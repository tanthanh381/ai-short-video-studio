/**
 * Pure decisions of the load balancer: which machines may take a kind of work, how long a task would take on each, and
 * whether using more than one machine is worth it. No I/O here, so every rule can be tested with plain objects.
 */

export type Lane = "image" | "tts" | "video" | "transcribe" | "whiteboard" | "llm";
export const LANES: readonly Lane[] = ["image", "tts", "video", "transcribe", "whiteboard", "llm"];
const MEDIA_LANES: readonly Lane[] = ["image", "tts", "video", "transcribe"];
export const isMediaLane = (lane: Lane): lane is "image" | "tts" | "video" | "transcribe" => MEDIA_LANES.includes(lane);

export const LANE_LABEL: Record<Lane, string> = {
  image: "vẽ ảnh",
  tts: "giọng đọc",
  video: "chuyển động",
  transcribe: "nhận dạng giọng nói",
  whiteboard: "vẽ tay",
  llm: "Ollama",
};

/** How long one task takes when nothing has been measured yet (a 16 GB Apple-silicon Mac). */
export const PRIOR_MS: Record<Lane, number> = {
  image: 25_000, tts: 8_000, video: 240_000, transcribe: 6_000, whiteboard: 45_000, llm: 30_000,
};
/** Tasks a node works on at once in a lane. The bridge itself serialises images, voices and motion. */
export const LANE_CAPACITY: Record<Lane, number> = { image: 1, tts: 1, video: 1, transcribe: 1, whiteboard: 2, llm: 1 };
/** Loading the Ollama model into memory when it is not resident yet. */
const LLM_WARMUP_MS = 15_000;
/** A measurement older than this no longer proves a node is slow: it gets another chance. */
const STALE_MS = 20 * 60_000;

export type NodeResources = {
  cpuCores: number | null;
  memTotalGb: number | null;
  memPressure: "normal" | "warn" | "critical" | "unknown";
  loadAvg1: number | null;
  power: "ac" | "battery" | "unknown";
  batteryPercent: number | null;
  thermal: "nominal" | "throttled" | "unknown";
};

/** Body of `GET /node-status` on the media bridge (local-tools/media_server.py). */
export type NodeStatus = {
  node?: string;
  accepting: boolean;
  capabilities: { image: boolean; tts: boolean; transcribe: boolean; video: boolean };
  image?: { state: "ready" | "loading" | "down"; models: string[]; defaultModel: string | null };
  tts?: { engines: string[]; defaultEngine: string | null };
  resources?: NodeResources;
  perf?: Partial<Record<"image" | "tts" | "transcribe" | "video", number>>;
  fingerprint?: string;
};

export type InflightTask = { startedAt: number; expectedMs: number };

/** What the balancer currently knows about one machine. */
export type NodeSnapshot = {
  id: string;
  /** The main machine: where the worker runs. Other machines must match it to take media work. */
  local: boolean;
  /** Reachable at all (debounced over several probes). */
  up: boolean;
  error?: string;
  mediaUp: boolean;
  llmUp: boolean;
  llmInstalled: string[];
  llmLoaded: string[];
  whiteboardUp: boolean;
  cooldownUntil: number;
  rttMs: number | null;
  status: NodeStatus | null;
  ewma: Partial<Record<Lane, number>>;
  lastSampleAt: Partial<Record<Lane, number>>;
  inflight: Partial<Record<Lane, InflightTask[]>>;
};

/** What a request needs from a node beyond "up": the same voice engine, the same image model, an installed LLM. */
export type LaneRequest = { ttsEngine?: string | null; imageModel?: string | null; llmModel?: string | null };

export type AssessContext = {
  now: number;
  nodes: NodeSnapshot[];
  /** Other machines must match the main one (settings and code) to make interchangeable pictures and voices. */
  strict: boolean;
  minBatteryPercent: number;
  request?: LaneRequest;
};

