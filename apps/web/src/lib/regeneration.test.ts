import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
vi.mock("./config", () => ({ appConfig: { apiUrl: "https://api.example", demoMode: false } }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-session" } } }) } } }));
afterEach(() => vi.unstubAllGlobals());
describe("selective regeneration client", () => {
 it.each(["all","image","audio","subtitles"] as const)("sends exactly %s", async component => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"job"}),{status:202}));vi.stubGlobal("fetch",fetcher);
  await api.regenerateScene("project","scene",component);
  const [url,init]=fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.example/v1/projects/project/jobs");
  expect(JSON.parse(init.body)).toEqual({type:"regenerate_scene",payload:{sceneId:"scene",component}});
 });
 it("defaults old client calls to all", async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"job"}),{status:202}));vi.stubGlobal("fetch",fetcher);
  await api.regenerateScene("project","scene");
  expect(JSON.parse(fetcher.mock.calls[0]![1].body).payload.component).toBe("all");
 });
});
