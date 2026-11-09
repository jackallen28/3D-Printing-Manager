import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { homeUrl, isAppsScript } from "../platform";
import bntsMark from "../assets/bnts-pixels.svg?inline";
export function Layout({ children, teacher = false }: { children: ReactNode; teacher?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <a href={homeUrl} target={isAppsScript ? "_top" : undefined} className="brand">
            <img src={bntsMark} alt="" width="32" height="32" />
            <span>
              <b>3D Print Studio</b>
              <small>Banyule Nillumbik Tech School</small>
            </span>
          </a>
          {teacher && <span className="header-note">Staff</span>}
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>Banyule Nillumbik Tech School</span>
      </footer>
    </>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error-message" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" /> {label}
    </div>
  );
}
export const bytesLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "Australia/Melbourne" }).format(new Date(date));
/** A labelled form control. The hint is linked with aria-describedby so the label stays short. */
export function Field({
  label,
  hint,
  optional = false,
  full = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  full?: boolean;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <div className={"field" + (full ? " full" : "")}>
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {optional && <span className="optional">Optional</span>}
      </span>
      {cloneElement(children, { id, "aria-describedby": hint ? id + "-hint" : undefined })}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
