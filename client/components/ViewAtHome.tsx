import { useEffect, useRef, useState } from "react";
import { FileBox, X } from "lucide-react";
import { api } from "../lib/api";
import { fileFormat } from "../../shared/formats.js";
import { loadModel, prepareRequestedParts, type LoadedModel } from "../lib/model";
import { Viewer } from "./Viewer";
import { ErrorMessage, Loading, dateLabel } from "./Layout";
import type { Option } from "../types";
interface StudentFile {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  view?: { scalePercent: number; mapping: Record<string, string>; advancedSources: string[] };
}
export default function ViewAtHome({ schools }: { schools: Option[] }) {
  const [school, setSchool] = useState(""),
    [name, setName] = useState(""),
    [files, setFiles] = useState<StudentFile[] | null>(null),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<StudentFile | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null),
    [modelError, setModelError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!selected) return;
    setModel(null);
    setModelError("");
    dialog.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let active = true;
    if (fileFormat(selected.name)?.preview)
      fetch(`/api/student/files/${selected.id}/model`, { headers: { Authorization: "Bearer " + token } })
        .then(async (response) => {
          if (!response.ok) {
            if (response.status === 404) throw new Error("This file has been deleted.");
            throw new Error("Your search has expired. Search for your files again.");
          }
          return new File([await response.blob()], selected.name);
        })
        .then(loadModel)
        .then((value) => prepareRequestedParts(value, Object.keys(selected.view?.mapping || {})))
        .then((value) => {
          if (active) setModel(value);
        })
        .catch((e) => {
          if (active) setModelError(e.message);
        });
    return () => {
      active = false;
      document.body.style.overflow = before;
    };
  }, [selected?.id, token]);
  const search = async (e?: React.FormEvent, more = false) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    if (!more) setFiles(null);
    try {
      const result = await api("/student/lookup", {
        method: "POST",
        body: JSON.stringify({ schoolId: school, firstName: name, offset: more ? nextOffset : 0 }),
      });
      setToken(result.token);
      setFiles((current) => (more ? [...(current || []), ...result.files] : result.files));
      setNextOffset(result.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="view-at-home panel" aria-labelledby="view-home-title">
      <h2 id="view-home-title">Find your uploads</h2>
      <p className="hint">See the files you’ve sent in the last 14 days, from school or at home.</p>
      <form className="home-search" onSubmit={(e) => search(e)}>
        <label className="field">
          School
          <select
            required
            disabled={busy}
            value={school}
            onChange={(e) => {
              setSchool(e.target.value);
              setFiles(null);
            }}
          >
            <option value="">Choose your school</option>
            {schools.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          First name
          <input
            required
            disabled={busy}
            maxLength={40}
            autoComplete="given-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFiles(null);
            }}
            placeholder="Your first name"
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy && <span className="spinner" />} {busy ? "Searching…" : "Find files"}
        </button>
      </form>
      <p className="hint home-privacy">Anyone who knows your school and first name can see these files.</p>
      <ErrorMessage message={error} />
      {files &&
        (!files.length ? (
          <p className="empty-message" role="status">
            No files found for that school and first name. Check the spelling, or your file may have been removed after
            14 days.
          </p>
        ) : (
          <div className="home-file-grid">
            {files.map((file) => (
              <HomeFileCard file={file} token={token} key={file.id} onClick={() => setSelected(file)} />
            ))}
          </div>
        ))}
      {files && nextOffset !== null && (
        <button className="button secondary" onClick={() => search(undefined, true)} disabled={busy}>
          Show more
        </button>
      )}
      {selected && (
        <dialog
          ref={dialog}
          className="modal home-model-modal"
          aria-labelledby="home-model-title"
          onCancel={(e) => {
            e.preventDefault();
            setSelected(null);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="modal-heading">
            <h2 id="home-model-title">{selected.name}</h2>
            <button className="icon-button" aria-label="Close" onClick={() => setSelected(null)}>
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {!fileFormat(selected.name)?.preview ? (
              <div className="unsupported-preview">
                <FileBox size={32} strokeWidth={1.5} />
                <p>There’s no 3D preview for this file type.</p>
              </div>
            ) : modelError ? (
              <ErrorMessage message={modelError} />
            ) : model ? (
              <Viewer
                model={model}
                analysis={model.analysis}
                scalePercent={selected.view?.scalePercent ?? 100}
                mapping={selected.view?.mapping}
                advancedSources={selected.view?.advancedSources}
              />
            ) : (
              <Loading label="Loading model…" />
            )}
            <p className="hint home-model-date">
              Sent {dateLabel(selected.createdAt)} · Available until {dateLabel(selected.expiresAt)}
            </p>
          </div>
        </dialog>
      )}
    </section>
  );
}
function HomeFileCard({ file, token, onClick }: { file: StudentFile; token: string; onClick: () => void }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true,
      objectUrl = "";
    fetch(`/api/student/files/${file.id}/preview`, { headers: { Authorization: "Bearer " + token } })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, token]);
  return (
    <button className="home-file-card" onClick={onClick}>
      {url ? (
        <img src={url} alt={`Preview of ${file.name}`} />
      ) : failed ? (
        <div className="thumb-empty">
          <FileBox size={24} strokeWidth={1.5} aria-label="No preview" />
        </div>
      ) : (
        <div className="thumb-skeleton" aria-hidden="true" />
      )}
      <span>
        <strong>{file.name}</strong>
        <small>Sent {dateLabel(file.createdAt)}</small>
      </span>
    </button>
  );
}
