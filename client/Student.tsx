import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Upload,
  Check,
  CheckCircle2,
  FileBox,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Play,
  Square,
  Info,
} from "lucide-react";
import { api, upload, setUploadMode, setHumanToken } from "./lib/api";
import HumanCheck from "./components/HumanCheck";
import { loadModel, splitModelParts, areaName, type LoadedModel } from "./lib/model";
import { Viewer, type ViewerHandle } from "./components/Viewer";
import { ErrorMessage, Field, Loading, PageLoading, bytesLabel, dateLabel } from "./components/Layout";
import ColourEditor from "./components/ColourEditor";
import PrintPreferences, {
  printOptions,
  usesAdvancedSettings,
  type FilePrintOptions,
} from "./components/PrintPreferences";
import { splitGroups, splitIntoFiles } from "../shared/split-files.js";
import ViewAtHome from "./components/ViewAtHome";
import ModeSwitch, { saveMode, savedMode, type Mode } from "./components/ModeSwitch";
import { dimensionWarnings } from "../shared/geometry.js";
import { thinFeatures } from "../shared/thickness.js";
import { printTestResult } from "../shared/print-test.js";
import { scaleLabel } from "../shared/printing.js";
import { ADVANCED_FILAMENT, ADVANCED_HEX, displayLabel } from "../shared/catalog.js";
import type { Analysis, Config, Details } from "./types";
import AnalysisWorker from "./lib/analysis.worker?worker&inline";
import { fileFormat, enabledFormats } from "../shared/formats.js";
import { extractCadArchive } from "../shared/archives.js";
import { filePreview } from "./lib/file-preview";
const freshDetails = (): Details => ({
  requestId: crypto.randomUUID(),
  firstName: "",
  schoolId: "",
  staffId: "",
  classId: "",
  classCode: "",
  classroom: "",
  scalePercent: 100,
  dimensionsMm: null,
  advancedFilamentNote: "",
  colour: "",
  customColour: "",
  colourMapping: [],
  size: "Original size",
  supports: "Let staff decide",
  printer: "Let staff decide",
  quality: "Standard",
  copies: 1,
  notes: "",
  designLink: "",
  readyConfirmed: false,
  detailsConfirmed: false,
});
type PreparedPrint = {
  file: File;
  preview: Blob;
  requestId: string;
  preferences: Pick<
    Details,
    "colour" | "customColour" | "colourMapping" | "advancedFilamentNote" | "scalePercent" | "dimensionsMm"
  > & { printOptions?: FilePrintOptions };
};
const steps = ["Upload", "Check model", "Your details", "Review"];
export default function Student() {
  const [config, setConfig] = useState<Config | null>(null),
    [configError, setConfigError] = useState("");
  const [step, setStep] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [model, setModel] = useState<LoadedModel | null>(null),
    [analysis, setAnalysis] = useState<Analysis | undefined>(),
    [details, setDetails] = useState<Details>(freshDetails);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [analysing, setAnalysing] = useState(false),
    [drag, setDrag] = useState(false),
    [progress, setProgress] = useState(0),
    [receipt, setReceipt] = useState<any>(null),
    [preview, setPreview] = useState<Blob | null>(null);
  const [archiveQueue, setArchiveQueue] = useState<File[]>([]),
    [archiveName, setArchiveName] = useState(""),
    [archiveTotal, setArchiveTotal] = useState(1),
    [preparedFiles, setPreparedFiles] = useState<PreparedPrint[]>([]);
  const [splitDismissed, setSplitDismissed] = useState(false);
  const splitDefaults = useRef(new WeakMap<File, Partial<Details>>());
  useEffect(() => setSplitDismissed(false), [file]);
  const [selectedPart, setSelectedPart] = useState("");
  // Beginner shows the essentials; Advanced adds per-part colours, file splitting, special filaments,
  // viewer tools and print settings. Remembered on this device.
  const [mode, setMode] = useState<Mode>(savedMode);
  // A signed pass from the optional robot check. It covers every file in this request for 30 minutes.
  const [humanPass, setHumanPass] = useState("");
  const passHuman = (pass: string) => {
    setHumanToken(pass);
    setHumanPass(pass);
  };
  const expert = mode === "advanced";
  const changeMode = (next: Mode) => {
    setMode(next);
    saveMode(next);
  };
  const [showSupports, setShowSupports] = useState(false);
  useEffect(() => setShowSupports(false), [file, model]);
  const [printTest, setPrintTest] = useState<ReturnType<typeof printTestResult> | "running" | null>(null);
  const printTestToken = useRef(0);
  const input = useRef<HTMLInputElement>(null),
    viewer = useRef<ViewerHandle>(null),
    worker = useRef<Worker | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    printTestToken.current++;
    viewer.current?.stopTestPrint();
    setPrintTest(null);
  }, [file, model, details.scalePercent, details.colourMapping]);
  const getConfig = () => {
    setConfigError("");
    api<Config>("/config")
      .then((value) => {
        setUploadMode(value.uploadMode);
        setConfig(value);
      })
      .catch((e) => setConfigError(e.message));
  };
  useEffect(() => {
    getConfig();
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    if (step) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      heading.current?.focus();
    }
  }, [step]);
  const update = (patch: Partial<Details>) => setDetails((d) => ({ ...d, ...patch, detailsConfirmed: false }));
  const choose = async (f?: File, fromArchive = false) => {
    if (!f) return;
    setError("");
    const extension = f.name.includes(".") ? f.name.split(".").at(-1)!.toLowerCase() : "";
    if (!config?.acceptedExtensions.includes(extension)) {
      setError(
        `${extension ? extension.toUpperCase() + " files" : "Files without a type"} can’t be uploaded. Use ${fileTypesLabel(config?.acceptedExtensions || [])}.`,
      );
      return;
    }
    const maxBytes = config?.maxBytes || 50 * 1024 * 1024;
    if (!f.size) {
      setError("This file is empty. Export it again from your CAD program.");
      return;
    }
    if (f.size > maxBytes) {
      setError(`This file is over ${maxBytes / 1024 / 1024} MB. Export a smaller file, or ask your teacher.`);
      return;
    }
    setBusy(true);
    worker.current?.terminate();
    setAnalysis(undefined);
    setAnalysing(true);
    try {
      if (/\.zip$/i.test(f.name)) {
        const extracted = extractCadArchive(await f.arrayBuffer(), config!.acceptedExtensions).map(
          (entry) => new File([new Uint8Array(entry.bytes)], entry.name, { type: "application/octet-stream" }),
        );
        setArchiveName(f.name);
        setArchiveTotal(extracted.length);
        setArchiveQueue(extracted.slice(1));
        setPreparedFiles([]);
        await choose(extracted[0], true);
        return;
      }
      if (!fromArchive) {
        setArchiveName("");
        setArchiveQueue([]);
        setArchiveTotal(1);
        setPreparedFiles([]);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (!fileFormat(f.name)?.preview) {
        setFile(f);
        setModel(null);
        setPreview(await filePreview(f));
        setDetails({
          ...freshDetails(),
          colour: config?.colours[0]?.name || "Custom",
          colourMapping: [{ source: "#19c1ca", target: config?.colours[0]?.name || "Custom" }],
        });
        setAnalysing(false);
        setStep(1);
        return;
      }
      const loaded = await loadModel(f),
        defaults = splitDefaults.current.get(f);
      const initialMapping = loaded.palette.map((source) => ({
        source,
        target:
          defaults?.colourMapping?.find((m) => m.source === source)?.target ||
          (loaded.parts || loaded.palette.length === 1 || mode === "beginner"
            ? config?.colours[0]?.name || "Custom"
            : closestColour(source, config!)),
      }));
      setFile(f);
      setModel(loaded);
      setSelectedPart(loaded.palette[0]);
      setPreview(null);
      setDetails((previous) => ({
        ...freshDetails(),
        ...(fromArchive
          ? {
              firstName: previous.firstName,
              schoolId: previous.schoolId,
              staffId: previous.staffId,
              classId: previous.classId,
              classCode: previous.classCode,
              classroom: previous.classroom,
            }
          : {}),
        ...defaults,
        colour: initialMapping[0]?.target || "Custom",
        colourMapping: initialMapping,
      }));
      setStep(1);
      const w = new AnalysisWorker();
      worker.current = w;
      w.onmessage = (e) => {
        if (e.data.error) setError(e.data.error);
        else {
          setAnalysis(e.data.result);
          const split = splitModelParts(loaded, e.data.result.triangleParts, e.data.result.components);
          if (split !== loaded) {
            setModel(split);
            setSelectedPart(split.palette[0]);
          }
          setDetails((d) => {
            const colours =
              split !== loaded ? split.palette.map((source) => ({ source, target: d.colour })) : d.colourMapping;
            return {
              ...d,
              colourMapping: colours.map((entry, i) => ({
                ...entry,
                partName: areaName(split, entry.source, i, e.data.result.components === 1 && colours.length > 1).slice(
                  0,
                  80,
                ),
              })),
              readyConfirmed: false,
            };
          });
        }
        setAnalysing(false);
        w.terminate();
      };
      w.onerror = () => {
        setError("The model check didn’t finish. Try exporting a smaller file.");
        setAnalysing(false);
        w.terminate();
      };
      const data = loaded.positions.slice();
      w.postMessage({ positions: data, format: loaded.format }, [data.buffer]);
    } catch (e) {
      if (fromArchive) {
        setStep(0);
        setFile(null);
        setModel(null);
        setArchiveQueue([]);
        setPreparedFiles([]);
        setArchiveName("");
        setArchiveTotal(1);
      }
      const message = e instanceof Error ? e.message : "The model could not be opened.";
      setError(fromArchive ? f.name + ": " + message + " Remove this file from the ZIP and try again." : message);
      setAnalysing(false);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const targetHex = (name: string) =>
    name === ADVANCED_FILAMENT ? ADVANCED_HEX : config?.colours.find((c) => c.name === name)?.hex || "#cfc2e0";
  const mapping = Object.fromEntries(details.colourMapping.map((m) => [m.source, targetHex(m.target)]));
  const colourNames = [...new Set(details.colourMapping.map((m) => m.target))];
  const advancedSources = details.colourMapping.filter((m) => m.target === ADVANCED_FILAMENT).map((m) => m.source);
  const needsAdvanced = details.colour === ADVANCED_FILAMENT || advancedSources.length > 0;
  const dimensionsMm = analysis?.dimensions.map((v) => (v * details.scalePercent) / 100) || null;
  const scaledAnalysis = analysis
    ? {
        ...analysis,
        dimensions: dimensionsMm!,
        warnings: [
          ...analysis.warnings.filter((w) => !["size", "thin", "units", "thin-features"].includes(w.code)),
          ...dimensionWarnings(dimensionsMm!),
          ...(model?.format === "obj"
            ? []
            : thinFeatures(analysis.thicknessSamples, analysis.partBounds, analysis.triangleParts, details.scalePercent)
                .warnings),
        ],
      }
    : undefined;
  const needsCustom = details.colour === "Custom" || details.colourMapping.some((m) => m.target === "Custom");
  const sections = analysis?.components === 1 && details.colourMapping.length > 1;
  const objects = model && analysis ? splitGroups(model, analysis) : [];
  const curiousExtras = [
    details.colourMapping.length > 1 &&
      `colour each of the ${details.colourMapping.length} ${sections ? "sections" : "parts"} separately`,
    objects.length > 1 && objects.length <= 20 && `split it into ${objects.length} separate files`,
    model && "see the triangles your model is made of",
    "ask for special filaments like silk or glow-in-the-dark",
  ]
    .filter((item): item is string => !!item)
    .slice(0, 3);
  const convertObjects = async () => {
    if (!file || !model || !analysis) return;
    setError("");
    setBusy(true);
    try {
      const files = splitIntoFiles(file, model, analysis);
      if (archiveTotal + files.length - 1 > 20)
        throw new Error("Review up to 20 files at a time. Split this file into smaller groups in your CAD program.");
      for (const [index, output] of files.entries()) {
        const sources = new Set<string>();
        for (const triangle of objects[index].triangles)
          for (let vertex = 0; vertex < 3; vertex++)
            sources.add(model.palette[model.colourIndices[triangle * 3 + vertex]]);
        const colours = details.colourMapping.filter((entry) => sources.has(entry.source)),
          target = colours[0]?.target || details.colour;
        const colourMapping = model.format === "stl" ? [{ source: "#19c1ca", target }] : colours;
        splitDefaults.current.set(output, {
          scalePercent: details.scalePercent,
          colourMapping,
          advancedFilamentNote: colourMapping.some((entry) => entry.target === ADVANCED_FILAMENT)
            ? details.advancedFilamentNote
            : "",
          customColour: colourMapping.some((entry) => entry.target === "Custom") ? details.customColour : "",
          ...printOptions(details),
        });
      }
      setArchiveName(archiveName || file.name);
      setArchiveTotal((total) => total + files.length - 1);
      setArchiveQueue((queue) => [...files.slice(1), ...queue]);
      await choose(files[0], true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    if (!analysis) return;
    const token = ++printTestToken.current;
    setPrintTest("running");
    update({ readyConfirmed: false });
    setError("");
    try {
      const finished = await viewer.current!.testPrint();
      if (token === printTestToken.current)
        setPrintTest(finished ? printTestResult(analysis, scaledAnalysis!.warnings) : null);
    } catch (error) {
      if (token === printTestToken.current) {
        setPrintTest(null);
        setError((error as Error).message);
      }
    }
  };
  const stopPrintTest = () => {
    printTestToken.current++;
    viewer.current?.stopTestPrint();
    setPrintTest(null);
  };
  const confirmModel = async () => {
    setError("");
    setBusy(true);
    try {
      if (printTest === "running") throw new Error("Wait for the test print to finish.");
      if (model && !analysis) throw new Error("Wait for the model check to finish.");
      if (scaledAnalysis?.warnings.length && !details.readyConfirmed)
        throw new Error("Tick the box to show you’ve read the model check.");
      if (needsAdvanced && !details.advancedFilamentNote.trim())
        throw new Error("Say which special filament you need.");
      if (needsCustom && !details.customColour.trim()) throw new Error("Say which colour you’d like.");
      if (
        archiveTotal > 1 &&
        [details.supports, details.printer, details.quality].some((value) => value.startsWith("Custom")) &&
        !details.notes.trim()
      )
        throw new Error("You chose Other, so add a note explaining what you need.");
      if (archiveTotal > 1 && details.designLink) {
        let valid = false;
        try {
          const link = new URL(details.designLink);
          valid = link.protocol === "https:" && !link.username && !link.password;
        } catch {}
        if (!valid) throw new Error("The design link must be a share link that starts with https://");
      }
      const blob = model ? await viewer.current!.snapshot() : preview;
      if (!blob || !file) throw new Error("The preview is not ready.");
      setPreview(blob);
      const prepared: PreparedPrint = {
        file,
        preview: blob,
        requestId: details.requestId,
        preferences: {
          colour: details.colourMapping[0]?.target || details.colour,
          customColour: details.customColour,
          colourMapping: details.colourMapping,
          advancedFilamentNote: details.advancedFilamentNote,
          scalePercent: details.scalePercent,
          dimensionsMm,
          printOptions: archiveTotal > 1 ? printOptions(details) : undefined,
        },
      };
      setPreparedFiles((previous) => [...previous.filter((p) => p.file !== file), prepared]);
      if (archiveQueue.length) {
        const [next, ...rest] = archiveQueue;
        setArchiveQueue(rest);
        await choose(next, true);
      } else setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!preparedFiles.length) return;
    setError("");
    setBusy(true);
    setProgress(0);
    const results = [];
    try {
      for (let i = 0; i < preparedFiles.length; i++) {
        const prepared = preparedFiles[i];
        const { printOptions: options, ...preferences } = prepared.preferences;
        const form = new FormData();
        form.append("model", prepared.file);
        form.append("preview", prepared.preview, "preview.png");
        form.append(
          "details",
          JSON.stringify({
            ...details,
            ...preferences,
            ...options,
            requestId: prepared.requestId,
            size: scaleLabel(prepared.preferences.scalePercent),
            readyConfirmed: true,
            detailsConfirmed: true,
          }),
        );
        const result = await upload(form, (value) =>
          setProgress(Math.round(((i + value / 100) / preparedFiles.length) * 100)),
        );
        results.push({ ...result, originalName: prepared.file.name });
      }
      setReceipt({ ...results.at(-1), count: results.length, files: results });
      setStep(4);
    } catch (e) {
      // The robot-check pass lasts 30 minutes; if it ran out, ask again rather than failing.
      if (/robot check/i.test((e as Error).message)) passHuman("");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    worker.current?.terminate();
    splitDefaults.current = new WeakMap();
    setStep(0);
    setModel(null);
    setFile(null);
    setReceipt(null);
    setError("");
    setAnalysis(undefined);
    setPreview(null);
    setDetails(freshDetails());
    setArchiveQueue([]);
    setArchiveName("");
    setArchiveTotal(1);
    setPreparedFiles([]);
    getConfig();
  };
  if (!config && !configError) return <PageLoading />;
  if (configError)
    return (
      <section className="page narrow">
        <h1>Can’t connect right now</h1>
        <ErrorMessage message={configError} />
        <button className="button primary" onClick={getConfig}>
          <RotateCcw size={16} /> Try again
        </button>
      </section>
    );
  if (!config) return null;
  const typesLabel = fileTypesLabel(config.acceptedExtensions);
  const maxMb = config.maxBytes / 1024 / 1024;
  const warnings = scaledAnalysis?.warnings || [];
  const needsAck = warnings.length > 0;
  const dimensionsText = dimensionsMm ? dimensionsMm.map((v) => v.toFixed(1)).join(" × ") + " mm" : "";
  const schoolName = config.schools.find((s) => s.id === details.schoolId)?.name;
  const teacherName = config.staff.find((s) => s.id === details.staffId)?.name;
  const colourText = colourNames.map((c) => (c === "Custom" ? details.customColour : displayLabel(c))).join(", ");
  return (
    <div className={"student page " + (step === 0 || step === 4 ? "landing" : "workflow")}>
      {config.localDemo && <div className="demo-banner">Local demo. Files are saved on this computer only.</div>}
      {step === 0 ? (
        <section className="landing-intro" aria-labelledby="landing-title">
          <h1 id="landing-title">Send a file to be 3D printed</h1>
          <p className="lead">
            Upload your model, check it in 3D and choose a colour. Your BNTS teacher will check it before it’s printed.
          </p>
          <ModeSwitch mode={mode} onChange={changeMode} />
          <div
            className={"drop-zone" + (drag ? " dragging" : "") + (!config.acceptingUploads ? " unavailable" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (config.acceptingUploads && !busy) {
                if (e.dataTransfer.files.length > 1)
                  setError("Drop one file at a time. To send several files, put them in a ZIP.");
                else choose(e.dataTransfer.files[0]);
              }
            }}
          >
            <Upload size={24} strokeWidth={1.75} aria-hidden="true" />
            <p className="drop-title">
              {busy ? "Opening your file…" : drag ? "Drop to upload" : "Drag your file here, or"}
            </p>
            <input
              ref={input}
              type="file"
              accept={config.acceptedExtensions.map((e) => "." + e).join(",")}
              aria-label="Upload a 3D printing file"
              className="visually-hidden"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <button
              className="button primary"
              disabled={busy || !config.acceptingUploads}
              onClick={() => input.current?.click()}
            >
              {busy && <span className="spinner" />} Choose a file
            </button>
            <p className="hint">
              {typesLabel}. Up to {maxMb} MB.
            </p>
          </div>
          <ErrorMessage message={error} />
          {!config.acceptingUploads && (
            <p className="notice">
              {config.uploadsPaused
                ? "Uploads are paused right now. Ask your teacher when they’ll be back on."
                : "Uploads aren’t open yet. Your teacher is still setting things up."}
            </p>
          )}
          <p className="hint">You don’t need an account. Files are deleted after 14 days.</p>
        </section>
      ) : step === 4 ? (
        <section className="success" aria-labelledby="success-title">
          <span className="success-icon" aria-hidden="true">
            <Check size={24} strokeWidth={2.5} />
          </span>
          <h1 id="success-title">
            {receipt.count > 1 ? `Your ${receipt.count} files have been sent` : "Your file has been sent"}
          </h1>
          <p className="lead">
            Thanks, {receipt.firstName}. Your BNTS teacher will check {receipt.count > 1 ? "them" : "it"} before
            printing.
          </p>
          <dl className="panel summary-list">
            <div>
              <dt>{receipt.count > 1 ? "Files" : "File"}</dt>
              <dd className="filename">
                {receipt.count > 1
                  ? receipt.files.map((f: { originalName: string }) => f.originalName).join(", ")
                  : file?.name}
              </dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{receipt.id.slice(0, 8).toUpperCase()}</dd>
            </div>
            <div>
              <dt>Available until</dt>
              <dd>{dateLabel(receipt.expiresAt)}</dd>
            </div>
          </dl>
          <button className="button primary" onClick={reset}>
            Send another file
          </button>
        </section>
      ) : (
        <>
          <div className="workflow-top">
            <nav className="stepper" aria-label="Upload progress">
              <ol>
                {steps.map((name, i) => (
                  <li
                    className={step === i ? "current" : step > i ? "done" : ""}
                    key={name}
                    aria-current={step === i ? "step" : undefined}
                  >
                    <span aria-hidden="true">{step > i ? <Check size={14} strokeWidth={2.5} /> : i + 1}</span>
                    {name}
                  </li>
                ))}
              </ol>
            </nav>
            <ModeSwitch mode={mode} onChange={changeMode} compact />
          </div>
          <header className="step-heading">
            <h1 ref={heading} tabIndex={-1}>
              {step === 1 ? "Check your model" : step === 2 ? "Your details" : "Review and send"}
            </h1>
            <p className="lead">
              {step === 1
                ? "Turn your model to check it from every side, then choose its size and colour."
                : step === 2
                  ? "Your teacher uses these to find your print."
                  : "Check everything is right, then send it to your teacher."}
            </p>
          </header>
          {file && (
            <div className="file-bar">
              <FileBox size={18} aria-hidden="true" />
              <strong>{file.name}</strong>
              <span>
                {bytesLabel(file.size)}
                {archiveName && ` · File ${archiveTotal - archiveQueue.length} of ${archiveTotal} from ${archiveName}`}
              </span>
              {step === 1 && (
                <button className="text-button" onClick={reset} disabled={busy}>
                  Change file
                </button>
              )}
            </div>
          )}
          <ErrorMessage message={error} />
          {step === 1 && file && (
            <>
              {expert && objects.length > 1 && !splitDismissed && (
                <section className="callout" aria-label="Separate objects">
                  <Info size={20} aria-hidden="true" />
                  <div>
                    <strong>This file has {objects.length} separate objects.</strong>
                    <p>
                      {objects.length > 20
                        ? "That’s too many to split here. Split them into groups of up to 20 in your CAD program."
                        : "You can split them into separate files, each with its own size and colour, or keep them together."}
                    </p>
                    <div className="button-row">
                      <button
                        className="button secondary"
                        disabled={busy || analysing || printTest === "running" || objects.length > 20}
                        onClick={convertObjects}
                      >
                        Split into separate files
                      </button>
                      <button className="text-button" disabled={busy} onClick={() => setSplitDismissed(true)}>
                        Keep as one file
                      </button>
                    </div>
                  </div>
                </section>
              )}
              <div className="preview-layout">
                <div className="preview-column">
                  {model ? (
                    <Viewer
                      ref={viewer}
                      model={model}
                      analysis={analysis}
                      mapping={mapping}
                      scalePercent={details.scalePercent}
                      advancedSources={advancedSources}
                      onPartSelect={setSelectedPart}
                      supportsVisible={showSupports}
                      onSupportsChange={setShowSupports}
                      tools={expert}
                    />
                  ) : (
                    <UnsupportedPreview filename={file.name} />
                  )}
                  {model && (
                    <section className="test-print" aria-label="Test print">
                      <div className="button-row">
                        <button
                          className="button secondary"
                          disabled={
                            analysing ||
                            !analysis ||
                            !analysis.complete ||
                            analysis.components > 64 ||
                            printTest === "running"
                          }
                          onClick={testPrint}
                        >
                          {printTest === "running" ? <span className="spinner" /> : <Play size={16} />} Test print
                        </button>
                        {printTest === "running" && (
                          <button className="text-button" onClick={stopPrintTest}>
                            <Square size={14} /> Stop
                          </button>
                        )}
                      </div>
                      <p className="hint">
                        {analysis && (!analysis.complete || analysis.components > 64)
                          ? "This model is too detailed for a test print. Your teacher will check it."
                          : "Watch your model print layer by layer to spot problems early."}
                      </p>
                      {printTest && printTest !== "running" && (
                        <div className={"print-test-result " + printTest.state} role="status">
                          <strong>{printTest.title}</strong>
                          {printTest.fixes.length > 0 ? (
                            <ul>
                              {printTest.fixes.map((fix) => (
                                <li key={fix}>{fix}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>Your teacher will still check it before printing.</p>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
                <aside className="panel checks-panel" aria-labelledby="checks-heading">
                  <h2 id="checks-heading">Model check</h2>
                  {analysing ? (
                    <Loading label="Checking your model…" />
                  ) : analysis ? (
                    <>
                      <div className={"check-summary" + (warnings.length ? " warning" : "")}>
                        {warnings.length ? (
                          <AlertTriangle size={20} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 size={20} aria-hidden="true" />
                        )}
                        <div>
                          <strong>
                            {!analysis.complete
                              ? "Your teacher needs to check this model"
                              : warnings.length
                                ? `${warnings.length} ${warnings.length === 1 ? "thing" : "things"} to check`
                                : model?.format === "obj"
                                  ? "Preview ready"
                                  : "No problems found"}
                          </strong>
                          <small>
                            {warnings.length
                              ? "Fix these in your CAD program, or ask your teacher."
                              : "Your teacher will still check it before printing."}
                          </small>
                        </div>
                      </div>
                      <ul className="checks-list">
                        {warnings.map((w) => (
                          <li className="check-warning" key={w.code}>
                            <b>{w.title}</b>
                            <p>{w.detail}</p>
                          </li>
                        ))}
                        {!warnings.length && model?.format !== "obj" && (
                          <>
                            <li className="check-ok">
                              <Check size={16} aria-hidden="true" />
                              {sections ? "Sections are joined" : "Parts are connected"}
                            </li>
                            <li className="check-ok">
                              <Check size={16} aria-hidden="true" /> No holes in the surface
                            </li>
                            <li className="check-ok">
                              <Check size={16} aria-hidden="true" /> Fits on the printer
                            </li>
                          </>
                        )}
                      </ul>
                      {expert && analysis.complete && (
                        <p className="model-facts">
                          {analysis.triangles.toLocaleString()} triangles · {analysis.components}{" "}
                          {analysis.components === 1 ? "part" : "parts"}
                          {dimensionsText && ` · ${dimensionsText}`}
                        </p>
                      )}
                      {analysis.notices.map((n) =>
                        n.code === "supports" ? (
                          <button
                            type="button"
                            className="support-card"
                            key={n.code}
                            aria-pressed={showSupports}
                            disabled={printTest === "running"}
                            onClick={() => setShowSupports((value) => !value)}
                          >
                            <strong>{n.title}</strong>
                            <small>{n.detail}</small>
                            <span className="support-card-action">
                              {showSupports ? "Hide supports" : "Show supports"}
                            </span>
                          </button>
                        ) : (
                          <div className="check-info" key={n.code}>
                            <b>{n.title}</b>
                            <p>{n.detail}</p>
                          </div>
                        ),
                      )}
                    </>
                  ) : (
                    <p className="hint">
                      {file.name.split(".").at(-1)?.toUpperCase()} files can’t be checked here. Check it in your CAD
                      program. Your teacher will also check it before printing.
                    </p>
                  )}
                </aside>
              </div>
              <section className="panel" aria-labelledby="size-heading">
                <h2 id="size-heading">Size</h2>
                <div className="scale-controls">
                  <input
                    type="range"
                    aria-label="Model scale slider"
                    min={1}
                    max={1000}
                    step={1}
                    value={details.scalePercent}
                    onChange={(e) => update({ scalePercent: Number(e.target.value), readyConfirmed: false })}
                  />
                  {expert && (
                    <label className="field scale-input">
                      Scale (%)
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        step={1}
                        value={details.scalePercent}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v))
                            update({ scalePercent: Math.min(1000, Math.max(1, v)), readyConfirmed: false });
                        }}
                      />
                    </label>
                  )}
                  <button
                    className="text-button"
                    disabled={details.scalePercent === 100}
                    onClick={() => update({ scalePercent: 100, readyConfirmed: false })}
                  >
                    Reset to 100%
                  </button>
                </div>
                <p className="scale-result">
                  {dimensionsMm ? (
                    <>
                      Print size: <b>{dimensionsText}</b> (width × depth × height)
                    </>
                  ) : model ? (
                    "Measuring…"
                  ) : (
                    "The size can’t be measured for this file type."
                  )}
                </p>
                <p className="hint">
                  Your file isn’t changed. Your teacher sets this size when printing.
                  {model?.notices.map((n) => " " + n)}
                </p>
              </section>
              <ColourEditor
                expert={expert}
                key={file.name + file.size}
                model={model}
                sections={sections}
                mapping={details.colourMapping}
                colours={config.colours}
                customEnabled={config.customColourEnabled}
                selectedPart={selectedPart}
                onSelect={setSelectedPart}
                onMapping={(value) =>
                  update({
                    colourMapping: value.map((entry, i) => ({
                      ...entry,
                      partName: areaName(model, entry.source, i, sections).slice(0, 80),
                    })),
                    colour: value[0]?.target || details.colour,
                    readyConfirmed: false,
                  })
                }
                customColour={details.customColour}
                advancedNote={details.advancedFilamentNote}
                onCustom={(value) => update({ customColour: value })}
                onAdvanced={(value) => update({ advancedFilamentNote: value })}
              />
              {archiveTotal > 1 && (
                <section className="panel" aria-labelledby="file-options-heading">
                  <h2 id="file-options-heading">Print options for this file</h2>
                  <PrintPreferences
                    key={file.name + file.size}
                    value={details}
                    onChange={update}
                    expert={expert}
                    onShowAdvanced={() => changeMode("advanced")}
                  />
                </section>
              )}
              {!expert && curiousExtras.length > 0 && (
                <div className="curious">
                  <p>
                    <b>Want more control?</b> Advanced mode lets you {listText(curiousExtras)}.
                  </p>
                  <button type="button" className="text-button" onClick={() => changeMode("advanced")}>
                    Switch to Advanced
                  </button>
                </div>
              )}
              {needsAck && (
                <label className="checkbox-row acknowledge">
                  <input
                    type="checkbox"
                    checked={details.readyConfirmed}
                    onChange={(e) => update({ readyConfirmed: e.target.checked })}
                  />
                  <span>I’ve read the model check. I’ll fix the problems or ask my teacher for help.</span>
                </label>
              )}
              <div className="actions">
                <button className="text-button" onClick={reset} disabled={busy}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    printTest === "running" ||
                    (!!model && !analysis) ||
                    analysing ||
                    (needsAck && !details.readyConfirmed)
                  }
                  onClick={confirmModel}
                >
                  {busy && <span className="spinner" />}
                  {archiveQueue.length ? "Next file" : "Continue"}
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                if (needsCustom && !details.customColour.trim()) {
                  setError("Say which colour you’d like. Go back to your model to add it.");
                  return;
                }
                if (
                  [details.supports, details.printer, details.quality].some((x) => x.startsWith("Custom")) &&
                  !details.notes.trim()
                ) {
                  setError("You chose Other, so add a note explaining what you need.");
                  return;
                }
                setBusy(true);
                try {
                  const result = await api("/classes/resolve", {
                    method: "POST",
                    body: JSON.stringify({ schoolId: details.schoolId, classCode: details.classCode }),
                  });
                  update({ classId: result.classId, classroom: result.classroom });
                  setStep(3);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <section className="panel" aria-labelledby="about-heading">
                <h2 id="about-heading">About you</h2>
                <div className="form-grid">
                  <Field label="First name" hint="Just your first name.">
                    <input
                      required
                      maxLength={40}
                      autoComplete="given-name"
                      value={details.firstName}
                      onChange={(e) => update({ firstName: e.target.value })}
                    />
                  </Field>
                  <label className="field">
                    School
                    <select
                      required
                      value={details.schoolId}
                      onChange={(e) => update({ schoolId: e.target.value, classId: "", classCode: "", classroom: "" })}
                    >
                      <option value="">Choose your school</option>
                      {config.schools.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    BNTS teacher
                    <select required value={details.staffId} onChange={(e) => update({ staffId: e.target.value })}>
                      <option value="">Choose your teacher</option>
                      {config.staff.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Class code"
                    optional={!config.requireClassCode}
                    hint={
                      !details.schoolId
                        ? "Choose your school first."
                        : config.requireClassCode
                          ? "Ask your teacher for your class code."
                          : "Only if your teacher gave you one."
                    }
                  >
                    <input
                      type="text"
                      maxLength={80}
                      autoComplete="off"
                      value={details.classCode}
                      onChange={(e) => update({ classCode: e.target.value, classId: "", classroom: "" })}
                      disabled={!details.schoolId}
                      required={config.requireClassCode}
                    />
                  </Field>
                </div>
              </section>
              <section className="panel" aria-labelledby="options-heading">
                <h2 id="options-heading">Print options</h2>
                {preparedFiles.length > 1 ? (
                  <>
                    <p className="hint">You chose options for each file. Go back to change them.</p>
                    <ArchiveSummary prints={preparedFiles} />
                  </>
                ) : (
                  <>
                    <div className="chosen-colours">
                      <span className="field-label">Colour</span>
                      {colourNames.map((name) => (
                        <span key={name} className="chip">
                          <i
                            className={"swatch" + (name === ADVANCED_FILAMENT ? " special-swatch" : "")}
                            style={{ background: targetHex(name) }}
                          />
                          {name === "Custom" ? details.customColour : displayLabel(name)}
                        </span>
                      ))}
                      <button type="button" className="text-button" onClick={() => setStep(1)}>
                        Change
                      </button>
                    </div>
                    <PrintPreferences
                      value={details}
                      onChange={update}
                      expert={expert}
                      onShowAdvanced={() => changeMode("advanced")}
                    />
                  </>
                )}
              </section>
              <div className="actions">
                <button type="button" className="text-button" onClick={() => setStep(1)}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button className="button primary" disabled={busy}>
                  {busy && <span className="spinner" />}
                  {busy ? "Checking class code…" : "Continue"}
                </button>
              </div>
            </form>
          )}
          {step === 3 && file && (
            <>
              <div className="review-layout">
                <div>
                  {preparedFiles.length > 1 ? (
                    <ArchiveSummary prints={preparedFiles} />
                  ) : model ? (
                    <Viewer
                      model={model}
                      mapping={mapping}
                      scalePercent={details.scalePercent}
                      advancedSources={advancedSources}
                      compact
                    />
                  ) : (
                    <UnsupportedPreview filename={file.name} />
                  )}
                </div>
                <section className="panel" aria-labelledby="review-heading">
                  <div className="panel-heading">
                    <h2 id="review-heading">Your request</h2>
                    <button className="text-button" onClick={() => setStep(2)} disabled={busy}>
                      Edit
                    </button>
                  </div>
                  <dl className="summary-list">
                    <div>
                      <dt>First name</dt>
                      <dd>{details.firstName}</dd>
                    </div>
                    <div>
                      <dt>School</dt>
                      <dd>{schoolName}</dd>
                    </div>
                    {details.classId && (
                      <div>
                        <dt>Class</dt>
                        <dd>{details.classroom}</dd>
                      </div>
                    )}
                    <div>
                      <dt>BNTS teacher</dt>
                      <dd>{teacherName}</dd>
                    </div>
                    {preparedFiles.length === 1 && (
                      <>
                        <div>
                          <dt>Colour</dt>
                          <dd>{colourText}</dd>
                        </div>
                        {needsAdvanced && (
                          <div>
                            <dt>Special filament</dt>
                            <dd className="preserve-text">{details.advancedFilamentNote}</dd>
                          </div>
                        )}
                        <div>
                          <dt>Size</dt>
                          <dd>
                            {scaleLabel(details.scalePercent)}
                            {dimensionsText && ` · ${dimensionsText}`}
                          </dd>
                        </div>
                        <div>
                          <dt>Copies</dt>
                          <dd>{details.copies}</dd>
                        </div>
                        {(expert || usesAdvancedSettings(details)) && (
                          <>
                            <div>
                              <dt>Supports</dt>
                              <dd>{displayLabel(details.supports)}</dd>
                            </div>
                            <div>
                              <dt>Printer</dt>
                              <dd>{displayLabel(details.printer)}</dd>
                            </div>
                            <div>
                              <dt>Quality</dt>
                              <dd>{displayLabel(details.quality)}</dd>
                            </div>
                          </>
                        )}
                        {details.notes && (
                          <div>
                            <dt>Notes</dt>
                            <dd className="preserve-text">{details.notes}</dd>
                          </div>
                        )}
                        {details.designLink && (
                          <div>
                            <dt>Design link</dt>
                            <dd>
                              <a href={details.designLink} target="_blank" rel="noreferrer">
                                Open design <ExternalLink size={12} />
                              </a>
                            </dd>
                          </div>
                        )}
                      </>
                    )}
                  </dl>
                </section>
              </div>
              <p className="hint review-note">
                Colours and options are requests. Your teacher will confirm what’s possible. You can find your file on
                this site for 14 days.
              </p>
              {busy && (
                <div className="upload-progress" role="status">
                  <div className="progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <span>{progress < 100 ? `Sending… ${progress}%` : "Saving… Keep this page open."}</span>
                </div>
              )}
              {config.turnstileSiteKey && !humanPass && (
                <HumanCheck siteKey={config.turnstileSiteKey} onPass={passHuman} />
              )}
              <div className="actions">
                <button className="text-button" onClick={() => setStep(2)} disabled={busy}>
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="button primary"
                  onClick={submit}
                  disabled={busy || (!!config.turnstileSiteKey && !humanPass)}
                >
                  {busy && <span className="spinner" />}
                  {busy ? "Sending…" : "Send for printing"}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {config.studentLookupSupported && (step === 0 || step === 4) && (
        <ViewAtHome schools={config.lookupSchools || config.schools} />
      )}
    </div>
  );
}
function fileTypesLabel(extensions: string[]) {
  const names = [...new Set(extensions.filter((e) => e !== "stp").map((e) => e.toUpperCase()))];
  return names.length > 1 ? names.slice(0, -1).join(", ") + " or " + names.at(-1) : names[0] || "";
}
function closestColour(hex: string, config: Config) {
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const source = rgb(hex);
  return (
    [...config.colours].sort((a, b) => {
      const distance = (h: string) => rgb(h).reduce((sum, n, i) => sum + (n - source[i]) ** 2, 0);
      return distance(a.hex) - distance(b.hex);
    })[0]?.name || "Custom"
  );
}

function UnsupportedPreview({ filename }: { filename: string }) {
  return (
    <div className="unsupported-preview">
      <FileBox size={32} strokeWidth={1.5} aria-hidden="true" />
      <strong>{filename.split(".").at(-1)?.toUpperCase()} file</strong>
      <p>There’s no 3D preview for this file type. It will still be sent as it is.</p>
    </div>
  );
}

function ArchiveSummary({ prints }: { prints: PreparedPrint[] }) {
  return (
    <div className="archive-summary">
      <h3>{prints.length} files</h3>
      <ul>
        {prints.map((print) => (
          <ArchiveItem key={print.requestId} print={print} />
        ))}
      </ul>
    </div>
  );
}
function ArchiveItem({ print }: { print: PreparedPrint }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(print.preview);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [print.preview]);
  const { preferences } = print;
  const options = preferences.printOptions;
  return (
    <li>
      {url ? <img src={url} alt={"Preview of " + print.file.name} /> : <div className="thumb-skeleton" />}
      <span>
        <b className="filename">{print.file.name}</b>
        <small>
          {scaleLabel(preferences.scalePercent)}
          {preferences.dimensionsMm
            ? " · " + preferences.dimensionsMm.map((v) => v.toFixed(1)).join(" × ") + " mm"
            : ""}
        </small>
        <small>
          {preferences.colourMapping
            .map(
              (m, i) =>
                (preferences.colourMapping.length > 1 ? (m.partName || "Part " + (i + 1)) + ": " : "") +
                (m.target === "Custom" ? preferences.customColour || "Custom" : displayLabel(m.target)),
            )
            .join(" · ")}
        </small>
        {preferences.advancedFilamentNote && <small>Special filament: {preferences.advancedFilamentNote}</small>}
        {options && (
          <>
            <small>
              {options.copies} {options.copies === 1 ? "copy" : "copies"} · Supports: {displayLabel(options.supports)}
            </small>
            {options.notes && <small>Notes: {options.notes}</small>}
          </>
        )}
      </span>
    </li>
  );
}

/** "a", "a and b", "a, b and c" */
function listText(items: string[]) {
  return items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items.at(-1) : items[0];
}
