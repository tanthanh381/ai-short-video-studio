import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import type { AppConfig } from "./config";

const config: AppConfig = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-secret-key-long",
  ALLOWED_ORIGINS: "http://localhost:5173",
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
});
