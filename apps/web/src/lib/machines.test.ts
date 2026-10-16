import { describe, expect, it } from "vitest";
import type { BalancerSummary, NodeSummary } from "@studio/shared";
import { disabledAfter, machineChoices, machineFacts, machineWarning, serviceSummary } from "./machines";

const lane = (over = {}) => ({ eligible: true, reasons: [], avgMs: null, running: 0, done: 0, ...over });
const node = (id: string, over: Partial<NodeSummary> = {}): NodeSummary => ({
  id, role: id === "mini" ? "primary" : "secondary", state: "healthy", detail: "ok", rttMs: 20, enabled: true,
  resources: { memTotalGb: 16, memPressure: "normal", power: "ac", batteryPercent: null, thermal: "nominal", loadAvg1: 1, cpuCores: 10, memUsedGb: 12.9, swapUsedGb: 6.6, swapTotalGb: 8 },
  lanes: { image: lane({ running: 1, done: 4 }), tts: lane({ done: 9 }) },
  ...over,
});
const balancer = (nodes: NodeSummary[]): BalancerSummary => ({ mode: "auto", nodes, decisions: [] });

describe("machineChoices", () => {
  it("shows each machine with its state and a glance at how it is doing", () => {
    const [mini, air] = machineChoices(balancer([node("mini"), node("air", { state: "degraded" })]));
    expect(mini).toMatchObject({ id: "mini", primary: true, enabled: true, state: { label: "Sẵn sàng", tone: "ok" }, canSwitchOff: true });
    expect(mini!.facts).toBe("RAM 12,9 GB/16 GB · đang vẽ 1 ảnh · đã xong 4 ảnh, 9 giọng"); // a full swap alone is not worth a mention
    expect(air).toMatchObject({ id: "air", primary: false, state: { label: "Hạn chế", tone: "warn" } });
  });

  it("does not let the last machine that is on be switched off", () => {
    const choices = machineChoices(balancer([node("mini", { state: "disabled", enabled: false }), node("air")]));
    expect(choices.map((choice) => [choice.id, choice.enabled, choice.canSwitchOff])).toEqual([["mini", false, true], ["air", true, false]]);
    expect(choices[0]!.facts).toMatch(/không nhận việc mới/);
    expect(choices[0]!.state).toEqual({ label: "Đã tắt", tone: "idle" });
  });

  it("treats a worker that does not report 'enabled' as everything on", () => {
    const old = node("air");
    delete (old as { enabled?: boolean }).enabled;
    expect(machineChoices(balancer([node("mini"), old])).every((choice) => choice.enabled)).toBe(true);
  });
});

describe("disabledAfter", () => {
  it("adds or removes one machine and keeps the others as they are", () => {
    const both = balancer([node("mini"), node("air")]);
    expect(disabledAfter(both, "air", false)).toEqual(["air"]);
    const mini = balancer([node("mini", { enabled: false, state: "disabled" }), node("air")]);
    expect(disabledAfter(mini, "air", false).sort()).toEqual(["air", "mini"]); // the page never sends this: the switch is locked
    expect(disabledAfter(mini, "mini", true)).toEqual([]);
  });
});

describe("machineWarning", () => {
  it("says nothing when everything is on", () => {
    expect(machineWarning(balancer([node("mini"), node("air")]))).toBeNull();
  });

  it("explains what switching the main machine off means", () => {
    const text = machineWarning(balancer([node("mini", { enabled: false, state: "disabled" }), node("air")]))!;
    expect(text).toMatch(/Máy chính đang tắt.*MacBook Air/);
    expect(text).toMatch(/Bước ghép video vẫn chạy trên máy chính/);
  });

  it("says the work is no longer shared when the other machines are off", () => {
    expect(machineWarning(balancer([node("mini"), node("air", { enabled: false, state: "disabled" })]))).toMatch(/Mọi việc đang chạy trên máy chính/);
  });
});

describe("machineFacts and serviceSummary", () => {
  it("mentions swap only while the machine is writing to it, and battery only when on battery", () => {
    expect(machineFacts(node("air", { resources: { ...node("air").resources!, swapUsedGb: 0.3, swapTotalGb: 2, power: "battery", batteryPercent: 40 }, lanes: {} }))).toBe("RAM 12,9 GB/16 GB · pin 40%");
    expect(machineFacts(node("air", { resources: { ...node("air").resources!, swapOutMBps: 20 }, lanes: {} }))).toBe("RAM 12,9 GB/16 GB · đang ghi swap 20 MB/s");
    expect(machineFacts(node("air", { resources: { ...node("air").resources!, swapOutMBps: 6 }, lanes: {} }))).toBe("RAM 12,9 GB/16 GB");
  });

  it("counts the services that are running and names the ones that are not", () => {
    const summary = serviceSummary({
      api: { state: "healthy", detail: "ok" }, supabase: { state: "healthy", detail: "ok" }, worker: { state: "healthy", detail: "ok" },
      ollama: { state: "offline", detail: "Không kết nối được Ollama" }, faceDetail: { state: "disabled", detail: "tắt" }, whiteboard: { state: "unknown", detail: "?" },
    });
    expect(summary).toEqual({ ok: 3, total: 4, problems: [{ name: "Ollama · nội dung", detail: "Không kết nối được Ollama" }] });
  });
});

describe("the sync line of each machine in Cài đặt", () => {
  it("is shown for a second machine that is on and answering, not for the main one, a machine that is off or one that dropped out", () => {
    const sync = { state: "in-sync" as const, checkedAt: new Date().toISOString(), appliedAt: null, sourceVersion: "a", localVersion: "a", behind: { code: 0, toolkit: 0, models: 0, ollama: 0 }, differences: [], error: null, restartPending: [], progress: null };
    const [mini, air] = machineChoices(balancer([node("mini"), node("air", { sync })]));
    expect(mini!.sync).toBeNull();
    expect(air!.sync).toMatchObject({ label: "Giống Mac Mini", canRequest: true });
    expect(machineChoices(balancer([node("mini"), node("air", { sync, enabled: false, state: "disabled" })]))[1]!.sync).toBeNull();
    expect(machineChoices(balancer([node("mini"), node("air", { sync, state: "offline" })]))[1]!.sync).toBeNull();
  });
});
