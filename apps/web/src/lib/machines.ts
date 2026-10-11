import type { BalancerSummary, NodeSummary } from "@studio/shared";
import { nodeActivity } from "./air-setup";
import { formatGb } from "./system";

/** The "Máy xử lý video" controls in Cài đặt: which machines are on, how work is split, a one-line state for each. Pure, so it is tested. */

export type Mode = BalancerSummary["mode"];

export const MODE_CHOICES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "auto", label: "Tự động", hint: "Hệ thống đánh giá từng đợt rồi chọn chạy một máy hay song song, tùy cách nào nhanh hơn." },
  { id: "single", label: "Một máy", hint: "Mỗi đợt chỉ dùng một máy (máy chính nếu đang bật); máy còn lại chờ dự phòng." },
  { id: "parallel", label: "Luôn song song", hint: "Dùng mọi máy đang bật và sẵn sàng, kể cả khi chia ra không nhanh hơn bao nhiêu." },
];

export type MachineChoice = {
  id: string;
  primary: boolean;
  enabled: boolean;
  /** Short state shown beside the switch. */
  state: { label: string; tone: "ok" | "warn" | "bad" | "idle" };
  /** "RAM 12,9/16 GB · đang vẽ 1 ảnh": a glance, the details are in Hệ thống. */
  facts: string;
  /** The last machine that is on cannot be switched off: something has to do the work. */
  canSwitchOff: boolean;
};

const STATE: Record<NodeSummary["state"], MachineChoice["state"]> = {
  healthy: { label: "Sẵn sàng", tone: "ok" },
  degraded: { label: "Hạn chế", tone: "warn" },
  paused: { label: "Tạm dừng", tone: "idle" },
  offline: { label: "Mất kết nối", tone: "bad" },
  disabled: { label: "Đã tắt", tone: "idle" },
};

export function machineFacts(node: NodeSummary): string {
  const resources = node.resources;
  const facts: string[] = [];
  if (resources?.memUsedGb != null && resources.memTotalGb) facts.push(`RAM ${formatGb(resources.memUsedGb)}/${formatGb(resources.memTotalGb)}`);
  else if (resources?.memTotalGb) facts.push(`RAM ${formatGb(resources.memTotalGb)}`);
  if (resources?.swapUsedGb != null && resources.swapTotalGb && resources.swapUsedGb / resources.swapTotalGb >= 0.5) facts.push(`swap ${formatGb(resources.swapUsedGb)}/${formatGb(resources.swapTotalGb)}`);
  if (resources?.power === "battery") facts.push(`pin ${resources.batteryPercent ?? "?"}%`);
  if (resources?.thermal === "throttled") facts.push("đang nóng");
  const activity = nodeActivity(node);
  if (activity) facts.push(activity);
  return facts.join(" · ");
}

export function machineChoices(balancer: BalancerSummary): MachineChoice[] {
  const enabled = balancer.nodes.filter((node) => node.enabled !== false);
  return balancer.nodes.map((node) => {
    const on = node.enabled !== false;
    return {
      id: node.id,
      primary: node.role === "primary",
      enabled: on,
      state: STATE[node.state],
      facts: on ? machineFacts(node) : "Không nhận việc mới; vẫn được theo dõi ở Hệ thống",
      canSwitchOff: !on || enabled.length > 1,
    };
  });
}

/** The list of switched-off machines after switching `id` on or off. */
export function disabledAfter(balancer: BalancerSummary, id: string, turnOn: boolean): string[] {
  const off = new Set(balancer.nodes.filter((node) => node.enabled === false).map((node) => node.id));
  if (turnOn) off.delete(id);
  else off.add(id);
  return [...off];
}

/** A sentence about what the current choice means, when it is worth saying. */
export function machineWarning(balancer: BalancerSummary): string | null {
  const primary = balancer.nodes.find((node) => node.role === "primary");
  const others = balancer.nodes.filter((node) => node.role !== "primary" && node.enabled !== false);
  if (primary && primary.enabled === false) {
    const names = others.map((node) => node.id).join(", ");
    return `Máy chính đang tắt: mọi việc AI chạy trên ${names || "máy còn lại"}. Nếu máy đó mất kết nối, video sẽ không chạy được cho tới khi bạn bật lại máy chính. Bước ghép video (FFmpeg) vẫn chạy trên máy chính.`;
  }
  if (others.length === 0 && balancer.nodes.length > 1) return "Các máy phụ đang tắt: mọi việc chạy trên máy chính, không còn chia song song.";
  return null;
}

export const SERVICE_NAMES: Array<[string, string]> = [
  ["api", "Backend API"], ["supabase", "Supabase"], ["worker", "Worker dựng video"], ["render", "FFmpeg"],
  ["ollama", "Ollama"], ["localMedia", "Media local"], ["faceDetail", "Sửa khuôn mặt"], ["whiteboard", "Máy vẽ tay"],
];

/** "7/8 dịch vụ hoạt động" and the ones that are not: all Cài đặt says about services; the full list is in Hệ thống. */
export function serviceSummary(statuses: Record<string, { state: string; detail: string }>): { ok: number; total: number; problems: Array<{ name: string; detail: string }> } {
  const known = SERVICE_NAMES.filter(([id]) => statuses[id] && statuses[id]!.state !== "disabled" && statuses[id]!.state !== "unknown");
  const problems = known.filter(([id]) => statuses[id]!.state === "offline").map(([id, name]) => ({ name, detail: statuses[id]!.detail }));
  return { ok: known.length - problems.length, total: known.length, problems };
}
