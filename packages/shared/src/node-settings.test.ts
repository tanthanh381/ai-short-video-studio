import { describe, expect, it } from "vitest";
import { BALANCER_SETTINGS_PATH, readBalancerSettings, writeBalancerSettings, type SettingsClient } from "./balancer-store";
import { DEFAULT_BALANCER_SETTINGS, effectiveDisabled, parseBalancerSettings } from "./node-settings";

describe("parseBalancerSettings", () => {
  it("reads what was saved", () => {
    expect(parseBalancerSettings(JSON.stringify({ mode: "parallel", disabled: ["mini"] }))).toEqual({ mode: "parallel", disabled: ["mini"] });
    expect(parseBalancerSettings(JSON.stringify({ disabled: ["air", "air"] }))).toEqual({ mode: null, disabled: ["air"] });
  });

  it("treats nothing saved, a damaged file or odd values as 'nothing chosen', never as an error", () => {
    for (const text of [null, undefined, "", "not json", "[]", JSON.stringify({ mode: "turbo" }), JSON.stringify({ disabled: ["Has Spaces"] }), JSON.stringify({ disabled: "mini" })]) {
      expect(parseBalancerSettings(text)).toEqual(DEFAULT_BALANCER_SETTINGS);
    }
  });
});

describe("effectiveDisabled", () => {
  it("keeps only machines that exist", () => {
    expect(effectiveDisabled(["mini", "air"], ["air", "ghost"])).toEqual(["air"]);
  });

  it("never switches every machine off: something has to do the work", () => {
    expect(effectiveDisabled(["mini", "air"], ["mini", "air"])).toEqual([]);
    expect(effectiveDisabled(["mini"], ["mini"])).toEqual([]);
  });
});

describe("the saved file", () => {
  const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  function fakeClient(initial: { content?: string; bucket?: boolean; downloadError?: unknown } = {}) {
    const state = { content: initial.content ?? null as string | null, bucket: initial.bucket ?? true, created: 0, uploads: [] as Array<{ path: string; body: string }> };
    const client: SettingsClient = {
      storage: {
        getBucket: async () => ({ data: state.bucket ? { id: "app-secrets" } : null }),
        createBucket: async () => { state.created += 1; state.bucket = true; return { error: null }; },
        from: () => ({
          download: async () => {
            if (initial.downloadError) return { data: null, error: initial.downloadError };
            if (state.content === null) return { data: null, error: { name: "StorageUnknownError", message: "{}", originalError: response(400, { statusCode: "404", error: "not_found", code: "NoSuchKey" }) } };
            const text = state.content;
            return { data: { text: async () => text }, error: null };
          },
          upload: async (path, body) => { state.uploads.push({ path, body }); state.content = body; return { error: null }; },
        }),
      },
    };
    return { client, state };
  }

  it("is 'nothing chosen' until the owner saves something (a missing file is not an error)", async () => {
    expect(await readBalancerSettings(fakeClient().client)).toEqual(DEFAULT_BALANCER_SETTINGS);
  });

  it("round-trips through the private bucket and creates the bucket when it is missing", async () => {
    const { client, state } = fakeClient({ bucket: false });
    await writeBalancerSettings(client, { mode: "single", disabled: ["air"] });
    expect(state.created).toBe(1);
    expect(state.uploads[0]!.path).toBe(BALANCER_SETTINGS_PATH);
    expect(await readBalancerSettings(client)).toEqual({ mode: "single", disabled: ["air"] });
  });

  it("does not take a storage outage for 'nothing chosen' (the worker would switch every machine back on)", async () => {
    const outage = fakeClient({ downloadError: { name: "StorageUnknownError", message: "{}", originalError: response(502, { error: "bad gateway" }) } });
    await expect(readBalancerSettings(outage.client)).rejects.toBeTruthy();
  });

  it("refuses to write something the worker could not read", async () => {
    const { client } = fakeClient();
    await expect(writeBalancerSettings(client, { mode: "warp" as never, disabled: [] })).rejects.toBeTruthy();
  });
});