export type Assessment = {
  eligible: boolean;
  /** Why it is out, or what slows it down. Shown in Settings and written to the log. */
  reasons: string[];
  /** Multiplier on the expected duration (1 = nothing slows the machine down). */
  speed: number;
  warmupMs: number;
};

const hasModel = (installed: string[], wanted: string) =>
  installed.includes(wanted) || installed.includes(`${wanted}:latest`) || (!wanted.includes(":") && installed.some((name) => name.startsWith(`${wanted}:`)));

export function assessNode(node: NodeSnapshot, lane: Lane, ctx: AssessContext): Assessment {
  const reasons: string[] = [];
  const out = (eligible: boolean, speed = 1, warmupMs = 0): Assessment => ({ eligible, reasons, speed, warmupMs });
  const primary = ctx.nodes.find((other) => other.local);
  const request = ctx.request ?? {};

  if (!node.up) {
    reasons.push(node.error ?? "mất kết nối");
    return out(false);
  }
  if (ctx.now < node.cooldownUntil) {
    reasons.push("vừa gặp lỗi, đang chờ thử lại");
    return out(false);
  }
  if (node.status && !node.status.accepting) {
    reasons.push("đang tạm dừng (có tệp tạm dừng trên máy)");
    return out(false);
  }

  let warmupMs = 0;
  if (isMediaLane(lane)) {
    const status = node.status;
    if (!node.mediaUp || !status) {
      reasons.push(node.error ?? "cầu nối media chưa phản hồi");
      return out(false);
    }
    if (!status.capabilities[lane]) {
      reasons.push(`chưa có dịch vụ ${LANE_LABEL[lane]}`);
      return out(false);
    }
    if ((lane === "image" || lane === "tts") && !node.local) {
      if (ctx.strict) {
        if (!status.fingerprint || !primary?.status?.fingerprint) {
          reasons.push("chưa kiểm chứng được cấu hình giống máy chính (cần cập nhật mã ở cả hai máy)");
          return out(false);
        }
        if (status.fingerprint !== primary.status.fingerprint) {
          reasons.push("cấu hình hoặc mã khác máy chính; ảnh và giọng sẽ không đồng nhất");
          return out(false);
        }
      }
    }
    if (lane === "image") {
      if (status.image?.state === "loading") {
        reasons.push("đang nạp model ảnh");
        return out(false);
      }
      const models = status.image?.models ?? [];
      const wanted = request.imageModel ?? (node.local ? null : primary?.status?.image?.defaultModel ?? null);
      if (wanted && models.length && !models.includes(wanted)) {
        reasons.push(`thiếu model ảnh ${wanted}`);
        return out(false);
      }
    }
    if (lane === "tts") {
      const engines = status.tts?.engines ?? [];
      // Without an explicit engine each machine picks its own default; a video must not change voice halfway through.
      const wanted = request.ttsEngine ?? (node.local ? null : primary?.status?.tts?.defaultEngine ?? null);
      if (wanted && !engines.includes(wanted)) {
        reasons.push(`thiếu giọng đọc ${wanted} giống máy chính`);
        return out(false);
      }
    }
  } else if (lane === "whiteboard") {
    if (!node.whiteboardUp) {
      reasons.push("máy vẽ tay chưa chạy");
      return out(false);
    }
  } else {
    if (!node.llmUp) {
      reasons.push("Ollama chưa chạy");
      return out(false);
    }
    if (request.llmModel) {
      if (node.llmInstalled.length && !hasModel(node.llmInstalled, request.llmModel)) {
        reasons.push(`chưa cài model ${request.llmModel}`);
        return out(false);
      }
      if (!hasModel(node.llmLoaded, request.llmModel)) warmupMs = LLM_WARMUP_MS;
    }
  }

  let speed = 1;
  const resources = node.status?.resources;
  if (resources) {
    if (resources.power === "battery") {
      if (resources.batteryPercent !== null && resources.batteryPercent < ctx.minBatteryPercent) {
        reasons.push(`pin còn ${resources.batteryPercent}%`);
        return out(false);
      }
      reasons.push("đang dùng pin");
      speed *= 1.25;
    }
    if (resources.memPressure === "critical") {
      reasons.push("RAM đang quá tải");
      if (lane !== "transcribe" && lane !== "tts") return out(false);
      speed *= 1.5;
    } else if (resources.memPressure === "warn") {
      reasons.push("RAM đang căng");
      speed *= 1.3;
    }
    if (resources.thermal === "throttled") {
      reasons.push("máy nóng, đang giảm xung");
      speed *= 1.6;
    }
    if (resources.loadAvg1 !== null && resources.cpuCores) {
      const ratio = resources.loadAvg1 / resources.cpuCores;
      if (ratio > 1.25) {
        reasons.push("máy đang bận việc khác");
        speed *= Math.min(2.5, ratio);
      }
    }
  }
  return out(true, speed, warmupMs);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** What a node reports about itself (its own timings over its requests); only the media bridge does. */
const reported = (node: NodeSnapshot, lane: Lane): number | undefined =>
  isMediaLane(lane) ? node.status?.perf?.[lane] : undefined;

/** Expected duration of one task of `lane` on `node`, before any slowdown or network cost. */
export function baseMs(node: NodeSnapshot, lane: Lane, ctx: AssessContext): number {
  const own = node.ewma[lane];
  const others = ctx.nodes
    .filter((other) => other.id !== node.id)
    .map((other) => other.ewma[lane] ?? reported(other, lane))
    .filter((value): value is number => value !== undefined);
  if (own === undefined) {
    const told = reported(node, lane);
    if (told !== undefined) return told;
    // An unmeasured machine is assumed a little slower than the others rather than as fast: it has to prove itself.
    return others.length ? median(others) * 1.3 : PRIOR_MS[lane];
  }
  const sampledAt = node.lastSampleAt[lane] ?? 0;
  if (ctx.now - sampledAt > STALE_MS && others.length) return Math.min(own, Math.min(...others) * 1.5);
  return own;
}

/** Network cost of using a machine other than the main one: the request and the finished picture or voice travel. */
export const overheadMs = (node: NodeSnapshot) => (node.local ? 0 : 300 + 3 * (node.rttMs ?? 50));

export function estimateMs(node: NodeSnapshot, lane: Lane, assessment: Assessment, ctx: AssessContext): number {
  return baseMs(node, lane, ctx) * assessment.speed + overheadMs(node);
}

/** Time until the node can start another task in `lane`: how long its current tasks still have to run. */
export function busyRemainingMs(node: NodeSnapshot, lane: Lane, now: number): number {
  const running = node.inflight[lane] ?? [];
  if (running.length < LANE_CAPACITY[lane]) return 0;
  const left = running.map((task) => Math.max(task.expectedMs - (now - task.startedAt), task.expectedMs * 0.2));
  return Math.min(...left);
}

export type PlanNode = {
  id: string;
  local: boolean;
  /** When this node can start its next task, from now (running work and warm-up). */
  availableAtMs: number;
  durationMs: number;
};

/**
 * Earliest-finish-time list scheduling: every task goes to the node that would finish it first. A slow or busy node
 * only gets work when that really finishes sooner, which is what keeps a laptop from becoming the straggler.
 */
export function simulate(nodes: PlanNode[], tasks: number): { makespanMs: number; assigned: Record<string, number> } {
  const free = new Map(nodes.map((node) => [node.id, node.availableAtMs]));
  const assigned: Record<string, number> = Object.fromEntries(nodes.map((node) => [node.id, 0]));
  for (let task = 0; task < tasks; task += 1) {
    let best: PlanNode | null = null;
    let bestFinish = Infinity;
    for (const node of nodes) {
      const finish = free.get(node.id)! + node.durationMs;
      if (finish < bestFinish - 1e-6 || (Math.abs(finish - bestFinish) <= 1e-6 && node.local && !best?.local)) {
        best = node;
        bestFinish = finish;
      }
    }
    if (!best) break;
    free.set(best.id, bestFinish);
    assigned[best.id]! += 1;
  }
  const makespanMs = Math.max(0, ...nodes.filter((node) => assigned[node.id]! > 0).map((node) => free.get(node.id)!));
  return { makespanMs, assigned };
}

export type BalanceMode = "auto" | "single" | "parallel";

export type Plan = {
  nodeIds: string[];
  singleMs: number;
  plannedMs: number;
  reason: string;
};

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`;
}

/**
 * Decides which machines take part in `tasks` tasks of one lane. `auto` adds a machine only when it makes the whole
 * batch clearly faster (`minGain` of the time and at least `minSavingsMs`), so a laptop is not woken up, heated and
 * drained for a few seconds; `single` keeps to the main machine and only falls back to another when it is out;
 * `parallel` uses every machine that is available.
 */
export function planLane(
  nodes: PlanNode[],
  tasks: number,
  options: { mode: BalanceMode; minGain: number; minSavingsMs: number },
): Plan {
  if (!nodes.length) return { nodeIds: [], singleMs: 0, plannedMs: 0, reason: "Không có máy nào khả dụng" };
  const alone = nodes.map((node) => ({ node, ms: simulate([node], tasks).makespanMs }));
  const fastest = alone.reduce((best, item) => (item.ms < best.ms ? item : best));
  // The main machine wins a near tie: it keeps its models warm and needs no network.
  const main = alone.find((item) => item.node.local);
  const single = main && (options.mode === "single" || main.ms <= fastest.ms * 1.05) ? main : fastest;

  if (nodes.length === 1 || options.mode === "single") {
    return {
      nodeIds: [single.node.id], singleMs: single.ms, plannedMs: single.ms,
      reason: nodes.length === 1 ? `Chạy trên máy ${single.node.id}` : `Chạy một máy (${single.node.id}) theo cấu hình`,
    };
  }
  if (options.mode === "parallel") {
    const all = simulate(nodes, tasks);
    return {
      nodeIds: nodes.map((node) => node.id), singleMs: single.ms, plannedMs: all.makespanMs,
      reason: `Chạy song song ${nodes.length} máy theo cấu hình (ước tính ${formatDuration(all.makespanMs)})`,
    };
  }

  const chosen = [single.node];
  let current = single.ms;
  let declined = "";
  const rest = nodes
    .filter((node) => node.id !== single.node.id)
    .sort((a, b) => a.availableAtMs + a.durationMs - (b.availableAtMs + b.durationMs));
  for (const candidate of rest) {
    const withCandidate = simulate([...chosen, candidate], tasks).makespanMs;
    const saved = current - withCandidate;
    if (saved >= options.minSavingsMs && withCandidate <= current * (1 - options.minGain)) {
      chosen.push(candidate);
      current = withCandidate;
    } else {
      const percent = Math.max(0, Math.round((saved / current) * 100));
      declined ||= `thêm máy ${candidate.id} chỉ nhanh hơn ${percent}% (${formatDuration(Math.max(0, saved))}), không đáng`;
    }
  }
  if (chosen.length > 1) {
    return {
      nodeIds: chosen.map((node) => node.id), singleMs: single.ms, plannedMs: current,
      reason: `Chạy song song ${chosen.length} máy (${chosen.map((node) => node.id).join(", ")}): ước tính ${formatDuration(current)} thay vì ${formatDuration(single.ms)} nếu chạy một máy`,
    };
  }
  return {
    nodeIds: [single.node.id], singleMs: single.ms, plannedMs: single.ms,
    reason: `Chạy một máy (${single.node.id}): ${declined || "không có máy phụ nào giúp nhanh hơn"}`,
  };
}
