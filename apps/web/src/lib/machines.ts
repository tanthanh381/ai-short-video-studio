import type { BalancerSummary, NodeSummary } from "@studio/shared";
import { nodeActivity } from "./air-setup";
import { SWAP_HURTS_MBPS, formatGb, syncView, type SyncView } from "./system";

/** Thiết lập thiết bị xử lý trong Cài đặt: thiết bị đang bật, cách phân bổ tác vụ và trạng thái tóm tắt. */

export type Mode = BalancerSummary["mode"];

export const MODE_CHOICES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "auto", label: "Tự động", hint: "Tự chọn xử lý đơn lẻ hoặc song song dựa trên tải hiện tại." },
  { id: "single", label: "Một thiết bị", hint: "Mỗi đợt tác vụ chỉ dùng một thiết bị; thiết bị còn lại ở chế độ dự phòng." },
  { id: "parallel", label: "Song song", hint: "Sử dụng tất cả thiết bị đang sẵn sàng để rút ngắn thời gian xử lý." },
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
  /** How closely a second machine follows the main one (null for the main machine). */
  sync: SyncView | null;
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
  if ((resources?.swapOutMBps ?? 0) >= SWAP_HURTS_MBPS) facts.push(`đang ghi swap ${resources!.swapOutMBps} MB/s`); // only swapping that is going on now is worth a glance
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
      facts: on ? machineFacts(node) : "Đang tắt · không nhận tác vụ mới",
      canSwitchOff: !on || enabled.length > 1,
      sync: on && node.state !== "offline" ? syncView(node) : null,
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
    return `Thiết bị chính đang tắt. Tác vụ được chuyển sang ${names || "thiết bị còn lại"}; nếu thiết bị này mất kết nối, video mới sẽ tạm dừng. Render vẫn được thực hiện trên thiết bị chính.`;
  }
  if (others.length === 0 && balancer.nodes.length > 1) return "Thiết bị phụ đang tắt. Tất cả tác vụ hiện được xử lý trên thiết bị chính.";
  return null;
}

export const SERVICE_NAMES: Array<[string, string]> = [
  ["api", "API ứng dụng"], ["supabase", "Cơ sở dữ liệu"], ["worker", "Bộ xử lý video"], ["render", "Bộ xuất video"],
  ["ollama", "Ollama · nội dung"], ["localMedia", "Bộ tạo media"], ["faceDetail", "Tăng cường khuôn mặt"], ["whiteboard", "Bảng vẽ"],
];

/** "7/8 dịch vụ hoạt động" and the ones that are not: all Cài đặt says about services; the full list is in Hệ thống. */
export function serviceSummary(statuses: Record<string, { state: string; detail: string }>): { ok: number; total: number; problems: Array<{ name: string; detail: string }> } {
  const known = SERVICE_NAMES.filter(([id]) => statuses[id] && statuses[id]!.state !== "disabled" && statuses[id]!.state !== "unknown");
  const problems = known.filter(([id]) => statuses[id]!.state === "offline").map(([id, name]) => ({ name, detail: statuses[id]!.detail }));
  return { ok: known.length - problems.length, total: known.length, problems };
}
