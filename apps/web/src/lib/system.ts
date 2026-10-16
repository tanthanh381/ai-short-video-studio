import type { NodeActivityEvent, NodeHistoryPoint, NodeSummary, SystemSummary } from "@studio/shared";

/** Words and numbers for the "Hệ thống" dashboard. Everything here is a plain function of the data, so it is tested without a browser. */

export type Tone = "ok" | "warn" | "bad" | "idle";

/** Human-facing device names; internal node IDs remain lowercase for config and routing. */
export function nodeDisplayName(id: string, role?: NodeSummary["role"]): string {
  const name = id === "mini" ? "Mac Mini" : id === "air" ? "MacBook Air" : id;
  return role === "primary" ? `${name} (máy chính)` : name;
}

/** Job stages arrive from the worker with the node id ("· máy air"); the page shows the same names everywhere. */
export function withDisplayNames(text: string): string {
  return text.replace(/\bmáy (mini|air)\b/gu, (_, id: string) => nodeDisplayName(id));
}

export const LANE_LABELS: Record<string, string> = {
  image: "Vẽ ảnh",
  tts: "Giọng đọc",
  transcribe: "Nhận dạng giọng nói",
  whiteboard: "Vẽ tay",
  llm: "Viết kịch bản (Ollama)",
  video: "Chuyển động",
};
export const LANE_ORDER = ["image", "tts", "transcribe", "whiteboard", "llm", "video"] as const;

export const NODE_STATE_LABEL: Record<NodeSummary["state"], { label: string; tone: Tone }> = {
  healthy: { label: "Sẵn sàng", tone: "ok" },
  degraded: { label: "Hạn chế", tone: "warn" },
  paused: { label: "Tạm dừng", tone: "idle" },
  offline: { label: "Mất kết nối", tone: "bad" },
  disabled: { label: "Đã tắt", tone: "idle" },
};

const decimal = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",").replace(/,0$/u, "");

export function formatGb(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value > 0 && value < 1) return `${Math.max(1, Math.round(value * 1024))} MB`;
  return `${decimal(value)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} giây`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} giờ ${minutes % 60} phút` : `${hours} giờ`;
}

/** A task's time: tenths of a second when it is short, otherwise whole seconds. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 10_000) return `${decimal(ms / 1000)} giây`;
  return formatDuration(ms / 1000);
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 5) return "vừa xong";
  if (seconds < 60) return `${seconds} giây trước`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} giờ trước`;
  return `${Math.round(seconds / 86400)} ngày trước`;
}

const percentOf = (part: number | null | undefined, total: number | null | undefined) =>
  part === null || part === undefined || !total ? null : Math.round((part / total) * 100);

// --- the machine's gauges ----------------------------------------------------------------------------------------------

export type Gauge = {
  id: "ram" | "swap" | "cpu" | "disk" | "power" | "thermal";
  label: string;
  /** 0-100 for the bar; null when there is no bar to draw. */
  percent: number | null;
  value: string;
  detail: string;
  tone: Tone;
};

/**
 * Swapping out (MB/s, averaged over the last minute). macOS pages a little in the background all the time: the idle Mac mini wrote
 * 6-8 MB/s with no job running. Below SWAP_LIGHT it is nothing, up to SWAP_HURTS it is housekeeping that is mentioned and not
 * flagged, from SWAP_HURTS the work is slowed (amber), from SWAP_THRASH the machine is thrashing (red).
 */
export const SWAP_LIGHT_MBPS = 3;
export const SWAP_HURTS_MBPS = 15;
export const SWAP_THRASH_MBPS = 50;

const PRESSURE_TEXT = { normal: "áp lực bộ nhớ bình thường", warn: "hệ điều hành báo bộ nhớ đang căng", critical: "bộ nhớ ở mức nghiêm trọng", unknown: "chưa rõ áp lực bộ nhớ" } as const;

