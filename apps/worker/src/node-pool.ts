/**
 * The machines that can do AI work for this worker: the main one (where the worker runs) and, optionally, others on the
 * same Tailscale network. The pool watches them, decides which may take a kind of work, and spreads scenes over them.
 *
 * With only the main machine configured it is a thin pass-through: no probing, no scheduling, the same calls in the
 * same order as before the pool existed.
 */
import type { BalanceDecision, BalancerSummary, NodeLaneSummary, NodeSummary } from "@studio/shared";
import { classifyError, NodeDownError } from "./node-errors";
import {
  assessNode, busyRemainingMs, estimateMs, LANES, planLane, simulate,
  type Assessment, type AssessContext, type BalanceMode, type Lane, type LaneRequest, type NodeSnapshot, type NodeStatus, type Plan, type PlanNode,
} from "./node-plan";

export type NodeSpec = {
  id: string;
  /** The main machine: where this worker runs. */
  local: boolean;
  mediaUrl: string;
  ollamaUrl: string;
  whiteboardUrl: string;
  token?: string;
};

export type NodeRef = { id: string; spec: NodeSpec };

export type ProbeResult = {
  rttMs: number | null;
  /** The media bridge's /node-status (or, from an older bridge, what /health says). Null when it does not answer. */
  status: NodeStatus | null;
  mediaOk: boolean;
  llm: { ok: boolean; installed: string[]; loaded: string[] };
  whiteboardOk: boolean;
  error?: string;
};

export type NodeConfig = {
  AI_NODES: string;
  AI_NODES_TOKEN?: string | undefined;
  AI_PRIMARY_NODE: string;
  LOCAL_MEDIA_BASE_URL: string;
  OLLAMA_BASE_URL: string;
  WHITEBOARD_SERVER_URL: string;
};

const trimSlash = (url: string) => url.replace(/\/+$/u, "");

