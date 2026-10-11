import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeDownError, NodeHttpError, classifyError } from "./node-errors";
import { NodePool, createProbe, parseNodeSpecs, summarizeSync, type NodeRef, type PoolOptions, type ProbeResult } from "./node-pool";
import type { NodeStatus } from "./node-plan";

const status = (over: Partial<NodeStatus> = {}): NodeStatus => ({
  accepting: true,
  capabilities: { image: true, tts: true, transcribe: true, video: false },
  image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
  tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
  resources: { cpuCores: 8, memTotalGb: 16, memPressure: "normal", loadAvg1: 1, power: "ac", batteryPercent: null, thermal: "nominal" },
  fingerprint: "same",
  ...over,
});
const up = (over: Partial<NodeStatus> = {}, extra: Partial<ProbeResult> = {}): ProbeResult => ({
  rttMs: 20, mediaOk: true, status: status(over),
  llm: { ok: true, installed: ["qwen3.5:4b"], loaded: ["qwen3.5:4b"] }, whiteboardOk: true, ...extra,
});
const offline: ProbeResult = { rttMs: null, mediaOk: false, status: null, llm: { ok: false, installed: [], loaded: [] }, whiteboardOk: false, error: "không phản hồi" };

const BASE = {
  AI_NODES: "air=100.64.0.2", AI_NODES_TOKEN: "tok", AI_PRIMARY_NODE: "mini",
  LOCAL_MEDIA_BASE_URL: "http://host.docker.internal:8765", OLLAMA_BASE_URL: "http://host.docker.internal:11434",
  WHITEBOARD_SERVER_URL: "http://host.docker.internal:8766",
};
const TWO = parseNodeSpecs(BASE);
const ONE = parseNodeSpecs({ ...BASE, AI_NODES: "" });

