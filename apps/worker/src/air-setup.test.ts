import { describe, expect, it } from "vitest";
import { fetchAirSetup } from "./air-setup";

const status = {
  active: true, finished: false, failed: null, node: "air", startedAt: 1_760_000_000, expiresAt: 1_760_005_400, lastSeenAt: 1_760_000_120,
  steps: [
    { id: "check", name: "Kiểm tra máy", state: "done", detail: "" },
    { id: "python", name: "Môi trường Python", state: "running", detail: "Dựng môi trường Python" },
    { id: "models", name: "Tải model từ Mac mini", state: "pending", detail: "" },
  ],
  models: { sentBytes: 0, totalBytes: 7_000_000_000 },
};
const respond = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("the Air's installation as the website shows it", () => {
  it("reads the bundle server's status with the node access code and turns its times into ISO dates", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers };
      return { ok: true, json: async () => status };
    }) as unknown as typeof fetch;
    const summary = await fetchAirSetup("http://100.121.139.81:8899/", "node-token-123", fake);
    expect(seen).toEqual({ url: "http://100.121.139.81:8899/status", headers: { authorization: "Bearer node-token-123" } });
    expect(summary).toMatchObject({ active: true, finished: false, failed: null, node: "air", steps: status.steps, models: status.models });
    expect(summary!.startedAt).toBe(new Date(1_760_000_000 * 1000).toISOString());
    expect(summary!.lastSeenAt).toBe(new Date(1_760_000_120 * 1000).toISOString());
  });

  it("says nothing when no installation is configured, the server is gone or it answers something else", async () => {
    expect(await fetchAirSetup(undefined, "node-token-123", respond(status))).toBeNull();
    expect(await fetchAirSetup("http://x:8899", undefined, respond(status))).toBeNull();
    expect(await fetchAirSetup("http://x:8899", "node-token-123", respond(status, false))).toBeNull(); // 401 or 404
    expect(await fetchAirSetup("http://x:8899", "node-token-123", respond({ unexpected: true }))).toBeNull();
    expect(await fetchAirSetup("http://x:8899", "node-token-123", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).toBeNull();
  });

  it("keeps a failed step and a missing last-seen time", async () => {
    const failed = { ...status, active: false, failed: "python", lastSeenAt: null, steps: [{ ...status.steps[1], state: "failed", detail: "pip lỗi" }] };
    expect(await fetchAirSetup("http://x:8899", "node-token-123", respond(failed))).toMatchObject({ failed: "python", lastSeenAt: null, steps: [{ state: "failed", detail: "pip lỗi" }] });
  });
});
