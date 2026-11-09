import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileBox,
  HardDrive,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { exportPrints } from "./lib/bulk-export";
import { api, setCsrf, modelFile, previewUrl, downloadModel } from "./lib/api";
import { isAppsScript, homeUrl } from "./platform";
import { FILE_FORMATS, fileFormat } from "../shared/formats.js";
import { loadModel, prepareRequestedParts, type LoadedModel } from "./lib/model";
import { Viewer } from "./components/Viewer";
import { ErrorMessage, Field, PageLoading, bytesLabel, dateLabel } from "./components/Layout";
import { normalizeClassCode, previewStyle, scaleLabel, exportBatches } from "../shared/printing.js";
import { ADVANCED_FILAMENT, ADVANCED_HEX, BAMBU_COLOURS, staffLabel } from "../shared/catalog.js";
import type { Settings, PrintRecord } from "./types";
interface AdminState {
  platform?: string;
  storage?: { usedBytes: number; limitBytes: number; files: number };
  settings: Settings;
  localDemo: boolean;
  connected: boolean;
  oauthConfigured: boolean;
  tokenPersisted: boolean;
  cleanupConfigured: boolean;
  cleanup: { lastRun: string | null; lastSuccess: string | null; error: string | null };
}
const STATUSES = [
  { id: "queued", label: "Queued" },
  { id: "printing", label: "Printing" },
  { id: "printed", label: "Printed" },
] as const;
const colourHex = (name: string) =>
  name === ADVANCED_FILAMENT ? ADVANCED_HEX : BAMBU_COLOURS.find((c) => c.name === name)?.hex || "#9aa5ab";
