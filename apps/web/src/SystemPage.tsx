import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, CircleAlert, CircleCheck, Laptop, LoaderCircle, Pause, Play, RefreshCw, Server, TriangleAlert } from "lucide-react";
import type { NodeHistoryPoint, NodeSummary, SystemJob, SystemSummary } from "@studio/shared";
import { api } from "./lib/api";
import {
  ago, describeEvent, formatDuration, formatGb, laneRows, machineGauges, modelRows, NODE_STATE_LABEL, sparklinePath, summaryTiles, systemAlerts, workShare,
  type Gauge, type Tone,
} from "./lib/system";

const REFRESH_MS = 3_000;
const SERVICE_ORDER: Array<[string, string]> = [
  ["api", "Backend API"], ["supabase", "Supabase"], ["worker", "Worker dựng video"], ["render", "FFmpeg"],
  ["ollama", "Ollama"], ["localMedia", "Media local"], ["faceDetail", "Sửa khuôn mặt"], ["whiteboard", "Máy vẽ tay"],
];
const SERVICE_TONE: Record<string, { label: string; tone: Tone }> = {
  healthy: { label: "Hoạt động", tone: "ok" },
  configured: { label: "Đã cấu hình", tone: "idle" },
  offline: { label: "Mất kết nối", tone: "bad" },
  disabled: { label: "Đang tắt", tone: "idle" },
  unknown: { label: "Chưa kiểm tra", tone: "idle" },
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Re-renders every second so "cập nhật 3 giây trước" keeps counting between refreshes. */
function useNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Asks for the dashboard's numbers every few seconds while the tab is visible and updating is not paused. */
function useSystem(paused: boolean) {
  const [system, setSystem] = useState<SystemSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setSystem(await api.getSystem());
      setUpdatedAt(Date.now());
      setError(null);
    } catch (failure) {
      // keep showing the last numbers: a hiccup must not blank the page
      setError(failure instanceof Error ? failure.message : "Không lấy được số liệu hệ thống");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [paused, load]);

  return { system, error, updatedAt, refreshing, refresh: load };
}

export function SystemPage() {
  const [paused, setPaused] = useState(false);
  const { system, error, updatedAt, refreshing, refresh } = useSystem(paused);
  const now = useNow();
  const live = paused ? { tone: "idle", text: "Đã dừng cập nhật" }
    : error ? { tone: "bad", text: "Mất kết nối tới máy chủ" }
    : updatedAt ? { tone: "ok", text: `Cập nhật ${ago(new Date(updatedAt).toISOString(), now)}` }
    : { tone: "idle", text: "Đang tải…" };

  return (
    <div className="page system-page">
      <div className="page-heading">
        <div>
          <h1>Hệ thống</h1>
          <p>Hiệu năng từng máy, mô hình AI đang chạy và việc đang làm. Số liệu tự cập nhật mỗi {REFRESH_MS / 1000} giây khi bạn mở trang này.</p>
        </div>
        <div className="sys-live" role="status" aria-live="polite">
          <span className={`sys-dot tone-${live.tone}`} aria-hidden="true" />
          <span>{live.text}</span>
          <button className="button button-ghost" type="button" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Tiếp tục" : "Tạm dừng"}
          </button>
          <button className="button button-ghost" type="button" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spin" : undefined} /> Làm mới
          </button>
        </div>
      </div>

      {error && system && <div className="sys-banner tone-bad" role="alert">Không cập nhật được: {error}. Đang hiển thị số liệu lần trước ({ago(updatedAt ? new Date(updatedAt).toISOString() : null, now)}).</div>}
      {!system ? (
        error
          ? <div className="sys-banner tone-bad" role="alert"><CircleAlert size={16} /> {error}</div>
          : <div className="empty"><LoaderCircle className="spin" /> Đang đọc số liệu từ các máy…</div>
      ) : (
        <>
          <Tiles system={system} />
          <Alerts system={system} />
          {system.balancer && system.balancer.nodes.length ? (
            <section aria-label="Các máy" className="sys-machines">
              {system.balancer.nodes.map((node) => <MachineCard key={node.id} node={node} now={now} />)}
            </section>
          ) : (
            <section className="sys-card sys-solo">
              <h2>Chỉ có một máy</h2>
              <p>Mọi việc đang chạy trên máy chính. Thêm máy phụ (ví dụ MacBook Air) để chia việc vẽ ảnh, giọng đọc song song: xem hướng dẫn "Thêm máy phụ" trong <code>docs/TU-HOST.md</code>.</p>
            </section>
          )}
          <div className="sys-two">
            {system.balancer && system.balancer.nodes.length > 1 ? <WorkShare system={system} now={now} /> : null}
            {system.balancer?.recent?.length ? <ActivityFeed system={system} now={now} /> : null}
          </div>
          <div className="sys-two">
            <JobsCard jobs={system.jobs.recent} />
            <ServicesCard services={system.services} />
          </div>
          <p className="microcopy sys-foot">
            Số đếm việc tính từ lúc worker khởi động{system.balancer?.since ? ` (${new Date(system.balancer.since).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })})` : ""}.
            Chế độ chia việc, khóa API và dịch vụ trả phí nằm ở <Link to="/settings">Cài đặt</Link>.
          </p>
        </>
      )}
    </div>
  );
}

