import { describe, expect, it } from "vitest";
import { JobCancelled, ensureNotCancelled, isCancelled, type JobStatusReader } from "./job-cancel";

const reader = (result: { data: { status?: string } | null; error: { message: string } | null }): JobStatusReader => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
});

describe("ensureNotCancelled", () => {
  it("stops a job whose row says cancelled", async () => {
    await expect(ensureNotCancelled(reader({ data: { status: "cancelled" }, error: null }), "j")).rejects.toBeInstanceOf(JobCancelled);
  });
  it("lets a running or queued job go on", async () => {
    await expect(ensureNotCancelled(reader({ data: { status: "running" }, error: null }), "j")).resolves.toBeUndefined();
    await expect(ensureNotCancelled(reader({ data: { status: "queued" }, error: null }), "j")).resolves.toBeUndefined();
  });
  it("does not cancel on a failed read or a missing row", async () => {
    await expect(ensureNotCancelled(reader({ data: null, error: { message: "network" } }), "j")).resolves.toBeUndefined();
    await expect(ensureNotCancelled(reader({ data: null, error: null }), "j")).resolves.toBeUndefined();
  });
  it("says in Vietnamese that finished scenes are kept", () => {
    expect(new JobCancelled().message).toMatch(/hủy.*giữ lại/u);
  });

  it("isCancelled reads the status without throwing", async () => {
    expect(await isCancelled(reader({ data: { status: "cancelled" }, error: null }), "j")).toBe(true);
    expect(await isCancelled(reader({ data: { status: "failed" }, error: null }), "j")).toBe(false);
  });
});
