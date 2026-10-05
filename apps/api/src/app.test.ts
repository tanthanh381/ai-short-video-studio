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
  });
});
