import { describe, expect, it } from "vitest";
import {
  assessNode, baseMs, busyRemainingMs, estimateMs, formatDuration, planLane, simulate,
  type AssessContext, type NodeResources, type NodeSnapshot, type NodeStatus, type PlanNode,
} from "./node-plan";

const resources = (over: Partial<NodeResources> = {}): NodeResources => ({
  cpuCores: 8, memTotalGb: 16, memPressure: "normal", loadAvg1: 1, power: "ac", batteryPercent: null, thermal: "nominal", ...over,
});
const status = (over: Partial<NodeStatus> = {}): NodeStatus => ({
  accepting: true,
  capabilities: { image: true, tts: true, transcribe: true, video: false },
  image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
  tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
  resources: resources(),
  fingerprint: "same",
  ...over,
});
const node = (id: string, over: Partial<NodeSnapshot> = {}): NodeSnapshot => ({
  id, local: id === "mini", up: true, mediaUp: true, llmUp: true, llmInstalled: ["qwen3.5:4b"], llmLoaded: ["qwen3.5:4b"],
  whiteboardUp: true, cooldownUntil: 0, rttMs: 20, status: status(), ewma: {}, lastSampleAt: {}, inflight: {}, ...over,
});
const context = (nodes: NodeSnapshot[], over: Partial<AssessContext> = {}): AssessContext => ({
  now: 1_000_000, nodes, strict: true, minBatteryPercent: 30, ...over,
});
const assess = (air: NodeSnapshot, lane: Parameters<typeof assessNode>[1], over: Partial<AssessContext> = {}) =>
  assessNode(air, lane, context([node("mini"), air], over));