export function machineGauges(node: NodeSummary): Gauge[] {
  const resources = node.resources;
  if (!resources) return [];
  const gauges: Gauge[] = [];

  const ramPercent = percentOf(resources.memUsedGb, resources.memTotalGb);
  gauges.push({
    id: "ram",
    label: "RAM",
    percent: ramPercent,
    value: resources.memUsedGb != null && resources.memTotalGb ? `${formatGb(resources.memUsedGb)} / ${formatGb(resources.memTotalGb)}` : formatGb(resources.memTotalGb),
    detail: resources.memUsedGb == null ? "máy này chưa báo mức đang dùng (cần cập nhật mã)" : PRESSURE_TEXT[resources.memPressure],
    tone: resources.memPressure === "critical" ? "bad" : resources.memPressure === "warn" || (ramPercent ?? 0) >= 92 ? "warn" : "ok",
  });

  if (resources.swapUsedGb != null && resources.swapTotalGb != null) {
    const swapPercent = resources.swapTotalGb > 0 ? percentOf(resources.swapUsedGb, resources.swapTotalGb) : 0;
    const full = (swapPercent ?? 0) >= 50;
    const writing = resources.swapOutMBps ?? null; // MB/s going out to disk over the last minute; null from a bridge that does not measure it
    const hurts = writing !== null && writing >= SWAP_HURTS_MBPS;
    const light = writing !== null && writing >= SWAP_LIGHT_MBPS && !hurts;
    // A full swap alone proves nothing: macOS leaves old pages there long after the pressure is gone. Only pages going out now do.
    let tone: Tone = "ok";
    let detail = "bình thường";
    if (hurts) {
      tone = writing! >= SWAP_THRASH_MBPS ? "bad" : "warn";
      detail = tone === "bad"
        ? `đang ghi nặng ${decimal(writing!)} MB/s ra ổ đĩa vì thiếu RAM: ảnh và giọng đang chậm hẳn`
        : `đang ghi ${decimal(writing!)} MB/s ra ổ đĩa vì thiếu RAM: ảnh và giọng có thể chậm đi`;
    } else if (writing === null) {
      tone = resources.memPressure === "critical" ? "bad" : resources.memPressure === "warn" && (swapPercent ?? 0) >= 80 ? "warn" : "ok";
      if (full) detail = "chưa biết máy có đang ghi ra swap không (máy này chưa báo hoạt động swap)";
    } else if (light) {
      detail = `hệ điều hành đang ghi nhẹ ${decimal(writing)} MB/s ra ổ đĩa (việc nền, chưa làm chậm việc đang chạy)`;
    } else if (full) {
      detail = "Swap còn đầy nhưng máy không ghi thêm ra đĩa trong phút qua: đó là phần cũ còn nằm lại, không làm chậm việc đang chạy";
    }
    gauges.push({
      id: "swap",
      label: "RAM ảo (swap)",
      percent: swapPercent,
      value: resources.swapTotalGb > 0 ? `${formatGb(resources.swapUsedGb)} / ${formatGb(resources.swapTotalGb)}${hurts || light ? ` · ghi ${decimal(writing!)} MB/s` : ""}` : "chưa dùng",
      detail,
      tone,
    });
  }

  if (resources.loadAvg1 != null && resources.cpuCores) {
    const load = Math.round((resources.loadAvg1 / resources.cpuCores) * 100);
    gauges.push({
      id: "cpu",
      label: "CPU",
      percent: Math.min(100, load),
      value: `${load}%`,
      detail: `tải trung bình 1 phút ${decimal(resources.loadAvg1, 2)} trên ${resources.cpuCores} nhân`,
      tone: load >= 100 ? "bad" : load >= 85 ? "warn" : "ok",
    });
  }

  if (resources.diskFreeGb != null && resources.diskTotalGb) {
    const used = percentOf(resources.diskTotalGb - resources.diskFreeGb, resources.diskTotalGb);
    gauges.push({
      id: "disk",
      label: "Ổ đĩa",
      percent: used,
      value: `còn ${formatGb(resources.diskFreeGb)} / ${formatGb(resources.diskTotalGb)}`,
      detail: resources.diskFreeGb < 10 ? "sắp hết chỗ: model và video có thể không ghi được; hãy dọn ngay"
        : resources.diskFreeGb < 25 ? "còn ít chỗ: nên xóa video cũ, bản tải về hoặc model không dùng để tránh lỗi khi tạo video dài" : "đủ chỗ",
      tone: resources.diskFreeGb < 10 ? "bad" : resources.diskFreeGb < 25 ? "warn" : "ok",
    });
  }

  if (resources.power !== "unknown") {
    const battery = resources.batteryPercent;
    const onBattery = resources.power === "battery";
    gauges.push({
      id: "power",
      label: onBattery ? "Pin" : "Nguồn điện",
      percent: battery,
      value: battery === null ? "Cắm điện" : `${onBattery ? "đang dùng pin" : "cắm điện"} ${battery}%`,
      detail: onBattery ? "máy chạy bằng pin: bộ cân bằng tải tránh giao việc nặng khi pin thấp" : "chạy bằng điện",
      tone: onBattery && (battery ?? 100) < 30 ? "bad" : onBattery && (battery ?? 100) < 50 ? "warn" : "ok",
    });
  }

  if (resources.thermal !== "unknown") {
    gauges.push({
      id: "thermal",
      label: "Nhiệt độ",
      percent: null,
      value: resources.thermal === "throttled" ? "Đang nóng" : "Bình thường",
      detail: resources.thermal === "throttled" ? "hệ điều hành đang giảm xung CPU để hạ nhiệt" : "không bị giảm xung",
      tone: resources.thermal === "throttled" ? "bad" : "ok",
    });
  }
  return gauges;
}

