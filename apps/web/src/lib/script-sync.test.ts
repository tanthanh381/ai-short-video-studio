import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, type Project, type Scene } from "@studio/shared";
import { withScriptFromScenes } from "./script-sync";

const scene = (n: number, narration: string): Scene => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, order: n - 1, narration, imagePrompt: "x", estimatedDurationMs: 3000, actualDurationMs: null,
  imagePath: null, videoPath: null, audioPath: null, thumbnailUrl: null, mediaStatus: "pending", errorMessage: null, annotationJson: null, subtitles: [],
});
const project = (scenes: Scene[], sourceText = "Ý tưởng ban đầu của tôi"): Project => ({
  id: "p", userId: "u", title: "t", sourceText, inputMode: "idea", hook: "", suggestedTitle: "", suggestedDescription: "", status: "draft",
  settings: DEFAULT_PROJECT_SETTINGS, scenes, createdAt: "", updatedAt: "",
}) as Project;

describe("withScriptFromScenes", () => {
  it("makes the script the scenes' narration, one scene a line, and reads it as written from then on", () => {
    const next = withScriptFromScenes(project([scene(1, "Câu một."), scene(2, " Câu hai. ")]));
    expect(next.sourceText).toBe("Câu một.\nCâu hai.");
    expect(next.inputMode).toBe("full-script");
  });
  it("keeps the previous script when too little is left (every scene deleted)", () => {
    const base = project([], "Kịch bản cũ còn giữ");
    expect(withScriptFromScenes(base)).toBe(base);
    expect(withScriptFromScenes(project([scene(1, "Ngắn")], "Kịch bản cũ còn giữ")).sourceText).toBe("Kịch bản cũ còn giữ");
  });
  it("returns the same object when nothing changed", () => {
    const base = project([scene(1, "Câu một.")], "Câu một.");
    expect(withScriptFromScenes(base)).toBe(base);
  });
});
