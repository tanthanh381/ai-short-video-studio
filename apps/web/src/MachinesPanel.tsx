import { Link } from "react-router-dom";
import type { BalancerSummary } from "@studio/shared";
import { MODE_CHOICES, disabledAfter, machineChoices, machineWarning, serviceSummary } from "./lib/machines";

/**
 * Cài đặt → thiết bị xử lý: chọn thiết bị nhận tác vụ mới và cách phân bổ tác vụ.
 * Trạng thái vận hành chi tiết được hiển thị trong Hệ thống.
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
      <ul className="machine-list" aria-label="Thiết bị tham gia xử lý">
        {choices.map((choice) => {
          const locked = busy || (choice.enabled && !choice.canSwitchOff);
          return (
            <li key={choice.id} className={choice.enabled ? "" : "is-off"}>
              <div className="machine-text">
                <strong>{choice.id}{choice.primary ? " (chính)" : ""}</strong>
                <span>{choice.facts || (choice.enabled ? "Chưa có số liệu" : "Đang tắt · không nhận tác vụ mới")}</span>
                {choice.sync ? (
                  <span className={`machine-sync tone-${choice.sync.tone}`}>
                    Đồng bộ thiết bị: <b>{choice.sync.label}</b>{choice.sync.detail ? ` · ${choice.sync.detail}` : ""}
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
                aria-label={`${choice.enabled ? "Tắt" : "Bật"} thiết bị ${choice.id}`}
                className="switch"
                disabled={locked}
                title={choice.enabled && !choice.canSwitchOff ? "Cần duy trì ít nhất một thiết bị đang bật" : choice.enabled ? `Tắt ${choice.id}: không nhận tác vụ mới` : `Bật ${choice.id}`}
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
        <legend>Phân bổ tác vụ</legend>
        {MODE_CHOICES.map((choice) => (
          <label key={choice.id} className={balancer.mode === choice.id ? "is-chosen" : ""}>
            <input type="radio" name="balance-mode" checked={balancer.mode === choice.id} onChange={() => onChange({ mode: choice.id })} />
            <span><strong>{choice.label}</strong><small>{choice.hint}</small></span>
          </label>
        ))}
      </fieldset>
      {notice ? <p className={`microcopy machine-notice tone-${notice.tone}`} role="status">{notice.text}</p> : null}

      <p className="machine-links">
        {summary.total ? `${summary.ok}/${summary.total} dịch vụ đang hoạt động. ` : ""}
        Xem hiệu năng và tác vụ đang chạy tại <Link to="/system">Hệ thống</Link>.
      </p>
      {summary.problems.length ? (
        <ul className="machine-problems">
          {summary.problems.map((problem) => <li key={problem.name}><strong>{problem.name}</strong> {problem.detail}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
