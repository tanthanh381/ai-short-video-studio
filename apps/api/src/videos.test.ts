import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import type { AppConfig } from "./config";

const userId = "c84187c5-33ad-4c80-a6f3-b925ca4aee31";
const projectId = "3b968fb5-a00d-4b9d-8bd5-638598d9ef4d";
const now = "2026-10-04T10:00:00.000Z";
const script = "  Hãy dành một phút để lắng nghe chính mình.\nNgày mới bắt đầu.  ";
const config: AppConfig = {
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret-key-long",
  ALLOWED_ORIGINS: "http://localhost:5173", OLLAMA_BASE_URL: "http://ollama.test:11434", WORKER_HEALTH_URL: "http://worker.test:8790", PORT: 8787, MAX_UPLOAD_MB: 50,
  DAILY_BUDGET_USD: 0, MAX_CONCURRENT_JOBS: 1, AI_FEATURES_ENABLED: false,
  OPENAI_FEATURES_ENABLED: true, ANTHROPIC_FEATURES_ENABLED: true,
  OLLAMA_FEATURES_ENABLED: true, LOCAL_MEDIA_FEATURES_ENABLED: true,
  LOCAL_MEDIA_BASE_URL: "http://media.test:8765", RENDER_WORKER_ENABLED: true, NODE_ENV: "test",
};

function fixture(options: { allowed?: boolean; busy?: boolean; rpcError?: string; owner?: string } = {}) {
  const row = {
    id: projectId, user_id: options.owner ?? userId, title: "Ngày mới", source_text: script,
    input_mode: "full-script", status: "queued", settings: { textProvider: "ollama", mediaProvider: "local" },
    created_at: now, updated_at: now,
  };
  const job = {
    id: "9e4517ae-8462-4c4c-b1c7-45c79bf6af3c", project_id: projectId, user_id: userId,
    job_type: "create_video", status: "queued", progress: 0, stage: "Đang chờ máy tạo video",
    error_message: null, attempts: 0, max_attempts: 3, created_at: now, updated_at: now,
  };
  const writes: string[] = [];
  const rpc = vi.fn(async (_name: string, input: Record<string, unknown>) => {
    if (options.rpcError) return { data: null, error: { message: options.rpcError } };
    row.settings = input.p_settings as typeof row.settings ?? row.settings;
    return { data: [job], error: null };
  });
  const signed = vi.fn(async () => ({ data: { signedUrl: "https://storage.test/file?token=expires" }, error: null }));
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email: "owner@example.com" } }, error: null })) },
    rpc,
    storage: { from: () => ({ createSignedUrl: signed }) },
    from(table: string) {
      const filters = new Map<string, unknown>();
      let single = false;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
        in: () => query,
        order: () => query,
        limit: () => query,
        update: () => { writes.push(table); return query; },
        upsert: () => { writes.push(table); return query; },
        delete: () => { writes.push(table); return query; },
        maybeSingle: () => { single = true; return query; },
        single: () => { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          let data: unknown = [];
          if (table === "allowed_users") data = options.allowed === false ? null : { user_id: userId, is_active: true, daily_budget_usd: 0, max_concurrent_jobs: 1 };
          if (table === "projects") data = filters.get("user_id") === row.user_id ? row : null;
          if (table === "scenes") data = [];
          if (table === "jobs") data = options.busy ? [{ id: job.id }] : [];
          if (table === "exports") data = single ? null : [];
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
  };
  return { app: createApp(config, db as never), db, rpc, row, writes, signed };
}

