/** Shapes the worker reports about its machines (worker /health → API /v1/settings → Settings page). */

/** `disabled`: switched off by the owner in Cài đặt (still watched, takes no new work). */
export type NodeHealthState = "healthy" | "degraded" | "offline" | "paused" | "disabled";

export type NodeLaneSummary = {
  eligible: boolean;
  /** Why the machine is out of this kind of work, or what slows it down. */
  reasons: string[];
  /** Measured milliseconds per task, null until the machine has done one. */
  avgMs: number | null;
  /** Tasks of this kind running on the machine right now. */
  running: number;
  /** Tasks of this kind the machine has finished since this worker started. */
  done: number;
};

/** One of the studio's programs on a machine and the memory it holds (physical footprint: includes models kept in GPU memory). */
export type NodeProcessSummary = { id: string; label: string; memGb: number; count: number };

export type NodeResourceSummary = {
  memTotalGb: number | null;
  memPressure: "normal" | "warn" | "critical" | "unknown";
  power: "ac" | "battery" | "unknown";
  batteryPercent: number | null;
  thermal: "nominal" | "throttled" | "unknown";
  loadAvg1: number | null;
  cpuCores: number | null;
  /** Reported by media bridges that know how to; absent from an older one. */
  memUsedGb?: number | null;
  swapUsedGb?: number | null;
  swapTotalGb?: number | null;
  diskFreeGb?: number | null;
  diskTotalGb?: number | null;
  processes?: NodeProcessSummary[];
};

/** Which AI models and engines a machine has ready, as the dashboard lists them. */
export type NodeModelsSummary = {
  llm: {
    up: boolean;
    installed: string[];
    /** Models Ollama holds in memory right now; it unloads one after a few idle minutes. */
    loaded: Array<{ name: string; sizeGb: number | null; expiresAt: string | null }>;
  };
  image: { state: "ready" | "loading" | "down" | "unknown"; models: string[]; defaultModel: string | null };
  tts: { engines: string[]; defaultEngine: string | null };
  transcribe: boolean | null;
  whiteboard: boolean;
  /** Redraws faces in pictures with people. */
  faceDetail: boolean | null;
};

/** One look at a machine, kept for the dashboard's charts. */
export type NodeHistoryPoint = {
  /** Epoch milliseconds. */
  at: number;
  /** Load average over the cores, in percent (can pass 100 when work is waiting for a core). */
  load: number | null;
  /** Memory in use, in percent of the total. */
  mem: number | null;
  swapGb: number | null;
  /** Tasks the balancer has running on the machine. */
  running: number;
  rttMs: number | null;
};

export type NodeSummary = {
  id: string;
  role: "primary" | "secondary";
  state: NodeHealthState;
  detail: string;
  rttMs: number | null;
  resources: NodeResourceSummary | null;
  lanes: Record<string, NodeLaneSummary>;
  /** False when the owner switched the machine off in Cài đặt. */
  enabled?: boolean;
  models?: NodeModelsSummary;
  /** Oldest first, one point every few seconds for the last half hour. */
  history?: NodeHistoryPoint[];
  /** Whether its pictures and voices are interchangeable with the main machine's (same settings and code); null when unknown. */
  matchesPrimary?: boolean | null;
};

/** A task a machine finished (or failed), newest first in the list the dashboard shows. */
export type NodeActivityEvent = { at: string; node: string; lane: string; ms: number; ok: boolean };

export type BalanceDecision = {
  at: string;
  lane: string;
  tasks: number;
  nodes: string[];
  reason: string;
};

export type BalancerSummary = {
  mode: "auto" | "single" | "parallel";
  nodes: NodeSummary[];
  decisions: BalanceDecision[];
  /** The counters in `lanes[...].done` count from this moment (when the worker started). */
  since?: string;
  recent?: NodeActivityEvent[];
};

/** The installation of the second machine, as the bundle server on the main machine sees it (local-tools/air_bundle_server.py). */
export type AirSetupStep = { id: string; name: string; state: "pending" | "running" | "done" | "failed"; detail: string };

export type AirSetupSummary = {
  /** The bundle server is waiting for the Air or serving it; false once it is done or has expired. */
  active: boolean;
  finished: boolean;
  /** The step that failed, if any. */
  failed: string | null;
  node: string;
  startedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  steps: AirSetupStep[];
  models: { sentBytes: number; totalBytes: number };
};

export type SystemJob = {
  id: string;
  type: string;
  title: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
};

export type SystemJobsSummary = {
  running: number;
  queued: number;
  completed24h: number;
  failed24h: number;
  /** Average time of the videos finished in the last 24 hours, in seconds. */
  avgVideoSeconds24h: number | null;
  recent: SystemJob[];
};

/** Everything the "Hệ thống" dashboard shows (GET /v1/system). */
export type SystemSummary = {
  checkedAt: string;
  balancer: BalancerSummary | null;
  services: Record<string, { state: string; detail: string; checkedAt: string }>;
  jobs: SystemJobsSummary;
};
