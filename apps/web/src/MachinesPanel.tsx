import { Link } from "react-router-dom";
import type { BalancerSummary } from "@studio/shared";
import { MODE_CHOICES, disabledAfter, machineChoices, machineWarning, serviceSummary } from "./lib/machines";

/**
 * Cài đặt → "Máy xử lý video": the controls. Which machines take part in making videos (a switch for each), and how the
 * work is split. What the machines are doing and how they perform is read-only and lives in the Hệ thống page.
 */
export function MachinesPanel({ balancer, busy, notice, services, onChange, onSyncNow, syncing }: {
  balancer: BalancerSummary;
  busy: boolean;
  /** The machine whose "Đồng bộ ngay" request is on its way. */
  syncing: string | null;
  onSyncNow: (id: string) => void;
  notice: { tone: "ok" | "warn"; text: string } | null;
  services: Record<string, { state: string; detail: string }>;
  onChange: (input: { mode?: BalancerSummary["mode"]; disabled?: string[] }) => void;
}) {
  const choices = machineChoices(balancer);
  const warning = machineWarning(balancer);
  const summary = serviceSummary(services);
  return (
    <div className="machines-panel">
      <ul className="machine-list" aria-label="Máy tham gia làm video">
        {choices.map((choice) => {
          const locked = busy || (choice.enabled && !choice.canSwitchOff);
          return (
            <li key={choice.id} className={choice.enabled ? "" : "is-off"}>
              <div className="machine-text">
                <strong>{choice.id}{choice.primary ? " (máy chính)" : ""}</strong>
                  <span>{choice.facts || (choice.enabled ? "Chưa có số liệu" : "Đã dừng model AI local và các server Python; vẫn giữ API/worker để bật lại")}</span>
                {choice.sync ? (
                  <span className={`machine-sync tone-${choice.sync.tone}`}>
                    Đồng bộ với Mac mini: <b>{choice.sync.label}</b>{choice.sync.detail ? ` · ${choice.sync.detail}` : ""}
                    {choice.sync.canRequest ? (
                      <button type="button" className="link-button" disabled={syncing !== null} onClick={() => onSyncNow(choice.id)}>
                        {syncing === choice.id ? "Đang gửi…" : "Đồng bộ ngay"}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <span className={`machine-state tone-${choice.state.tone}`}>{choice.state.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={choice.enabled}
                aria-label={`${choice.enabled ? "Tắt" : "Bật"} máy ${choice.id}`}
                className="switch"
                disabled={locked}
                title={choice.enabled && !choice.canSwitchOff ? "Cần giữ ít nhất một máy đang bật" : choice.enabled ? `Tắt máy ${choice.id}: không giao việc mới` : `Bật máy ${choice.id}`}
                onClick={() => onChange({ disabled: disabledAfter(balancer, choice.id, !choice.enabled) })}
              >
                <span className="switch-knob" aria-hidden="true" />
                <span className="switch-label">{choice.enabled ? "Bật" : "Tắt"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {warning ? <p className="machine-warning" role="note">{warning}</p> : null}

      <fieldset className="mode-choice" disabled={busy}>
        <legend>Cách chia việc</legend>
        {MODE_CHOICES.map((choice) => (
          <label key={choice.id} className={balancer.mode === choice.id ? "is-chosen" : ""}>
            <input type="radio" name="balance-mode" checked={balancer.mode === choice.id} onChange={() => onChange({ mode: choice.id })} />
            <span><strong>{choice.label}</strong><small>{choice.hint}</small></span>
          </label>
        ))}
      </fieldset>
      {notice ? <p className={`microcopy machine-notice tone-${notice.tone}`} role="status">{notice.text}</p> : null}

      <p className="machine-links">
        {summary.total ? `${summary.ok}/${summary.total} dịch vụ trên máy chính đang hoạt động. ` : ""}
        Hiệu năng, mô hình AI và việc đang chạy: <Link to="/system">mở Hệ thống</Link>.
      </p>
      {summary.problems.length ? (
        <ul className="machine-problems">
          {summary.problems.map((problem) => <li key={problem.name}><strong>{problem.name}</strong> {problem.detail}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
