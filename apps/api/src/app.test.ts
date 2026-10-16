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

    describe("bat tat may", () => {
      const missing = { name: "StorageUnknownError", message: "{}", originalError: new Response(JSON.stringify({ statusCode: "404", code: "NoSuchKey" }), { status: 400 }) };
      function dbWithSettings(initial?: string) {
        const store = { content: initial ?? null as string | null, uploads: [] as string[] };
        const db = {
          auth: owner.auth,
          from: owner.from,
          storage: {
            getBucket: async () => ({ data: { id: "app-secrets" } }),
            createBucket: async () => ({ error: null }),
            from: () => ({
              download: async () => store.content === null ? { data: null, error: missing } : { data: { text: async () => store.content as string }, error: null },
              upload: async (_path: string, body: string) => { store.uploads.push(body); store.content = body; return { error: null }; },
            }),
          },
        };
        return { db, store };
      }
      const workerWith = (nodes: unknown[], reloadReply?: unknown) => vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/balancer/reload")) {
          expect(init?.method).toBe("POST");
          return reloadReply === undefined ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(reloadReply));
        }
        return new Response(JSON.stringify({ ok: true, services: { worker: { state: "healthy", detail: "Worker đang chạy" } }, balancer: { mode: "auto", nodes, decisions: [] } }));
      }));
      const both = [node("mini", "primary"), node("air", "secondary")];

      it("luu viec tat may Air, bao worker doc lai ngay va tra ve trang thai moi", async () => {
        const after = [node("mini", "primary"), { ...node("air", "secondary"), state: "disabled", enabled: false }];
        workerWith(both, { ok: true, balancer: { mode: "auto", nodes: after, decisions: [] } });
        const { db, store } = dbWithSettings();
        const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, db as never);
        const response = await request(app).put("/v1/balancer").set("Authorization", "Bearer test").send({ disabled: ["air"] });
        expect(response.status).toBe(200);
        expect(JSON.parse(store.uploads[0]!)).toEqual({ mode: null, disabled: ["air"] });
        expect(response.body).toMatchObject({ applied: true, settings: { mode: null, disabled: ["air"] } });
        expect(response.body.balancer.nodes[1]).toMatchObject({ id: "air", state: "disabled", enabled: false });
        vi.unstubAllGlobals();
      });

      it("giu nguyen phan con lai khi chi doi cach chia viec, va noi that vong khi worker khong tra loi", async () => {
        workerWith(both);
        const { db, store } = dbWithSettings(JSON.stringify({ mode: null, disabled: ["air"] }));
        const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, db as never);
        const response = await request(app).put("/v1/balancer").set("Authorization", "Bearer test").send({ mode: "parallel" });
        expect(response.status).toBe(200);
        expect(JSON.parse(store.uploads[0]!)).toEqual({ mode: "parallel", disabled: ["air"] }); // the machine stays off
        expect(response.body.applied).toBe(false); // saved; the worker picks it up within ten seconds
        vi.unstubAllGlobals();
      });

      it("khong cho tat het cac may, khong nhan may la, va noi ro khi chua co may phu", async () => {
        workerWith(both);
        const { db, store } = dbWithSettings();
        const app = createApp({ ...config, RENDER_WORKER_ENABLED: true }, db as never);
        const put = (body: unknown) => request(app).put("/v1/balancer").set("Authorization", "Bearer test").send(body as object);
        const all = await put({ disabled: ["mini", "air"] });
        expect(all.status).toBe(400);
        expect(all.body.error).toMatch(/ít nhất một máy/);
        const ghost = await put({ disabled: ["ghost"] });
        expect(ghost.status).toBe(400);
        expect(ghost.body.error).toMatch(/ghost/);
        expect((await put({ mode: "turbo" })).status).toBe(400);
        expect(store.uploads).toEqual([]); // nothing was saved by any of those
        vi.unstubAllGlobals();
        workerWith([]);
        const alone = await request(createApp({ ...config, RENDER_WORKER_ENABLED: true }, dbWithSettings().db as never)).put("/v1/balancer").set("Authorization", "Bearer test").send({ disabled: ["air"] });
        expect(alone.status).toBe(409);
        vi.unstubAllGlobals();
      });

      it("can dang nhap", async () => {
        const { db } = dbWithSettings();
        expect((await request(createApp(config, db as never)).put("/v1/balancer").send({ disabled: [] })).status).toBe(401);
      });
    });

    describe("dong bo ngay", () => {
      const both = [node("mini", "primary"), node("air", "secondary")];
      const stub = (syncReply: Response | "throws") => vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("/sync/now")) {
          expect(init?.method).toBe("POST");
          if (syncReply === "throws") throw new Error("down");
          return syncReply;
        }
        return new Response(JSON.stringify({ ok: true, services: { worker: { state: "healthy", detail: "Worker đang chạy" } }, balancer: { mode: "auto", nodes: both, decisions: [] } }));
      }));
      const appFor = () => createApp({ ...config, RENDER_WORKER_ENABLED: true }, owner as never);

      it("chuyen yeu cau cho worker va tra loi ok", async () => {
        stub(new Response(JSON.stringify({ ok: true })));
        const response = await request(appFor()).post("/v1/sync/air").set("Authorization", "Bearer test");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/sync/now?node=air"))).toBe(true);
        vi.unstubAllGlobals();
      });

      it("noi ro khi may chua nhan duoc, khi worker khong tra loi, khi la may chinh hoac may la", async () => {
        stub(new Response("{}", { status: 502 }));
        const post = (name: string) => request(appFor()).post(`/v1/sync/${name}`).set("Authorization", "Bearer test");
        expect((await post("air")).status).toBe(502);
        expect((await post("air")).body.error).toMatch(/chưa cài tiến trình đồng bộ/);
        vi.unstubAllGlobals();
        stub("throws");
        expect((await post("air")).body.error).toMatch(/Không liên lạc được worker/);
        expect((await post("mini")).status).toBe(400);
        expect((await post("ghost")).status).toBe(404);
        expect((await post("BAD NAME")).status).toBe(400);
        vi.unstubAllGlobals();
      });

      it("can dang nhap", async () => {
        stub(new Response("{}"));
        expect((await request(appFor()).post("/v1/sync/air")).status).toBe(401);
        vi.unstubAllGlobals();
      });
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

  it("answers a refused origin, unreadable JSON and an oversized body with JSON 4xx, never a bare 500", async () => {
    const app = createApp(config, {} as never);
    const refused = await request(app).options("/v1/projects").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(refused.status).toBe(403);
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
    expect(refused.body.error).toMatch(/không được phép/);
    const broken = await request(app).post("/v1/videos").set("Authorization", "Bearer x").set("Content-Type", "application/json").send("{bad");
    expect(broken.status).toBe(400);
    expect(broken.body.error).toMatch(/không đọc được/);
    const huge = await request(app).post("/v1/videos").set("Content-Type", "application/json").send(JSON.stringify({ sourceText: "a".repeat(1_200_000) }));
    expect(huge.status).toBe(413);
    expect(huge.body.error).toMatch(/quá lớn/);
    expect(JSON.stringify([refused.body, broken.body, huge.body])).not.toMatch(/stack|at .*\.ts|node_modules/);
  });

  it("answers an id that is not a UUID with 404 (was a 500 from the database)", async () => {
    const owner = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "owner@example.com" } }, error: null })) },
      from: () => {
        const query = { select: () => query, eq: () => query, gte: () => query, maybeSingle: async () => ({ data: { user_id: "user-1", is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 }, error: null }) };
        return query;
      },
    };
    const app = createApp(config, owner as never);
    for (const path of ["/v1/projects/not-a-uuid", "/v1/projects/not-a-uuid/result", "/v1/exports/12345/download"]) {
      const response = await request(app).get(path).set("Authorization", "Bearer test");
      expect(response.status, path).toBe(404);
      expect(response.body.error).toMatch(/Không tìm thấy/);
    }
    const scene = await request(app).delete("/v1/projects/00000000-0000-4000-8000-000000000001/scenes/x/annotation").set("Authorization", "Bearer test");
    expect(scene.status).toBe(404);
    expect(scene.body.error).toMatch(/Không tìm thấy/);
  });

  describe("huy tac vu", () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const row = (status: string) => ({ id: jobId, project_id: "22222222-2222-4222-8222-222222222222", user_id: "user-1", job_type: "create_video", status, progress: 40, stage: "Đang tạo ảnh", attempts: 1, max_attempts: 3, payload: {}, created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z", error_message: null, finished_at: null });
    const make = (job: ReturnType<typeof row> | null) => {
      const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
      const db = {
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "o@example.com" } }, error: null })) },
        from: (table: string) => {
          let values: Record<string, unknown> | null = null;
          const query: Record<string, unknown> = {
            select: () => query, eq: () => query, in: () => query, gte: () => query,
            update: (v: Record<string, unknown>) => { values = v; updates.push({ table, values: v }); return query; },
            maybeSingle: async () => table === "allowed_users"
              ? { data: { user_id: "user-1", is_active: true, daily_budget_usd: 3, max_concurrent_jobs: 1 }, error: null }
              : { data: values && job ? { ...job, ...values } : job, error: null },
            then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
          };
          return query;
        },
      };
      return { app: createApp(config, db as never), updates };
    };

    it("huy duoc tac vu dang chay va tra du an ve ban nhap", async () => {
      const { app, updates } = make(row("running"));
      const response = await request(app).post(`/v1/jobs/${jobId}/cancel`).set("Authorization", "Bearer t");
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("cancelled");
      expect(updates.find((item) => item.table === "jobs")?.values).toMatchObject({ status: "cancelled" });
      expect(updates.find((item) => item.table === "projects")?.values).toEqual({ status: "draft" });
    });

    it("khong huy tac vu da ket thuc va khong ton tai", async () => {
      const done = await request(make(row("completed")).app).post(`/v1/jobs/${jobId}/cancel`).set("Authorization", "Bearer t");
      expect(done.status).toBe(409);
      const none = await request(make(null).app).post(`/v1/jobs/${jobId}/cancel`).set("Authorization", "Bearer t");
      expect(none.status).toBe(404);
      const anonymous = await request(make(row("running")).app).post(`/v1/jobs/${jobId}/cancel`);
      expect(anonymous.status).toBe(401);
    });
  });
});
