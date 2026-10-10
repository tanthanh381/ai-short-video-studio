/** Shapes the worker reports about its machines (worker /health → API /v1/settings → Settings page). */

export type NodeHealthState = "healthy" | "degraded" | "offline" | "paused";

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

export type NodeResourceSummary = {
  memTotalGb: number | null;
  memPressure: "normal" | "warn" | "critical" | "unknown";
  power: "ac" | "battery" | "unknown";
  batteryPercent: number | null;
  thermal: "nominal" | "throttled" | "unknown";
  loadAvg1: number | null;
  cpuCores: number | null;
};

export type NodeSummary = {
  id: string;
  role: "primary" | "secondary";
  state: NodeHealthState;
  detail: string;
  rttMs: number | null;
  resources: NodeResourceSummary | null;
  lanes: Record<string, NodeLaneSummary>;
};

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
