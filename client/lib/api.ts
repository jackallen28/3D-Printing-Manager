import { isAppsScript } from "../platform";
let csrf = "";
// A signed pass from the Turnstile robot check, sent with each new upload when the check is on.
let humanToken = "";
export function setHumanToken(value: string) {
  humanToken = value;
}
let uploadMode = "multipart";
export function setUploadMode(value?: string) {
  uploadMode = value || "multipart";
}
const sessionKey = "bnts-teacher:" + (window.BNTS_GAS?.baseUrl || "");
let gasToken = isAppsScript ? sessionStorage.getItem(sessionKey) || "" : "";
async function gasRequest(path: string, options: RequestInit = {}, payload?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = payload ?? (typeof options.body === "string" ? JSON.parse(options.body) : undefined);
    window
      .google!.script.run.withSuccessHandler((response: any) => {
        if (!response.ok) {
          if (response.status === 401 && path !== "/admin/login")
            window.dispatchEvent(new Event("teacher-session-expired"));
          reject(new Error(response.error || "The request could not be completed."));
          return;
        }
        if (response.data?.token) {
          gasToken = response.data.token;
          sessionStorage.setItem(sessionKey, gasToken);
        }
        if (path === "/admin/logout") {
          gasToken = "";
          sessionStorage.removeItem(sessionKey);
        }
        resolve(response.data);
      })
      .withFailureHandler(() => reject(new Error("Google could not complete the request. Please try again shortly.")))
      .bntsApi({ path, method: options.method || "GET", body: body ?? null, token: gasToken, csrf });
  });
}
export function setCsrf(value: string) {
  csrf = value;
}
/** An error worth trying again after a short wait: a dropped connection or a brief server hiccup. */
const retryable = (message: string) => Object.assign(new Error(message), { retryable: true });
const isRetryable = (error: unknown) => !!(error as { retryable?: boolean })?.retryable;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Runs a step that is safe to repeat, retrying brief failures with growing waits. The random extra
 * wait stops a whole class retrying at the same moment. Limits and other clear answers are not retried.
 */
async function retrying<T>(task: () => Promise<T>): Promise<T> {
  const delays = [1500, 4000, 9000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (!isRetryable(error) || attempt >= delays.length) throw error;
      await wait(delays[attempt] + Math.random() * 1500);
    }
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (isAppsScript) return gasRequest(path, options);
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  let response: Response;
  try {
    response = await fetch("/api" + path, { ...options, headers });
  } catch {
    throw retryable("The server could not be reached. Check your internet connection and try again.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    // A gateway page instead of JSON usually means a brief problem between here and the server.
    if (response.status >= 500) throw retryable("The print studio is busy. Please try again.");
    throw new Error("The server could not be reached. Please try again.");
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/admin/login") window.dispatchEvent(new Event("teacher-session-expired"));
    const message = result.error || "Something went wrong. Please try again.";
    throw result.retry ? retryable(message) : new Error(message);
  }
  return result;
}
export function upload(form: FormData, onProgress: (value: number) => void): Promise<any> {
  if (uploadMode === "cloudflare") return cloudflareUpload(form, onProgress);
  if (isAppsScript)
    return (async () => {
      onProgress(10);
      const model = form.get("model") as File,
        preview = form.get("preview") as File;
      const body = {
        details: JSON.parse(String(form.get("details"))),
        name: model.name,
        model: await base64(model),
        preview: await base64(preview),
      };
      onProgress(35);
      const result = await gasRequest("/submissions", { method: "POST" }, body);
      onProgress(100);
      return result;
    })();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/submissions");
    xhr.timeout = 600000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        xhr.status >= 200 && xhr.status < 300 ? resolve(result) : reject(new Error(result.error || "Upload failed."));
      } catch {
        reject(new Error("The upload could not be confirmed. Retry to check the same submission."));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Connection lost. Check your internet, then retry; this will not duplicate your submission."));
    xhr.ontimeout = () => reject(new Error("The upload timed out. Retry to check the same submission."));
    xhr.send(form);
  });
}
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read your file."));
    reader.readAsDataURL(blob);
  });
}
export async function modelFile(id: string, filename: string): Promise<File> {
  if (isAppsScript) {
    const result = await gasRequest(`/admin/submissions/${id}/model`);
    return new File([decodeBase64(result.base64)], filename);
  }
  const response = await fetch(`/api/admin/submissions/${id}/model`);
  if (!response.ok) throw new Error("The model could not be loaded. It may have expired.");
  return new File([await response.blob()], filename);
}
export async function previewUrl(id: string): Promise<string> {
  if (!isAppsScript) return `/api/admin/submissions/${id}/preview`;
  const result = await gasRequest(`/admin/submissions/${id}/preview`);
  return "data:image/png;base64," + result.base64;
}
export async function downloadModel(id: string, filename: string) {
  const file = await modelFile(id, filename);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cloudflareUpload(form: FormData, onProgress: (value: number) => void) {
  const model = form.get("model") as File,
    preview = form.get("preview") as File;
  // Each step is safe to repeat: the server recognises the same request and file.
  const pending = await retrying(() =>
    api("/uploads/init", {
      method: "POST",
      headers: humanToken ? { "X-Human-Token": humanToken } : undefined,
      body: JSON.stringify({
        details: JSON.parse(String(form.get("details"))),
        name: model.name,
        bytes: model.size,
        previewBytes: preview.size,
      }),
    }),
  );
  if (pending.receipt) return pending.receipt;
  const total = model.size + preview.size;
  async function part(kind: "model" | "preview", file: File, done: boolean) {
    if (done) return;
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/uploads/${pending.id}/${kind}`);
      xhr.setRequestHeader("Authorization", "Bearer " + pending.token);
      xhr.setRequestHeader("Content-Type", kind === "preview" ? "image/png" : "application/octet-stream");
      // Many students sharing one school connection can make a large file slow to send.
      xhr.timeout = 30 * 60 * 1000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(Math.min(99, Math.round((((kind === "preview" ? model.size : 0) + event.loaded) / total) * 100)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let body: { error?: string; retry?: boolean } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // Not JSON: usually a gateway page during a brief server problem.
        }
        const message = body.error || "The upload failed. Please try again.";
        // 409: an earlier attempt that dropped is still being tidied up on the server.
        reject(
          body.retry || xhr.status === 409 || (xhr.status >= 502 && !body.error)
            ? retryable(message)
            : new Error(message),
        );
      };
      xhr.onerror = () => reject(retryable("Connection lost. Select Send for printing again to carry on."));
      xhr.ontimeout = () => reject(retryable("The upload took too long. Select Send for printing again to carry on."));
      xhr.send(file);
    });
  }
  await retrying(() => part("model", model, pending.modelDone));
  await retrying(() => part("preview", preview, pending.previewDone));
  const result = await retrying(() =>
    api(`/uploads/${pending.id}/complete`, {
      method: "POST",
      headers: { Authorization: "Bearer " + pending.token },
    }),
  );
  onProgress(100);
  return result;
}