// --- AI models ----------------------------------------------------------------------------------------------------------

export type ModelRow = { id: string; label: string; state: "ready" | "idle" | "loading" | "down"; detail: string; chips: string[] };

function unloadsIn(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "";
  const seconds = Math.round((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(seconds)) return "";
  return seconds <= 0 ? " · sắp giải phóng" : ` · tự giải phóng sau ${formatDuration(seconds)} nếu không dùng`;
}

/** The AI programs a machine has: what is loaded in memory, what is only installed, what is not answering. */
export function modelRows(node: NodeSummary, now = Date.now()): ModelRow[] {
  const models = node.models;
  if (!models) return [];
  const rows: ModelRow[] = [];
  const loaded = models.llm.loaded;
  if (!models.llm.up) rows.push({ id: "llm", label: "Ollama (viết kịch bản)", state: "down", detail: "Ollama không phản hồi", chips: [] });
  else if (loaded.length) {
    rows.push({
      id: "llm", label: "Ollama (viết kịch bản)", state: "ready",
      detail: `Đang nạp trong RAM: ${loaded.map((model) => `${model.name}${model.sizeGb != null ? ` (${formatGb(model.sizeGb)})` : ""}`).join(", ")}${unloadsIn(loaded[0]?.expiresAt ?? null, now)}`,
      chips: models.llm.installed,
    });
  } else {
    rows.push({
      id: "llm", label: "Ollama (viết kịch bản)", state: "idle",
      detail: models.llm.installed.length ? "Đã cài, chưa nạp vào RAM (tự nạp khi có kịch bản cần viết)" : "Chưa cài model nào",
      chips: models.llm.installed,
    });
  }
  const image = models.image;
  rows.push({
    id: "image", label: "Vẽ ảnh",
    state: image.state === "ready" ? "ready" : image.state === "loading" ? "loading" : image.state === "asleep" ? "idle" : "down",
    detail: image.state === "loading" ? "Đang nạp model ảnh vào bộ nhớ"
      : image.state === "asleep" ? "Đang ngủ để nhả RAM · tự thức khi có ảnh cần vẽ (mất khoảng 1 phút nạp model)"
      : image.state === "ready" ? `Sẵn sàng · mặc định ${image.defaultModel ?? "—"}`
      : image.state === "down" ? "Máy vẽ ảnh không phản hồi" : "Chưa có thông tin",
    chips: image.models,
  });
  rows.push({
    id: "tts", label: "Giọng đọc",
    state: models.tts.engines.length ? "ready" : "down",
    detail: models.tts.engines.length ? `Sẵn sàng · mặc định ${models.tts.defaultEngine ?? "—"}` : "Chưa có giọng đọc nào phản hồi",
    chips: models.tts.engines,
  });
  rows.push({
    id: "transcribe", label: "Nhận dạng giọng nói (Whisper)",
    state: models.transcribe ? "ready" : "down",
    detail: models.transcribe ? "Sẵn sàng" : models.transcribe === false ? "Whisper không phản hồi" : "Chưa có thông tin",
    chips: [],
  });
  if (models.faceDetail !== null) {
    rows.push({ id: "face", label: "Sửa khuôn mặt", state: models.faceDetail ? "ready" : "down", detail: models.faceDetail ? "Sẵn sàng" : "Đang tắt hoặc thiếu mô hình dò mặt (video vẫn tạo bình thường)", chips: [] });
  }
  rows.push({ id: "whiteboard", label: "Máy vẽ tay", state: models.whiteboard ? "ready" : "down", detail: models.whiteboard ? "Sẵn sàng" : "Không phản hồi", chips: [] });
  return rows;
}

// --- work ---------------------------------------------------------------------------------------------------------------

export type LaneRow = { id: string; label: string; eligible: boolean; status: string; reason: string; avg: string; running: number; done: number };

export function laneRows(node: NodeSummary): LaneRow[] {
  return LANE_ORDER.flatMap((id) => {
    const lane = node.lanes[id];
    if (!lane) return [];
    // A second Mac is not expected to move pictures (LTX): show that lane only when it has done something.
    if (id === "video" && !lane.eligible && lane.done === 0) return [];
    return [{
      id, label: LANE_LABELS[id] ?? id, eligible: lane.eligible,
      status: lane.running > 0 ? `đang làm ${lane.running}` : lane.eligible ? "nhận việc" : "không nhận",
      reason: lane.reasons.join("; "),
      avg: lane.avgMs === null ? "chưa đo" : formatMs(lane.avgMs),
      running: lane.running,
      done: lane.done,
    }];
  });
}

export type ShareRow = { lane: string; label: string; total: number; parts: Array<{ node: string; done: number; percent: number }> };

/** Who did how much of each kind of work since the worker started. */
export function workShare(nodes: NodeSummary[]): ShareRow[] {
  return LANE_ORDER.flatMap((lane) => {
    const total = nodes.reduce((sum, node) => sum + (node.lanes[lane]?.done ?? 0), 0);
    if (total === 0) return [];
    return [{
      lane, label: LANE_LABELS[lane] ?? lane, total,
      parts: nodes.map((node) => ({ node: node.id, done: node.lanes[lane]?.done ?? 0, percent: Math.round(((node.lanes[lane]?.done ?? 0) / total) * 100) })),
    }];
  });
}

export function describeEvent(event: NodeActivityEvent): string {
  return `${LANE_LABELS[event.lane] ?? event.lane} ${event.ok ? "xong" : "lỗi"} sau ${formatMs(event.ms)}`;
}

// --- charts -------------------------------------------------------------------------------------------------------------

/** Both Macs run a virtual machine (Docker on the main one, Claude Code's on a laptop); a bridge from before the rename calls it Docker. */
export function processLabel(process: { id: string; label: string }): string {
  return process.id === "docker" ? "Máy ảo (Docker, Claude Code)" : process.label;
}

export const HISTORY_WINDOW_MS = 30 * 60_000;

/** An SVG path for one series over the last `windowMs`: gaps (no reading, or no look at all for a while) are left open, not joined. */
export function sparklinePath(
  points: NodeHistoryPoint[],
  pick: (point: NodeHistoryPoint) => number | null,
  size: { width: number; height: number; max: number },
  now: number,
  windowMs = HISTORY_WINDOW_MS,
): { line: string; area: string; last: number | null } {
  const start = now - windowMs;
  const x = (at: number) => ((at - start) / windowMs) * size.width;
  const y = (value: number) => size.height - (Math.max(0, Math.min(value, size.max)) / size.max) * (size.height - 2) - 1;
  const segments: string[] = [];
  const areas: string[] = [];
  let run: Array<[number, number]> = [];
  const flush = () => {
    if (run.length >= 2) {
      segments.push(run.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" "));
      const first = run[0]!;
      const last = run[run.length - 1]!;
      areas.push(`M${first[0].toFixed(1)} ${size.height} ${run.map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")} L${last[0].toFixed(1)} ${size.height} Z`);
    } else if (run.length === 1) {
      const [px, py] = run[0]!;
      segments.push(`M${(px - 0.5).toFixed(1)} ${py.toFixed(1)} L${(px + 0.5).toFixed(1)} ${py.toFixed(1)}`);
    }
    run = [];
  };
  let previousAt: number | null = null;
  let last: number | null = null;
  for (const point of points) {
    if (point.at < start) continue;
    const value = pick(point);
    // two readings further apart than a minute mean the machine was not being watched in between
    if (previousAt !== null && point.at - previousAt > 60_000) flush();
    previousAt = point.at;
    if (value === null) { flush(); continue; }
    run.push([x(point.at), y(value)]);
    last = value;
  }
  flush();
  return { line: segments.join(" "), area: areas.join(" "), last };
}

