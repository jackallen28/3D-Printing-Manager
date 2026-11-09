import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Home, Box, ScanLine, Layers3, Ruler } from "lucide-react";
import { addGlitterShader } from "../lib/glitter";
import { animatePrint, type PrintProgress } from "../lib/print-animation";
import { buildSupportPreview } from "../lib/support-preview";
import { thinFeatures } from "../../shared/thickness.js";
import type { LoadedModel } from "../lib/model";
import type { Analysis } from "../types";
export interface ViewerHandle {
  snapshot: () => Promise<Blob>;
  testPrint: () => Promise<boolean>;
  stopTestPrint: () => void;
}
export const Viewer = forwardRef<
  ViewerHandle,
  {
    model: LoadedModel;
    analysis?: Analysis;
    mapping?: Record<string, string>;
    scalePercent?: number;
    advancedSources?: string[];
    onPartSelect?: (source: string) => void;
    supportsVisible?: boolean;
    onSupportsChange?: (visible: boolean) => void;
    compact?: boolean;
    /** Show the wireframe and highlight toggles. Beginners see the highlights without the switches. */
    tools?: boolean;
  }
>(
  (
    {
      model,
      analysis,
      mapping = {},
      scalePercent = 100,
      advancedSources = [],
      onPartSelect,
      supportsVisible,
      onSupportsChange,
      compact,
      tools = true,
    },
    ref,
  ) => {
    const partCallback = useRef(onPartSelect);
    partCallback.current = onPartSelect;
    const scaleRef = useRef(scalePercent);
    scaleRef.current = scalePercent;
    const [baseDimensions, setBaseDimensions] = useState<number[]>([]);
    const container = useRef<HTMLDivElement>(null);
    const runtime = useRef<{
      renderer: THREE.WebGLRenderer;
      camera: THREE.PerspectiveCamera;
      scene: THREE.Scene;
      object: THREE.Group;
      root: THREE.Group;
      size: THREE.Vector3;
      controls: OrbitControls;
      render: () => void;
      reset: (animate?: boolean) => void;
      flyTo: (position: THREE.Vector3, target: THREE.Vector3) => void;
      overlays: THREE.Object3D[];
    } | null>(null);
    const [error, setError] = useState("");
    const [wireframe, setWireframe] = useState(false),
      [highlight, setHighlight] = useState(true),
      [showParts, setShowParts] = useState(true),
      [showThin, setShowThin] = useState(true);
    const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null);
    useEffect(() => {
      if (tools) return;
      setWireframe(false);
      setHighlight(true);
      setShowParts(true);
      setShowThin(true);
    }, [tools]);
    const animation = useRef<ReturnType<typeof animatePrint> | null>(null);
    const [localSupports, setLocalSupports] = useState(false);
    const supportShown = supportsVisible ?? localSupports;
    const toggleSupports = () => (onSupportsChange ? onSupportsChange(!supportShown) : setLocalSupports(!supportShown));
    const thin = useMemo(
      () =>
        analysis && model.format !== "obj"
          ? thinFeatures(analysis.thicknessSamples, analysis.partBounds, analysis.triangleParts, scalePercent)
          : { triangles: new Uint32Array() },
      [analysis, model.format, scalePercent],
    );
    useImperativeHandle(ref, () => ({
      snapshot: () =>
        new Promise((resolve, reject) => {
          const current = runtime.current;
          if (!current) return reject(new Error("The 3D viewer is not ready."));
          if (animation.current) return reject(new Error("Finish the test preview before confirming."));
          const visible = current.overlays.map((overlay) => overlay.visible);
          current.overlays.forEach((overlay) => (overlay.visible = false));
          current.render();
          current.renderer.domElement.toBlob((blob) => {
            current.overlays.forEach((overlay, i) => (overlay.visible = visible[i]));
            current.render();
            blob ? resolve(blob) : reject(new Error("The preview could not be captured."));
          }, "image/png");
        }),
      testPrint: async () => {
        const current = runtime.current;
        if (!current || !analysis || !analysis.complete || analysis.components > 64)
          throw new Error("Ask your teacher to check this detailed model.");
        animation.current?.stop();
        const visible = current.overlays.map((overlay) => overlay.visible);
        current.overlays.forEach((overlay) => (overlay.visible = false));
        const running = animatePrint({
          ...current,
          content: current.object.userData.content,
          model,
          analysis,
          scale: scalePercent / 100,
          mapping,
          advancedSources,
          onProgress: setPrintProgress,
        });
        animation.current = running;
        const finished = await running.finished;
        if (animation.current === running) animation.current = null;
        if (runtime.current === current) {
          current.overlays.forEach((overlay, i) => (overlay.visible = visible[i]));
          current.render();
        }
        return finished;
      },
      stopTestPrint: () => animation.current?.stop(),
    }));
    useEffect(() => {
      const host = container.current!;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      } catch {
        setError(
          "Your browser could not start the 3D viewer. Enable hardware acceleration or try Chrome / Edge on another computer.",
        );
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor("#0f1b21");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      renderer.domElement.setAttribute("aria-label", "3D model. Drag to rotate, scroll or pinch to zoom.");
      renderer.domElement.setAttribute("role", "img");
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
      const controls = new OrbitControls(camera, renderer.domElement);
      // Gentle damping makes rotating and zooming ease to a stop instead of halting abruptly.
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.maxPolarAngle = Math.PI * 0.88;
      const ambient = new THREE.HemisphereLight("#e4faff", "#25304a", 2.5);
      scene.add(ambient);
      const light = new THREE.DirectionalLight("#ffffff", 3.3);
      light.position.set(80, 140, 90);
      scene.add(light);
      const rim = new THREE.DirectionalLight("#cfe3ea", 1.4);
      rim.position.set(-80, 40, -70);
      scene.add(rim);
      const object = model.object.clone(true);
      object.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.geometry = n.geometry.clone();
          n.material = Array.isArray(n.material) ? n.material.map((m) => m.clone()) : n.material.clone();
          const attr = n.geometry.getAttribute("color");
          if (attr) {
            const original = new Float32Array(attr.array),
              keys: string[] = [],
              lookup = new Map<string, number>(),
              sourceIndex = new Uint16Array(attr.count),
              colour = new THREE.Color();
            for (let i = 0; i < attr.count; i++) {
              const key = "#" + colour.setRGB(original[i * 3], original[i * 3 + 1], original[i * 3 + 2]).getHexString();
              let index = lookup.get(key);
              if (index === undefined) {
                index = keys.length;
                keys.push(key);
                lookup.set(key, index);
              }
              sourceIndex[i] = index;
            }
            Object.assign(n.geometry.userData, { originalColours: original, sourceKeys: keys, sourceIndex });
          }
          n.geometry.setAttribute(
            "bntsGlitter",
            new THREE.BufferAttribute(new Float32Array(n.geometry.getAttribute("position").count), 1),
          );
          (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
            if (m instanceof THREE.MeshStandardMaterial) addGlitterShader(m);
          });
        }
      });
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      setBaseDimensions([size.x, size.y, size.z]);
      const content = new THREE.Group();
      content.add(object);
      content.position.set(-center.x, -center.y, -bounds.min.z);
      const rotate = new THREE.Group();
      rotate.rotation.x = -Math.PI / 2;
      rotate.add(content);
      rotate.scale.setScalar(scaleRef.current / 100);
      scene.add(rotate);
      const grid = new THREE.GridHelper(300, 30, "#3a4d57", "#24333b");
      scene.add(grid);
      const target = new THREE.Vector3(0, (size.z * 0.5 * scaleRef.current) / 100, 0);
      const render = () => renderer.render(scene, camera);
      // Render on demand: a frame loop runs only while the camera is moving, then stops.
      let frame = 0,
        interacting = false,
        flight: {
          from: THREE.Vector3;
          to: THREE.Vector3;
          fromTarget: THREE.Vector3;
          toTarget: THREE.Vector3;
          start: number;
        } | null = null;
      const FLIGHT_MS = 550;
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const loop = (now: number) => {
        frame = 0;
        if (flight) {
          const t = Math.min(1, (now - flight.start) / FLIGHT_MS),
            k = ease(t);
          camera.position.lerpVectors(flight.from, flight.to, k);
          controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
          if (t >= 1) flight = null;
        }
        const moved = controls.update();
        if (!moved) render();
        if (flight || interacting || moved) frame = requestAnimationFrame(loop);
      };
      const wake = () => {
        if (!frame) frame = requestAnimationFrame(loop);
      };
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const flyTo = (position: THREE.Vector3, nextTarget: THREE.Vector3) => {
        // Follows the device's reduce-motion setting: jump straight there when it is on.
        if (reducedMotion.matches) {
          flight = null;
          camera.position.copy(position);
          controls.target.copy(nextTarget);
          controls.update();
          render();
          return;
        }
        flight = {
          from: camera.position.clone(),
          to: position.clone(),
          fromTarget: controls.target.clone(),
          toTarget: nextTarget.clone(),
          start: performance.now(),
        };
        wake();
      };
      const reset = (animate = true) => {
        target.set(0, (size.z * 0.5 * scaleRef.current) / 100, 0);
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2),
          angle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
        const distance = (Math.max(((size.length() / 2) * scaleRef.current) / 100, 5) / Math.sin(angle)) * 1.22;
        const position = target.clone().add(new THREE.Vector3(1.3, 1, 1.6).normalize().multiplyScalar(distance));
        if (animate) return flyTo(position, target);
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        render();
      };
      controls.addEventListener("change", render);
      controls.addEventListener("start", () => {
        // The person takes over: stop any camera flight where it is.
        flight = null;
        interacting = true;
        wake();
      });
      controls.addEventListener("end", () => {
        interacting = false;
        wake();
      });
      const raycaster = new THREE.Raycaster();
      let pointerStart = { x: 0, y: 0 };
      const down = (event: PointerEvent) => {
        pointerStart = { x: event.clientX, y: event.clientY };
      };
      const up = (event: PointerEvent) => {
        if (
          !partCallback.current ||
          event.button !== 0 ||
          Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
        )
          return;
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = raycaster.intersectObject(object, true).find((h) => h.object instanceof THREE.Mesh);
        if (!hit) return;
        const mesh = hit.object as THREE.Mesh;
        let source = mesh.userData.colourSource as string | undefined;
        const original = mesh.geometry.userData.originalColours as Float32Array | undefined;
        if (!source && original && hit.face) {
          const i = hit.face.a;
          source =
            "#" + new THREE.Color().setRGB(original[i * 3], original[i * 3 + 1], original[i * 3 + 2]).getHexString();
        }
        partCallback.current(source || model.palette[0]);
      };
      renderer.domElement.addEventListener("pointerdown", down);
      renderer.domElement.addEventListener("pointerup", up);

      const resize = () => {
        const width = host.clientWidth,
          height = host.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      reset(false);
      runtime.current = {
        renderer,
        camera,
        scene,
        object,
        root: rotate,
        size,
        controls,
        render,
        reset,
        flyTo,
        overlays: [],
      };
      // Overlay uses the same world coordinates as analysis, before the preview's centring transform.
      runtime.current.object.userData.content = content;
      return () => {
        cancelAnimationFrame(frame);
        animation.current?.stop();
        animation.current = null;
        observer.disconnect();
        controls.dispose();
        scene.traverse((n) => {
          if (n instanceof THREE.Mesh || n instanceof THREE.LineSegments || n instanceof THREE.Points) {
            n.geometry.dispose();
            const materials = Array.isArray(n.material) ? n.material : [n.material];
            materials.forEach((m) => m.dispose());
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
      };
    }, [model]);
    useEffect(() => {
      const r = runtime.current;
      if (!r) return;
      r.object.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          const attribute = n.geometry.getAttribute("color") as THREE.BufferAttribute | undefined,
            original = n.geometry.userData.originalColours as Float32Array | undefined,
            keys = n.geometry.userData.sourceKeys as string[] | undefined,
            sourceIndex = n.geometry.userData.sourceIndex as Uint16Array | undefined;
          const glitter = n.geometry.getAttribute("bntsGlitter") as THREE.BufferAttribute;
          let sparkling = false;
          if (attribute && original && keys && sourceIndex) {
            const colours = attribute.array as Float32Array,
              flags = glitter.array as Float32Array;
            // One target colour and glitter flag per source colour, then a fast copy per vertex.
            const targets = keys.map((key) => (mapping[key] ? new THREE.Color(mapping[key]) : null));
            const active = keys.map((key) => advancedSources.includes(key));
            sparkling = active.some(Boolean);
            for (let i = 0; i < sourceIndex.length; i++) {
              const k = sourceIndex[i],
                next = targets[k],
                o = i * 3;
              if (next) {
                colours[o] = next.r;
                colours[o + 1] = next.g;
                colours[o + 2] = next.b;
              } else {
                colours[o] = original[o];
                colours[o + 1] = original[o + 1];
                colours[o + 2] = original[o + 2];
              }
              flags[i] = active[k] ? 1 : 0;
            }
            attribute.needsUpdate = true;
          }
          const source = n.userData.colourSource || model.palette[0];
          if (!attribute) {
            sparkling = advancedSources.includes(source);
            for (let i = 0; i < glitter.count; i++) glitter.setX(i, sparkling ? 1 : 0);
          }
          glitter.needsUpdate = true;
          const materials = Array.isArray(n.material) ? n.material : [n.material];
          materials.forEach((m) => {
            if (m instanceof THREE.MeshStandardMaterial) {
              m.wireframe = wireframe;
              m.metalness = sparkling ? 0.3 : 0.04;
              m.roughness = sparkling ? 0.35 : 0.55;
              if (!attribute) m.color.set(mapping[source] || source || "#19c1ca");
            }
          });
        }
      });
      r.render();
    }, [mapping, wireframe, model, advancedSources]);
    useEffect(() => {
      const r = runtime.current;
      if (!r) return;
      r.root.scale.setScalar(scalePercent / 100);
      r.controls.target.set(0, (r.size.z * 0.5 * scalePercent) / 100, 0);
      r.controls.update();
      r.render();
    }, [scalePercent, model]);
    useEffect(() => {
      const r = runtime.current;
      if (!r) return;
      const content = r.object.userData.content as THREE.Group;
      const dispose = (root: THREE.Object3D) =>
        root.traverse((node) => {
          if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments || node instanceof THREE.Points) {
            node.geometry.dispose();
            (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => m.dispose());
          }
        });
      for (const overlay of r.overlays) {
        content.remove(overlay);
        dispose(overlay);
      }
      r.overlays = [];
      const faces = (triangles: Uint32Array, colour: string, visible: boolean, opacity = 0.75) => {
        if (!triangles.length) return;
        const positions = new Float32Array(triangles.length * 9);
        triangles.forEach((triangle, i) =>
          positions.set(model.positions.subarray(triangle * 9, triangle * 9 + 9), i * 9),
        );
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: colour,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthTest: false,
          }),
        );
        mesh.visible = visible;
        mesh.renderOrder = 10;
        content.add(mesh);
        r.overlays.push(mesh);
      };
      if (analysis) {
        faces(analysis.overhangTriangles, "#a6adb3", true, 0.4);
        if (supportShown && analysis.supportContacts.length) {
          const supports = buildSupportPreview(analysis.supportContacts);
          content.add(supports);
          r.overlays.push(supports);
        }
        faces(analysis.floatingTriangles, "#ff716c", highlight);
        faces(thin.triangles, "#ffc153", showThin);
        if (analysis.problemEdges.length) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(analysis.problemEdges, 3));
          const edges = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({ color: "#ff716c", depthTest: false }),
          );
          edges.renderOrder = 12;
          content.add(edges);
          r.overlays.push(edges);
        }
        if (analysis.components > 1 && analysis.components <= 64) {
          const boxes = new THREE.Group();
          analysis.partBounds.forEach((part, index) => {
            const bounds = new THREE.Box3(new THREE.Vector3(...part.min), new THREE.Vector3(...part.max));
            bounds.expandByScalar(0.15);
            const colour = analysis.floatingParts.includes(index)
              ? "#ff716c"
              : new THREE.Color().setHSL((index * 0.618 + 0.45) % 1, 0.7, 0.65);
            boxes.add(new THREE.Box3Helper(bounds, colour));
          });
          boxes.visible = showParts;
          content.add(boxes);
          r.overlays.push(boxes);
        }
      }
      r.render();
    }, [analysis, highlight, showParts, showThin, thin, model, supportShown]);
    useEffect(() => {
      const r = runtime.current;
      if (!r || !supportShown || !analysis?.supportContacts.length) return;
      const ground = Math.min(...analysis.partBounds.map((part) => part.min[2])),
        height =
          analysis.supportContacts.reduce((sum, contact) => sum + (contact.top + contact.bottom) / 2, 0) /
          analysis.supportContacts.length;
      const distance = r.camera.position.distanceTo(r.controls.target),
        target = new THREE.Vector3(0, ((height - ground) * scaleRef.current) / 100, 0);
      // Glide down to a low angle so the underside and supports come into view.
      r.flyTo(target.clone().add(new THREE.Vector3(1.3, 0, 1.6).normalize().multiplyScalar(distance)), target);
    }, [supportShown, analysis, model]);
    return (
      <div
        className={"viewer " + (compact ? "compact" : "")}
        data-print-test-phase={printProgress ? (printProgress.falling ? "falling" : "printing") : "idle"}
        data-support-preview={supportShown ? "visible" : "hidden"}
        data-support-count={analysis?.supportContacts.length || 0}
      >
        <div className="viewer-unit-label">
          {baseDimensions.map((n) => ((n * scalePercent) / 100).toFixed(1)).join(" × ")} mm
        </div>
        <div className="viewer-canvas" ref={container} />
        {printProgress ? (
          <div className="print-animation-label" role="status">
            <b>Test print {printProgress.percent}%</b>
            <span>
              Layer {printProgress.layer} of {printProgress.layers}
              {printProgress.falling ? " · Floating parts are falling" : ""}
            </span>
          </div>
        ) : (
          analysis && (
            <div className="viewer-issue-key">
              {analysis.components > 1 && (
                <span>
                  <i className="parts-key" />
                  Separate parts outlined
                </span>
              )}
              {analysis.floating > 0 && (
                <span>
                  <i className="floating-key" />
                  Floating parts
                </span>
              )}
              {thin.triangles.length > 0 && (
                <span>
                  <i className="thin-key" />
                  Thin areas
                </span>
              )}
              {analysis.supportContacts.length > 0 && (
                <button
                  type="button"
                  className="support-key-button"
                  disabled={!!printProgress}
                  aria-pressed={supportShown}
                  onClick={toggleSupports}
                >
                  <i className="support-key" />
                  {supportShown ? "Hide supports" : "Show supports"}
                </button>
              )}
              {supportShown && analysis.supportContacts.length > 0 && (
                <span className="support-finish-note">Speckled areas may leave a rough underside.</span>
              )}
              {analysis.problemEdges.length > 0 && (
                <span>
                  <i className="floating-key" />
                  Holes or open edges
                </span>
              )}
            </div>
          )
        )}
        {error && (
          <div className="viewer-error" role="alert">
            {error}
          </div>
        )}
        <div className="viewer-bottom">
          <span>Drag to rotate · Scroll to zoom · Grid squares are 10 mm</span>
          <div className="viewer-tools">
            <button
              type="button"
              className="viewer-home"
              onClick={() => runtime.current?.reset()}
              title="Return to the starting view"
            >
              <Home size={16} /> Reset view
            </button>
            {tools && (
              <>
                <button
                  type="button"
                  onClick={() => setWireframe(!wireframe)}
                  aria-pressed={wireframe}
                  title="Show wireframe"
                  aria-label="Show wireframe"
                >
                  <Box size={17} />
                </button>
                {!!analysis && analysis.components > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowParts(!showParts)}
                    disabled={!!printProgress}
                    aria-pressed={showParts}
                    title="Highlight separate parts"
                    aria-label="Highlight separate parts"
                  >
                    <Layers3 size={17} />
                  </button>
                )}
                {!!thin.triangles.length && (
                  <button
                    type="button"
                    onClick={() => setShowThin(!showThin)}
                    disabled={!!printProgress}
                    aria-pressed={showThin}
                    title="Highlight thin areas"
                    aria-label="Highlight thin areas"
                  >
                    <Ruler size={17} />
                  </button>
                )}
                {!!analysis?.floating && (
                  <button
                    type="button"
                    onClick={() => setHighlight(!highlight)}
                    disabled={!!printProgress}
                    aria-pressed={highlight}
                    title="Highlight floating parts"
                    aria-label="Highlight floating parts"
                  >
                    <ScanLine size={17} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