function Tiles({ system }: { system: SystemSummary }) {
  return (
    <section className="sys-tiles" aria-label="Tóm tắt">
      {summaryTiles(system).map((tile) => (
        <div key={tile.id} className={`sys-tile tone-${tile.tone}`}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small>{tile.detail}</small>
        </div>
      ))}
    </section>
  );
}

function Alerts({ system }: { system: SystemSummary }) {
  const alerts = systemAlerts(system);
  if (!alerts.length) {
    return <div className="sys-banner tone-ok"><CircleCheck size={16} /> Mọi máy, mô hình và dịch vụ đang bình thường.</div>;
  }
  return (
    <section className="sys-alerts" aria-label="Cần chú ý">
      <h2>Cần chú ý</h2>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id} className={`tone-${alert.tone === "info" ? "idle" : alert.tone}`}>
            {alert.tone === "bad" ? <CircleAlert size={16} /> : <TriangleAlert size={16} />}
            <div><strong>{alert.title}</strong><span>{alert.detail}</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meter({ gauge }: { gauge: Gauge }) {
  return (
    <div className={`sys-meter tone-${gauge.tone}`}>
      <div className="sys-meter-top"><span>{gauge.label}</span><strong>{gauge.value}</strong></div>
      {gauge.percent !== null ? (
        <div className="sys-bar" role="meter" aria-valuenow={gauge.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${gauge.label}: ${gauge.value}`}>
          <i style={{ width: `${Math.max(2, gauge.percent)}%` }} />
        </div>
      ) : null}
      <small>{gauge.detail}</small>
    </div>
  );
}

function Spark({ label, points, pick, max, now, format }: {
  label: string;
  points: NodeHistoryPoint[];
  pick: (point: NodeHistoryPoint) => number | null;
  max: number;
  now: number;
  format: (value: number) => string;
}) {
  const { line, area, last } = sparklinePath(points, pick, { width: 300, height: 36, max }, now);
  const summary = last === null ? "chưa có số liệu" : format(last);
  return (
    <div className="sys-spark">
      <div className="sys-spark-top"><span>{label}</span><strong>{summary}</strong></div>
      <svg viewBox="0 0 300 36" preserveAspectRatio="none" role="img" aria-label={`${label} trong 30 phút qua, hiện ${summary}`}>
        <line x1="0" x2="300" y1="35.5" y2="35.5" className="axis" vectorEffect="non-scaling-stroke" />
        {area ? <path className="area" d={area} /> : null}
        {line ? <path className="line" d={line} fill="none" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
    </div>
  );
}

function MachineCard({ node, now }: { node: NodeSummary; now: number }) {
  const state = NODE_STATE_LABEL[node.state];
  const gauges = machineGauges(node);
  const models = modelRows(node, now);
  const lanes = laneRows(node);
  const processes = node.resources?.processes ?? [];
  const history = node.history ?? [];
  const totalMemory = node.resources?.memTotalGb ?? 0;
  const biggest = Math.max(0.01, ...processes.map((process) => process.memGb));
  const Icon = node.role === "primary" ? Server : Laptop;
  return (
    <article className="sys-card sys-machine" aria-label={`Máy ${node.id}`}>
      <header>
        <Icon size={22} aria-hidden="true" />
        <div>
          <h2>{node.id}{node.role === "primary" ? " (máy chính)" : ""}</h2>
          <p>{node.detail}</p>
        </div>
        <span className={`sys-badge tone-${state.tone}`}>{state.label}</span>
      </header>
      <div className="sys-chips">
        {node.rttMs !== null && node.role === "secondary" ? <span>độ trễ mạng {node.rttMs} ms</span> : null}
        {node.role === "secondary" && node.matchesPrimary === true ? <span className="tone-ok">cấu hình giống máy chính</span> : null}
        {node.role === "secondary" && node.matchesPrimary === false ? <span className="tone-warn">cấu hình khác máy chính</span> : null}
        {node.role === "secondary" && node.matchesPrimary === null ? <span className="tone-idle">chưa kiểm chứng được cấu hình</span> : null}
      </div>

      {gauges.length ? <div className="sys-meters">{gauges.map((gauge) => <Meter key={gauge.id} gauge={gauge} />)}</div> : <p className="microcopy">Máy chưa báo số liệu tài nguyên.</p>}

      {history.length > 1 ? (
        <div className="sys-sparks">
          <h3>30 phút gần nhất</h3>
          <Spark label="CPU" points={history} pick={(point) => point.load} max={100} now={now} format={(value) => `${value}%`} />
          <Spark label="RAM" points={history} pick={(point) => point.mem} max={100} now={now} format={(value) => `${value}%`} />
          <Spark label="Việc đang chạy" points={history} pick={(point) => point.running} max={Math.max(2, ...history.map((point) => point.running))} now={now} format={(value) => String(value)} />
          <div className="sys-axis"><span>30 phút trước</span><span>bây giờ</span></div>
        </div>
      ) : null}

      {models.length ? (
        <div className="sys-section">
          <h3>Mô hình AI</h3>
          <ul className="sys-models">
            {models.map((row) => (
              <li key={row.id}>
                <span className={`sys-dot tone-${row.state === "ready" ? "ok" : row.state === "loading" ? "warn" : row.state === "idle" ? "idle" : "bad"}`} aria-hidden="true" />
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.detail}</span>
                  {row.chips.length ? <em>{row.chips.map((chip) => <code key={chip}>{chip}</code>)}</em> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {processes.length ? (
        <div className="sys-section">
          <h3>Bộ nhớ theo chương trình</h3>
          <ul className="sys-procs">
            {processes.map((process) => (
              <li key={process.id}>
                <span>{process.label}{process.count > 1 ? ` ×${process.count}` : ""}</span>
                <div className="sys-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (process.memGb / (totalMemory || biggest)) * 100)}%` }} /></div>
                <strong>{formatGb(process.memGb)}</strong>
              </li>
            ))}
          </ul>
          <p className="microcopy">Đo bằng bộ nhớ vật lý chương trình giữ, kể cả model nằm trong bộ nhớ GPU.</p>
        </div>
      ) : null}

      {lanes.length ? (
        <div className="sys-section">
          <h3>Loại việc máy này nhận</h3>
          <table className="sys-lanes">
            <thead><tr><th scope="col">Việc</th><th scope="col">Trạng thái</th><th scope="col">Đã xong</th><th scope="col">Mỗi việc</th></tr></thead>
            <tbody>
              {lanes.map((row) => (
                <tr key={row.id} className={row.eligible ? "" : "is-off"}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className={`sys-dot tone-${row.running ? "ok" : row.eligible ? "idle" : "bad"}`} aria-hidden="true" /> {row.status}
                    {row.reason ? <small>{row.reason}</small> : null}
                  </td>
                  <td>{row.done}</td>
                  <td>{row.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

const NODE_COLORS = ["#176bff", "#ff6b55", "#22b78d", "#8b5cf6"];

function WorkShare({ system, now }: { system: SystemSummary; now: number }) {
  const balancer = system.balancer!;
  const rows = workShare(balancer.nodes);
  return (
    <section className="sys-card">
      <h2>Chia việc giữa các máy</h2>
      <p className="microcopy">Mỗi thanh cho biết máy nào đã làm bao nhiêu việc từ lúc worker khởi động.</p>
      <div className="sys-legend">
        {balancer.nodes.map((node, index) => <span key={node.id}><i style={{ background: NODE_COLORS[index % NODE_COLORS.length] }} /> {node.id}</span>)}
      </div>
      {rows.length ? (
        <ul className="sys-share">
          {rows.map((row) => (
            <li key={row.lane}>
              <span>{row.label}</span>
              <div className="sys-stack" role="img" aria-label={row.parts.map((part) => `${part.node} ${part.done}`).join(", ")}>
                {row.parts.filter((part) => part.done > 0).map((part) => {
                  const index = balancer.nodes.findIndex((node) => node.id === part.node);
                  return <i key={part.node} style={{ width: `${part.percent}%`, background: NODE_COLORS[index % NODE_COLORS.length] }} title={`${part.node}: ${part.done} (${part.percent}%)`}>{part.percent >= 12 ? part.done : ""}</i>;
                })}
              </div>
              <strong>{row.total}</strong>
            </li>
          ))}
        </ul>
      ) : <p className="microcopy">Chưa có việc nào hoàn thành kể từ lúc khởi động.</p>}
      <h3>Quyết định phân việc gần nhất</h3>
      {balancer.decisions.length ? (
        <ul className="sys-decisions">
          {balancer.decisions.slice(0, 5).map((decision) => (
            <li key={`${decision.at}-${decision.lane}`}>
              <time dateTime={decision.at}>{clock(decision.at)}</time>
              <span><strong>{decision.tasks} việc {decision.lane}</strong> · {decision.reason}</span>
              <small>{ago(decision.at, now)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="microcopy">Chưa có lần phân việc nào.</p>}
    </section>
  );
}

function ActivityFeed({ system, now }: { system: SystemSummary; now: number }) {
  const events = system.balancer?.recent ?? [];
  return (
    <section className="sys-card">
      <h2><Activity size={16} aria-hidden="true" /> Hoạt động gần đây</h2>
      <ul className="sys-feed">
        {events.slice(0, 14).map((event, index) => (
          <li key={`${event.at}-${index}`} className={event.ok ? "" : "tone-bad"}>
            <span className={`sys-dot tone-${event.ok ? "ok" : "bad"}`} aria-hidden="true" />
            <code>{event.node}</code>
            <span>{describeEvent(event)}</span>
            <small>{ago(event.at, now)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobsCard({ jobs }: { jobs: SystemJob[] }) {
  const label: Record<SystemJob["status"], { text: string; tone: Tone }> = {
    queued: { text: "Đang chờ", tone: "idle" }, running: { text: "Đang chạy", tone: "ok" }, completed: { text: "Xong", tone: "ok" },
    failed: { text: "Lỗi", tone: "bad" }, cancelled: { text: "Đã hủy", tone: "idle" },
  };
  return (
    <section className="sys-card">
      <h2>Video gần đây</h2>
      {jobs.length ? (
        <ul className="sys-jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <div>
                <strong>{job.title || "Video không tên"}</strong>
                <span>{job.status === "running" || job.status === "queued" ? job.stage : job.status === "failed" ? job.stage : `Xong trong ${formatDuration(job.durationSeconds)}`}</span>
                {job.status === "running" ? <div className="sys-bar" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.title}: ${job.progress}%`}><i style={{ width: `${Math.max(2, job.progress)}%` }} /></div> : null}
              </div>
              <span className={`sys-badge tone-${label[job.status].tone}`}>{label[job.status].text}{job.status === "running" ? ` ${job.progress}%` : ""}</span>
            </li>
          ))}
        </ul>
      ) : <p className="microcopy">Chưa có video nào.</p>}
    </section>
  );
}

function ServicesCard({ services }: { services: SystemSummary["services"] }) {
  const rows = SERVICE_ORDER.filter(([id]) => services[id]);
  return (
    <section className="sys-card">
      <h2>Dịch vụ trên máy chính</h2>
      <ul className="sys-services">
        {rows.map(([id, name]) => {
          const service = services[id]!;
          const meta = SERVICE_TONE[service.state] ?? SERVICE_TONE.unknown!;
          return (
            <li key={id}>
              <span className={`sys-dot tone-${meta.tone}`} aria-hidden="true" />
              <div><strong>{name}</strong><span>{service.detail}</span></div>
              <span className={`sys-badge tone-${meta.tone}`}>{meta.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