/** `AI_NODES=air=100.101.102.103,studio=studio.tailnet.ts.net:8765` → one spec per extra machine, after the main one. */
export function parseNodeSpecs(config: NodeConfig): NodeSpec[] {
  const specs: NodeSpec[] = [{
    id: config.AI_PRIMARY_NODE,
    local: true,
    mediaUrl: trimSlash(config.LOCAL_MEDIA_BASE_URL),
    ollamaUrl: trimSlash(config.OLLAMA_BASE_URL),
    whiteboardUrl: trimSlash(config.WHITEBOARD_SERVER_URL),
  }];
  for (const entry of config.AI_NODES.split(/[\s,]+/u).filter(Boolean)) {
    const match = /^([a-z0-9][a-z0-9-]{0,23})=(.+)$/u.exec(entry);
    if (!match) throw new Error(`AI_NODES: "${entry}" sai định dạng. Dùng tên=địa-chỉ, ví dụ air=100.101.102.103`);
    const [, id, address] = match as unknown as [string, string, string];
    if (specs.some((spec) => spec.id === id))
      throw new Error(`AI_NODES: tên máy "${id}" bị trùng (máy chính cũng là một tên, mặc định "${config.AI_PRIMARY_NODE}")`);
    let url: URL;
    try {
      url = new URL(/^https?:\/\//u.test(address) ? address : `http://${address}`);
    } catch {
      throw new Error(`AI_NODES: địa chỉ "${address}" của máy ${id} không hợp lệ`);
    }
    const host = url.hostname;
    const mediaPort = url.port || "8765";
    specs.push({
      id,
      local: false,
      mediaUrl: `http://${host}:${mediaPort}`,
      ollamaUrl: `http://${host}:11434`,
      whiteboardUrl: `http://${host}:8766`,
      ...(config.AI_NODES_TOKEN ? { token: config.AI_NODES_TOKEN } : {}),
    });
  }
  return specs;
}

const describeFailure = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "không phản hồi" : "không kết nối được";

/** Asks one machine what it can do right now. Never throws: a machine that does not answer is simply not available. */
export function createProbe(fetchFn: typeof fetch = fetch, timeoutMs = 2_500): (spec: NodeSpec) => Promise<ProbeResult> {
  return async (spec) => {
    const auth: Record<string, string> = spec.token ? { authorization: `Bearer ${spec.token}` } : {};
    const get = (url: string, headers: Record<string, string> = {}) => fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const json = async <T>(url: string): Promise<T | null> => {
      try {
        const response = await get(url);
        return response.ok ? ((await response.json()) as T) : null;
      } catch {
        return null;
      }
    };

    const media = (async (): Promise<Pick<ProbeResult, "rttMs" | "status" | "mediaOk" | "error">> => {
      const started = performance.now();
      try {
        const response = await get(`${spec.mediaUrl}/node-status`, auth);
        const rttMs = Math.round(performance.now() - started);
        if (response.ok) return { rttMs, status: (await response.json()) as NodeStatus, mediaOk: true };
        if (response.status === 401 || response.status === 403)
          return { rttMs, status: null, mediaOk: false, error: "máy phụ từ chối token (kiểm tra AI_NODES_TOKEN và NODE_TOKEN)" };
        // A bridge from before /node-status: /health still says what it can do, but not its resources or settings.
        const health = await get(`${spec.mediaUrl}/health`);
        if (!health.ok) return { rttMs, status: null, mediaOk: false, error: `cầu nối media trả HTTP ${health.status}` };
        const body = (await health.json()) as Partial<Record<"image" | "tts" | "transcribe" | "video", boolean>>;
        return {
          rttMs, mediaOk: true,
          status: { accepting: true, capabilities: { image: Boolean(body.image), tts: Boolean(body.tts), transcribe: Boolean(body.transcribe), video: Boolean(body.video) } },
        };
      } catch (error) {
        return { rttMs: null, status: null, mediaOk: false, error: `cầu nối media ${describeFailure(error)}` };
      }
    })();
    const llm = (async () => {
      const [tags, loaded] = await Promise.all([
        json<{ models?: Array<{ name?: string }> }>(`${spec.ollamaUrl}/api/tags`),
        json<{ models?: Array<{ name?: string }> }>(`${spec.ollamaUrl}/api/ps`),
      ]);
      const names = (body: typeof tags) => (body?.models ?? []).map((model) => model.name).filter((name): name is string => Boolean(name));
      return { ok: tags !== null, installed: names(tags), loaded: names(loaded) };
    })();
    const whiteboard = (async () => {
      try {
        return (await get(`${spec.whiteboardUrl}/health`)).ok;
      } catch {
        return false;
      }
    })();
    const [mediaResult, llmResult, whiteboardOk] = await Promise.all([media, llm, whiteboard]);
    return { ...mediaResult, llm: llmResult, whiteboardOk };
  };
}

/** Wakes everything waiting for "something changed" (a task finished, a machine came or went). */
class Signal {
  private readonly waiters = new Set<() => void>();
  notify() {
    for (const wake of [...this.waiters]) wake();
  }
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }
}

type Logger = { info(fields: object, message: string): void; warn(fields: object, message: string): void };

export type PoolOptions = {
  mode: BalanceMode;
  /** Other machines must match the main one's settings and code before they make pictures or voices. */
  strict: boolean;
  minBatteryPercent: number;
  probe: (spec: NodeSpec) => Promise<ProbeResult>;
  probeIntervalMs?: number;
  /** Consecutive probes that find nothing before a machine counts as down (and its requests are aborted). */
  downAfterFailures?: number;
  /** After a request fails because the machine did not answer, leave it alone this long. */
  cooldownMs?: number;
  /** A second machine joins a batch only when it saves this share of the time ... */
  minGain?: number;
  /** ... and at least this many milliseconds. */
  minSavingsMs?: number;
  now?: () => number;
  log?: Logger;
};

export type Outcome<R> = { ok: true; value: R; nodeId: string } | { ok: false; error: Error; nodeId?: string };

