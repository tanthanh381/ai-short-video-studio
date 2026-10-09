import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

vi.mock("./config", () => ({ appConfig: { apiUrl: "https://api.example", demoMode: false } }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-session" } } }) } } }));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Video API integration", () => {
  it("retries an interrupted submission with the same idempotency key and unwraps the project", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network disconnected"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: "project-1" }, job: { id: "job-1" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    const input = { sourceText: "Lời đọc giữ nguyên cho video kiểm thử." };
    await expect(api.createVideo(input)).rejects.toThrow("kiểm tra máy xử lý đang bật");
    await expect(api.createVideo(input)).resolves.toMatchObject({ id: "project-1" });
    const first = fetcher.mock.calls[0]?.[1] as RequestInit;
    const retry = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(first.headers).get("idempotency-key")).toBe(new Headers(retry.headers).get("idempotency-key"));
    expect(new Headers(retry.headers).get("authorization")).toBe("Bearer test-session");
    expect(JSON.parse(retry.body as string).sourceText).toBe(input.sourceText);
  });

  it("fills settings an older API did not return, so the editor never reads undefined", async () => {
    const legacy = { id: "project-1", settings: { voice: "linh", aspectRatio: "9:16" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(legacy))));
    const project = await api.getProject("project-1");
    expect(project.settings.voice).toBe("linh");
    expect(project.settings.voiceSpeed).toBe(1);
    expect(project.settings.layoutTemplate).toBe("full-bleed");
    expect(project.settings.autoMusic).toBe(false);
  });

  it("unwraps the resumed job and signs a real export preview", async () => {
    const exported = { id: "export-1", videoUrl: "https://media.example/video.mp4", downloadUrl: "https://media.example/download.mp4", thumbnailUrl: "https://media.example/thumb.jpg", durationMs: 7000, width: 1080, height: 1920, createdAt: "2026-10-04T10:00:00Z" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: "project-1" }, job: { id: "job-1", status: "queued" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: exported, expiresIn: 300 })));
    vi.stubGlobal("fetch", fetcher);
    await expect(api.continueVideo("project-1")).resolves.toEqual({ id: "job-1", status: "queued" });
    await expect(api.getResult("project-1")).resolves.toMatchObject({ id: "export-1", url: exported.videoUrl, durationMs: 7000 });
  });

  it("returns no video when rendering has not produced an export", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ export: null, expiresIn: 300 }))));
    await expect(api.getResult("project-1")).resolves.toBeNull();
  });

  it("returns an actionable message when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.listProjects()).rejects.toThrow("kiểm tra máy xử lý đang bật");
  });

  it("keeps motion video items available in the media library response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: "scene-1:video", kind: "video", projectTitle: "Kiểm thử", url: "https://media.example/scene.mp4" },
    ]))));
    await expect(api.listMedia()).resolves.toEqual([
      { id: "scene-1:video", kind: "video", projectTitle: "Kiểm thử", url: "https://media.example/scene.mp4" },
    ]);
  });
});
