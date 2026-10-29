import type { BalancerSummary, NodeHistoryPoint, NodeSummary, SystemSummary } from "@studio/shared";

/** Sample numbers for the "Hệ thống" page in the demo build (no worker to ask): a single Mac doing voice-over and subtitles. */

const history = (now: number, load: (minutes: number) => number, mem: (minutes: number) => number, swapGb: number, busy: (minutes: number) => number): NodeHistoryPoint[] =>
  Array.from({ length: 180 }, (_, index) => {
    const minutes = (179 - index) / 6; // one point every 10 seconds
    return { at: now - minutes * 60_000, load: Math.round(load(minutes)), mem: Math.round(mem(minutes)), swapGb, running: busy(minutes), rttMs: 20 };
  });

const lane = (over: Partial<NodeSummary["lanes"][string]> = {}) => ({ eligible: true, reasons: [], avgMs: null, running: 0, done: 0, ...over });

export function demoSystem(now = Date.now()): SystemSummary {
  const wave = (minutes: number, period: number, low: number, high: number) => low + ((Math.sin(minutes / period) + 1) / 2) * (high - low);
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const mini: NodeSummary = {
    id: "mini", role: "primary", state: "healthy", detail: "Sẵn sàng nhận việc", rttMs: 8,
    resources: {
      memTotalGb: 16, memPressure: "normal", power: "ac", batteryPercent: null, thermal: "nominal", loadAvg1: 2.3, cpuCores: 10,
      memUsedGb: 7.4, swapUsedGb: 0.4, swapTotalGb: 4, swapInMBps: 0, swapOutMBps: 0, diskFreeGb: 76, diskTotalGb: 228,
      processes: [
        { id: "docker", label: "Máy ảo (Docker, Claude Code)", memGb: 3.14, count: 4 },
        { id: "vieneu", label: "Giọng VieNeu", memGb: 1.25, count: 1 },
        { id: "whisper", label: "Whisper (nhận dạng giọng)", memGb: 0.27, count: 1 },
      ],
    },
    lanes: {
      tts: lane({ done: 12, avgMs: 2_100 }),
      transcribe: lane({ avgMs: 5_800 }),
    },
    models: {
      llm: { up: false, installed: [], loaded: [] },
      image: { state: "unknown", models: [], defaultModel: null },
      tts: { engines: ["vieneu"], defaultEngine: "vieneu" },
      transcribe: true, whiteboard: false, faceDetail: null,
    },
    history: history(now, (m) => wave(m, 4, 10, 45), () => 46 + Math.sin((now / 60_000) / 5) * 2, 0.4, (m) => (m < 6 ? 1 : 0)),
    matchesPrimary: true,
  };
  return {
    checkedAt: iso(0),
    balancer: {
      mode: "auto", nodes: [mini],
      decisions: [
        { at: iso(-92_000), lane: "tts", tasks: 12, nodes: ["mini"], reason: "Chạy trên máy chính (mini): đủ nhanh cho khối lượng hiện tại" },
      ],
      since: iso(-3 * 3600_000),
      recent: [
        { at: iso(-4_000), node: "mini", lane: "tts", ms: 2_000, ok: true },
        { at: iso(-26_000), node: "mini", lane: "tts", ms: 2_300, ok: true },
        { at: iso(-48_000), node: "mini", lane: "transcribe", ms: 5_600, ok: true },
      ],
    },
    services: {
      api: { state: "healthy", detail: "API đã phản hồi yêu cầu này", checkedAt: iso(0) },
      supabase: { state: "healthy", detail: "Đã xác thực tài khoản và truy cập được dữ liệu", checkedAt: iso(0) },
      worker: { state: "healthy", detail: "Đang chạy, sẵn sàng nhận việc", checkedAt: iso(0) },
      render: { state: "healthy", detail: "FFmpeg và bộ lọc phụ đề đã sẵn sàng", checkedAt: iso(0) },
      localMedia: { state: "healthy", detail: "Giọng đọc và phụ đề đang chạy", checkedAt: iso(0) },
    },
    jobs: {
      running: 1, queued: 0, completed24h: 5, failed24h: 0, avgVideoSeconds24h: 48,
      recent: [
        { id: "j3", type: "dub_video", title: "Ăn khế trả vàng", status: "running", stage: "Đang tạo giọng đọc", progress: 62, startedAt: iso(-40_000), finishedAt: null, durationSeconds: 40 },
        { id: "j2", type: "dub_video", title: "Sự tích Hồ Gươm", status: "completed", stage: "Hoàn thành", progress: 100, startedAt: iso(-3_600_000), finishedAt: iso(-3_549_000), durationSeconds: 51 },
        { id: "j1", type: "dub_video", title: "Đạo lý cổ phong", status: "completed", stage: "Hoàn thành", progress: 100, startedAt: iso(-7_200_000), finishedAt: iso(-7_156_000), durationSeconds: 44 },
      ],
    },
  };
}

/** What the demo page shows after a switch is flipped (the real one asks the server, which saves it and tells the worker). */
export function demoBalancerAfter(balancer: BalancerSummary, input: { mode?: BalancerSummary["mode"] | null; disabled?: string[] }): BalancerSummary {
  const off = new Set(input.disabled ?? balancer.nodes.filter((node) => node.enabled === false).map((node) => node.id));
  return {
    ...balancer,
    mode: input.mode ?? balancer.mode,
    nodes: balancer.nodes.map((node) => off.has(node.id)
      ? { ...node, enabled: false, state: "disabled", detail: "Đã tắt trong Cài đặt: không nhận việc mới" }
      : { ...node, enabled: true, state: node.state === "disabled" ? "healthy" : node.state, detail: node.state === "disabled" ? "Sẵn sàng nhận việc" : node.detail }),
  };
}