/** mini 20 s and air 30 s per picture, as the machines report about themselves. */
function makePool(over: Partial<PoolOptions> = {}, perf: { mini?: number; air?: number } = { mini: 20_000, air: 30_000 }, specs = TWO) {
  const results: Record<string, ProbeResult> = {
    mini: up({ perf: { image: perf.mini ?? 20_000, tts: perf.mini ?? 20_000 } }),
    air: up({ perf: { image: perf.air ?? 30_000, tts: perf.air ?? 30_000 } }),
  };
  const pool = new NodePool(specs, {
    mode: "auto", strict: true, minBatteryPercent: 30, probe: async (spec) => results[spec.id] ?? offline,
    downAfterFailures: 2, cooldownMs: 15_000, ...over,
  });
  for (const spec of specs) pool.applyProbe(spec.id, results[spec.id] ?? offline);
  return { pool, results };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

/** Lets virtual time pass until the promise settles. */
async function settle<T>(promise: Promise<T>, limitMs = 3_600_000): Promise<T> {
  let done = false;
  promise.then(() => (done = true), () => (done = true));
  for (let waited = 0; !done && waited < limitMs; waited += 500) await vi.advanceTimersByTimeAsync(500);
  return promise;
}

type Run = { item: number; node: string; at: number };
/** A task that takes `durations[node]` virtual milliseconds and logs where and when it finished. */
function job(durations: Record<string, number>, log: Run[] = []) {
  return (item: number, node: NodeRef) => new Promise<number>((resolve) => {
    setTimeout(() => {
      log.push({ item, node: node.id, at: Date.now() });
      resolve(item * 10);
    }, durations[node.id] ?? 1_000);
  });
}
const elapsed = (from: number) => Date.now() - from;
const unreachable = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

describe("parseNodeSpecs", () => {
  it("puts the main machine first and gives the others the standard ports and the shared token", () => {
    expect(TWO).toHaveLength(2);
    expect(TWO[0]).toMatchObject({ id: "mini", local: true, mediaUrl: "http://host.docker.internal:8765" });
    expect(TWO[0]!.token).toBeUndefined();
    expect(TWO[1]).toEqual({
      id: "air", local: false, token: "tok",
      mediaUrl: "http://100.64.0.2:8765", ollamaUrl: "http://100.64.0.2:11434", whiteboardUrl: "http://100.64.0.2:8766",
    });
  });

  it("accepts several machines, URLs and another media port", () => {
    const specs = parseNodeSpecs({ ...BASE, AI_NODES: "air=100.64.0.2, studio=http://studio.tail1.ts.net:9000\nlab=lab.local" });
    expect(specs.map((spec) => spec.id)).toEqual(["mini", "air", "studio", "lab"]);
    expect(specs[2]!.mediaUrl).toBe("http://studio.tail1.ts.net:9000");
    expect(specs[2]!.ollamaUrl).toBe("http://studio.tail1.ts.net:11434");
  });

  it("explains a mistake instead of ignoring it", () => {
    expect(() => parseNodeSpecs({ ...BASE, AI_NODES: "100.64.0.2" })).toThrow(/tên=địa-chỉ/);
    expect(() => parseNodeSpecs({ ...BASE, AI_NODES: "mini=100.64.0.2" })).toThrow(/trùng/);
    expect(() => parseNodeSpecs({ ...BASE, AI_NODES: "air=100.64.0.2,air=100.64.0.3" })).toThrow(/trùng/);
    expect(() => parseNodeSpecs({ ...BASE, AI_NODES: "air=http://" })).toThrow(/không hợp lệ/);
  });
});

describe("one machine only", () => {
  it("behaves like a plain loop: one at a time, in order, errors returned as they are", async () => {
    const { pool } = makePool({}, {}, ONE);
    expect(pool.distributed).toBe(false);
    let concurrent = 0;
    let peak = 0;
    const order: number[] = [];
    const outcomes = await settle(pool.distribute("image", [1, 2, 3, 4], async (item) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      order.push(item);
      concurrent -= 1;
      if (item === 3) throw new Error("ảnh lỗi");
      return item;
    }));
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true, false, true]);
    expect(outcomes[2]).toMatchObject({ ok: false, error: { message: "ảnh lỗi" } });
  });

  it("calls the main machine straight away, even before anything was probed, and rethrows its error", async () => {
    const { pool } = makePool({}, {}, ONE);
    const seen: string[] = [];
    await expect(pool.runOne("tts", async (node) => (seen.push(node.id), "ok"))).resolves.toBe("ok");
    await expect(pool.runOne("tts", async () => { throw unreachable(); })).rejects.toThrow("fetch failed");
    expect(seen).toEqual(["mini"]);
    expect(pool.summary().nodes).toEqual([]); // nothing is probed, so nothing untrue is reported
  });

  it("does not probe anything", async () => {
    const probe = vi.fn(async () => offline);
    const { pool } = makePool({ probe }, {}, ONE);
    pool.start();
    await pool.probeAll();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("distribute over two machines", () => {
  it("spreads scenes over both machines and finishes much sooner than one machine alone", async () => {
    const { pool } = makePool();
    const log: Run[] = [];
    const started = Date.now();
    const outcomes = await settle(pool.distribute("image", Array.from({ length: 12 }, (_, i) => i), job({ mini: 20_000, air: 30_000 }, log)));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.map((outcome) => (outcome.ok ? outcome.value : -1))).toEqual(Array.from({ length: 12 }, (_, i) => i * 10)); // order kept
    const mini = log.filter((entry) => entry.node === "mini").length;
    const air = log.filter((entry) => entry.node === "air").length;
    expect(mini + air).toBe(12);
    expect(air).toBeGreaterThanOrEqual(4);
    expect(mini).toBeGreaterThan(air); // the faster machine takes more
    expect(elapsed(started)).toBeLessThan(12 * 20_000 * 0.7); // 240 s alone
    expect(pool.summary().decisions[0]).toMatchObject({ lane: "image", tasks: 12, nodes: ["mini", "air"] });
    expect(pool.summary().decisions[0]!.reason).toMatch(/song song 2 máy/);
  });

  it("never runs two pictures at once on the same machine", async () => {
    const { pool } = makePool();
    const active: Record<string, number> = { mini: 0, air: 0 };
    let worst = 0;
    await settle(pool.distribute("image", Array.from({ length: 10 }, (_, i) => i), async (_item, node) => {
      worst = Math.max(worst, ++active[node.id]!);
      await new Promise((resolve) => setTimeout(resolve, node.id === "mini" ? 20_000 : 30_000));
      active[node.id]! -= 1;
    }));
    expect(worst).toBe(1);
  });

  it("keeps to one machine for a couple of scenes: the laptop is not worth waking up", async () => {
    const { pool } = makePool();
    const log: Run[] = [];
    await settle(pool.distribute("image", [0, 1], job({ mini: 20_000, air: 25_000 }, log)));
    expect(new Set(log.map((entry) => entry.node))).toEqual(new Set(["mini"]));
    expect(pool.summary().decisions[0]!.reason).toMatch(/Chạy một máy \(mini\)/);
  });

  it("leaves the last scenes to the fast machine instead of waiting for a slow one", async () => {
    const { pool } = makePool({ minGain: 0, minSavingsMs: 0 }, { mini: 20_000, air: 200_000 });
    const log: Run[] = [];
    await settle(pool.distribute("image", [0, 1, 2], job({ mini: 20_000, air: 200_000 }, log)));
    expect(log.map((entry) => entry.node)).toEqual(["mini", "mini", "mini"]);
  });

  it("honours single and parallel mode", async () => {
    const single = makePool({ mode: "single" });
    const log1: Run[] = [];
    await settle(single.pool.distribute("image", Array.from({ length: 8 }, (_, i) => i), job({ mini: 20_000, air: 20_000 }, log1)));
    expect(new Set(log1.map((entry) => entry.node))).toEqual(new Set(["mini"]));

    const parallel = makePool({ mode: "parallel" });
    const log2: Run[] = [];
    await settle(parallel.pool.distribute("image", [0, 1], job({ mini: 20_000, air: 21_000 }, log2)));
    expect(new Set(log2.map((entry) => entry.node))).toEqual(new Set(["mini", "air"]));
  });

  it("uses only the second machine when the main one is out", async () => {
    const { pool, results } = makePool();
    pool.applyProbe("mini", { ...results.mini!, status: status({ accepting: false }) });
    const log: Run[] = [];
    await settle(pool.distribute("image", [0, 1, 2], job({ mini: 20_000, air: 30_000 }, log)));
    expect(new Set(log.map((entry) => entry.node))).toEqual(new Set(["air"]));
  });

  it("does not hand pictures to a machine whose settings differ from the main one", async () => {
    const { pool, results } = makePool();
    pool.applyProbe("air", { ...results.air!, status: status({ fingerprint: "other", perf: { image: 10_000 } }) });
    const log: Run[] = [];
    await settle(pool.distribute("image", Array.from({ length: 8 }, (_, i) => i), job({ mini: 20_000, air: 10_000 }, log)));
    expect(new Set(log.map((entry) => entry.node))).toEqual(new Set(["mini"]));
  });
});

describe("a machine that goes away", () => {
  it("moves a scene whose machine cannot be reached to the other one, and leaves that machine alone for a while", async () => {
    const { pool, results } = makePool();
    results.air = offline; // the machine really is gone: the look the pool takes right after the failure finds nothing
    const log: Run[] = [];
    let airTried = 0;
    const outcomes = await settle(pool.distribute("image", Array.from({ length: 8 }, (_, i) => i), async (item, node) => {
      if (node.id === "air") {
        airTried += 1;
        throw unreachable();
      }
      return job({ mini: 20_000 }, log)(item, node);
    }));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.every((outcome) => outcome.ok && outcome.nodeId === "mini")).toBe(true);
    expect(airTried).toBe(1); // one failed request, then it is left alone
  });

  it("aborts requests in flight when the machine is declared down, and reruns them elsewhere", async () => {
    const { pool, results } = makePool();
    results.air = offline; // so the pool's own look at the machine after the abort agrees
    const aborted: number[] = [];
    const done: Run[] = [];
    const task = (item: number, node: NodeRef) => new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { done.push({ item, node: node.id, at: Date.now() }); resolve(item); }, node.id === "mini" ? 20_000 : 30_000);
      const signal = pool.downSignal(node.id);
      signal.addEventListener("abort", () => { clearTimeout(timer); aborted.push(item); reject(signal.reason); }, { once: true });
    });
    const batch = pool.distribute("image", Array.from({ length: 8 }, (_, i) => i), task);
    await vi.advanceTimersByTimeAsync(5_000);
    pool.applyProbe("air", offline); // first miss: still counted as up
    expect(aborted).toEqual([]);
    pool.applyProbe("air", offline); // second miss: down, in-flight request aborted
    const outcomes = await settle(batch);
    expect(aborted).toHaveLength(1);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(done.filter((entry) => entry.node === "air")).toEqual([]);
    expect(done.map((entry) => entry.item).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("brings the machine back into the batch once it answers again", async () => {
    const { pool, results } = makePool();
    pool.applyProbe("air", offline);
    pool.applyProbe("air", offline);
    const log: Run[] = [];
    const batch = pool.distribute("image", Array.from({ length: 20 }, (_, i) => i), job({ mini: 20_000, air: 30_000 }, log));
    await vi.advanceTimersByTimeAsync(60_000);
    pool.applyProbe("air", results.air!);
    await settle(batch);
    expect(log.some((entry) => entry.node === "air")).toBe(true);
    expect(log.filter((entry) => entry.node === "air").every((entry) => entry.at > Date.parse("2026-10-10T10:01:00Z"))).toBe(true);
  });

  it("does not retry a request the machine refused, but tries a server error once elsewhere", async () => {
    const { pool } = makePool({ mode: "parallel" });
    const calls: Array<[number, string]> = [];
    const outcomes = await settle(pool.distribute("image", [0, 1, 2, 3], async (item, node) => {
      calls.push([item, node.id]);
      if (item === 0) throw new NodeHttpError("Media local trả lỗi 400: prompt", 400);
      if (item === 1 && calls.filter(([seen]) => seen === 1).length === 1) throw new NodeHttpError("Media local trả lỗi 500", 500);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return item;
    }));
    expect(outcomes[0]).toMatchObject({ ok: false, error: { message: "Media local trả lỗi 400: prompt" } });
    expect(calls.filter(([item]) => item === 0)).toHaveLength(1);
    const second = calls.filter(([item]) => item === 1);
    expect(second).toHaveLength(2);
    expect(second[0]![1]).not.toBe(second[1]![1]); // the second try went to the other machine
    expect(outcomes[1]).toMatchObject({ ok: true, value: 1 });
  });

  it("returns failures instead of hanging when no machine can do the work", async () => {
    const { pool } = makePool({}, {}, TWO);
    pool.applyProbe("air", offline);
    pool.applyProbe("air", offline);
    const outcomes = await settle(pool.distribute("image", [0, 1, 2], async () => { throw unreachable(); }, { nodeWaitMs: 5_000 }));
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);
  });
});