// --- keeping a second machine identical to the main one ------------------------------------------------------------------

export type SyncView = { tone: Tone; label: string; detail: string; percent: number | null; differences: string[]; canRequest: boolean; recovery: string | null };

const behindCount = (sync: NonNullable<NodeSummary["sync"]>) => sync.behind.code + sync.behind.toolkit + sync.behind.models + sync.behind.ollama;

/** What to say about how closely a second machine follows the main one; null for the main machine (it is the source). */
export function syncView(node: NodeSummary, now = Date.now()): SyncView | null {
  if (node.role === "primary") return null;
  const sync = node.sync;
  // No answer from the machine at all (it is restarting its programs after an update, or is off the network): that is not a
  // missing sync agent, and telling the owner to reinstall would send them the wrong way.
  if (!sync && (node.state === "offline" || !node.resources)) {
    return { tone: "warn", label: "Tạm mất kết nối", detail: "Chưa nhận được số liệu từ máy này. Thường do máy đang khởi động lại dịch vụ sau khi cập nhật và sẽ tự trở lại sau ít phút. Nếu kéo dài, kiểm tra máy còn bật, không ngủ và cùng mạng Tailscale.", percent: null, differences: [], canRequest: false, recovery: null };
  }
  if (!sync) {
    return { tone: "idle", label: "Chưa bật tự động", detail: "Máy này chưa chạy tiến trình đồng bộ (hoặc còn bản cũ). Dán lại dòng lệnh cài trên máy để bật.", percent: null, differences: [], canRequest: false, recovery: null };
  }
  const checked = sync.checkedAt ? `kiểm tra ${ago(sync.checkedAt, now)}` : "chưa kiểm tra";
  const version = sync.localVersion ? `phiên bản ${sync.localVersion}` : "";
  const recovery = sync.recovery && (sync.recovery.count > 0 || sync.recovery.down.length > 0)
    ? [
        sync.recovery.down.length ? `Đang thiếu: ${sync.recovery.down.join(", ")} (máy tự khởi động lại)` : "",
        sync.recovery.count > 0 ? `Đã tự bật lại dịch vụ ${sync.recovery.count} lần${sync.recovery.lastAt ? `, lần cuối ${ago(sync.recovery.lastAt, now)}` : ""}` : "",
      ].filter(Boolean).join(" · ")
    : null;
  const base = { percent: null, differences: [] as string[], canRequest: true, recovery };
  switch (sync.state) {
    case "in-sync":
      return { ...base, tone: "ok", label: "Giống Mac Mini", detail: [version, checked].filter(Boolean).join(" · ") };
    case "syncing": {
      const progress = sync.progress;
      const percent = progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.doneBytes / progress.totalBytes) * 100)) : null;
      const size = progress && progress.totalBytes > 0 ? ` (${formatGb(progress.doneBytes / 2 ** 30)} / ${formatGb(progress.totalBytes / 2 ** 30)})` : "";
      return { ...base, tone: "warn", label: "Đang đồng bộ", detail: `${progress?.label || "Đang so sánh với Mac Mini"}${size}`, percent, differences: sync.differences, canRequest: false };
    }
    case "behind":
      return { ...base, tone: "warn", label: `Lệch ${behindCount(sync)} mục`, detail: sync.error ?? `Còn khác Mac Mini · ${checked}`, differences: sync.differences };
    case "error":
      return { ...base, tone: "bad", label: "Đồng bộ lỗi", detail: sync.error ?? "Không rõ nguyên nhân", differences: sync.differences };
    case "paused":
      return { ...base, tone: "idle", label: "Đã tạm dừng", detail: "Chủ máy đã tạm dừng đồng bộ và tự khởi động lại dịch vụ (bật lại: Dong-Bo-May-Phu.command resume).", canRequest: false };
    default:
      return { ...base, tone: "idle", label: "Chưa rõ", detail: checked };
  }
}

