/**
 * The studio's confirmation box, in place of window.confirm: the question is the title, the consequence sits below it,
 * and both buttons say what they do ("Xóa dự án" / "Giữ lại") instead of OK / Hủy. `askConfirm()` can be awaited from
 * any handler; <ConfirmHost /> (mounted once in App) shows the box. Built on <dialog>, so focus stays inside and Esc
 * answers no.
 */
import { useEffect, useRef, useState } from "react";

export type ConfirmOptions = {
  title: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger: the action removes or stops something (red button). */
  tone?: "default" | "danger";
};

type Request = ConfirmOptions & { resolve(answer: boolean): void };

let show: ((request: Request) => void) | null = null;

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  // Without a host (tests, a page rendered alone) fall back to the browser's box rather than acting unasked.
  if (!show) return Promise.resolve(window.confirm([options.title, options.detail].filter(Boolean).join("\n\n")));
  return new Promise((resolve) => show!({ ...options, resolve }));
}

export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    show = (next) => setRequest((current) => {
      current?.resolve(false); // a second question replaces an unanswered one
      return next;
    });
    return () => { show = null; };
  }, []);

  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    if (request && !box.open) {
      box.showModal();
      // a destructive action is never the default: focus starts on the safe button
      if (request.tone !== "danger") confirmButton.current?.focus();
    } else if (!request && box.open) box.close();
  }, [request]);

  function answer(value: boolean) {
    request?.resolve(value);
    setRequest(null);
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby={request?.detail ? "confirm-detail" : undefined}
      onCancel={(event) => { event.preventDefault(); answer(false); }}
      onClick={(event) => { if (event.target === event.currentTarget) answer(false); }}
    >
      {request && (
        <div className="confirm-body">
          <h2 id="confirm-title">{request.title}</h2>
          {request.detail && <p id="confirm-detail">{request.detail}</p>}
          <div className="confirm-actions">
            <button type="button" className="button button-secondary" onClick={() => answer(false)}>
              {request.cancelLabel ?? "Giữ lại"}
            </button>
            <button
              ref={confirmButton}
              type="button"
              className={`button ${request.tone === "danger" ? "button-danger" : "button-primary"}`}
              onClick={() => answer(true)}
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