describe("assessNode", () => {
  it("accepts a healthy second Mac that matches the main one", () => {
    const result = assess(node("air"), "image");
    expect(result).toMatchObject({ eligible: true, speed: 1, warmupMs: 0 });
  });

  it("rejects a machine that is down, paused or just failed", () => {
    expect(assess(node("air", { up: false, error: "không phản hồi" }), "image")).toMatchObject({ eligible: false, reasons: ["không phản hồi"] });
    expect(assess(node("air", { status: status({ accepting: false }) }), "tts").reasons[0]).toMatch(/tạm dừng/);
    expect(assess(node("air", { cooldownUntil: 1_000_001 }), "image").reasons[0]).toMatch(/chờ thử lại/);
  });

  it("keeps a second Mac away from pictures and voices when its settings or code differ", () => {
    const different = node("air", { status: status({ fingerprint: "other" }) });
    expect(assess(different, "image")).toMatchObject({ eligible: false });
    expect(assess(different, "tts").reasons[0]).toMatch(/khác máy chính/);
    // Hand-drawing and Ollama do not depend on the image settings.
    expect(assess(different, "whiteboard").eligible).toBe(true);
    expect(assess(different, "image", { strict: false }).eligible).toBe(true);
  });

  it("cannot vouch for a machine whose bridge does not report a fingerprint", () => {
    const old = node("air", { status: status({ fingerprint: undefined as unknown as string }) });
    expect(assess(old, "image").reasons[0]).toMatch(/cập nhật mã/);
  });

  it("does not hand over a voice the main machine would not use", () => {
    const piperOnly = node("air", { status: status({ tts: { engines: ["piper"], defaultEngine: "piper" } }) });
    expect(assess(piperOnly, "tts").reasons[0]).toMatch(/vieneu/);
    // Asked for piper by name, a machine that has piper may take it.
    expect(assess(piperOnly, "tts", { request: { ttsEngine: "piper" } }).eligible).toBe(true);
    const sameVoices = node("air");
    expect(assess(sameVoices, "tts", { request: { ttsEngine: "vieneu" } }).eligible).toBe(true);
    expect(assess(sameVoices, "tts", { request: { ttsEngine: "xtts" } }).eligible).toBe(false);
  });

  it("waits for the image model instead of sending requests that would be refused", () => {
    const loading = node("air", { status: status({ image: { state: "loading", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" } }) });
    expect(assess(loading, "image").reasons[0]).toMatch(/nạp model/);
    expect(assess(node("air"), "image", { request: { imageModel: "sdxl-base-1.0-comfyui" } }).reasons[0]).toMatch(/thiếu model/);
  });

  it("protects a laptop on a low battery and slows its estimate on a higher one", () => {
    const low = node("air", { status: status({ resources: resources({ power: "battery", batteryPercent: 22 }) }) });
    expect(assess(low, "image")).toMatchObject({ eligible: false, reasons: ["pin còn 22%"] });
    const half = node("air", { status: status({ resources: resources({ power: "battery", batteryPercent: 60 }) }) });
    expect(assess(half, "image")).toMatchObject({ eligible: true, speed: 1.25 });
  });

  it("slows a hot, memory-starved or busy machine, and refuses heavy work when memory is critical", () => {
    const hot = node("air", { status: status({ resources: resources({ thermal: "throttled" }) }) });
    expect(assess(hot, "image").speed).toBeCloseTo(1.6);
    const tight = node("air", { status: status({ resources: resources({ memPressure: "warn" }) }) });
    expect(assess(tight, "image").speed).toBeCloseTo(1.3);
    const critical = node("air", { status: status({ resources: resources({ memPressure: "critical" }) }) });
    expect(assess(critical, "image").eligible).toBe(false);
    expect(assess(critical, "tts").eligible).toBe(true);
    const busy = node("air", { status: status({ resources: resources({ loadAvg1: 16 }) }) });
    expect(assess(busy, "image").speed).toBeCloseTo(2);
  });

  it("checks Ollama separately: installed model, warm-up when it is not resident", () => {
    const air = node("air");
    expect(assess(air, "llm", { request: { llmModel: "qwen3.5:4b" } })).toMatchObject({ eligible: true, warmupMs: 0 });
    expect(assess(node("air", { llmLoaded: [] }), "llm", { request: { llmModel: "qwen3.5:4b" } }).warmupMs).toBeGreaterThan(0);
    expect(assess(node("air", { llmInstalled: ["llama3"] }), "llm", { request: { llmModel: "qwen3.5:4b" } }).reasons[0]).toMatch(/chưa cài/);
    expect(assess(node("air", { llmUp: false }), "llm").eligible).toBe(false);
    expect(assess(node("air", { whiteboardUp: false }), "whiteboard").eligible).toBe(false);
  });
});

describe("estimates", () => {
  const ctx = (nodes: NodeSnapshot[]) => context(nodes);

  it("assumes a machine nobody has measured is slower than the others, and trusts what it reports about itself", () => {
    const mini = node("mini", { ewma: { image: 20_000 } });
    expect(baseMs(node("air"), "image", ctx([mini, node("air")]))).toBeCloseTo(26_000);
    const told = node("air", { status: status({ perf: { image: 31_000 } }) });
    expect(baseMs(told, "image", ctx([mini, told]))).toBe(31_000);
    expect(baseMs(node("mini"), "image", ctx([node("mini")]))).toBe(25_000); // prior, nothing measured anywhere
  });

  it("gives a machine another chance when its slow measurement is old", () => {
    const mini = node("mini", { ewma: { image: 20_000 } });
    const stale = node("air", { ewma: { image: 90_000 }, lastSampleAt: { image: 1_000_000 - 30 * 60_000 } });
    const fresh = node("air", { ewma: { image: 90_000 }, lastSampleAt: { image: 999_000 } });
    expect(baseMs(stale, "image", ctx([mini, stale]))).toBe(30_000);
    expect(baseMs(fresh, "image", ctx([mini, fresh]))).toBe(90_000);
  });

  it("adds network cost for another machine and the slowdown of its condition", () => {
    const air = node("air", { ewma: { image: 20_000 }, rttMs: 40 });
    const ok = { eligible: true, reasons: [], speed: 1.25, warmupMs: 0 };
    expect(estimateMs(air, "image", ok, ctx([node("mini"), air]))).toBe(20_000 * 1.25 + 300 + 120);
    expect(estimateMs(node("mini", { ewma: { image: 20_000 } }), "image", { ...ok, speed: 1 }, ctx([node("mini")]))).toBe(20_000);
  });

  it("knows how long a busy machine still has to work", () => {
    const working = node("mini", { inflight: { image: [{ startedAt: 990_000, expectedMs: 25_000 }] } });
    expect(busyRemainingMs(working, "image", 1_000_000)).toBe(15_000);
    expect(busyRemainingMs(node("mini"), "image", 1_000_000)).toBe(0);
    const overdue = node("mini", { inflight: { image: [{ startedAt: 0, expectedMs: 10_000 }] } });
    expect(busyRemainingMs(overdue, "image", 1_000_000)).toBe(2_000);
    // Hand-drawing takes two at a time on a machine, so a single one running leaves room.
    expect(busyRemainingMs(node("mini", { inflight: { whiteboard: [{ startedAt: 0, expectedMs: 9_000 }] } }), "whiteboard", 5_000)).toBe(0);
  });

  it("formats durations for people", () => {
    expect(formatDuration(900)).toBe("1 giây");
    expect(formatDuration(45_000)).toBe("45 giây");
    expect(formatDuration(120_000)).toBe("2 phút");
    expect(formatDuration(150_000)).toBe("2 phút 30 giây");
  });
});

const plan = (id: string, durationMs: number, availableAtMs = 0): PlanNode => ({ id, local: id === "mini", availableAtMs, durationMs });
const auto = { mode: "auto" as const, minGain: 0.15, minSavingsMs: 30_000 };

describe("simulate (earliest finish time)", () => {
  it("shares equal machines evenly and gives a faster one proportionally more", () => {
    expect(simulate([plan("mini", 20_000), plan("air", 20_000)], 6).assigned).toEqual({ mini: 3, air: 3 });
    const uneven = simulate([plan("mini", 20_000), plan("air", 40_000)], 6);
    expect(uneven.assigned).toEqual({ mini: 4, air: 2 });
    expect(uneven.makespanMs).toBe(80_000);
  });

  it("never gives a slow machine the last task if the fast one finishes it first", () => {
    expect(simulate([plan("mini", 20_000), plan("air", 70_000)], 3).assigned).toEqual({ mini: 3, air: 0 });
  });

  it("counts work already running and warm-up", () => {
    expect(simulate([plan("mini", 20_000, 50_000), plan("air", 30_000)], 2).assigned).toEqual({ mini: 0, air: 2 });
  });

  it("prefers the main machine on a tie and handles an empty batch", () => {
    expect(simulate([plan("air", 10_000), plan("mini", 10_000)], 1).assigned).toEqual({ air: 0, mini: 1 });
    expect(simulate([plan("mini", 10_000)], 0)).toEqual({ makespanMs: 0, assigned: { mini: 0 } });
  });
});

describe("planLane", () => {
  it("runs in parallel when a second machine saves a lot", () => {
    const result = planLane([plan("mini", 20_000), plan("air", 30_000)], 12, auto);
    expect(result.nodeIds).toEqual(["mini", "air"]);
    expect(result.plannedMs).toBeLessThan(result.singleMs * 0.7);
    expect(result.reason).toMatch(/song song 2 máy.*thay vì 4 phút/i);
  });

  it("stays on one machine when the second adds too little", () => {
    const result = planLane([plan("mini", 20_000), plan("air", 120_000)], 4, auto);
    expect(result.nodeIds).toEqual(["mini"]);
    expect(result.reason).toMatch(/Chạy một máy \(mini\).*không đáng/);
  });

  it("does not wake a laptop for a couple of scenes", () => {
    expect(planLane([plan("mini", 20_000), plan("air", 25_000)], 2, auto).nodeIds).toEqual(["mini"]);
  });

  it("uses the second machine alone when the main one is much busier", () => {
    const result = planLane([plan("mini", 20_000, 300_000), plan("air", 25_000)], 3, auto);
    expect(result.nodeIds).toEqual(["air"]);
  });

  it("keeps the main machine on a near tie", () => {
    expect(planLane([plan("air", 19_500), plan("mini", 20_000)], 1, auto).nodeIds).toEqual(["mini"]);
  });

  it("honours the single and parallel overrides", () => {
    const nodes = [plan("mini", 20_000), plan("air", 21_000)];
    expect(planLane(nodes, 2, { ...auto, mode: "single" }).nodeIds).toEqual(["mini"]);
    expect(planLane(nodes, 2, { ...auto, mode: "parallel" }).nodeIds).toEqual(["mini", "air"]);
    expect(planLane([plan("air", 21_000)], 2, { ...auto, mode: "single" }).nodeIds).toEqual(["air"]);
  });

  it("says so when no machine is available", () => {
    expect(planLane([], 3, auto)).toMatchObject({ nodeIds: [], reason: "Không có máy nào khả dụng" });
  });
});