// --- what needs attention -----------------------------------------------------------------------------------------------

const GAUGE_ALERT: Partial<Record<Gauge["id"], string>> = {
  swap: "thiếu RAM, đang dùng ổ đĩa thay RAM nên ảnh và giọng chậm hơn",
  ram: "sắp hết RAM",
  disk: "sắp đầy ổ đĩa",
  cpu: "đang quá tải",
  thermal: "đang nóng, máy tự giảm tốc độ",
};

function gaugeAlertTitle(name: string, gauge: Gauge): string {
  const words = GAUGE_ALERT[gauge.id];
  return words ? `${name} ${words}` : `${name}: ${gauge.label} ${gauge.value}`;
}

export type SystemAlert = { id: string; tone: "bad" | "warn" | "info"; title: string; detail: string };

const SERVICE_NAMES: Record<string, string> = {
  api: "Dịch vụ ứng dụng", supabase: "Cơ sở dữ liệu", worker: "Bộ dựng video", render: "Bộ xuất video (FFmpeg)",
  ollama: "Ollama", localMedia: "Bộ tạo ảnh và giọng", faceDetail: "Sửa khuôn mặt", whiteboard: "Máy vẽ tay",
};

/** What the owner should look at first: a machine that dropped out, one short of memory, a service down, videos that failed. */
export function systemAlerts(system: SystemSummary): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  for (const node of system.balancer?.nodes ?? []) {
    const displayName = nodeDisplayName(node.id, node.role);
    // A second machine that has not been updated yet runs the old media bridge and has no sync agent: it differs from the main one in
    // everything at once. That is one thing to do (update it once), not three alarms.
    const outdated = node.role !== "primary" && node.state !== "offline" && node.state !== "disabled" && !node.sync && node.matchesPrimary === false;
    if (node.state === "disabled") {
      // switched off by the owner: nothing to fix, and its readings are not a problem either
      alerts.push({ id: `${node.id}-disabled`, tone: "info", title: `${displayName} đang tắt`, detail: "Đã tắt trong Cài đặt: máy này không nhận việc mới. Bật lại ở Cài đặt → Máy tạo video." });
      continue;
    }
    if (node.state === "offline") alerts.push({ id: `${node.id}-offline`, tone: "bad", title: `${displayName} mất kết nối`, detail: node.detail });
    else if (node.state === "paused") alerts.push({ id: `${node.id}-paused`, tone: "info", title: `${displayName} đang tạm dừng`, detail: "Chủ máy đã tạm dừng: máy chính không giao việc mới cho máy này (bật lại bằng Mo-May-Phu.command resume)." });
    else if (outdated) {
      alerts.push({
        id: `${node.id}-outdated`, tone: "warn", title: `${displayName} đang chạy bản cũ`,
        detail: `Cập nhật một lần: mở Terminal trên ${displayName} và dán dòng lệnh cài (Cài đặt → Máy xử lý video, hoặc docs/TU-HOST.md). Từ lần sau máy tự đồng bộ với Mac Mini. Trong lúc này ${displayName} chưa được giao việc vẽ ảnh và đọc giọng vì hai máy làm ra kết quả khác nhau.`,
      });
    } else if (node.state === "degraded") alerts.push({ id: `${node.id}-degraded`, tone: "warn", title: `${displayName} bị hạn chế`, detail: node.detail });
    for (const gauge of machineGauges(node)) {
      if (gauge.tone === "ok" || gauge.tone === "idle") continue;
      if (gauge.id === "ram" && node.resources?.memPressure === "warn" && (gauge.percent ?? 0) < 92) continue; // a warning from the system alone: the swap gauge says whether it matters
      // The title says what is wrong in words; the numbers go to the detail line.
      alerts.push({ id: `${node.id}-${gauge.id}`, tone: gauge.tone === "bad" ? "bad" : "warn", title: gaugeAlertTitle(nodeDisplayName(node.id), gauge), detail: GAUGE_ALERT[gauge.id] ? `${gauge.label}: ${gauge.value}` : gauge.detail });
    }
    const sync = node.role === "primary" || node.state === "offline" || outdated ? null : syncView(node);
    if (sync && node.role !== "primary" && node.state !== "offline") {
      if (!node.sync) alerts.push({ id: `${node.id}-sync-off`, tone: "info", title: `${displayName} chưa bật tự động đồng bộ`, detail: sync.detail });
      else if (node.sync.state === "error") alerts.push({ id: `${node.id}-sync-error`, tone: "warn", title: `Đồng bộ ${displayName} đang lỗi`, detail: sync.detail });
      else if (node.sync.state !== "paused" && node.sync.recovery && node.sync.recovery.down.length > 0)
        alerts.push({ id: `${node.id}-services-down`, tone: "warn", title: `${displayName} đang thiếu dịch vụ: ${node.sync.recovery.down.join(", ")}`, detail: "Máy tự khởi động lại các dịch vụ này (thử lại sau 3, 6, 12 phút nếu chưa lên). Nếu kéo dài, kiểm tra máy còn mở, còn cắm điện và đã đăng nhập." });
      else if (node.sync.state === "behind") alerts.push({ id: `${node.id}-sync-behind`, tone: "info", title: `${displayName} chưa giống Mac Mini (${sync.label.toLowerCase()})`, detail: sync.differences.slice(0, 3).join("; ") || sync.detail });
    }
    if (node.matchesPrimary === false && !outdated) {
      alerts.push({ id: `${node.id}-parity`, tone: "warn", title: `${displayName} làm ảnh và giọng khác máy chính`, detail: node.lanes.image?.reasons[0] ?? "Cấu hình hoặc mã khác máy chính nên máy này không được chia việc ảnh và giọng." });
    }
  }
  for (const [id, service] of Object.entries(system.services)) {
    if (service.state === "offline" && SERVICE_NAMES[id]) alerts.push({ id: `service-${id}`, tone: "bad", title: `${SERVICE_NAMES[id]} không phản hồi`, detail: service.detail });
  }
  if (system.jobs.failed24h > 0) alerts.push({ id: "jobs-failed", tone: "warn", title: `${system.jobs.failed24h} video lỗi trong 24 giờ qua`, detail: "Mở Lịch sử xuất hoặc dự án để xem lý do và tạo lại." });
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

