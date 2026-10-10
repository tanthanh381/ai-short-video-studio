import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { checkKeyWithProvider } from "./api-keys";
import type { AppConfig } from "./config";

/** What the real Supabase client returns for a file that is not there: HTTP 400, message "{}", the 404 only in the body. */
const missingObjectError = () => ({
  name: "StorageUnknownError",
  message: "{}",
  originalError: new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found", code: "NoSuchKey" }), { status: 400 }),
});

const userId = "8d5f3a6e-0e53-4c45-9d3a-1d6dbf5a1a11";
const projectId = "3b968fb5-a00d-4b9d-8bd5-638598d9ef4d";
const SECRET = "a-test-secret-that-is-longer-than-thirty-two-characters";
const OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const CLAUDE_KEY = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-wxyz";
const now = "2026-10-10T10:00:00.000Z";
const sceneRow = { id: "5f0f7f64-4d5e-4c4e-8f55-0f6d4a8d2c11", project_id: projectId, scene_order: 0, narration: "Một câu chuyện ngắn.", image_prompt: "A quiet street",
  estimated_duration_ms: 4000, actual_duration_ms: null, image_path: null, video_path: null, audio_path: null, media_status: "pending", error_message: null, subtitles: [], annotation_json: null };
const config: AppConfig = {
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret-key-long",
  ALLOWED_ORIGINS: "http://localhost:5173", OLLAMA_BASE_URL: "http://ollama.test:11434", WORKER_HEALTH_URL: "http://worker.test:8790", PORT: 8787, MAX_UPLOAD_MB: 50,
  DAILY_BUDGET_USD: 3, MAX_CONCURRENT_JOBS: 1, AI_FEATURES_ENABLED: false,
  OPENAI_FEATURES_ENABLED: true, ANTHROPIC_FEATURES_ENABLED: true,
  OLLAMA_FEATURES_ENABLED: true, LOCAL_MEDIA_FEATURES_ENABLED: true,
  LOCAL_MEDIA_BASE_URL: "http://media.test:8765", RENDER_WORKER_ENABLED: true, NODE_ENV: "test",
  OPENAI_BASE_URL: "https://openai.test/v1", ANTHROPIC_BASE_URL: "https://anthropic.test",
  API_KEYS_SECRET: SECRET,
};

/** Fake Supabase: auth, the tables the settings and jobs routes touch, and an in-memory storage. */
function fixture(options: { secret?: string | undefined; textProvider?: string; mediaProvider?: string } = {}) {
  const files = new Map<string, string>();
  const buckets = new Set<string>();
  const row = { id: projectId, user_id: userId, title: "Ngày mới", source_text: "Một câu chuyện ngắn đủ dài.", input_mode: "full-script", status: "draft",
    settings: { textProvider: options.textProvider ?? "ollama", mediaProvider: options.mediaProvider ?? "local" }, created_at: now, updated_at: now };
  const jobsInserted: unknown[] = [];
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email: "owner@example.com" } }, error: null })) },
    storage: {
      getBucket: async (id: string) => (buckets.has(id) ? { data: { id }, error: null } : { data: null, error: { message: "Bucket not found" } }),
      createBucket: async (id: string) => { buckets.add(id); return { data: { name: id }, error: null }; },
      from: (bucket: string) => ({
        download: async (path: string) => {
          const text = files.get(`${bucket}/${path}`);
          return text === undefined ? { data: null, error: missingObjectError() } : { data: { text: async () => text }, error: null };
        },
        upload: async (path: string, body: string) => { files.set(`${bucket}/${path}`, body); return { data: {}, error: null }; },
      }),
    },
    from(table: string) {
      let single = false;
      const query = {
        select: () => query, eq: () => query, in: () => query, gte: () => query, order: () => query, limit: () => query,
        upsert: (value: unknown) => { jobsInserted.push(value); return query; },
        update: () => query,
        maybeSingle: () => { single = true; return query; },
        single: () => { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          let data: unknown = [];
          let count: number | null = null;
          if (table === "allowed_users") data = { user_id: userId, is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 };
          if (table === "projects") data = row;
          if (table === "scenes") data = [sceneRow];
          if (table === "jobs") { data = single ? { id: "9e4517ae-8462-4c4c-b1c7-45c79bf6af3c", project_id: projectId, user_id: userId, job_type: "storyboard", status: "queued", progress: 0, stage: "Đã xếp hàng", error_message: null, attempts: 0, max_attempts: 3, created_at: now, updated_at: now } : []; count = 0; }
          return Promise.resolve(resolve({ data, error: null, count }));
        },
      };
      return query;
    },
  };
  const app = createApp({ ...config, API_KEYS_SECRET: "secret" in options ? options.secret : SECRET } as AppConfig, db as never);
  const authed = (req: request.Test) => req.set("Authorization", "Bearer test");
  return { app, files, buckets, jobsInserted, authed };
}

