import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import type { AppConfig } from "./config";

const config: AppConfig = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-secret-key-long",
  ALLOWED_ORIGINS: "http://localhost:5173",
  OLLAMA_BASE_URL: "http://ollama.test:11434",
  WORKER_HEALTH_URL: "http://worker.test:8790",
  PORT: 8787,
  MAX_UPLOAD_MB: 50,
  DAILY_BUDGET_USD: 3,
  MAX_CONCURRENT_JOBS: 1,
  AI_FEATURES_ENABLED: false,
  OPENAI_FEATURES_ENABLED: false,
  ANTHROPIC_FEATURES_ENABLED: false,
  OLLAMA_FEATURES_ENABLED: false,
  LOCAL_MEDIA_FEATURES_ENABLED: false,
  LOCAL_MEDIA_BASE_URL: "http://localhost:8765",
  RENDER_WORKER_ENABLED: false,
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  NODE_ENV: "test",
};

describe("API", () => {
  it("cong khai health check", async () => {
    const app = createApp(config, {} as never);
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("cho phep CORS cho frontend da cau hinh", async () => {
    const app = createApp(config, {} as never);
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("chan endpoint du an khi khong dang nhap", async () => {
    const app = createApp(config, {} as never);
    const response = await request(app).get("/v1/projects");
    expect(response.status).toBe(401);
  });

  it("tra ve trang thai dich vu thay vi chi tra co cau hinh hay khong", async () => {
    const db = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email: "owner@example.com" } },
          error: null,
        })),
      },
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          maybeSingle: async () => ({
            data: { user_id: "user-1", is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 },
            error: null,
          }),
        };
        return query;
      },
    };
    const app = createApp(config, db as never);
    const response = await request(app)
      .get("/v1/settings")
      .set("Authorization", "Bearer test");

    expect(response.status).toBe(200);
    expect(response.body.serviceStatuses.api.state).toBe("healthy");
    expect(response.body.serviceStatuses.supabase.state).toBe("healthy");
    expect(response.body.serviceStatuses.ollama.state).toBe("disabled");
    expect(response.body.serviceStatuses.worker.state).toBe("disabled");
    expect(response.body.balancer).toBeNull();
  });

  describe("cac may cung xu ly", () => {
    const owner = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "owner@example.com" } }, error: null })) },
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          maybeSingle: async () => ({ data: { user_id: "user-1", is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 }, error: null }),
        };
        return query;
      },
    };
    const node = (id: string, role: "primary" | "secondary") => ({ id, role, state: "healthy", detail: "Sẵn sàng nhận việc", rttMs: null, resources: null, lanes: {} });
    const workerSays = (balancer: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      services: { worker: { state: "healthy", detail: "Worker đang chạy" } },
      balancer,
    }))));

    it("bao cac may va lan phan viec gan nhat khi co tu hai may", async () => {
      workerSays({
        mode: "auto",
        nodes: [node("mini", "primary"), node("air", "secondary")],
        decisions: [{ at: "2026-10-10T10:00:00.000Z", lane: "image", tasks: 12, nodes: ["mini", "air"], reason: "Chạy song song 2 máy" }],
      });
      const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, owner as never);
      const response = await request(app).get("/v1/settings").set("Authorization", "Bearer test");
      expect(response.status).toBe(200);
      expect(response.body.balancer.nodes.map((item: { id: string }) => item.id)).toEqual(["mini", "air"]);
      expect(response.body.balancer.decisions[0].reason).toBe("Chạy song song 2 máy");
      vi.unstubAllGlobals();
    });

    it("bao tien trinh cai may Air khi worker doc duoc, va khong bao gi khi khong co", async () => {
      const setup = { active: true, finished: false, failed: null, node: "air", startedAt: "2026-10-10T16:00:00.000Z", expiresAt: "2026-10-10T17:30:00.000Z", lastSeenAt: null,
        steps: [{ id: "check", name: "Kiểm tra máy", state: "running", detail: "" }], models: { sentBytes: 0, totalBytes: 0 } };
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, services: { worker: { state: "healthy", detail: "Worker đang chạy" } }, balancer: { mode: "auto", nodes: [], decisions: [] }, airSetup: setup }))));
      const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, owner as never);
      const response = await request(app).get("/v1/settings").set("Authorization", "Bearer test");
      expect(response.body.airSetup).toEqual(setup);
      vi.unstubAllGlobals();
      workerSays({ mode: "auto", nodes: [], decisions: [] });
      const quiet = createApp({ ...config, RENDER_WORKER_ENABLED: true }, owner as never);
      expect((await request(quiet).get("/v1/settings").set("Authorization", "Bearer test")).body.airSetup).toBeNull();
      vi.unstubAllGlobals();
    });

    describe("bang dieu khien he thong", () => {
      const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
      const jobsTable = (rowsFor: (columns: string) => unknown[]) => ({
        auth: owner.auth,
        from: (table: string) => {
          const query: Record<string, unknown> = {
            select: (columns: string) => { query.columns = columns; return query; },
            eq: () => query, in: () => query, gte: () => query, order: () => query, limit: () => query,
            maybeSingle: async () => ({ data: { user_id: "user-1", is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 }, error: null }),
            then: (resolve: (value: unknown) => void) => resolve({ data: table === "jobs" ? rowsFor(String(query.columns)) : [], error: null }),
          };
          return query;
        },
      });

      it("gom may, dich vu va viec cua chu tai khoan trong mot lan goi", async () => {
        workerSays({ mode: "auto", nodes: [node("mini", "primary"), node("air", "secondary")], decisions: [] });
        const db = jobsTable((columns) => {
          if (columns === "status") return [{ status: "running" }, { status: "queued" }, { status: "queued" }];
          if (columns.startsWith("job_type, status")) return [
            { job_type: "create_video", status: "completed", started_at: hoursAgo(2), finished_at: new Date(Date.parse(hoursAgo(2)) + 300_000).toISOString() },
            { job_type: "create_video", status: "completed", started_at: hoursAgo(1), finished_at: new Date(Date.parse(hoursAgo(1)) + 500_000).toISOString() },
            { job_type: "render_video", status: "completed", started_at: hoursAgo(1), finished_at: hoursAgo(0.9) }, // not a whole video: no effect on the average
            { job_type: "create_video", status: "failed", started_at: hoursAgo(3), finished_at: hoursAgo(3) },
          ];
          return [
            { id: "j2", job_type: "create_video", status: "running", stage: "Đang tạo ảnh cảnh 3 · máy air", progress: 30, started_at: hoursAgo(0.05), finished_at: null, projects: { title: "Ăn khế trả vàng" } },
            { id: "j1", job_type: "create_video", status: "completed", stage: "Hoàn thành", progress: 100, started_at: hoursAgo(2), finished_at: hoursAgo(1.9), projects: [{ title: "Sơn Tinh" }] },
          ];
        });
        const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, db as never);
        const response = await request(app).get("/v1/system").set("Authorization", "Bearer test");
        expect(response.status).toBe(200);
        expect(response.body.balancer.nodes.map((item: { id: string }) => item.id)).toEqual(["mini", "air"]);
        expect(response.body.services.worker.state).toBe("healthy");
        expect(response.body.jobs).toMatchObject({ running: 1, queued: 2, completed24h: 3, failed24h: 1, avgVideoSeconds24h: 400 });
        expect(response.body.jobs.recent[0]).toMatchObject({ id: "j2", title: "Ăn khế trả vàng", status: "running", stage: "Đang tạo ảnh cảnh 3 · máy air", progress: 30 });
        expect(response.body.jobs.recent[0].durationSeconds).toBeGreaterThanOrEqual(179); // still running: counts up to now
        expect(response.body.jobs.recent[1]).toMatchObject({ title: "Sơn Tinh", durationSeconds: 360 });
        vi.unstubAllGlobals();
      });

      it("khong tinh trung binh khi chua co video nao xong, va can dang nhap", async () => {
        workerSays({ mode: "auto", nodes: [], decisions: [] });
        const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, jobsTable(() => []) as never);
        const response = await request(app).get("/v1/system").set("Authorization", "Bearer test");
        expect(response.body.jobs).toEqual({ running: 0, queued: 0, completed24h: 0, failed24h: 0, avgVideoSeconds24h: null, recent: [] });
        expect(response.body.balancer).toBeNull();
        expect((await request(app).get("/v1/system")).status).toBe(401);
        vi.unstubAllGlobals();
      });
    });

    it("khong hien gi khi worker chi co may chinh", async () => {
      workerSays({ mode: "auto", nodes: [], decisions: [] });
      const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, owner as never);
      const response = await request(app).get("/v1/settings").set("Authorization", "Bearer test");
      expect(response.body.balancer).toBeNull();
      vi.unstubAllGlobals();
    });
  });
});
