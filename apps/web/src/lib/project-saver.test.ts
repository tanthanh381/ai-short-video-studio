import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, type Project, type Scene } from "@studio/shared";
import { ProjectSaver, isStaleSave, type SaveState } from "./project-saver";
import { rebaseEdits } from "./project-merge";

const scene = (n: number, over: Partial<Scene> = {}): Scene => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, order: n - 1, narration: `Lời đọc ${n}`, imagePrompt: `ảnh ${n}`, estimatedDurationMs: 3000,
  actualDurationMs: 3000, imagePath: `img${n}`, videoPath: null, audioPath: `aud${n}`, thumbnailUrl: null, mediaStatus: "ready", errorMessage: null,
  annotationJson: null, subtitles: [], ...over,
});
const project = (over: Partial<Project> = {}): Project => ({
  id: "p1", userId: "u1", title: "Video", sourceText: "Lời đọc 1\nLời đọc 2", inputMode: "full-script", hook: "", suggestedTitle: "",
  suggestedDescription: "", status: "completed", settings: DEFAULT_PROJECT_SETTINGS, scenes: [scene(1), scene(2)],
  createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T01:00:00.000Z", ...over,
}) as Project;

describe("rebaseEdits", () => {
  it("keeps the person's narration and takes the server's newer media and status", () => {
    const base = project();
    const local = project({ status: "draft", scenes: [scene(1, { narration: "Lời mới", audioPath: null, subtitles: [], mediaStatus: "pending" }), scene(2)] });
    const latest = project({ status: "completed", updatedAt: "2026-10-15T02:00:00.000Z", scenes: [scene(1, { imagePath: "img1-v2" }), scene(2, { audioPath: "aud2-v2" })] });
    const merged = rebaseEdits(base, local, latest);
    expect(merged.updatedAt).toBe("2026-10-15T02:00:00.000Z");
    expect(merged.scenes[0]).toMatchObject({ narration: "Lời mới", audioPath: null, mediaStatus: "pending", imagePath: "img1-v2" });
    expect(merged.scenes[1]).toMatchObject({ narration: "Lời đọc 2", audioPath: "aud2-v2" });
    expect(merged.status).toBe("draft"); // the edit made it a draft again
  });

  it("takes only the server's fields for what the person did not touch, and carries setting changes", () => {
    const base = project();
    const local = project({ settings: { ...DEFAULT_PROJECT_SETTINGS, progressBar: true } });
    const latest = project({ updatedAt: "2026-10-15T03:00:00.000Z", title: "Tiêu đề do máy đặt", settings: { ...DEFAULT_PROJECT_SETTINGS, logoPath: "u/p/logo" } });
    const merged = rebaseEdits(base, local, latest);
    expect(merged.title).toBe("Tiêu đề do máy đặt");
    expect(merged.settings).toMatchObject({ progressBar: true, logoPath: "u/p/logo" });
  });

  it("keeps scenes added, deleted and reordered here, and merges the ones that remain", () => {
    const base = project();
    const added = scene(3);
    const local = project({ scenes: [scene(2, { order: 0 }), added] });
    const latest = project({ updatedAt: "2026-10-15T04:00:00.000Z", scenes: [scene(1), scene(2, { imagePath: "img2-v2" })] });
    const merged = rebaseEdits(base, local, latest);
    expect(merged.scenes.map((s) => s.id)).toEqual([scene(2).id, added.id]);
    expect(merged.scenes[0]).toMatchObject({ order: 0, imagePath: "img2-v2" });
  });

  it("adopts scenes the server created when the person edited no scene structure", () => {
    const base = project({ scenes: [] });
    const local = project({ scenes: [], title: "Tên tôi đặt" });
    const latest = project({ updatedAt: "2026-10-15T05:00:00.000Z", scenes: [scene(1), scene(2)] });
    const merged = rebaseEdits(base, local, latest);
    expect(merged.title).toBe("Tên tôi đặt");
    expect(merged.scenes).toHaveLength(2);
  });
});

function harness(serverStart = project()) {
  let server = serverStart;
  const states: SaveState[] = [];
  const saved: Project[] = [];
  let version = 0;
  const calls: string[] = [];
  const saver = new ProjectSaver({
    async save(next) {
      calls.push(next.updatedAt);
      if (next.updatedAt !== server.updatedAt) throw Object.assign(new Error("Dự án đã được cập nhật. Vui lòng tải lại trước khi chỉnh sửa."), { status: 409 });
      server = { ...next, updatedAt: `2026-10-15T09:00:0${++version}.000Z` };
      return server;
    },
    async load() { return server; },
    onSaved: (p) => saved.push(p),
    onState: (s) => states.push(s),
  });
  saver.confirm(server);
  return { saver, states, saved, calls, serverNow: () => server, touchServer: (over: Partial<Project>) => { server = { ...server, ...over, updatedAt: "2026-10-15T08:00:00.000Z" }; } };
}

describe("ProjectSaver", () => {
  it("recognises a stale save by status and message", () => {
    expect(isStaleSave(Object.assign(new Error("Dự án đã được cập nhật. Vui lòng tải lại"), { status: 409 }))).toBe(true);
    expect(isStaleSave(Object.assign(new Error("Video đang xử lý"), { status: 409 }))).toBe(false);
    expect(isStaleSave(new Error("Dự án đã được cập nhật"))).toBe(false);
  });

  it("saves edits made while an earlier save is still in flight, each on the newest stamp", async () => {
    const h = harness();
    const first = project({ title: "A" });
    h.saver.edit(first);
    const flushing = h.saver.flush();
    h.saver.edit(project({ title: "AB" })); // typed during the first save, built on the old updatedAt
    await flushing;
    await h.saver.flush();
    expect(h.serverNow().title).toBe("AB");
    expect(h.states.at(-1)).toEqual({ status: "saved" });
  });

  it("carries an edit over a server-side change instead of failing as stale", async () => {
    const h = harness();
    h.touchServer({ status: "completed", scenes: [scene(1, { imagePath: "img1-v2" }), scene(2)] }); // a job finished after the page loaded
    h.saver.edit(project({ status: "draft", scenes: [scene(1, { narration: "Sửa tay", audioPath: null }), scene(2)] }));
    await h.saver.flush();
    expect(h.serverNow().scenes[0]).toMatchObject({ narration: "Sửa tay", audioPath: null, imagePath: "img1-v2" });
    expect(h.calls.length).toBe(2); // refused once, rebased, accepted
  });

  it("keeps the edit queued and reports the error when the save cannot succeed", async () => {
    const states: SaveState[] = [];
    const saver = new ProjectSaver({ save: async () => { throw new Error("Mất kết nối"); }, load: async () => project(), onSaved: () => {}, onState: (s) => states.push(s) });
    saver.confirm(project());
    saver.edit(project({ title: "X" }));
    await expect(saver.flush()).rejects.toThrow("Mất kết nối");
    expect(states.at(-1)).toEqual({ status: "error", message: "Mất kết nối" });
    expect(saver.hasPending).toBe(true);
  });
});
