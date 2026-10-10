import { describe, expect, it } from "vitest";
import type { AirSetupSummary, NodeSummary } from "@studio/shared";
import { describeAirSetup, nodeActivity } from "./air-setup";

const steps = (states: Array<AirSetupSummary["steps"][number]["state"]>): AirSetupSummary["steps"] =>
  ["check", "tools", "code", "python", "models", "token", "start"].map((id, index) => ({ id, name: `Bước ${id}`, state: states[index] ?? "pending", detail: "" }));

const setup = (over: Partial<AirSetupSummary> = {}): AirSetupSummary => ({
  active: true, finished: false, failed: null, node: "air", startedAt: "2026-10-10T16:00:00.000Z", expiresAt: "2026-10-10T17:30:00.000Z", lastSeenAt: null,
  steps: steps([]), models: { sentBytes: 0, totalBytes: 0 }, ...over,
});

describe("the Air's installation on the Settings page", () => {
  it("tells the owner what to do while the Air has not been heard from yet", () => {
    const view = describeAirSetup(setup());
    expect(view.title).toBe("Đang cài máy Air");
    expect(view.message).toContain("Chưa thấy máy Air kết nối");
    expect(view.message).toContain("dán dòng lệnh cài");
    expect(view.percent).toBe(0);
  });

  it("counts the finished steps and says how long ago the Air spoke", () => {
    const now = new Date("2026-10-10T16:05:30.000Z").getTime();
    const view = describeAirSetup(setup({ lastSeenAt: "2026-10-10T16:05:00.000Z", steps: steps(["done", "done", "done", "running"]) }), now);
    expect(view.message).toContain("3/7 bước");
    expect(view.message).toContain("liên lạc 30 giây trước");
    expect(view.percent).toBe(43);
    expect(view.steps.map((step) => step.state)).toEqual(["done", "done", "done", "running", "pending", "pending", "pending"]);
  });

  it("shows the model download in gigabytes and percent, never above the total", () => {
    const view = describeAirSetup(setup({ lastSeenAt: "2026-10-10T16:10:00.000Z", steps: steps(["done", "done", "done", "done", "running"]), models: { sentBytes: 3 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 } }));
    expect(view.steps[4]!.detail).toBe("Đã tải 3,0 / 6,0 GB (50%)");
    const over = describeAirSetup(setup({ steps: steps(["done", "done", "done", "done", "running"]), models: { sentBytes: 7 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 } }));
    expect(over.steps[4]!.detail).toBe("Đã tải 6,0 / 6,0 GB (100%)");
    expect(describeAirSetup(setup({ steps: steps(["done", "done", "done", "done"]), models: { sentBytes: 0, totalBytes: 6 * 1024 ** 3 } })).steps[4]!.detail).toBe(""); // not started
  });

  it("shows a failure at its step with the installer's own words, and a finished install as complete", () => {
    const failed = describeAirSetup(setup({ active: false, failed: "python", steps: [...steps(["done", "done", "done"]).slice(0, 3), { id: "python", name: "Môi trường Python", state: "failed", detail: "pip lỗi" }] }));
    expect(failed.title).toBe("Cài máy Air gặp lỗi");
    expect(failed.steps.find((step) => step.id === "python")).toMatchObject({ state: "failed", detail: "pip lỗi" });
    const finished = describeAirSetup(setup({ active: false, finished: true, steps: steps(Array(7).fill("done")) }));
    expect(finished.title).toBe("Máy Air đã cài xong");
    expect(finished.percent).toBe(100);
    expect(finished.message).toContain("Máy cùng xử lý video");
  });
});

describe("what a machine is doing", () => {
  const node = (lanes: NodeSummary["lanes"]): NodeSummary => ({ id: "air", role: "secondary", state: "healthy", detail: "", rttMs: null, resources: null, lanes });
  const lane = (running: number, done: number) => ({ eligible: true, reasons: [], avgMs: null, running, done });

  it("says what is running and what is finished, and nothing for an idle new machine", () => {
    expect(nodeActivity(node({ image: lane(1, 12), tts: lane(0, 12) }))).toBe("đang vẽ 1 ảnh · đã xong 12 ảnh, 12 giọng");
    expect(nodeActivity(node({ image: lane(0, 3) }))).toBe("đã xong 3 ảnh");
    expect(nodeActivity(node({ tts: lane(2, 0), whiteboard: lane(1, 0) }))).toBe("đang đọc 2 giọng · đang vẽ 1 cảnh vẽ tay");
    expect(nodeActivity(node({ image: lane(0, 0) }))).toBe("");
    expect(nodeActivity(node({}))).toBe("");
  });
});
