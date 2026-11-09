import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("The robot check couldn’t load. Check your internet connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile, shown only when Cloudflare needs the person to click. Most students never see it.
 * A passed check is exchanged for a signed pass that covers every file in this request.
 */
export default function HumanCheck({ siteKey, onPass }: { siteKey: string; onPass: (pass: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const passed = useRef(onPass);
  passed.current = onPass;
  useEffect(() => {
    let widget = "",
      active = true;
    setError("");
    loadTurnstile()
      .then(() => {
        if (!active || !host.current || !window.turnstile) return;
        widget = window.turnstile.render(host.current, {
          sitekey: siteKey,
          theme: "dark",
          appearance: "interaction-only",
          callback: async (token: string) => {
            try {
              const result = await api<{ token: string }>("/uploads/human", {
                method: "POST",
                body: JSON.stringify({ token }),
              });
              if (active) passed.current(result.token);
            } catch (e) {
              if (active) setError((e as Error).message);
            }
          },
          "error-callback": () => {
            if (active) setError("The robot check didn’t work. Try again.");
          },
          "expired-callback": () => {
            if (active) setAttempt((n) => n + 1);
          },
        });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, attempt]);
  return (
    <div className="human-check" role="status">
      <div ref={host} />
      {error ? (
        <p className="error-text">
          {error}{" "}
          <button type="button" className="inline-link" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : (
        <p className="hint">
          <span className="spinner" /> Checking you’re not a robot…
        </p>
      )}
    </div>
  );
}