const providerSays = (status: number) => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));

describe("the owner's own OpenAI and Claude keys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("needs a login", async () => {
    const f = fixture();
    expect((await request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY })).status).toBe(401);
    expect((await request(f.app).delete("/v1/api-keys/openai")).status).toBe(401);
  });

  it("checks the key with the provider at no cost, stores it encrypted, and gives the website only the last four characters", async () => {
    const f = fixture();
    providerSays(200);
    const response = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: `  "${OPENAI_KEY}" ` }));
    expect(response.status).toBe(200);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("https://openai.test/v1/models"); // listing models, no tokens spent
    expect((call[1] as RequestInit).headers).toEqual({ authorization: `Bearer ${OPENAI_KEY}` });
    expect(response.body.apiKeys).toMatchObject({ enabled: true, keys: { openai: { saved: true, last4: "abcd" }, anthropic: { saved: false } } });
    expect(JSON.stringify(response.body)).not.toContain("AbCdEfGh");
    expect(f.buckets.has("app-secrets")).toBe(true);
    const stored = [...f.files.entries()];
    expect(stored).toHaveLength(1);
    expect(stored[0]![0]).toBe(`app-secrets/${userId}/api-keys.json`);
    expect(stored[0]![1]).not.toContain("AbCdEfGh");
    expect(stored[0]![1]).not.toContain("sk-proj");
  });

  it("asks Claude with its own header and version", async () => {
    const f = fixture();
    providerSays(200);
    const response = await f.authed(request(f.app).put("/v1/api-keys/anthropic").send({ key: CLAUDE_KEY }));
    expect(response.status).toBe(200);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("https://anthropic.test/v1/models?limit=1");
    expect((call[1] as RequestInit).headers).toEqual({ "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" });
    expect(response.body.apiKeys.keys.anthropic).toMatchObject({ saved: true, last4: "wxyz" });
  });

  it("keeps both keys when the second one is saved, and removes one at a time", async () => {
    const f = fixture();
    providerSays(200);
    await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    await f.authed(request(f.app).put("/v1/api-keys/anthropic").send({ key: CLAUDE_KEY }));
    const both = await f.authed(request(f.app).get("/v1/settings"));
    expect(both.body.apiKeys.keys.openai.saved && both.body.apiKeys.keys.anthropic.saved).toBe(true);
    const removed = await f.authed(request(f.app).delete("/v1/api-keys/openai"));
    expect(removed.status).toBe(200);
    expect(removed.body.apiKeys.keys).toMatchObject({ openai: { saved: false }, anthropic: { saved: true, last4: "wxyz" } });
    expect(removed.body.capabilities.openai).toBe(false);
    expect(removed.body.capabilities.anthropic).toBe(true);
  });

  it("makes the provider available only for the owner who saved a key", async () => {
    const f = fixture();
    const before = await f.authed(request(f.app).get("/v1/settings"));
    expect(before.body.capabilities).toMatchObject({ openai: false, anthropic: false });
    expect(before.body.serviceStatuses.openai).toMatchObject({ state: "disabled" });
    providerSays(200);
    await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    const after = await f.authed(request(f.app).get("/v1/settings"));
    expect(after.body.capabilities).toMatchObject({ openai: true, anthropic: false });
    expect(after.body.serviceStatuses.openai).toMatchObject({ state: "configured", detail: expect.stringContaining("…abcd") });
  });

  it("rejects a key the provider refuses, says so in Vietnamese and stores nothing", async () => {
    const f = fixture();
    providerSays(401);
    const response = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/từ chối khóa này.*platform\.openai\.com/);
    expect(JSON.stringify(response.body)).not.toContain(OPENAI_KEY);
    expect(f.files.size).toBe(0);
  });

  it("does not save when the provider cannot be reached or is failing, so a typo is not stored by accident", async () => {
    const f = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const offline = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    expect(offline.status).toBe(502);
    providerSays(500);
    const failing = await f.authed(request(f.app).put("/v1/api-keys/anthropic").send({ key: CLAUDE_KEY }));
    expect(failing.status).toBe(502);
    expect(f.files.size).toBe(0);
  });

  it("accepts a restricted or rate-limited key with a note instead of refusing it", async () => {
    const f = fixture();
    providerSays(403);
    const response = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    expect(response.status).toBe(200);
    expect(response.body.warning).toMatch(/nhận ra khóa/);
    expect(response.body.apiKeys.keys.openai.saved).toBe(true);
  });

  it("rejects a malformed key before anything is sent, without echoing it", async () => {
    const f = fixture();
    providerSays(200);
    for (const bad of ["", "hunter2 hunter2", "hunter2-hunter2-hunter2-hunter2-hunter2", CLAUDE_KEY]) {
      const response = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: bad }));
      expect(response.status, bad).toBe(400);
      if (bad) expect(JSON.stringify(response.body)).not.toContain(bad);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.authed(request(f.app).put("/v1/api-keys/openai").send({}))).status).toBe(400);
    expect((await f.authed(request(f.app).put("/v1/api-keys/google").send({ key: OPENAI_KEY }))).status).toBe(404);
  });

  it("limits attempts per owner, so the endpoint cannot be used to try many keys", async () => {
    const f = fixture();
    providerSays(401);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }))).status);
    expect(statuses.slice(0, 8).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(8);
  });

  it("says plainly when the server has no encryption secret, and never stores in the clear", async () => {
    const f = fixture({ secret: undefined });
    providerSays(200);
    const response = await f.authed(request(f.app).put("/v1/api-keys/openai").send({ key: OPENAI_KEY }));
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/API_KEYS_SECRET/);
    expect(f.files.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    const settings = await f.authed(request(f.app).get("/v1/settings"));
    expect(settings.body.apiKeys.enabled).toBe(false);
  });

  it("refuses to queue a script or media job for a paid provider the owner has no key for, and queues it once there is one", async () => {
    const f = fixture({ textProvider: "anthropic", mediaProvider: "openai" });
    const refused = await f.authed(request(f.app).post(`/v1/projects/${projectId}/jobs`).send({ type: "storyboard" }));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Chưa có khóa API Claude \(Anthropic\).*Cài đặt/);
    const media = await f.authed(request(f.app).post(`/v1/projects/${projectId}/jobs`).send({ type: "generate_media" }));
    expect(media.status).toBe(409);
    expect(media.body.error).toMatch(/Chưa có khóa API ChatGPT \/ OpenAI/);
    expect(f.jobsInserted).toHaveLength(0);
    providerSays(200);
    await f.authed(request(f.app).put("/v1/api-keys/anthropic").send({ key: CLAUDE_KEY }));
    const accepted = await f.authed(request(f.app).post(`/v1/projects/${projectId}/jobs`).send({ type: "storyboard" }));
    expect(accepted.status).toBe(202);
    expect(f.jobsInserted).toHaveLength(1);
  });

  it("does not stop an Ollama or local-media project, whatever keys exist", async () => {
    const f = fixture({ textProvider: "ollama", mediaProvider: "local" });
    expect((await f.authed(request(f.app).post(`/v1/projects/${projectId}/jobs`).send({ type: "storyboard" }))).status).toBe(202);
  });
});

describe("asking the provider whether a key works", () => {
  const urls = { OPENAI_BASE_URL: "https://openai.test/v1/", ANTHROPIC_BASE_URL: "https://anthropic.test/" };
  it("maps the answer: 2xx ok, 401 invalid, 403 and 429 ok with a note, anything else try again", async () => {
    const ask = (status: number) => checkKeyWithProvider(urls, "openai", OPENAI_KEY, (async () => new Response("{}", { status })) as typeof fetch);
    expect(await ask(200)).toEqual({ ok: true });
    expect(await ask(401)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await ask(403)).toMatchObject({ ok: true, warning: expect.any(String) });
    expect(await ask(429)).toMatchObject({ ok: true, warning: expect.any(String) });
    expect(await ask(503)).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