describe("one-click video API", () => {
  it("requires login and backend allowlist permission", async () => {
    const f = fixture({ allowed: false });
    expect((await request(f.app).post("/v1/videos").send({ sourceText: script })).status).toBe(401);
    expect((await request(f.app).post("/v1/videos").set("Authorization", "Bearer test").send({ sourceText: script })).status).toBe(403);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("creates local full-script pipeline without rewriting or paid provider even if paid keys exist", async () => {
    const f = fixture();
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test")
      .set("Idempotency-Key", "unique-click-123").send({ sourceText: script });
    expect(response.status).toBe(202);
    const args = f.rpc.mock.calls[0]![1];
    expect(args.p_source_text).toBe(script);
    expect(args.p_title).toBe("Hãy dành một phút để lắng nghe chính mình.");
    expect(args.p_settings).toMatchObject({ textProvider: "ollama", mediaProvider: "local", rewriteFullScript: false, aspectRatio: "9:16" });
    expect(args.p_idempotency_key).toBe("create-video:unique-click-123");
    expect(response.body.job.type).toBe("create_video");
    expect(response.body.project.sourceText).toBe(script);
  });

  it("fails capability preflight before creating projects or jobs", async () => {
    const f = fixture();
    const app = createApp({ ...config, LOCAL_MEDIA_FEATURES_ENABLED: false }, f.db as never);
    const response = await request(app).post("/v1/videos").set("Authorization", "Bearer test").send({ sourceText: script });
    expect(response.status).toBe(503);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("rejects accidental paid media routes", async () => {
    const f = fixture();
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test")
      .send({ sourceText: script, settings: { mediaProvider: "openai" } });
    expect(response.status).toBe(503);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("maps atomic concurrency rejection into a clear user message", async () => {
    const f = fixture({ rpcError: "VIDEO_CONCURRENCY_LIMIT" });
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test").send({ sourceText: script });
    expect(response.status).toBe(429);
    expect(response.body.error).toContain("đang xử lý");
  });

  it("prevents stale autosave from overwriting generated scenes during a job", async () => {
    const f = fixture({ busy: true });
    const loaded = await request(f.app).get(`/v1/projects/${projectId}`).set("Authorization", "Bearer test");
    const response = await request(f.app).put(`/v1/projects/${projectId}`).set("Authorization", "Bearer test").send(loaded.body);
    expect(response.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it("does not sign another user's export", async () => {
    const f = fixture({ owner: "73865c65-6b9c-4220-997c-75bece066dde" });
    const response = await request(f.app).get(`/v1/projects/${projectId}/result`).set("Authorization", "Bearer test");
    expect(response.status).toBe(404);
    expect(f.signed).not.toHaveBeenCalled();
  });
});

describe("local model selection API", () => {
  const catalog = {
    available: true,
    storyboard: { models: [{ id: "qwen2.5:3b", label: "qwen2.5:3b" }], default: "qwen2.5:3b" },
    image: { models: [{ id: "sdxl-turbo", label: "SDXL-Turbo" }], default: "sdxl-turbo" },
    tts: { models: [{ id: "vieneu", label: "VieNeu" }], default: "vieneu" },
    transcribe: { models: [], default: null },
  };

  it("stores per-task model choices in the project settings", async () => {
    const f = fixture();
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test")
      .send({ sourceText: script, settings: { textProvider: "ollama", mediaProvider: "local", localModels: { storyboard: "qwen2.5:3b", tts: "piper" } } });
    expect(response.status).toBe(202);
    expect((f.rpc.mock.calls[0]![1].p_settings as { localModels: unknown }).localModels).toEqual({ storyboard: "qwen2.5:3b", image: null, tts: "piper", transcribe: null });
  });

  it("rejects model names that could smuggle other values", async () => {
    const f = fixture();
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test")
      .send({ sourceText: script, settings: { textProvider: "ollama", mediaProvider: "local", localModels: { image: "x; rm -rf /" } } });
    expect(response.status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("returns the installed model catalog and degrades to unavailable when the machine is off", async () => {
    const f = fixture();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(catalog))).mockRejectedValueOnce(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const ok = await request(f.app).get("/v1/local-models").set("Authorization", "Bearer test");
      expect(ok.body.storyboard.models[0].id).toBe("qwen2.5:3b");
      expect(fetchMock.mock.calls[0]![0]).toBe("http://media.test:8765/models");
      const down = await request(f.app).get("/v1/local-models").set("Authorization", "Bearer test");
      expect(down.status).toBe(200);
      expect(down.body.available).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it("previews voices with a fixed sample, rejects unknown voices and caches the audio", async () => {
    const f = fixture();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bad = await request(f.app).post("/v1/voice-preview").set("Authorization", "Bearer test").send({ voice: "../etc/passwd" });
      expect(bad.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      const first = await request(f.app).post("/v1/voice-preview").set("Authorization", "Bearer test").send({ voice: "co-trang" });
      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toContain("audio/mpeg");
      const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
      expect(sent.voice).toBe("co-trang");
      expect(sent.text).toContain("kiếm khách");
      await request(f.app).post("/v1/voice-preview").set("Authorization", "Bearer test").send({ voice: "co-trang" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("requires login for model catalog and previews", async () => {
    const f = fixture();
    expect((await request(f.app).get("/v1/local-models")).status).toBe(401);
    expect((await request(f.app).post("/v1/voice-preview").send({ voice: "co-trang" })).status).toBe(401);
  });

  it("names the project from the cleaned script, not from a timing label", async () => {
    const f = fixture();
    const labelled = "**[0–5s | Hook]**\nTrăng treo đầu núi, kiếm khách một mình bước giữa sương khuya.\n\n**[5–15s]**\nHắn không mang theo vàng bạc.";
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test").send({ sourceText: labelled });
    expect(response.status).toBe(202);
    const args = f.rpc.mock.calls[0]![1];
    expect(args.p_title).toBe("Trăng treo đầu núi, kiếm khách một mình bước giữa sương khuya.");
    expect(args.p_source_text).toBe(labelled); // the author's text is stored untouched
  });

  it("falls back to the raw first line when the script is only labels", async () => {
    const f = fixture();
    const response = await request(f.app).post("/v1/videos").set("Authorization", "Bearer test").send({ sourceText: "**[0–5s | Hook]**\n[5–15s]" });
    expect(response.status).toBe(202);
    expect(f.rpc.mock.calls[0]![1].p_title).toBe("**[0–5s | Hook]**");
  });
});
