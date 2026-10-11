import type { BalancerSummary, NodeHistoryPoint, NodeSummary, SystemSummary } from "@studio/shared";

/** Sample numbers for the "Hệ thống" page in the demo build (no worker to ask): two Macs, one of them short of memory. */

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
    id: "mini", role: "primary", state: "degraded", detail: "RAM đang căng", rttMs: 8,
    resources: {
      memTotalGb: 16, memPressure: "warn", power: "ac", batteryPercent: null, thermal: "nominal", loadAvg1: 5.1, cpuCores: 10,
      memUsedGb: 14.2, swapUsedGb: 8, swapTotalGb: 9, swapInMBps: 9.5, swapOutMBps: 12, diskFreeGb: 44, diskTotalGb: 228,
      processes: [
        { id: "image", label: "Vẽ ảnh SDXL-Turbo", memGb: 3.96, count: 1 },
        { id: "docker", label: "Máy ảo (Docker, Claude Code)", memGb: 3.14, count: 4 },
        { id: "ollama", label: "Ollama (viết kịch bản)", memGb: 3.2, count: 1 },
        { id: "vieneu", label: "Giọng VieNeu", memGb: 1.25, count: 1 },
        { id: "comfy", label: "ComfyUI (SDXL Base)", memGb: 0.56, count: 1 },
        { id: "piper", label: "Giọng Piper", memGb: 0.41, count: 2 },
        { id: "whisper", label: "Whisper (nhận dạng giọng)", memGb: 0.27, count: 1 },
      ],
    },
    lanes: {
      image: lane({ running: 1, done: 4, avgMs: 19_000, reasons: ["RAM đang căng"] }), tts: lane({ done: 9, avgMs: 2_100, reasons: ["RAM đang căng"] }),
      transcribe: lane({ avgMs: 5_800 }), whiteboard: lane({ avgMs: 41_000 }), llm: lane({ done: 1, avgMs: 22_000 }),
      video: lane({ eligible: false, reasons: ["chưa có dịch vụ chuyển động"] }),
    },
    models: {
      llm: { up: true, installed: ["qwen3.5:4b"], loaded: [{ name: "qwen3.5:4b", sizeGb: 3.4, expiresAt: iso(4 * 60_000) }] },
      image: { state: "ready", models: ["sdxl-turbo", "sdxl-base-1.0-comfyui"], defaultModel: "sdxl-turbo" },
      tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
      transcribe: true, whiteboard: true, faceDetail: true,
    },
    history: history(now, (m) => wave(m, 3, 25, 95), () => 86 + Math.sin((now / 60_000 - 0) / 5) * 3, 8, (m) => (m < 6 ? 1 : 0)),
    matchesPrimary: true,
  };
  const air: NodeSummary = {
    id: "air", role: "secondary", state: "healthy", detail: "Sẵn sàng nhận việc", rttMs: 74,
    resources: {
      memTotalGb: 24, memPressure: "normal", power: "ac", batteryPercent: 100, thermal: "nominal", loadAvg1: 2.4, cpuCores: 10,
      memUsedGb: 11.8, swapUsedGb: 0.3, swapTotalGb: 2, swapInMBps: 0, swapOutMBps: 0, diskFreeGb: 242, diskTotalGb: 494,
      processes: [
        { id: "image", label: "Vẽ ảnh SDXL-Turbo", memGb: 4.1, count: 1 },
        { id: "vieneu", label: "Giọng VieNeu", memGb: 1.3, count: 1 },
        { id: "piper", label: "Giọng Piper", memGb: 0.4, count: 2 },
        { id: "whisper", label: "Whisper (nhận dạng giọng)", memGb: 0.3, count: 1 },
      ],
    },
    lanes: {
      image: lane({ running: 1, done: 11, avgMs: 13_000 }), tts: lane({ done: 6, avgMs: 2_600 }), transcribe: lane({ avgMs: 7_000 }),
      whiteboard: lane(), llm: lane({ avgMs: 38_000 }), video: lane({ eligible: false, reasons: ["chưa có dịch vụ chuyển động"] }),
    },
    models: {
      llm: { up: true, installed: ["qwen3.5:4b"], loaded: [] },
      image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
      tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
      transcribe: true, whiteboard: true, faceDetail: true,
    },
    history: history(now, (m) => wave(m, 4, 8, 55), () => wave(now / 60_000 - 0, 7, 44, 52), 0.3, (m) => (m < 6 ? 1 : 0)),
    matchesPrimary: true,
    sync: {
      state: "in-sync", checkedAt: iso(-25_000), appliedAt: iso(-3 * 3600_000), sourceVersion: "9f3a7c21b0d4", localVersion: "9f3a7c21b0d4",
      behind: { code: 0, toolkit: 0, models: 0, ollama: 0 }, differences: [], error: null, restartPending: [], progress: null,
      recovery: { count: 1, lastAt: iso(-2 * 3600_000), down: [] },
    },
  };
  return {
    checkedAt: iso(0),
    balancer: {
      mode: "auto", nodes: [mini, air],
      decisions: [
        { at: iso(-90_000), lane: "image", tasks: 15, nodes: ["air", "mini"], reason: "Chạy song song 2 máy (air, mini): ước tính 1 phút 39 giây thay vì 2 phút 28 giây" },
        { at: iso(-92_000), lane: "tts", tasks: 15, nodes: ["mini"], reason: "Chạy một máy (mini): thêm máy air chỉ nhanh hơn 33% (7 giây), không đáng" },
      ],
      since: iso(-3 * 3600_000),
      recent: [
        { at: iso(-4_000), node: "air", lane: "image", ms: 12_800, ok: true },
        { at: iso(-9_000), node: "mini", lane: "image", ms: 19_400, ok: true },
        { at: iso(-17_000), node: "air", lane: "image", ms: 13_100, ok: true },
        { at: iso(-26_000), node: "mini", lane: "tts", ms: 2_000, ok: true },
        { at: iso(-31_000), node: "air", lane: "image", ms: 13_000, ok: true },
        { at: iso(-48_000), node: "mini", lane: "tts", ms: 2_300, ok: false },
      ],
    },
    services: {
      api: { state: "healthy", detail: "API đã phản hồi yêu cầu này", checkedAt: iso(0) },
      supabase: { state: "healthy", detail: "Đã xác thực tài khoản và truy cập được dữ liệu", checkedAt: iso(0) },
      worker: { state: "healthy", detail: "Worker đang chạy và sẵn sàng nhận job", checkedAt: iso(0) },
      render: { state: "healthy", detail: "FFmpeg và bộ lọc phụ đề đã sẵn sàng", checkedAt: iso(0) },
      ollama: { state: "healthy", detail: "Ollama đang phản hồi", checkedAt: iso(0) },
      localMedia: { state: "healthy", detail: "Media server và LTX đang phản hồi", checkedAt: iso(0) },
    },
    jobs: {
      running: 1, queued: 0, completed24h: 5, failed24h: 0, avgVideoSeconds24h: 317,
      recent: [
        { id: "j3", type: "create_video", title: "Ăn khế trả vàng", status: "running", stage: "Đang tạo ảnh cảnh 7 · máy air", progress: 42, startedAt: iso(-150_000), finishedAt: null, durationSeconds: 150 },
        { id: "j2", type: "create_video", title: "Sự tích Hồ Gươm", status: "completed", stage: "Hoàn thành", progress: 100, startedAt: iso(-3_600_000), finishedAt: iso(-3_290_000), durationSeconds: 310 },
        { id: "j1", type: "create_video", title: "Đạo lý cổ phong", status: "completed", stage: "Hoàn thành", progress: 100, startedAt: iso(-7_200_000), finishedAt: iso(-6_870_000), durationSeconds: 330 },
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