describe("batch control", () => {
  it("stops the whole batch when beforeItem throws (the job's time limit), after the running scene ends", async () => {
    const { pool } = makePool({}, {}, ONE);
    const started: number[] = [];
    const batch = pool.distribute("image", [0, 1, 2, 3], async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }, { beforeItem: (item) => { if (item === 2) throw new Error("hết thời gian"); } });
    await expect(settle(batch)).rejects.toThrow("hết thời gian");
    expect(started).toEqual([0, 1]);
  });

  it("returns an empty list for no items", async () => {
    const { pool } = makePool();
    await expect(pool.distribute("image", [], async () => 1)).resolves.toEqual([]);
  });
});

describe("runOne", () => {
  it("sends one task to the main machine unless another is clearly better", async () => {
    const { pool } = makePool();
    expect((await pool.runOne("image", async (node) => node.id))).toBe("mini");
    const slowMain = makePool({}, { mini: 100_000, air: 20_000 });
    expect((await slowMain.pool.runOne("image", async (node) => node.id))).toBe("air");
  });

  it("spreads concurrent tasks over machines by how busy each one is", async () => {
    const { pool } = makePool({ minGain: 0, minSavingsMs: 0 });
    const used: string[] = [];
    const calls = [0, 1, 2].map(() => pool.runOne("tts", async (node) => {
      used.push(node.id);
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }));
    await settle(Promise.all(calls));
    expect(used.slice(0, 2).sort()).toEqual(["air", "mini"]);
  });

  it("retries on another machine when the first cannot be reached, and says so when none works", async () => {
    const { pool } = makePool({ mode: "parallel" });
    const tried: string[] = [];
    await expect(pool.runOne("image", async (node) => {
      tried.push(node.id);
      if (node.id !== "air") throw unreachable();
      return "ok";
    })).resolves.toBe("ok");
    expect(tried).toEqual(["mini", "air"]);

    const again = makePool();
    await expect(again.pool.runOne("image", async () => { throw unreachable(); })).rejects.toThrow("fetch failed");
  });

  it("does not retry an error that would fail anywhere", async () => {
    const { pool } = makePool();
    const tried: string[] = [];
    await expect(pool.runOne("image", async (node) => { tried.push(node.id); throw new NodeHttpError("Media local trả lỗi 400", 400); })).rejects.toThrow("400");
    expect(tried).toHaveLength(1);
  });

  it("tries the main machine as a last resort when nothing is certain, so single-machine errors stay the same", async () => {
    const { pool } = makePool();
    pool.applyProbe("mini", offline);
    pool.applyProbe("mini", offline);
    pool.applyProbe("air", offline);
    pool.applyProbe("air", offline);
    const tried: string[] = [];
    await expect(pool.runOne("image", async (node) => { tried.push(node.id); throw new Error("Media local trả lỗi"); })).rejects.toThrow("Media local trả lỗi");
    expect(tried).toEqual(["mini"]);
  });

  it("waits longer each time a machine fails again, and starts over once it answers", () => {
    const { pool, results } = makePool({ cooldownMs: 10_000 });
    const cooling = () => pool.assess("air", "image").reasons[0] === "vừa gặp lỗi, đang chờ thử lại";
    pool.markSuspect("air", unreachable());
    vi.setSystemTime(Date.now() + 11_000);
    expect(cooling()).toBe(false); // 10 s were enough the first time
    pool.markSuspect("air", unreachable());
    vi.setSystemTime(Date.now() + 11_000);
    expect(cooling()).toBe(true); // the second failure doubled it to 20 s
    vi.setSystemTime(Date.now() + 10_000);
    expect(cooling()).toBe(false);
    pool.recordSample("air", "image", 30_000);
    pool.markSuspect("air", unreachable());
    vi.setSystemTime(Date.now() + 11_000);
    expect(cooling()).toBe(false); // back to the short wait
    expect(results.air).toBeDefined();
  });

  it("learns how long a machine takes and shrinks the effect of one stalled request", async () => {
    const { pool } = makePool();
    for (const ms of [10_000, 10_000, 600_000]) pool.recordSample("air", "image", ms);
    const avg = pool.summary().nodes.find((node) => node.id === "air")!.lanes.image!.avgMs!;
    expect(avg).toBeGreaterThan(10_000);
    expect(avg).toBeLessThan(25_000); // not dragged to a tenth of 600 s
  });
});