export type SummaryTile = { id: string; label: string; value: string; detail: string; tone: Tone };

export function summaryTiles(system: SystemSummary): SummaryTile[] {
  const all = system.balancer?.nodes ?? [];
  const nodes = all.filter((node) => node.state !== "disabled");
  const switchedOff = all.length - nodes.length;
  const ready = nodes.filter((node) => node.state === "healthy").length;
  const usable = nodes.filter((node) => node.state === "healthy" || node.state === "degraded").length;
  const share = system.balancer ? workShare(system.balancer.nodes).find((row) => row.lane === "image") : undefined;
  const tiles: SummaryTile[] = [
    {
      id: "machines", label: "Máy tạo video",
      value: nodes.length ? `${usable}/${nodes.length} hoạt động` : "1 máy",
      detail: nodes.length
        ? `${ready} sẵn sàng hoàn toàn${nodes.length > ready ? `, ${nodes.length - ready} hạn chế` : ""}${switchedOff ? ` · ${switchedOff} máy đã tắt` : ""}`
        : "Chưa thêm máy phụ: mọi việc chạy trên máy chính",
      tone: nodes.length === 0 ? "idle" : usable === nodes.length ? (ready === nodes.length ? "ok" : "warn") : "bad",
    },
    {
      id: "jobs", label: "Video đang làm",
      value: `${system.jobs.running} chạy · ${system.jobs.queued} chờ`,
      detail: system.jobs.running ? withDisplayNames(system.jobs.recent.find((job) => job.status === "running")?.stage ?? "Đang xử lý") : "Không có video nào đang chạy",
      tone: system.jobs.running ? "ok" : "idle",
    },
    {
      id: "throughput", label: "24 giờ qua",
      value: `${system.jobs.completed24h} video xong`,
      detail: system.jobs.avgVideoSeconds24h !== null ? `trung bình ${formatDuration(system.jobs.avgVideoSeconds24h)} mỗi video${system.jobs.failed24h ? ` · ${system.jobs.failed24h} lỗi` : ""}` : system.jobs.failed24h ? `${system.jobs.failed24h} lỗi` : "Chưa có video nào hoàn thành",
      tone: system.jobs.failed24h ? "warn" : "idle",
    },
  ];
  if (share) {
    tiles.push({
      id: "share", label: "Chia việc vẽ ảnh",
      value: `${share.total} ảnh`,
      detail: `${share.parts.map((part) => `${nodeDisplayName(part.node)} ${part.done}`).join(" · ")} · từ lần khởi động gần nhất`,
      tone: "idle",
    });
  }
  const followers = nodes.filter((node) => node.role !== "primary");
  if (followers.length) {
    const views = followers.map((node) => ({ node, view: syncView(node)! }));
    const worst = views.find((item) => item.view.tone === "bad") ?? views.find((item) => item.view.tone === "warn") ?? views.find((item) => item.view.tone === "idle") ?? views[0]!;
    tiles.push({
      id: "sync", label: "Đồng bộ model và mã",
      // One helper Mac (the usual case): the state is the value and the name goes in the line below.
      value: views.length === 1 ? views[0]!.view.label : views.map((item) => `${nodeDisplayName(item.node.id)}: ${item.view.label}`).join(" · "),
      detail: worst.view.tone === "ok"
        ? `${views.map((item) => nodeDisplayName(item.node.id)).join(", ")} tự giữ giống Mac Mini mỗi phút`
        : `${views.length === 1 ? `${nodeDisplayName(views[0]!.node.id)}: ` : ""}${worst.view.detail}`,
      tone: worst.view.tone,
    });
  }
  return tiles;
}
