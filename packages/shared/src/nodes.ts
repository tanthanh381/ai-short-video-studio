/** Shapes the worker reports about its machines (worker /health → API /v1/settings → Settings page). */

export type NodeHealthState = "healthy" | "degraded" | "offline" | "paused";

export type NodeLaneSummary = {
  eligible: boolean;
  /** Why the machine is out of this kind of work, or what slows it down. */
  reasons: string[];
  /** Measured milliseconds per task, null until the machine has done one. */
  avgMs: number | null;
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