describe("what each machine is doing, for the Settings page", () => {
  it("counts the tasks finished and running per kind of work on each machine", async () => {
    const { pool } = makePool();
    const lane = (id: string, kind: string) => pool.summary().nodes.find((node) => node.id === id)!.lanes[kind]!;
    expect([lane("air", "image").done, lane("air", "image").running]).toEqual([0, 0]);
    pool.recordSample("air", "image", 9_000);
    pool.recordSample("air", "image", 9_000);
    pool.recordSample("air", "tts", 5_000);
    expect(lane("air", "image").done).toBe(2);
    expect(lane("air", "tts").done).toBe(1);
    expect(lane("mini", "image").done).toBe(0); // counted per machine
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = pool.runOne("image", async () => { await held; return "ok"; });
    await vi.advanceTimersByTimeAsync(5);
    const busy = pool.summary().nodes.map((node) => node.lanes.image!.running).reduce((a, b) => a + b, 0);
    expect(busy).toBe(1); // one picture is being made on one of the machines right now
    release();
    await settle(running);
    expect(pool.summary().nodes.map((node) => node.lanes.image!.running).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("what the dashboard shows", () => {
  const rich = (over: Partial<NodeStatus> = {}) => up({
    resources: {
      cpuCores: 10, memTotalGb: 16, memPressure: "warn", loadAvg1: 5, power: "ac", batteryPercent: null, thermal: "nominal",
      memUsedGb: 12, swapUsedGb: 8, swapTotalGb: 9, diskFreeGb: 44, diskTotalGb: 228,
      processes: [{ id: "image", label: "Vẽ ảnh SDXL-Turbo", memGb: 3.96, count: 1 }],
    },
    settings: { FACE_DETAIL_READY: true },
    ...over,
  }, { llm: {
    ok: true, installed: ["qwen3.5:4b", "llama3:8b"], loaded: ["qwen3.5:4b"],
    loadedInfo: [{ name: "qwen3.5:4b", sizeBytes: 3_400_000_000, expiresAt: "2026-10-10T10:05:00Z" }],
  } });
  const air = (pool: NodePool) => pool.summary().nodes.find((node) => node.id === "air")!;

  it("lists the models and engines each machine has ready, with the memory Ollama holds", () => {
    const { pool } = makePool();
    pool.applyProbe("air", rich());
    expect(air(pool).models).toEqual({
      llm: { up: true, installed: ["qwen3.5:4b", "llama3:8b"], loaded: [{ name: "qwen3.5:4b", sizeGb: 3.4, expiresAt: "2026-10-10T10:05:00Z" }] },
      image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
      tts: { engines: ["vieneu", "piper"], defaultEngine: "vieneu" },
      transcribe: true, whiteboard: true, faceDetail: true,
    });
  });

  it("passes on memory, swap, disk and the programs' memory, and leaves them out for an older bridge", () => {
    const { pool } = makePool();
    expect(air(pool).resources).not.toHaveProperty("memUsedGb"); // makePool's bridge reports the basics only
    pool.applyProbe("air", rich());
    expect(air(pool).resources).toMatchObject({ memUsedGb: 12, swapUsedGb: 8, diskFreeGb: 44, processes: [{ id: "image", memGb: 3.96 }] });
  });

  it("knows whether a machine makes the same pictures and voices as the main one", () => {
    const { pool } = makePool();
    const nodes = () => Object.fromEntries(pool.summary().nodes.map((node) => [node.id, node.matchesPrimary]));
    expect(nodes()).toEqual({ mini: true, air: true });
    pool.applyProbe("air", up({ fingerprint: "other" }));
    expect(nodes().air).toBe(false);
    pool.applyProbe("air", up({ fingerprint: undefined as unknown as string }));
    expect(nodes().air).toBeNull(); // an old bridge cannot vouch for itself
  });

  it("keeps a chart point at most every ten seconds, for the last half hour, oldest first", () => {
    const { pool } = makePool();
    const before = air(pool).history!.length;
    pool.applyProbe("air", rich());
    expect(air(pool).history!.length).toBe(before); // probes come every 5 s; a point per 10 s is enough
    vi.setSystemTime(Date.now() + 11_000);
    pool.applyProbe("air", rich());
    const points = air(pool).history!;
    expect(points.length).toBe(before + 1);
    expect(points[points.length - 1]).toMatchObject({ load: 50, mem: 75, swapGb: 8, running: 0, rttMs: 20 });
    for (let i = 0; i < 250; i += 1) {
      vi.setSystemTime(Date.now() + 11_000);
      pool.applyProbe("air", rich());
    }
    const capped = air(pool).history!;
    expect(capped).toHaveLength(180);
    expect(capped[0]!.at).toBeLessThan(capped[capped.length - 1]!.at);
  });

  it("logs finished and failed tasks, newest first, and says since when the counters count", async () => {
    const { pool } = makePool();
    pool.recordSample("air", "image", 9_000);
    pool.recordSample("mini", "tts", 2_000);
    const failing = pool.runOne("image", async () => { throw new Error("Giọng đọc local không bảo toàn kịch bản"); }).catch(() => undefined);
    await settle(failing);
    const summary = pool.summary();
    expect(summary.since).toBe("2026-10-10T10:00:00.000Z");
    expect(summary.recent!.slice(0, 3).map((event) => [event.node, event.lane, event.ok])).toEqual([["mini", "image", false], ["mini", "tts", true], ["air", "image", true]]);
    expect(summary.recent![2]).toMatchObject({ ms: 9_000 });
    for (let i = 0; i < 60; i += 1) pool.recordSample("air", "image", 1_000);
    expect(pool.summary().recent).toHaveLength(40);
  });
});

describe("following how closely the second machine tracks the main one", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    state: "in-sync", checkedAt: 1_791_680_000, appliedAt: 1_791_679_000, ageSeconds: 20, sourceVersion: "abc123def456", localVersion: "abc123def456",
    behind: { code: 0, toolkit: 0, models: 0, ollama: 0 }, differences: [], error: null, restartPending: [], progress: null, ...over,
  });
  const air = (pool: NodePool) => pool.summary().nodes.find((node) => node.id === "air")!;

  it("turns the agent's report into what the dashboard shows", () => {
    expect(summarizeSync(report({ state: "behind", behind: { code: 2, models: 1 }, differences: ["Mã media_server.py"] }))).toMatchObject({
      state: "behind", checkedAt: "2026-10-11T00:53:20.000Z", behind: { code: 2, toolkit: 0, models: 1, ollama: 0 }, differences: ["Mã media_server.py"],
    });
    expect(summarizeSync(report({ state: "syncing", progress: { doneBytes: 3_200_000_000, totalBytes: 5_100_000_000, label: "Model image/…/unet" } }))?.progress)
      .toEqual({ doneBytes: 3_200_000_000, totalBytes: 5_100_000_000, label: "Model image/…/unet" });
  });

  it("passes on which of the machine's programs the agent had to start again, and which are still down", () => {
    const summary = summarizeSync(report({ recovery: { count: 2, lastAt: 1_791_680_000, down: ["Ollama"] } }))!;
    expect(summary.recovery).toEqual({ count: 2, lastAt: "2026-10-11T00:53:20.000Z", down: ["Ollama"] });
    expect(summarizeSync(report())).not.toHaveProperty("recovery"); // an agent from before this existed
  });

  it("does not trust an agent that has gone quiet, and says so", () => {
    const silent = summarizeSync(report({ ageSeconds: 1_500 }))!;
    expect(silent.state).toBe("error");
    expect(silent.error).toMatch(/không báo cáo suốt 25 phút/);
    expect(summarizeSync(report({ state: "paused", ageSeconds: 99_999 }))?.state).toBe("paused"); // paused on purpose: it writes nothing new
  });

  it("is null without an agent, and treats a state it does not know as unknown", () => {
    expect(summarizeSync(null)).toBeNull();
    expect(summarizeSync(undefined)).toBeNull();
    expect(summarizeSync(report({ state: "something-new" }))?.state).toBe("unknown");
  });

  it("reaches the second machine's card, never the main machine's", () => {
    const { pool } = makePool();
    pool.applyProbe("air", up({ sync: report({ state: "behind", behind: { code: 1 } }) as NonNullable<NodeStatus["sync"]> }));
    expect(air(pool).sync).toMatchObject({ state: "behind", behind: { code: 1 } });
    expect(pool.summary().nodes.find((node) => node.id === "mini")).not.toHaveProperty("sync");
    pool.applyProbe("air", up({}));
    expect(air(pool).sync).toBeNull(); // an older bridge or no agent
  });

  it("asks the second machine's bridge to sync now, with the access code", async () => {
    const { pool } = makePool();
    const calls: Array<[string, string | undefined, string | undefined]> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init?.method, (init?.headers as Record<string, string>).authorization]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await pool.requestSync("air", fetchFn)).toBe(true);
    expect(calls).toEqual([["http://100.64.0.2:8765/sync-now", "POST", "Bearer tok"]]);
    expect(await pool.requestSync("mini", fetchFn)).toBe(false); // the main machine is the source: nothing to ask
    expect(await pool.requestSync("ghost", fetchFn)).toBe(false);
    expect(await pool.requestSync("air", vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(false);
    expect(await pool.requestSync("air", vi.fn(async () => new Response("no", { status: 503 })) as unknown as typeof fetch)).toBe(false);
  });
});

describe("machines the owner switches off in Cài đặt", () => {
  const node = (pool: NodePool, id: string) => pool.summary().nodes.find((item) => item.id === id)!;

  it("keeps a switched-off machine out of all work, but still shows it", async () => {
    const { pool } = makePool();
    pool.applySettings({ mode: null, disabled: ["air"] });
    expect(node(pool, "air")).toMatchObject({ state: "disabled", enabled: false, detail: expect.stringMatching(/Đã tắt trong Cài đặt/) });
    expect(node(pool, "air").lanes.image).toMatchObject({ eligible: false, reasons: ["đã tắt trong Cài đặt"] });
    expect(node(pool, "air").resources).not.toBeNull(); // still watched
    expect(node(pool, "mini")).toMatchObject({ state: "healthy", enabled: true });
    const used: string[] = [];
    for (let i = 0; i < 4; i += 1) await settle(pool.runOne("image", async (nodeRef) => { used.push(nodeRef.id); return i; }));
    expect(used).toEqual(["mini", "mini", "mini", "mini"]);
    const log: Run[] = [];
    await settle(pool.distribute("image", [1, 2, 3, 4, 5, 6], job({ mini: 1_000, air: 1_000 }, log), { request: {} }));
    expect(new Set(log.map((run) => run.node))).toEqual(new Set(["mini"]));
  });

  it("can switch the main machine off: the other one takes everything, and the main one is never used as a fallback", async () => {
    const { pool, results } = makePool();
    pool.applySettings({ mode: null, disabled: ["mini"] });
    expect(node(pool, "mini")).toMatchObject({ state: "disabled", enabled: false });
    const used: string[] = [];
    await settle(pool.runOne("tts", async (nodeRef) => { used.push(nodeRef.id); return 1; }));
    expect(used).toEqual(["air"]);
    // with the Air gone there is nobody: the work must fail rather than quietly run on the machine that was switched off
    pool.applyProbe("air", offline);
    pool.applyProbe("air", offline);
    await expect(settle(pool.runOne("tts", async () => 1))).rejects.toThrow(/Không có máy xử lý nào khả dụng/);
    pool.applyProbe("air", results.air!);
    await expect(settle(pool.runOne("tts", async () => 1))).resolves.toBe(1);
  });

  it("ignores a request to switch every machine off, and unknown machines", () => {
    const { pool } = makePool();
    pool.applySettings({ mode: null, disabled: ["mini", "air"] });
    expect(pool.summary().nodes.map((item) => item.state)).not.toContain("disabled");
    pool.applySettings({ mode: null, disabled: ["ghost"] });
    expect(pool.summary().nodes.every((item) => item.enabled)).toBe(true);
  });

  it("switches back on, and a machine that is working finishes what it started", async () => {
    const { pool } = makePool();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = pool.runOne("image", async () => { await held; return "done"; });
    await vi.advanceTimersByTimeAsync(5);
    const busyNode = pool.summary().nodes.find((item) => item.lanes.image!.running > 0)!;
    pool.applySettings({ mode: null, disabled: [busyNode.id] });
    release();
    await expect(settle(running)).resolves.toBe("done");
    pool.applySettings({ mode: null, disabled: [] });
    expect(node(pool, busyNode.id).state).toBe("healthy");
  });

  it("lets the owner choose how work is split, falling back to the environment's mode when nothing is chosen", () => {
    const { pool } = makePool();
    expect(pool.summary().mode).toBe("auto");
    pool.applySettings({ mode: "parallel", disabled: [] });
    expect(pool.summary().mode).toBe("parallel");
    expect(pool.mode).toBe("parallel");
    pool.applySettings({ mode: null, disabled: [] });
    expect(pool.summary().mode).toBe("auto");
  });

  it("logs a change once, not on every look at the settings", () => {
    const messages: string[] = [];
    const { pool } = makePool({ log: { info: (_fields, message) => messages.push(message), warn: () => undefined } });
    pool.applySettings({ mode: null, disabled: ["air"] });
    pool.applySettings({ mode: null, disabled: ["air"] });
    pool.applySettings({ mode: null, disabled: [] });
    expect(messages.filter((message) => message === "balancer_settings_changed")).toHaveLength(2);
  });
});

describe("watching the machines", () => {
  it("counts a machine as down only after repeated misses, and up again at the first answer", () => {
    const { pool, results } = makePool();
    const state = () => pool.summary().nodes.find((node) => node.id === "air")!.state;
    expect(state()).toBe("healthy");
    pool.applyProbe("air", offline);
    expect(state()).toBe("degraded"); // one missed look: no new work goes there, but it is not written off yet
    pool.applyProbe("air", offline);
    expect(state()).toBe("offline");
    pool.applyProbe("air", results.air!);
    expect(state()).toBe("healthy");
  });

  it("does not call a machine up because it failed to answer once at startup", () => {
    const logged: string[] = [];
    const specs = parseNodeSpecs(BASE);
    const pool = new NodePool(specs, {
      mode: "auto", strict: true, minBatteryPercent: 30, probe: async () => offline,
      log: { info: (_fields, message) => logged.push(message), warn: (_fields, message) => logged.push(message) },
    });
    pool.applyProbe("mini", up());
    pool.applyProbe("air", offline);
    const air = pool.summary().nodes.find((node) => node.id === "air")!;
    expect(air.state).toBe("offline");
    expect(logged).not.toContain("node_up");
    expect(logged).not.toContain("node_down"); // it was never up, so nothing went down
  });

  it("reports why a machine is held back", () => {
    const { pool, results } = makePool();
    pool.applyProbe("air", { ...results.air!, status: status({ resources: { cpuCores: 8, memTotalGb: 8, memPressure: "normal", loadAvg1: 1, power: "battery", batteryPercent: 18, thermal: "nominal" } }) });
    const air = pool.summary().nodes.find((node) => node.id === "air")!;
    expect(air.state).toBe("degraded");
    expect(air.detail).toMatch(/pin còn 18%/);
    expect(air.lanes.image).toMatchObject({ eligible: false });
    expect(air.resources).toMatchObject({ power: "battery", batteryPercent: 18, memTotalGb: 8 });
    pool.applyProbe("air", { ...results.air!, status: status({ accepting: false }) });
    expect(pool.summary().nodes.find((node) => node.id === "air")!.state).toBe("paused");
  });

  it("probes every machine on a timer", async () => {
    const probe = vi.fn(async () => up());
    const { pool } = makePool({ probe, probeIntervalMs: 5_000 });
    pool.start();
    await vi.advanceTimersByTimeAsync(11_000);
    pool.stop();
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(6); // 2 machines × (start + two ticks)
  });
});

describe("createProbe", () => {
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  it("reads /node-status with the token and Ollama's model lists", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push([target, (init?.headers as Record<string, string> | undefined)?.authorization]);
      if (target.endsWith("/node-status")) return reply(200, status());
      if (target.endsWith("/api/tags")) return reply(200, { models: [{ name: "qwen3.5:4b" }, { name: "llama3:8b" }] });
      if (target.endsWith("/api/ps")) return reply(200, { models: [{ name: "qwen3.5:4b", size: 3_400_000_000, expires_at: "2026-10-10T10:05:00Z" }] });
      return reply(200, { ok: true });
    }) as unknown as typeof fetch;
    const result = await createProbe(fetchFn)(TWO[1]!);
    expect(result).toMatchObject({ mediaOk: true, whiteboardOk: true, llm: { ok: true, installed: ["qwen3.5:4b", "llama3:8b"], loaded: ["qwen3.5:4b"] } });
    expect(result.llm.loadedInfo).toEqual([{ name: "qwen3.5:4b", sizeBytes: 3_400_000_000, expiresAt: "2026-10-10T10:05:00Z" }]);
    expect(result.status?.fingerprint).toBe("same");
    expect(calls.find(([url]) => url.endsWith("/node-status"))![1]).toBe("Bearer tok");
  });

  it("says what is wrong with a wrong token, and falls back to /health for an older bridge", async () => {
    const wrongToken = vi.fn(async () => reply(401, { error: "x" })) as unknown as typeof fetch;
    expect(await createProbe(wrongToken)(TWO[1]!)).toMatchObject({ mediaOk: false, error: expect.stringContaining("token") });

    const legacy = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/node-status")) return reply(404);
      if (target.endsWith("/health") && target.includes(":8765")) return reply(200, { image: true, tts: true, transcribe: false });
      return reply(200, {});
    }) as unknown as typeof fetch;
    const result = await createProbe(legacy)(TWO[0]!);
    expect(result.mediaOk).toBe(true);
    expect(result.status).toMatchObject({ accepting: true, capabilities: { image: true, tts: true, transcribe: false, video: false } });
    expect(result.status?.fingerprint).toBeUndefined();
  });

  it("reports an unreachable machine as such without throwing", async () => {
    const broken = vi.fn(async () => { throw unreachable(); }) as unknown as typeof fetch;
    const result = await createProbe(broken)(TWO[1]!);
    expect(result).toMatchObject({ mediaOk: false, whiteboardOk: false, llm: { ok: false } });
    expect(result.error).toMatch(/không kết nối được/);
  });
});

describe("classifyError", () => {
  it("tells a machine problem from a request problem", () => {
    expect(classifyError(new NodeDownError("air"))).toBe("unreachable");
    expect(classifyError(unreachable())).toBe("unreachable");
    expect(classifyError(new DOMException("timed out", "TimeoutError"))).toBe("unreachable");
    expect(classifyError(new NodeHttpError("x", 503))).toBe("unreachable");
    expect(classifyError(new NodeHttpError("x", 500))).toBe("retryable");
    expect(classifyError(new NodeHttpError("x", 400))).toBe("fatal");
    expect(classifyError(new Error("Giọng đọc local không bảo toàn kịch bản"))).toBe("fatal");
    expect(classifyError("text")).toBe("fatal");
  });
});