export type DistributeOptions<T> = {
  request?: LaneRequest;
  /** Runs before each item starts; throwing stops the whole batch (used for the job's time limit). */
  beforeItem?: (item: T, index: number) => void;
  /** Tries per item across machines (a request that cannot reach its machine moves to another). */
  maxAttempts?: number;
  /** How long a batch waits for any machine to come back before failing what is left. */
  nodeWaitMs?: number;
};

type NodeEntry = { spec: NodeSpec; snapshot: NodeSnapshot; failures: number; strikes: number; down: AbortController };

const NO_NODE = "Không có máy xử lý nào khả dụng";
/** A second machine joins a batch only when it makes it at least 15% and 30 seconds faster: a laptop is not woken up, heated and drained for less. */
const DEFAULT_MIN_GAIN = 0.15;
const DEFAULT_MIN_SAVINGS_MS = 30_000;

export class NodePool {
  private readonly entries = new Map<string, NodeEntry>();
  private readonly changed = new Signal();
  private readonly decisions: BalanceDecision[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(specs: NodeSpec[], private readonly options: PoolOptions) {
    if (!specs.some((spec) => spec.local)) throw new Error("NodePool cần một máy chính");
    this.now = options.now ?? Date.now;
    for (const spec of specs) {
      this.entries.set(spec.id, {
        spec,
        failures: 0,
        strikes: 0,
        down: new AbortController(),
        snapshot: {
          id: spec.id, local: spec.local,
          // Optimistic until the first probe: the main machine is used exactly as it was before the pool existed.
          up: true, mediaUp: spec.local, llmUp: spec.local, llmInstalled: [], llmLoaded: [], whiteboardUp: spec.local,
          cooldownUntil: 0, rttMs: null, status: null, ewma: {}, lastSampleAt: {}, inflight: {},
        },
      });
      if (!spec.local) {
        const entry = this.entries.get(spec.id)!;
        entry.snapshot.up = false;
        entry.snapshot.error = "chưa kiểm tra";
      }
    }
  }

  /** More than one machine configured; otherwise the pool changes nothing. */
  get distributed(): boolean {
    return this.entries.size > 1;
  }

  get primary(): NodeRef {
    const entry = [...this.entries.values()].find((item) => item.spec.local)!;
    return { id: entry.spec.id, spec: entry.spec };
  }

  spec(id: string): NodeSpec {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Không có máy ${id}`);
    return entry.spec;
  }

  get mode(): BalanceMode {
    return this.options.mode;
  }

  /** Starts watching the machines; resolves once the first look at all of them is done (never rejects). */
  start(): Promise<void> {
    if (!this.distributed || this.timer) return Promise.resolve();
    const first = this.probeAll();
    this.timer = setInterval(() => void this.probeAll(), this.options.probeIntervalMs ?? 5_000);
    this.timer.unref?.();
    return first;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async probeAll(): Promise<void> {
    if (!this.distributed) return;
    await Promise.all([...this.entries.keys()].map((id) => this.probeNode(id)));
  }

  async probeNode(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    let result: ProbeResult;
    try {
      result = await this.options.probe(entry.spec);
    } catch (error) {
      result = { rttMs: null, status: null, mediaOk: false, llm: { ok: false, installed: [], loaded: [] }, whiteboardOk: false, error: describeFailure(error) };
    }
    this.applyProbe(id, result);
  }

  applyProbe(id: string, result: ProbeResult) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const snapshot = entry.snapshot;
    const reachable = result.mediaOk || result.llm.ok || result.whiteboardOk;
    entry.failures = reachable ? 0 : entry.failures + 1;
    const wasUp = snapshot.up;
    // A machine that was up gets a second chance before it counts as down; one never seen answering stays down.
    snapshot.up = reachable || (wasUp && entry.failures < (this.options.downAfterFailures ?? 2));
    snapshot.mediaUp = result.mediaOk;
    snapshot.status = result.mediaOk ? result.status : null;
    snapshot.llmUp = result.llm.ok;
    snapshot.llmInstalled = result.llm.installed;
    snapshot.llmLoaded = result.llm.loaded;
    snapshot.whiteboardUp = result.whiteboardOk;
    snapshot.rttMs = result.rttMs;
    if (result.mediaOk && reachable) delete snapshot.error;
    else snapshot.error = result.error ?? "không kết nối được";
    if (wasUp && !snapshot.up) {
      this.options.log?.warn({ node: id, error: snapshot.error }, "node_down");
      // Requests in flight to a machine that went silent would otherwise wait out their own long timeouts.
      entry.down.abort(new NodeDownError(id));
      entry.down = new AbortController();
    } else if (!wasUp && snapshot.up) {
      this.options.log?.info({ node: id, rttMs: result.rttMs }, "node_up");
    }
    this.changed.notify();
  }

  /** Aborts when the machine is declared down; adapters combine it with their own timeouts. */
  downSignal(id: string): AbortSignal {
    return this.entries.get(id)!.down.signal;
  }

  private context(request?: LaneRequest): AssessContext {
    return {
      now: this.now(),
      nodes: [...this.entries.values()].map((entry) => entry.snapshot),
      strict: this.options.strict,
      minBatteryPercent: this.options.minBatteryPercent,
      ...(request ? { request } : {}),
    };
  }

  assess(id: string, lane: Lane, request?: LaneRequest): Assessment {
    return assessNode(this.entries.get(id)!.snapshot, lane, this.context(request));
  }

  private candidates(lane: Lane, request?: LaneRequest, exclude?: ReadonlySet<string>) {
    const ctx = this.context(request);
    const found: Array<{ id: string; local: boolean; assessment: Assessment; estimate: number; availableAt: number }> = [];
    for (const entry of this.entries.values()) {
      if (exclude?.has(entry.spec.id)) continue;
      const assessment = assessNode(entry.snapshot, lane, ctx);
      if (!assessment.eligible) continue;
      found.push({
        id: entry.spec.id, local: entry.spec.local, assessment,
        estimate: estimateMs(entry.snapshot, lane, assessment, ctx),
        availableAt: busyRemainingMs(entry.snapshot, lane, ctx.now) + assessment.warmupMs,
      });
    }
    return found;
  }

  /** True when some machine could take this kind of work now (the main one is tried anyway when none is certain). */
  laneAvailable(lane: Lane, request?: LaneRequest): boolean {
    return this.candidates(lane, request).length > 0;
  }

  /** A machine that is eligible, or the main one as a last resort so a single machine behaves exactly as before. */
  private usable(id: string, lane: Lane, request?: LaneRequest): boolean {
    if (!this.distributed) return true;
    if (this.assess(id, lane, request).eligible) return true;
    return this.entries.get(id)!.spec.local && this.candidates(lane, request).length === 0;
  }

  /** Where one task should go: the machine that finishes it first, but the main one unless another is clearly better. */
  private pick(lane: Lane, request: LaneRequest | undefined, tried: ReadonlySet<string>): NodeRef | null {
    if (!this.distributed) return this.primary;
    const found = this.candidates(lane, request, tried).sort((a, b) => a.availableAt + a.estimate - (b.availableAt + b.estimate) || Number(b.local) - Number(a.local));
    const best = found[0];
    if (!best) return tried.size === 0 ? this.primary : null; // nothing certain: try the main machine like before
    let chosen = best;
    const main = found.find((item) => item.local);
    if (main && !best.local && this.options.mode !== "parallel") {
      const mainFinish = main.availableAt + main.estimate;
      const bestFinish = best.availableAt + best.estimate;
      const worthIt = mainFinish - bestFinish >= (this.options.minSavingsMs ?? DEFAULT_MIN_SAVINGS_MS) && bestFinish <= mainFinish * (1 - (this.options.minGain ?? DEFAULT_MIN_GAIN));
      if (!worthIt || this.options.mode === "single") chosen = main;
    }
    return { id: chosen.id, spec: this.entries.get(chosen.id)!.spec };
  }

  private begin(id: string, lane: Lane, expectedMs: number): () => void {
    const list = (this.entries.get(id)!.snapshot.inflight[lane] ??= []);
    const task = { startedAt: this.now(), expectedMs };
    list.push(task);
    return () => {
      const at = list.indexOf(task);
      if (at >= 0) list.splice(at, 1);
      this.changed.notify();
    };
  }

  private expected(id: string, lane: Lane, request?: LaneRequest): number {
    const ctx = this.context(request);
    const snapshot = this.entries.get(id)!.snapshot;
    return estimateMs(snapshot, lane, { eligible: true, reasons: [], speed: 1, warmupMs: 0 }, ctx);
  }

  recordSample(id: string, lane: Lane, ms: number) {
    const snapshot = this.entries.get(id)!.snapshot;
    const previous = snapshot.ewma[lane];
    // A request that stalled or had to reload a model must not brand the machine as slow.
    const cap = previous === undefined ? this.expected(id, lane) * 4 : previous * 3;
    const sample = Math.min(ms, cap);
    snapshot.ewma[lane] = previous === undefined ? sample : previous + 0.4 * (sample - previous);
    snapshot.lastSampleAt[lane] = this.now();
    this.entries.get(id)!.strikes = 0; // it answered: forget the earlier failures
  }

  /**
   * A request could not reach the machine: leave it alone for a moment and look at it again right away. Each failure
   * in a row doubles the wait (up to eight times), so a machine that keeps failing is not tried again every few seconds.
   */
  markSuspect(id: string, error: unknown) {
    if (!this.distributed) return;
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.strikes += 1;
    const wait = (this.options.cooldownMs ?? 15_000) * 2 ** Math.min(entry.strikes - 1, 3);
    entry.snapshot.cooldownUntil = this.now() + wait;
    this.options.log?.warn({ node: id, err: error instanceof Error ? error.message : String(error) }, "node_request_failed");
    this.changed.notify();
    void this.probeNode(id);
  }

  /** Runs one task on the best machine; a request that cannot reach its machine is retried on another. */
  async runOne<R>(lane: Lane, work: (node: NodeRef) => Promise<R>, request?: LaneRequest): Promise<R> {
    const tried = new Set<string>();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const node = this.pick(lane, request, tried);
      if (!node) break;
      const end = this.begin(node.id, lane, this.expected(node.id, lane, request));
      const started = this.now();
      try {
        const value = await work(node);
        this.recordSample(node.id, lane, this.now() - started);
        return value;
      } catch (error) {
        lastError = error;
        const kind = classifyError(error);
        if (kind === "unreachable") this.markSuspect(node.id, error);
        tried.add(node.id);
        if (kind === "fatal" || !this.distributed) throw error;
      } finally {
        end();
      }
    }
    throw lastError ?? new Error(NO_NODE);
  }

  private planFor(lane: Lane, tasks: number, request?: LaneRequest): Plan {
    const ctx = this.context(request);
    let nodes: PlanNode[] = this.candidates(lane, request).map((item) => ({
      id: item.id, local: item.local, availableAtMs: item.availableAt, durationMs: item.estimate,
    }));
    if (!this.distributed || !nodes.length) {
      const main = this.entries.get(this.primary.id)!.snapshot;
      nodes = [{ id: main.id, local: true, availableAtMs: 0, durationMs: estimateMs(main, lane, { eligible: true, reasons: [], speed: 1, warmupMs: 0 }, ctx) }];
    }
    return planLane(nodes, tasks, { mode: this.options.mode, minGain: this.options.minGain ?? DEFAULT_MIN_GAIN, minSavingsMs: this.options.minSavingsMs ?? DEFAULT_MIN_SAVINGS_MS });
  }

  /** Would this idle machine be given the next task by an earliest-finish schedule of what is still queued? */
  private shouldTake(id: string, lane: Lane, queued: number, selected: ReadonlySet<string>, request?: LaneRequest): boolean {
    if (!this.distributed) return true;
    const ctx = this.context(request);
    const nodes: PlanNode[] = [];
    for (const otherId of selected) {
      const snapshot = this.entries.get(otherId)!.snapshot;
      const assessment = assessNode(snapshot, lane, ctx);
      if (!assessment.eligible && otherId !== id) continue;
      nodes.push({
        id: otherId, local: snapshot.local,
        availableAtMs: (otherId === id ? 0 : busyRemainingMs(snapshot, lane, ctx.now)) + assessment.warmupMs,
        durationMs: estimateMs(snapshot, lane, assessment.eligible ? assessment : { ...assessment, speed: 1 }, ctx),
      });
    }
    if (!nodes.some((node) => node.id === id)) return false;
    return simulate(nodes, queued).assigned[id]! > 0;
  }

  private record(lane: Lane, tasks: number, plan: Plan) {
    const decision: BalanceDecision = { at: new Date(this.now()).toISOString(), lane, tasks, nodes: plan.nodeIds, reason: plan.reason };
    this.decisions.push(decision);
    if (this.decisions.length > 8) this.decisions.shift();
    this.options.log?.info({ lane, tasks, nodes: plan.nodeIds, singleMs: Math.round(plan.singleMs), plannedMs: Math.round(plan.plannedMs) }, plan.reason);
  }

  /**
   * Runs `run` for every item, spread over the machines the plan selects: each machine takes one item at a time, so a
   * faster machine simply takes more of them, and an item whose machine goes away is handed to another. One entry per
   * item comes back, in order; failures are returned (not thrown), as the callers treat a missing picture as retryable.
   */
  async distribute<T, R>(
    lane: Lane,
    items: T[],
    run: (item: T, node: NodeRef, index: number) => Promise<R>,
    options: DistributeOptions<T> = {},
  ): Promise<Array<Outcome<R>>> {
    const outcomes = new Array<Outcome<R>>(items.length);
    if (!items.length) return outcomes;
    const { request } = options;
    const maxAttempts = options.maxAttempts ?? 2;
    const nodeWaitMs = options.nodeWaitMs ?? 25_000;
    type Job = { index: number; attempts: number; avoid: Set<string>; lastError?: Error };
    const queue: Job[] = items.map((_, index) => ({ index, attempts: 0, avoid: new Set<string>() }));
    const selected = new Set<string>();
    const running = new Set<string>();
    const runners: Array<Promise<void>> = [];
    let active = 0;
    let stop: Error | null = null;

    const select = (log: boolean) => {
      const plan = this.planFor(lane, queue.length + active, request);
      for (const id of plan.nodeIds) selected.add(id); // only ever added to: a machine is not dropped mid-batch
      if (log && this.distributed) this.record(lane, items.length, plan);
    };

    const runner = async (id: string) => {
      const entry = this.entries.get(id)!;
      while (!stop) {
        const at = queue.findIndex((job) => !job.avoid.has(id));
        if (at < 0 || !selected.has(id) || !this.usable(id, lane, request)) return;
        const eligibleJobs = queue.filter((job) => !job.avoid.has(id)).length;
        if (!this.shouldTake(id, lane, eligibleJobs, selected, request)) {
          await this.changed.wait(1_000);
          continue;
        }
        const [job] = queue.splice(at, 1) as [Job];
        try {
          options.beforeItem?.(items[job.index]!, job.index);
        } catch (error) {
          stop = error instanceof Error ? error : new Error(String(error));
          outcomes[job.index] = { ok: false, error: stop, nodeId: id };
          this.changed.notify();
          return;
        }
        const end = this.begin(id, lane, this.expected(id, lane, request));
        active += 1;
        const started = this.now();
        let leave = false;
        try {
          const value = await run(items[job.index]!, { id, spec: entry.spec }, job.index);
          this.recordSample(id, lane, this.now() - started);
          outcomes[job.index] = { ok: true, value, nodeId: id };
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          const kind = classifyError(error);
          job.attempts += 1;
          job.avoid.add(id);
          job.lastError = failure;
          if (kind === "unreachable") {
            this.markSuspect(id, error);
            leave = true;
          }
          const elsewhere = this.distributed && this.candidates(lane, request, job.avoid).length > 0;
          if (kind !== "fatal" && job.attempts < maxAttempts && elsewhere) queue.unshift(job);
          else outcomes[job.index] = { ok: false, error: failure, nodeId: id };
        } finally {
          end();
          active -= 1;
          this.changed.notify();
        }
        if (leave) return;
      }
    };

    const spawn = () => {
      for (const id of selected) {
        if (running.has(id) || stop) continue;
        if (!queue.some((job) => !job.avoid.has(id)) || !this.usable(id, lane, request)) continue;
        running.add(id);
        runners.push(
          runner(id)
            .catch((error: unknown) => this.options.log?.warn({ node: id, err: error instanceof Error ? error.message : String(error) }, "distribute_runner_failed"))
            .finally(() => {
              running.delete(id);
              this.changed.notify();
            }),
        );
      }
    };

    select(true);
    let stuckSince = 0;
    while (queue.length > 0 || active > 0) {
      if (stop) {
        if (active === 0) break;
        await this.changed.wait(500);
        continue;
      }
      select(false);
      spawn();
      await this.changed.wait(500);
      if (queue.length > 0 && active === 0 && running.size === 0) {
        stuckSince ||= this.now();
        if (this.now() - stuckSince >= nodeWaitMs) {
          for (const job of queue.splice(0)) outcomes[job.index] = { ok: false, error: job.lastError ?? new Error(NO_NODE) };
        }
      } else {
        stuckSince = 0;
      }
    }
    await Promise.all(runners);
    for (const job of queue.splice(0)) outcomes[job.index] = { ok: false, error: stop ?? job.lastError ?? new Error(NO_NODE) };
    if (stop) throw stop;
    return outcomes;
  }

  summary(): BalancerSummary {
    // One machine is not probed, so there is nothing true to say about it here; the worker's own health covers it.
    if (!this.distributed) return { mode: this.options.mode, nodes: [], decisions: [] };
    const ctx = this.context();
    const nodes: NodeSummary[] = [...this.entries.values()].map((entry) => {
      const snapshot = entry.snapshot;
      const lanes: Record<string, NodeLaneSummary> = {};
      for (const lane of LANES) {
        const assessment = assessNode(snapshot, lane, ctx);
        lanes[lane] = { eligible: assessment.eligible, reasons: assessment.reasons, avgMs: snapshot.ewma[lane] !== undefined ? Math.round(snapshot.ewma[lane]!) : null };
      }
      const status = snapshot.status;
      const paused = Boolean(status && !status.accepting);
      // Pictures and voices are what the machine is for; a missing LTX or hand-drawing server is normal on a second Mac.
      const core = (["image", "tts"] as const).map((lane) => lanes[lane]!);
      const coreReasons = [...new Set(core.flatMap((lane) => lane.reasons))];
      const state: NodeSummary["state"] = !snapshot.up ? "offline"
        : paused ? "paused"
        : core.some((lane) => !lane.eligible) || coreReasons.length ? "degraded" : "healthy";
      const reasons = !snapshot.up || paused ? [...new Set(Object.values(lanes).flatMap((lane) => lane.reasons))] : coreReasons;
      return {
        id: snapshot.id,
        role: snapshot.local ? "primary" : "secondary",
        state,
        detail: reasons.length ? reasons.slice(0, 3).join("; ") : "Sẵn sàng nhận việc",
        rttMs: snapshot.rttMs,
        resources: status?.resources
          ? { memTotalGb: status.resources.memTotalGb, memPressure: status.resources.memPressure, power: status.resources.power, batteryPercent: status.resources.batteryPercent, thermal: status.resources.thermal, loadAvg1: status.resources.loadAvg1, cpuCores: status.resources.cpuCores }
          : null,
        lanes,
      };
    });
    return { mode: this.options.mode, nodes, decisions: [...this.decisions].reverse() };
  }
}
