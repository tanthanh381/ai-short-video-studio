/**
 * The studio's basic controls. Every screen uses these instead of styling its own, so a change here (and in the tokens of
 * styles.css) reaches the whole site. Documented in docs/DESIGN-SYSTEM.md.
 */
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InfoPopover } from "./Disclosure";

/** The five tones shared by Notice, Badge and the status colours: info (accent), ok, warn, bad, idle. */
export type Tone = "info" | "ok" | "warn" | "bad" | "idle";

/**
 * A button. `primary` is the one main action of a screen; `secondary` the other actions; `ghost` a quiet action inside
 * content; `danger` something that removes or stops. `busy` shows a spinner and blocks double clicks.
 */
export function Button({
  children,
  variant = "primary",
  busy,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button type={type} className={`button button-${variant}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <LoaderCircle className="spin" size={17} /> : null}
      {children}
    </button>
  );
}

const NOTICE_ICON = { info: Info, success: CircleCheck, warn: TriangleAlert, bad: CircleAlert } as const;

/**
 * A message inside the page. `bad` is a failure the person must act on: red, and announced at once by screen readers.
 * `warn` is something to know about (amber, announced politely); `info` and `success` are informative.
 */
export function Notice({ children, tone = "info", id }: { children: ReactNode; tone?: "info" | "success" | "warn" | "bad"; id?: string }) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div id={id} className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"} aria-live={tone === "bad" ? "assertive" : "polite"}>
      <Icon size={18} aria-hidden="true" /> <span>{children}</span>
    </div>
  );
}

/** A small status chip in one of the five tones. */
export function Badge({ tone = "idle", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

/** Compact status vocabulary shared by device, service and job summaries. */
export function StatusBadge({ label, tone = "idle" }: { label: string; tone?: Tone }) {
  return <span className={`status-badge tone-${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>;
}

/** A labelled form control. The hint, when given, sits behind an (i) next to the label so the form stays short. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint ? <InfoPopover title={label}>{hint}</InfoPopover> : null}</span>
      {children}
    </label>
  );
}
