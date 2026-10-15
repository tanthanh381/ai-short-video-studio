import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type InfoPopoverProps = {
  title: string;
  children: ReactNode;
  label?: string;
  className?: string;
};

/** Compact, keyboard-safe detail disclosure for secondary product information. */
export function InfoPopover({ title, children, label = "Xem thông tin", className = "" }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`info-popover ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="info-trigger"
        aria-label={label}
        data-tooltip={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open ? (
        <span id={panelId} className="info-popover-panel" role="dialog" aria-label={title}>
          <span className="info-popover-heading">
            <strong>{title}</strong>
            <button type="button" className="info-close" aria-label="Đóng thông tin" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
          <span className="info-popover-body">{children}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Metric({
  icon,
  label,
  value,
  detail,
  percent,
  tone = "ok",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: ReactNode;
  percent?: number | null;
  tone?: "ok" | "warn" | "bad" | "idle";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-top">
        <span className="metric-label"><span className="metric-icon" aria-hidden="true">{icon}</span><span className="sr-only">{label}</span></span>
        <strong>{value}</strong>
        {detail ? <InfoPopover title={label}>{detail}</InfoPopover> : null}
      </div>
      {percent !== undefined && percent !== null ? <div className="metric-bar" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(2, percent)}%` }} /></div> : null}
    </div>
  );
}
