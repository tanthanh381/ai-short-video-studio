import { describe, expect, it } from "vitest";
import type { NodeHistoryPoint, NodeSummary, SystemSummary } from "@studio/shared";
import {
  ago, describeEvent, formatDuration, formatGb, formatMs, laneRows, machineGauges, modelRows, processLabel, sparklinePath, summaryTiles, systemAlerts, workShare,
} from "./system";

const NOW = Date.parse("2026-10-11T08:00:00Z");

const lane = (over: Partial<NodeSummary["lanes"][string]> = {}) => ({ eligible: true, reasons: [], avgMs: null, running: 0, done: 0, ...over });
const node = (id: string, over: Partial<NodeSummary> = {}): NodeSummary => ({
  id, role: id === "mini" ? "primary" : "secondary", state: "healthy", detail: "Sẵn sàng nhận việc", rttMs: 20,
  resources: { memTotalGb: 16, memPressure: "normal", power: "ac", batteryPercent: null, thermal: "nominal", loadAvg1: 2, cpuCores: 10, memUsedGb: 8, swapUsedGb: 0, swapTotalGb: 2, diskFreeGb: 100, diskTotalGb: 228 },
  lanes: { image: lane(), tts: lane(), transcribe: lane(), whiteboard: lane(), llm: lane(), video: lane({ eligible: false, reasons: ["chưa có dịch vụ chuyển động"] }) },
  matchesPrimary: true,
  ...over,
});
const system = (nodes: NodeSummary[], over: Partial<SystemSummary> = {}): SystemSummary => ({
  checkedAt: "2026-10-11T08:00:00Z",
  balancer: { mode: "auto", nodes, decisions: [] },
  services: {},
  jobs: { running: 0, queued: 0, completed24h: 0, failed24h: 0, avgVideoSeconds24h: null, recent: [] },
  ...over,
});