export default function Teacher() {
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [tab, setTab] = useState<"queue" | "settings">("queue");
  const [admin, setAdmin] = useState<AdminState | null>(null),
    [records, setRecords] = useState<PrintRecord[]>([]),
    [school, setSchool] = useState(""),
    [group, setGroup] = useState(""),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("newest"),
    [status, setStatus] = useState("all"),
    [colour, setColour] = useState("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]),
    [bulkStatus, setBulkStatus] = useState("printed"),
    [bulkMessage, setBulkMessage] = useState("");
  const [exportParts, setExportParts] = useState<PrintRecord[][] | null>(null),
    [exportedParts, setExportedParts] = useState<number[]>([]);
  useEffect(() => {
    setCheckedIds([]);
    setBulkMessage("");
  }, [school, group, search, status, colour]);
  const [selected, setSelected] = useState<PrintRecord | null>(null),
    [loaded, setLoaded] = useState<LoadedModel | null>(null),
    [previewError, setPreviewError] = useState(""),
    [deleteTarget, setDeleteTarget] = useState<PrintRecord | null>(null);
  useEffect(() => {
    const expire = () => {
      setAuthenticated(false);
      setCsrf("");
    };
    window.addEventListener("teacher-session-expired", expire);
    api("/admin/session")
      .then((r) => {
        setCsrf(r.csrf);
        setAuthenticated(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    return () => window.removeEventListener("teacher-session-expired", expire);
  }, []);
  const refresh = async () => {
    setError("");
    setRefreshing(true);
    try {
      const [settings, submissions] = await Promise.all([
        api<AdminState>("/admin/settings"),
        api<{ records: PrintRecord[] }>("/admin/submissions"),
      ]);
      setAdmin(settings);
      setRecords(submissions.records);
      if (
        (settings.platform !== "cloudflare" && !settings.settings.folderId) ||
        !settings.connected ||
        !settings.settings.schools.length ||
        !settings.settings.staff.length
      )
        setTab("settings");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (authenticated) refresh();
  }, [authenticated]);
  useEffect(() => {
    setLoaded(null);
    setPreviewError("");
    if (!selected || !fileFormat(selected.filename)?.preview) return;
    let cancelled = false;
    modelFile(selected.id, selected.filename)
      .then(loadModel)
      .then((model) =>
        prepareRequestedParts(
          model,
          selected.colourMapping.map((m) => m.source),
        ),
      )
      .then((model) => {
        if (!cancelled) setLoaded(model);
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      setCsrf(r.csrf);
      setPassword("");
      setAuthenticated(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (record: PrintRecord, next: string) => {
    setBusy(true);
    setError("");
    try {
      const { record: updated } = await api("/admin/submissions/" + record.id, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setRecords((r) => r.map((x) => (x.id === record.id ? updated : x)));
      setSelected(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/submissions/" + deleteTarget.id, { method: "DELETE" });
      setRecords((r) => r.filter((x) => x.id !== deleteTarget.id));
      setSelected(null);
      setDeleteTarget(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (checking) return <PageLoading />;
  if (!authenticated)
    return (
      <section className="page narrow" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Staff sign in</h1>
        <p className="lead">Sign in to see and manage print requests. Students don’t need to sign in.</p>
        <form className="panel form-stack" onSubmit={login}>
          <label className="field">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              maxLength={256}
            />
          </label>
          <ErrorMessage message={error} />
          <button className="button primary" disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    );
  const schoolClasses = (admin?.settings.classes || []).filter((c) => !school || c.schoolId === school);
  const filtered = records
    .filter(
      (r) =>
        (!school || r.schoolId === school) &&
        (!group || (group === "none" ? !r.classId : r.classId === group)) &&
        (status === "all" || r.status === status) &&
        (colour === "all" || r.colourLabel === colour || r.colourMapping.some((c) => c.target === colour)) &&
        (!search ||
          [r.firstName, r.originalName, r.filename, r.staff, r.notes, r.classroom, r.school]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase())),
    )
    .sort((a, b) =>
      sort === "size-desc"
        ? b.bytes - a.bytes
        : sort === "size-asc"
          ? a.bytes - b.bytes
          : sort === "colour"
            ? a.colourLabel.localeCompare(b.colourLabel)
            : sort === "name"
              ? a.firstName.localeCompare(b.firstName)
              : sort === "oldest"
                ? a.createdAt.localeCompare(b.createdAt)
                : b.createdAt.localeCompare(a.createdAt),
    );
  const filtersActive = !!(school || group || search || colour !== "all" || status !== "all");
  const clearFilters = () => {
    setSchool("");
    setGroup("");
    setSearch("");
    setColour("all");
    setStatus("all");
  };
  const selectedFiles = records.filter((r) => checkedIds.includes(r.id));
  const downloadExport = async (files: PrintRecord[], partIndex?: number) => {
    setBusy(true);
    setError("");
    setBulkMessage("Preparing download…");
    try {
      await exportPrints(
        files,
        (done, total) => setBulkMessage(`Preparing ${done} of ${total} files…`),
        partIndex === undefined ? "" : `part-${partIndex + 1}-of-${exportParts!.length}`,
      );
      if (partIndex !== undefined) setExportedParts((parts) => [...new Set([...parts, partIndex])]);
      setBulkMessage(`Downloaded ${files.length} ${files.length === 1 ? "file" : "files"}.`);
    } catch (error) {
      setError((error as Error).message);
      setBulkMessage("");
    } finally {
      setBusy(false);
    }
  };
  const exportSelected = async () => {
    try {
      const batches = exportBatches(selectedFiles);
      if (batches.length > 1) {
        setExportParts(batches);
        setExportedParts([]);
        setBulkMessage("");
        setError("");
      } else await downloadExport(selectedFiles);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const updateSelected = async () => {
    setBusy(true);
    setError("");
    let updated = 0,
      skipped = 0;
    try {
      for (let i = 0; i < selectedFiles.length; i += 200) {
        const result = await api("/admin/submissions/bulk-status", {
          method: "POST",
          body: JSON.stringify({ ids: selectedFiles.slice(i, i + 200).map((r) => r.id), status: bulkStatus }),
        });
        updated += result.updated;
        skipped += result.skipped;
      }
      await refresh();
      setCheckedIds([]);
      setBulkMessage(
        `Updated ${updated} ${updated === 1 ? "file" : "files"}.${skipped ? ` ${skipped} expired or deleted files were skipped.` : ""}`,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const count = (id: string) => records.filter((r) => id === "all" || r.status === id).length;
  const colourOptions = [
    ...new Set(records.flatMap((r) => [r.colourLabel, ...r.colourMapping.map((c) => c.target)])),
  ].sort();
  const allChecked = !!filtered.length && filtered.every((r) => checkedIds.includes(r.id));
  return (
    <div className="page teacher">
      <div className="page-heading">
        <h1>Print requests</h1>
        <div className="button-row">
          <button className="text-button" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : <RefreshCw size={16} />} Refresh
          </button>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/admin/logout", { method: "POST" });
                setCsrf("");
                setAuthenticated(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Staff sections">
        <button onClick={() => setTab("queue")} aria-pressed={tab === "queue"}>
          Print queue <span className="count">{records.length}</span>
        </button>
        <button onClick={() => setTab("settings")} aria-pressed={tab === "settings"}>
          Settings
        </button>
      </div>
      <ErrorMessage message={error} />
      {admin?.localDemo && <div className="demo-banner">Local demo. Files are saved on this computer only.</div>}
      {!admin ? (
        <QueueSkeleton />
      ) : tab === "settings" ? (
        <Setup admin={admin} onSaved={refresh} />
      ) : !records.length ? (
        <div className="empty-state">
          <h2>No print requests yet</h2>
          <p>Files appear here as soon as students send them.</p>
          <a href={homeUrl} target={isAppsScript ? "_top" : undefined} className="button secondary">
            Open the student upload page
          </a>
        </div>
      ) : (
        <>
          <div className="status-filter" role="group" aria-label="Filter by status">
            {[{ id: "all", label: "All" }, ...STATUSES].map((s) => (
              <button key={s.id} aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
                {s.label} <span className="count">{count(s.id)}</span>
              </button>
            ))}
          </div>
          <div className="filter-bar">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search requests"
                placeholder="Search by name, file or note"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="field">
              School
              <select
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setGroup("");
                }}
              >
                <option value="">All schools</option>
                {(admin.settings.schools.length
                  ? admin.settings.schools
                  : [...new Map(records.map((r) => [r.schoolId, { id: r.schoolId, name: r.school }])).values()]
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Class
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">All classes</option>
                <option value="none">No class</option>
                {schoolClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!school && admin.settings.schools.length > 1
                      ? " · " + (admin.settings.schools.find((s) => s.id === c.schoolId)?.name || "")
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Colour
              <select value={colour} onChange={(e) => setColour(e.target.value)}>
                <option value="all">All colours</option>
                {colourOptions.map((c) => (
                  <option key={c} value={c}>
                    {staffLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Student name</option>
                <option value="colour">Colour</option>
                <option value="size-desc">Largest file</option>
                <option value="size-asc">Smallest file</option>
              </select>
            </label>
          </div>
          <div className="bulk-actions">
            <label className="checkbox-row">
              <input
                type="checkbox"
                aria-label="Select all files"
                disabled={busy || !filtered.length}
                checked={allChecked}
                onChange={(e) => setCheckedIds(e.target.checked ? filtered.map((r) => r.id) : [])}
              />
              <span>
                {selectedFiles.length
                  ? `${selectedFiles.length} selected`
                  : `${filtered.length} ${filtered.length === 1 ? "request" : "requests"}`}
              </span>
            </label>
            {filtersActive && (
              <button className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
            {selectedFiles.length > 0 && (
              <div className="bulk-controls">
                <label className="inline-field">
                  Mark as
                  <select
                    aria-label="Bulk print status"
                    value={bulkStatus}
                    disabled={busy}
                    onChange={(e) => setBulkStatus(e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button secondary" disabled={busy} onClick={updateSelected}>
                  Update status
                </button>
                <button className="button secondary" disabled={busy} onClick={exportSelected}>
                  <Download size={16} /> Download ZIP
                </button>
              </div>
            )}
          </div>
          {bulkMessage && (
            <p role="status" className="hint">
              {bulkMessage}
            </p>
          )}
          {filtered.length ? (
            <ul className="file-grid">
              {filtered.map((r) => (
                <li className="print-card" key={r.id}>
                  <input
                    type="checkbox"
                    className="print-select"
                    aria-label={"Select " + r.firstName + " " + r.originalName}
                    checked={checkedIds.includes(r.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setCheckedIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)))
                    }
                  />
                  <button className="print-card-button" onClick={() => setSelected(r)}>
                    <span className="print-thumb">
                      <Thumbnail record={r} />
                    </span>
                    <span className="print-card-info">
                      <span className="print-card-title">
                        <strong>{r.firstName}</strong>
                        <span className={"status-badge " + r.status}>{statusLabel(r.status)}</span>
                      </span>
                      <span className="filename">{r.originalName}</span>
                      <span className="print-card-meta">
                        <i className="swatch" style={{ background: colourHex(r.colourLabel) }} />
                        {new Set(r.colourMapping.map((m) => m.target)).size > 1
                          ? "Several colours"
                          : staffLabel(r.colourLabel)}
                      </span>
                      <small>
                        {dateLabel(r.createdAt)} · {r.classroom || r.school}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <h2>No matching requests</h2>
              <p>Try a different search or clear the filters.</p>
              <button className="button secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
          <p className="hint">Files are deleted 14 days after they’re sent. Download anything you need to keep.</p>
        </>
      )}
      {exportParts && (
        <Modal
          title="Download files"
          onClose={() => {
            if (!busy) setExportParts(null);
          }}
        >
          <p className="hint">
            These files are too large for one download, so they’re split into {exportParts.length} ZIP files. Download
            each one.
          </p>
          <ErrorMessage message={error} />
          <ul className="export-download-list">
            {exportParts.map((files, index) => (
              <li key={index}>
                <span>
                  ZIP {index + 1} of {exportParts.length}
                  <small>
                    {files.length} files · {bytesLabel(files.reduce((sum, file) => sum + file.bytes, 0))}
                  </small>
                </span>
                <button className="button secondary" disabled={busy} onClick={() => downloadExport(files, index)}>
                  {exportedParts.includes(index) ? <Check size={16} /> : <Download size={16} />} Download ZIP{" "}
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
          {bulkMessage && (
            <p role="status" className="hint">
              {bulkMessage}
            </p>
          )}
        </Modal>
      )}
      {selected && (
        <Modal
          title={`${selected.firstName}’s request`}
          onClose={() => {
            setSelected(null);
            setDeleteTarget(null);
          }}
          wide
        >
          <ErrorMessage message={error} />
          <div className="submission-modal">
            <div className="form-stack">
              {!fileFormat(selected.filename)?.preview ? (
                <div className="unsupported-preview">
                  <FileBox size={32} strokeWidth={1.5} aria-hidden="true" />
                  <strong>{selected.filename.split(".").at(-1)?.toUpperCase()} file</strong>
                  <p>There’s no preview for this file type. Download it to open it in your CAD program.</p>
                </div>
              ) : loaded ? (
                <Viewer
                  model={loaded}
                  analysis={loaded.analysis}
                  mapping={previewStyle(selected).mapping}
                  scalePercent={selected.scalePercent ?? 100}
                  advancedSources={previewStyle(selected).advancedSources}
                  compact
                />
              ) : previewError ? (
                <ErrorMessage message={previewError} />
              ) : (
                <div className="viewer compact viewer-skeleton" aria-hidden="true" />
              )}
              <a
                className="button primary"
                href={isAppsScript ? undefined : `/api/admin/submissions/${selected.id}/download`}
                onClick={
                  isAppsScript
                    ? async () => {
                        try {
                          await downloadModel(selected.id, selected.filename);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }
                    : undefined
                }
                role="link"
                tabIndex={0}
              >
                <Download size={16} /> Download original {selected.filename.split(".").at(-1)?.toUpperCase()}
              </a>
              <p className="hint">
                The file is exactly as the student sent it. Set the size and colours below in the slicer.
              </p>
            </div>
            <div className="form-stack">
              <label className="field">
                Status
                <select
                  value={selected.status}
                  onChange={(e) => changeStatus(selected, e.target.value)}
                  disabled={busy}
                >
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <dl className="summary-list">
                <div>
                  <dt>School</dt>
                  <dd>{selected.school}</dd>
                </div>
                {selected.classroom && (
                  <div>
                    <dt>Class</dt>
                    <dd>{selected.classroom}</dd>
                  </div>
                )}
                <div>
                  <dt>Teacher</dt>
                  <dd>{selected.staff}</dd>
                </div>
                <div>
                  <dt>Colour</dt>
                  <dd>
                    {selected.colourMapping.length > 1
                      ? selected.colourMapping.map((m, i) => (
                          <span className="mapping-row" key={i}>
                            <i className="swatch" style={{ background: colourHex(m.target) }} />
                            <b>{m.partName || "Part " + (i + 1)}:</b>{" "}
                            {m.target === "Custom" ? selected.customColour : staffLabel(m.target)}
                          </span>
                        ))
                      : selected.colourLabel === "Custom"
                        ? selected.customColour || "Custom"
                        : staffLabel(selected.colourLabel)}
                  </dd>
                </div>
                {selected.advancedFilamentNote && (
                  <div>
                    <dt>Special filament</dt>
                    <dd className="preserve-text">{selected.advancedFilamentNote}</dd>
                  </div>
                )}
                <div>
                  <dt>Size</dt>
                  <dd>
                    {selected.scalePercent !== undefined ? scaleLabel(selected.scalePercent) : selected.size}
                    {selected.dimensionsMm && ` · ${selected.dimensionsMm.map((v) => v.toFixed(1)).join(" × ")} mm`}
                  </dd>
                </div>
                <div>
                  <dt>Copies</dt>
                  <dd>{selected.copies}</dd>
                </div>
                <div>
                  <dt>Supports</dt>
                  <dd>{staffLabel(selected.supports)}</dd>
                </div>
                <div>
                  <dt>Printer</dt>
                  <dd>{staffLabel(selected.printer)}</dd>
                </div>
                <div>
                  <dt>Quality</dt>
                  <dd>{staffLabel(selected.quality)}</dd>
                </div>
                {selected.notes && (
                  <div>
                    <dt>Student notes</dt>
                    <dd className="preserve-text">{selected.notes}</dd>
                  </div>
                )}
                {selected.designLink && (
                  <div>
                    <dt>Design link</dt>
                    <dd>
                      <a href={selected.designLink} target="_blank" rel="noreferrer">
                        Open design <ExternalLink size={13} />
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>File</dt>
                  <dd className="filename">
                    {selected.filename}
                    <small>
                      Sent as {selected.originalName} · {bytesLabel(selected.bytes)}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Sent</dt>
                  <dd>{dateLabel(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>Deleted on</dt>
                  <dd>{dateLabel(selected.expiresAt)}</dd>
                </div>
              </dl>
              {deleteTarget ? (
                <div className="delete-confirm" role="alertdialog" aria-label="Confirm delete">
                  <p>Delete this file and the student’s details? This can’t be undone.</p>
                  <div className="button-row">
                    <button className="button danger" disabled={busy} onClick={remove}>
                      {busy && <span className="spinner" />} Delete permanently
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => setDeleteTarget(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="text-button danger-text" onClick={() => setDeleteTarget(selected)}>
                  <Trash2 size={16} /> Delete request
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
const statusLabel = (status: string) => STATUSES.find((s) => s.id === status)?.label || status;
function QueueSkeleton() {
  return (
    <div className="file-grid" role="status" aria-label="Loading print requests">
      {[0, 1, 2].map((i) => (
        <div className="print-card" key={i}>
          <div className="thumb-skeleton" />
          <div className="print-card-info">
            <span className="line-skeleton" />
            <span className="line-skeleton short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Setup({ admin, onSaved }: { admin: AdminState; onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings>(admin.settings),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [cleaning, setCleaning] = useState(false),
    [schoolName, setSchoolName] = useState(""),
    [staffName, setStaffName] = useState(""),
    [className, setClassName] = useState(""),
    [classCode, setClassCode] = useState(""),
    [classSchool, setClassSchool] = useState(""),
    [classError, setClassError] = useState(""),
    [token, setToken] = useState("");
  useEffect(() => setSettings(admin.settings), [admin.settings]);
  const dirty = JSON.stringify(settings) !== JSON.stringify(admin.settings);
  const patch = (value: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...value }));
    setSuccess("");
  };
  const add = (kind: "schools" | "staff", name: string) => {
    if (!name.trim()) return;
    patch({ [kind]: [...settings[kind], { id: crypto.randomUUID(), name: name.trim() }] });
    kind === "schools" ? setSchoolName("") : setStaffName("");
  };
  const save = async () => {
    setSuccess("");
    if (settings.classes.some((c) => !c.code?.trim())) {
      setError("Every class needs a code. Add the missing codes, then save.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      await onSaved();
      setSuccess("Settings saved. The upload page now uses these options.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cleanup = async () => {
    setCleaning(true);
    setError("");
    try {
      const r = await api("/admin/cleanup", { method: "POST" });
      await onSaved();
      setSuccess(
        `Clean-up finished. ${r.deletedSubmissions} expired ${r.deletedSubmissions === 1 ? "request" : "requests"} deleted.${r.moreMayRemain ? " More will be removed at the next clean-up." : ""}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCleaning(false);
    }
  };
  const copyToken = async () => {
    setError("");
    try {
      let value = token;
      if (!value) {
        const r = await api("/admin/google/refresh-token", { method: "POST" });
        value = r.token;
        setToken(value);
      }
      try {
        await navigator.clipboard.writeText(value);
        setSuccess(
          "Token copied. Save it as GOOGLE_REFRESH_TOKEN in your host’s secret settings, then restart the service.",
        );
      } catch {
        setSuccess("Copy the token below into GOOGLE_REFRESH_TOKEN in your host’s secret settings.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const optionList = (kind: "schools" | "staff", noun: string) => (
    <ul className="option-list">
      {settings[kind].map((s) => (
        <li key={s.id}>
          <span>{s.name}</span>
          <button
            className="icon-button"
            aria-label={`Remove ${noun} ${s.name}`}
            onClick={() =>
              patch(
                kind === "schools"
                  ? {
                      schools: settings.schools.filter((x) => x.id !== s.id),
                      classes: settings.classes.filter((x) => x.schoolId !== s.id),
                    }
                  : { staff: settings.staff.filter((x) => x.id !== s.id) },
              )
            }
          >
            <X size={16} />
          </button>
        </li>
      ))}
      {!settings[kind].length && <li className="hint">None added yet.</li>}
    </ul>
  );
  return (
    <div className="setup">
      <p className="lead">Choose what students see on the upload page. Changes apply when you save.</p>
      <section className="panel" aria-labelledby="storage-heading">
        <div className="panel-heading">
          <h2 id="storage-heading">{admin.platform === "cloudflare" ? "Storage" : "Google Drive storage"}</h2>
          <span className={"status-badge " + (admin.connected ? "printed" : "queued")}>
            {admin.localDemo ? "Local demo" : admin.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        {admin.platform === "cloudflare" ? (
          <>
            <p className="hint">Files are stored privately in Cloudflare R2. No Google account is needed.</p>
            {admin.storage && (
              <>
                <div className="progress-track">
                  <span
                    style={{ width: Math.min(100, (admin.storage.usedBytes / admin.storage.limitBytes) * 100) + "%" }}
                  />
                </div>
                <p className="hint">
                  {(admin.storage.usedBytes / 1e9).toFixed(2)} GB of {(admin.storage.limitBytes / 1e9).toFixed(0)} GB
                  used. New uploads stop when storage is full.
                </p>
              </>
            )}
          </>
        ) : admin.localDemo ? (
          <p className="notice">
            This is local demo storage. On your host, set STORAGE_MODE=drive and connect a Google account before
            accepting real files.
          </p>
        ) : admin.platform === "apps-script" ? (
          <p className="notice">
            Google handles Drive access through the account that deployed this app. Paste a folder link that this
            account can add files to. No Drive keys or tokens are needed.
          </p>
        ) : (
          <>
            {!admin.oauthConfigured && (
              <div className="notice">
                <p>
                  Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>PUBLIC_URL</code> in
                  your hosting settings. Enable the Google Drive API and register{" "}
                  <code>PUBLIC_URL/api/admin/google/callback</code> as the OAuth redirect URI. The README explains each
                  step.
                </p>
              </div>
            )}
            <p className="hint">
              Connect the Google account that can add files to your shared folder. A shared folder link on its own
              doesn’t give upload access. Use a dedicated school account if you can.
            </p>
            <a
              className={"button secondary" + (!admin.oauthConfigured ? " disabled" : "")}
              href={admin.oauthConfigured ? "/api/admin/google/start" : undefined}
            >
              <HardDrive size={16} /> {admin.connected ? "Reconnect Google Drive" : "Connect Google Drive"}
            </a>
            {admin.connected && !admin.tokenPersisted && (
              <div className="notice form-stack">
                <strong>One more step: keep the connection after restarts.</strong>
                <p>
                  Copy the connection token into <code>GOOGLE_REFRESH_TOKEN</code> in your host’s secret settings. Never
                  share it with students or commit it to Git.
                </p>
                <button className="button secondary" onClick={copyToken}>
                  <Copy size={16} /> Copy new refresh token
                </button>
                {token && (
                  <label className="field">
                    New refresh token
                    <input type="password" readOnly value={token} onFocus={(e) => e.target.select()} />
                    <small>Select and copy it if the clipboard isn’t available. Reloading hides this token.</small>
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {admin.platform !== "cloudflare" && (
          <Field
            label="Shared Google Drive folder link"
            hint="Files are saved in School / Date / Class folders. The folder isn’t made public."
          >
            <input
              type="text"
              value={settings.folderId}
              maxLength={300}
              onChange={(e) => patch({ folderId: e.target.value })}
              placeholder="https://drive.google.com/drive/folders/…"
              disabled={!admin.connected}
            />
          </Field>
        )}
      </section>
      <div className="setup-two">
        <section className="panel" aria-labelledby="schools-heading">
          <h2 id="schools-heading">Schools</h2>
          <p className="hint">Students choose from this list.</p>
          {optionList("schools", "school")}
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              add("schools", schoolName);
            }}
          >
            <input
              aria-label="New school name"
              required
              maxLength={80}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="School name"
            />
            <button className="button secondary" aria-label="Add school">
              <Plus size={16} /> Add
            </button>
          </form>
        </section>
        <section className="panel" aria-labelledby="staff-heading">
          <h2 id="staff-heading">BNTS teachers</h2>
          <p className="hint">Students choose the teacher who is helping them.</p>
          {optionList("staff", "teacher")}
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              add("staff", staffName);
            }}
          >
            <input
              aria-label="New teacher name"
              required
              maxLength={80}
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Teacher name"
            />
            <button className="button secondary" aria-label="Add teacher">
              <Plus size={16} /> Add
            </button>
          </form>
        </section>
      </div>
      <section className="panel" aria-labelledby="classes-heading">
        <h2 id="classes-heading">
          Classes <span className="optional">Optional</span>
        </h2>
        <p className="hint">
          Give each class a code and share it with students. Their files are then grouped by class. Codes ignore capital
          letters and must be different within a school.
        </p>
        {settings.classes.length > 0 && (
          <ul className="class-list">
            {settings.classes.map((c) => (
              <li key={c.id}>
                <span>
                  <b>{c.name}</b>
                  <small>{settings.schools.find((s) => s.id === c.schoolId)?.name}</small>
                </span>
                <input
                  aria-label={"Class code for " + c.name}
                  maxLength={80}
                  value={c.code || ""}
                  onChange={(e) =>
                    patch({
                      classes: settings.classes.map((x) => (x.id === c.id ? { ...x, code: e.target.value } : x)),
                    })
                  }
                  placeholder="Class code"
                />
                <button
                  className="icon-button"
                  aria-label={"Remove class " + c.name}
                  onClick={() => patch({ classes: settings.classes.filter((x) => x.id !== c.id) })}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="class-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!className.trim() || !classSchool || !classCode.trim()) return;
            if (
              settings.classes.some(
                (c) => c.schoolId === classSchool && normalizeClassCode(c.code || "") === normalizeClassCode(classCode),
              )
            ) {
              setClassError("That code is already used at this school. Choose a different code.");
              return;
            }
            patch({
              classes: [
                ...settings.classes,
                { id: crypto.randomUUID(), name: className.trim(), schoolId: classSchool, code: classCode.trim() },
              ],
            });
            setClassName("");
            setClassCode("");
            setClassError("");
          }}
        >
          <select
            aria-label="School for new class"
            required
            value={classSchool}
            onChange={(e) => setClassSchool(e.target.value)}
          >
            <option value="">School</option>
            {settings.schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            aria-label="New class name"
            required
            maxLength={80}
            placeholder="Class name, e.g. Year 8 Design"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
          />
          <input
            aria-label="New class code"
            required
            maxLength={80}
            placeholder="Class code"
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
          />
          <button className="button secondary">
            <Plus size={16} /> Add class
          </button>
        </form>
        <ErrorMessage message={classError} />
      </section>
      <section className="panel" aria-labelledby="colours-heading">
        <h2 id="colours-heading">Colours in stock</h2>
        <p className="hint">Select the Bambu PLA Basic colours you have. Students only see the ones you select.</p>
        <div className="inventory-swatches">
          {BAMBU_COLOURS.map((c) => (
            <button
              type="button"
              key={c.id}
              className={"inventory-colour" + (settings.colours.includes(c.id) ? " selected" : "")}
              onClick={() =>
                patch({
                  colours: settings.colours.includes(c.id)
                    ? settings.colours.filter((id) => id !== c.id)
                    : [...settings.colours, c.id],
                })
              }
              aria-pressed={settings.colours.includes(c.id)}
            >
              <span className="swatch" style={{ background: c.hex }}>
                {settings.colours.includes(c.id) && <Check size={12} strokeWidth={3} />}
              </span>
              {c.name}
            </button>
          ))}
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.customColourEnabled}
            onChange={(e) => patch({ customColourEnabled: e.target.checked })}
          />
          <span>
            Let students ask for other colours
            <small>They describe the colour they want. You decide whether it’s possible.</small>
          </span>
        </label>
      </section>
      <section className="panel" aria-labelledby="formats-heading">
        <h2 id="formats-heading">File types</h2>
        <p className="hint">
          STL, OBJ, STEP, 3MF and ZIP are always accepted. Turn on other types below. Files without a preview are still
          uploaded.
        </p>
        <div className="format-list">
          {FILE_FORMATS.map((format) => (
            <label className="checkbox-row" key={format.id}>
              <input
                type="checkbox"
                disabled={format.required}
                checked={format.required || (settings.extraFormats || []).includes(format.id)}
                onChange={(e) =>
                  patch({
                    extraFormats: e.target.checked
                      ? [...(settings.extraFormats || []), format.id]
                      : (settings.extraFormats || []).filter((id) => id !== format.id),
                  })
                }
              />
              <span>
                {format.name}
                <small>
                  .{format.extensions.join(", .")} ·{" "}
                  {format.id === "zip"
                    ? "CAD files are taken out of the ZIP"
                    : format.preview
                      ? "3D preview"
                      : "No preview"}
                  {format.required ? " · Always on" : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="cleanup-heading">
        <h2 id="cleanup-heading">Automatic deletion</h2>
        <p className="hint">
          Files, previews and student details are permanently deleted 14 days after they’re sent. Only files sent
          through this site are removed.
        </p>
        {admin.platform === "cloudflare" ? (
          <p className="hint">
            Clean-up runs every 10 minutes. Expired files are hidden straight away and removed at the next clean-up.
          </p>
        ) : admin.platform === "apps-script" ? (
          <p className="hint">
            An hourly Apps Script trigger is created when you save. If a clean-up fails, check its execution history in
            the Apps Script editor.
          </p>
        ) : !admin.cleanupConfigured ? (
          <p className="notice">
            Add a random CLEANUP_SECRET to your host and set up the included hourly GitHub Actions workflow, or another
            scheduler. Free Render services sleep, so the built-in timer can’t delete files on its own.
          </p>
        ) : (
          <p className="hint">
            The clean-up endpoint is on. Make sure your scheduler is set up, because the secret alone doesn’t run it.
          </p>
        )}
        <div className="cleanup-status">
          <span className="hint">
            Last clean-up:{" "}
            {admin.cleanup.lastSuccess
              ? new Date(admin.cleanup.lastSuccess).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })
              : "not run yet"}
          </span>
          <button className="button secondary" disabled={cleaning || !admin.connected} onClick={cleanup}>
            {cleaning ? <span className="spinner" /> : <RefreshCw size={16} />} Clean up now
          </button>
        </div>
        {admin.cleanup.error && <ErrorMessage message={admin.cleanup.error} />}
      </section>
      {!isAppsScript && (
        <section className="panel" aria-labelledby="examples-heading">
          <h2 id="examples-heading">Test files</h2>
          <p className="hint">
            Try the student upload page with example models: a clean cube, a two-colour block, a nut and bolt to split,
            and a part with a floating tab.
          </p>
          <a className="button secondary" href="/examples/example-cad-upload.zip" download>
            <Download size={16} /> Download example files (ZIP)
          </a>
        </section>
      )}
      <div className={"save-bar" + (dirty ? " dirty" : "")}>
        <div role="status" className="save-message">
          {error ? (
            <span className="error-text">{error}</span>
          ) : success ? (
            <span className="success-text">
              <Check size={16} /> {success}
            </span>
          ) : dirty ? (
            "You have unsaved changes."
          ) : (
            "All changes saved."
          )}
        </div>
        <div className="button-row">
          {dirty && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setSettings(admin.settings);
                setError("");
              }}
            >
              Discard
            </button>
          )}
          <button className="button primary" onClick={save} disabled={busy || !admin.connected}>
            {busy && <span className="spinner" />}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function Thumbnail({ record }: { record: PrintRecord }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    previewUrl(record.id)
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [record.id]);
  return src ? (
    <img loading="lazy" src={src} alt={`3D preview of ${record.originalName}`} />
  ) : failed ? (
    <FileBox size={28} strokeWidth={1.5} aria-label="No preview" />
  ) : (
    <span className="thumb-skeleton" aria-hidden="true" />
  );
}
