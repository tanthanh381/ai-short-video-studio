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
  ALLOWED_ORIGINS: "http://localhost:5173", PORT: 8787, MAX_UPLOAD_MB: 50,
  DAILY_BUDGET_USD: 0, MAX_CONCURRENT_JOBS: 1, AI_FEATURES_ENABLED: false,
  OPENAI_FEATURES_ENABLED: true, ANTHROPIC_FEATURES_ENABLED: true,
  OLLAMA_FEATURES_ENABLED: true, LOCAL_MEDIA_FEATURES_ENABLED: true,
  RENDER_WORKER_ENABLED: true, NODE_ENV: "test",
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