describe("formatting", () => {
  it("writes sizes and times the way the pages do", () => {
    expect(formatGb(16)).toBe("16 GB");
    expect(formatGb(12.6)).toBe("12,6 GB");
    expect(formatGb(0.02)).toBe("20 MB");
    expect(formatGb(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 giây");
    expect(formatDuration(380)).toBe("6 phút 20 giây");
    expect(formatDuration(600)).toBe("10 phút");
    expect(formatDuration(3900)).toBe("1 giờ 5 phút");
    expect(formatMs(2100)).toBe("2,1 giây");
    expect(formatMs(13_400)).toBe("13 giây");
    expect(formatMs(null)).toBe("—");
    expect(ago("2026-10-11T07:59:58Z", NOW)).toBe("vừa xong");
    expect(ago("2026-10-11T07:59:30Z", NOW)).toBe("30 giây trước");
    expect(ago("2026-10-11T07:50:00Z", NOW)).toBe("10 phút trước");
    expect(ago(null, NOW)).toBe("—");
  });
});

describe("machineGauges", () => {
  const byId = (item: NodeSummary) => Object.fromEntries(machineGauges(item).map((gauge) => [gauge.id, gauge]));

  it("shows memory, swap, CPU and disk with a bar and a verdict", () => {
    const gauges = byId(node("mini"));
    expect(gauges.ram).toMatchObject({ percent: 50, value: "8 GB / 16 GB", tone: "ok" });
    expect(gauges.swap).toMatchObject({ percent: 0, tone: "ok" });
    expect(gauges.cpu).toMatchObject({ percent: 20, value: "20%", tone: "ok" });
    expect(gauges.disk).toMatchObject({ percent: 56, value: "còn 100 GB / 228 GB", tone: "ok" });
    expect(gauges.power).toMatchObject({ value: "Cắm điện", percent: null });
    expect(gauges.thermal).toMatchObject({ value: "Bình thường", tone: "ok" });
  });

  it("turns red for a machine that has run out of memory and is writing to disk", () => {
    const squeezed = node("mini", { resources: { ...node("mini").resources!, memUsedGb: 15.2, memPressure: "warn", swapUsedGb: 8, swapTotalGb: 9 } });
    const gauges = byId(squeezed);
    expect(gauges.swap).toMatchObject({ percent: 89, tone: "bad" });
    expect(gauges.swap!.detail).toMatch(/ảnh và giọng chậm/);
    expect(gauges.ram!.tone).toBe("warn");
  });

  it("flags a laptop on low battery, a hot machine and a nearly full disk", () => {
    const sick = node("air", { resources: { ...node("air").resources!, power: "battery", batteryPercent: 20, thermal: "throttled", diskFreeGb: 6 } });
    const gauges = byId(sick);
    expect(gauges.power).toMatchObject({ tone: "bad", value: "đang dùng pin 20%" });
    expect(gauges.thermal).toMatchObject({ tone: "bad", value: "Đang nóng" });
    expect(gauges.disk!.tone).toBe("bad");
  });

  it("says what is missing instead of inventing numbers for an older media bridge", () => {
    const basic = node("air", { resources: { memTotalGb: 24, memPressure: "normal", power: "ac", batteryPercent: 100, thermal: "nominal", loadAvg1: 1, cpuCores: 10 } });
    const gauges = byId(basic);
    expect(gauges.ram).toMatchObject({ percent: null, value: "24 GB" });
    expect(gauges.ram!.detail).toMatch(/cần cập nhật mã/);
    expect(gauges.swap).toBeUndefined();
    expect(gauges.disk).toBeUndefined();
    expect(machineGauges(node("air", { resources: null }))).toEqual([]);
  });
});

describe("modelRows", () => {
  const models = (over: Partial<NonNullable<NodeSummary["models"]>> = {}): NonNullable<NodeSummary["models"]> => ({
    llm: { up: true, installed: ["qwen3.5:4b"], loaded: [] },
    image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
    tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
    transcribe: true, whiteboard: true, faceDetail: true,
    ...over,
  });
  const rows = (value: NonNullable<NodeSummary["models"]>) => Object.fromEntries(modelRows(node("air", { models: value }), NOW).map((row) => [row.id, row]));

  it("tells the model Ollama holds in memory from one that is only installed", () => {
    expect(rows(models()).llm).toMatchObject({ state: "idle", chips: ["qwen3.5:4b"] });
    const loaded = rows(models({ llm: { up: true, installed: ["qwen3.5:4b"], loaded: [{ name: "qwen3.5:4b", sizeGb: 3.4, expiresAt: "2026-10-11T08:04:00Z" }] } })).llm!;
    expect(loaded.state).toBe("ready");
    expect(loaded.detail).toBe("Đang nạp trong RAM: qwen3.5:4b (3,4 GB) · tự giải phóng sau 4 phút nếu không dùng");
    expect(rows(models({ llm: { up: false, installed: [], loaded: [] } })).llm!.state).toBe("down");
  });

  it("reports the picture model loading, voices, Whisper, faces and the hand-drawing server", () => {
    const all = rows(models({ image: { state: "loading", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" }, transcribe: false, faceDetail: false, whiteboard: false }));
    expect(all.image).toMatchObject({ state: "loading", chips: ["sdxl-turbo"] });
    expect(all.tts).toMatchObject({ state: "ready", chips: ["vieneu", "piper"] });
    expect(all.transcribe!.state).toBe("down");
    expect(all.face!.state).toBe("down");
    expect(all.whiteboard!.state).toBe("down");
    expect(rows(models({ faceDetail: null })).face).toBeUndefined();
  });

  it("has nothing to list for a worker that does not report models yet", () => {
    expect(modelRows(node("air"), NOW)).toEqual([]);
  });
});

describe("work", () => {
  it("lists the kinds of work a machine takes with the reason when it does not, and hides the motion lane it never has", () => {
    const rows = laneRows(node("air", { lanes: { image: lane({ running: 1, done: 11, avgMs: 13_000 }), tts: lane({ eligible: false, reasons: ["cấu hình khác máy chính"] }), video: lane({ eligible: false }) } }));
    expect(rows.map((row) => row.id)).toEqual(["image", "tts"]);
    expect(rows[0]).toMatchObject({ status: "đang làm 1", avg: "13 giây", done: 11 });
    expect(rows[1]).toMatchObject({ status: "không nhận", reason: "cấu hình khác máy chính", avg: "chưa đo" });
  });

  it("shows who did how much since the worker started", () => {
    const share = workShare([
      node("mini", { lanes: { image: lane({ done: 4 }), tts: lane({ done: 9 }) } }),
      node("air", { lanes: { image: lane({ done: 11 }), tts: lane({ done: 6 }) } }),
    ]);
    expect(share).toHaveLength(2);
    expect(share[0]).toMatchObject({ lane: "image", total: 15, parts: [{ node: "mini", done: 4, percent: 27 }, { node: "air", done: 11, percent: 73 }] });
    expect(workShare([node("mini")])).toEqual([]); // nothing done yet: nothing to split
  });

  it("describes a finished or failed task", () => {
    expect(describeEvent({ at: "x", node: "air", lane: "image", ms: 13_000, ok: true })).toBe("Vẽ ảnh xong sau 13 giây");
    expect(describeEvent({ at: "x", node: "mini", lane: "tts", ms: 2_500, ok: false })).toBe("Giọng đọc lỗi sau 2,5 giây");
  });
});

describe("sparklinePath", () => {
  const point = (minutesAgo: number, load: number | null): NodeHistoryPoint => ({ at: NOW - minutesAgo * 60_000, load, mem: null, swapGb: null, running: 0, rttMs: null });
  const size = { width: 300, height: 30, max: 100 };

  it("draws the newest point at the right edge and 100% at the top", () => {
    const { line, last } = sparklinePath([point(1, 0), point(0.5, 50), point(0, 100)], (p) => p.load, size, NOW, 60_000);
    expect(line.startsWith("M0.0 29.0")).toBe(true);
    expect(line).toContain("L150.0 15.0");
    expect(line.endsWith("L300.0 1.0")).toBe(true);
    expect(last).toBe(100);
  });

  it("leaves a gap where the machine was not watched or a reading is missing, and drops what is older than the window", () => {
    const { line } = sparklinePath([point(40, 90), point(20, 10), point(19.5, 20), point(10, null), point(5, 30), point(4.5, 40)], (p) => p.load, size, NOW);
    const segments = line.split("M").filter(Boolean);
    expect(segments).toHaveLength(2); // before the gap, and after it; the 40-minute-old point is not drawn
    expect(sparklinePath([], (p) => p.load, size, NOW)).toEqual({ line: "", area: "", last: null });
  });

  it("clamps values that pass the scale (a load above 100% of the cores)", () => {
    const { line } = sparklinePath([point(1, 250), point(0, 250)], (p) => p.load, size, NOW);
    expect(line).toContain(" 1.0");
  });
});

describe("systemAlerts and summaryTiles", () => {
  it("is quiet when everything is fine", () => {
    const healthy = system([node("mini"), node("air")]);
    expect(systemAlerts(healthy)).toEqual([]);
    const tiles = Object.fromEntries(summaryTiles(healthy).map((tile) => [tile.id, tile]));
    expect(tiles.machines).toMatchObject({ value: "2/2 hoạt động", tone: "ok" });
    expect(tiles.alerts).toMatchObject({ value: "Không có", tone: "ok" });
    expect(tiles.jobs).toMatchObject({ value: "0 chạy · 0 chờ", tone: "idle" });
  });

  it("puts a machine that dropped out and a squeezed Mac first, then the rest", () => {
    const squeezed = node("mini", { resources: { ...node("mini").resources!, memUsedGb: 12, memPressure: "warn", swapUsedGb: 8, swapTotalGb: 9 } });
    const off = node("air", { state: "offline", detail: "cầu nối media không kết nối được", matchesPrimary: null });
    const alerts = systemAlerts(system([squeezed, off], { jobs: { running: 0, queued: 0, completed24h: 2, failed24h: 1, avgVideoSeconds24h: 300, recent: [] }, services: { ollama: { state: "offline", detail: "Không kết nối được Ollama", checkedAt: "x" }, supabase: { state: "healthy", detail: "ok", checkedAt: "x" } } }));
    expect(alerts.map((alert) => alert.id)).toEqual(["mini-swap", "air-offline", "service-ollama", "jobs-failed"]); // red ones first, in the order found
    expect(alerts[1]).toMatchObject({ tone: "bad", title: "Máy air mất kết nối" });
    expect(alerts.find((alert) => alert.id === "mini-ram")).toBeUndefined(); // a warning from the system alone, swap tells the story
  });

  it("warns when a machine would draw differently from the main one", () => {
    const air = node("air", { state: "degraded", matchesPrimary: false, lanes: { image: lane({ eligible: false, reasons: ["cấu hình khác máy chính ở IMAGE_STEPS"] }) } });
    const alerts = systemAlerts(system([node("mini"), air]));
    expect(alerts.find((alert) => alert.id === "air-parity")).toMatchObject({ tone: "warn", detail: "cấu hình khác máy chính ở IMAGE_STEPS" });
    expect(summaryTiles(system([node("mini"), air])).find((tile) => tile.id === "machines")).toMatchObject({ value: "2/2 hoạt động", tone: "warn" });
  });

  it("counts the work and the videos in the tiles", () => {
    const busy = system(
      [node("mini", { lanes: { image: lane({ done: 4 }) } }), node("air", { lanes: { image: lane({ done: 11 }) } })],
      { jobs: { running: 1, queued: 2, completed24h: 5, failed24h: 0, avgVideoSeconds24h: 380, recent: [{ id: "j", type: "create_video", title: "A", status: "running", stage: "Đang tạo ảnh cảnh 3 · máy air", progress: 30, startedAt: null, finishedAt: null, durationSeconds: 60 }] } },
    );
    const tiles = Object.fromEntries(summaryTiles(busy).map((tile) => [tile.id, tile]));
    expect(tiles.jobs).toMatchObject({ value: "1 chạy · 2 chờ", detail: "Đang tạo ảnh cảnh 3 · máy air", tone: "ok" });
    expect(tiles.throughput).toMatchObject({ value: "5 video xong", detail: "trung bình 6 phút 20 giây mỗi video" });
    expect(tiles.share).toMatchObject({ value: "mini 4 · air 11" });
  });

  it("still works with one machine and no balancer", () => {
    const solo = system([], { balancer: null });
    expect(summaryTiles(solo).find((tile) => tile.id === "machines")).toMatchObject({ value: "1 máy", tone: "idle" });
    expect(systemAlerts(solo)).toEqual([]);
  });
});

describe("the demo data", () => {
  it("tells a consistent story: a Mac short of memory, a healthy one, work shared between them", async () => {
    const { demoSystem } = await import("./demo-system");
    const demo = demoSystem(NOW);
    const nodes = demo.balancer!.nodes;
    expect(nodes.map((item) => item.id)).toEqual(["mini", "air"]);
    for (const item of nodes) {
      expect(item.history!.length).toBe(180);
      expect(item.history![179]!.at).toBeLessThanOrEqual(NOW);
      expect(machineGauges(item).length).toBeGreaterThanOrEqual(5);
      expect(modelRows(item, NOW).length).toBeGreaterThanOrEqual(6);
    }
    expect(systemAlerts(demo).map((alert) => alert.id)).toContain("mini-swap");
    expect(workShare(nodes)[0]).toMatchObject({ lane: "image", total: 15 });
    expect(summaryTiles(demo).map((tile) => tile.id)).toEqual(["machines", "jobs", "throughput", "share", "alerts"]);
  });
});

describe("processLabel", () => {
  it("names the virtual machine the same whichever bridge reported it", () => {
    expect(processLabel({ id: "docker", label: "Docker (API + worker)" })).toBe("Máy ảo (Docker, Claude Code)");
    expect(processLabel({ id: "image", label: "Vẽ ảnh SDXL-Turbo" })).toBe("Vẽ ảnh SDXL-Turbo");
  });
});

describe("machines switched off in Cài đặt", () => {
  const off = node("air", { state: "disabled", enabled: false, detail: "Đã tắt trong Cài đặt: không nhận việc mới", matchesPrimary: true });

  it("is not an alarm: one quiet note, and no complaints about its memory or connection", () => {
    const squeezed = { ...off, resources: { ...off.resources!, memUsedGb: 23.5, memPressure: "critical" as const, swapUsedGb: 7, swapTotalGb: 7 } };
    const alerts = systemAlerts(system([node("mini"), squeezed]));
    expect(alerts.map((alert) => [alert.id, alert.tone])).toEqual([["air-disabled", "info"]]);
    expect(alerts[0]!.detail).toMatch(/Cài đặt → Máy xử lý video/);
  });

  it("counts only the machines that are on, and says how many are off", () => {
    const tile = summaryTiles(system([node("mini"), off])).find((item) => item.id === "machines")!;
    expect(tile).toMatchObject({ value: "1/1 hoạt động", tone: "ok" });
    expect(tile.detail).toBe("1 sẵn sàng hoàn toàn · 1 máy đã tắt");
  });
});
