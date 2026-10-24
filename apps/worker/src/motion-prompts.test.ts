import { describe, expect, it } from "vitest";
import { sceneMotionPrompt } from "./motion-prompts";

describe("scene motion prompts", () => {
  it("keeps the ancient-wisdom preset grounded in everyday character movement", () => {
    const prompt = sceneMotionPrompt("chibi-co-phong", 0, "Cậu bé khẽ nâng chén trà rồi nhìn ra xa.");
    expect(prompt).toContain("everyday gesture");
    expect(prompt).toContain("mentioned object");
    expect(prompt).toContain("Preserve the same face");
  });

  it("cycles distinct micro-motions for the existing chibi preset", () => {
    const prompts = [0, 1, 2, 3, 4].map((index) => sceneMotionPrompt("chibi-co-phong", index));
    expect(new Set(prompts).size).toBe(5);
    expect(prompts[0]).toContain("blinks once");
    expect(prompts[1]).toContain("hair strands");
    expect(prompts[2]).toContain("smoke");
    expect(prompts[3]).toContain("flower petals");
  });

  it("uses a style-specific cue for each new visual genre", () => {
    expect(sceneMotionPrompt("chibi-huyen-bi", 0)).toContain("lantern flame flickers");
    expect(sceneMotionPrompt("paper-storybook", 0)).toContain("foreground paper layer shifts");
    expect(sceneMotionPrompt("chibi-dong-vat-co-phong", 0)).toContain("ears or tail");
    expect(sceneMotionPrompt("thuy-mac-co-phong", 0)).toContain("ink-wash mist");
  });

  it("locks the camera for chibi presets so the character moves, not the frame", () => {
    const chibi = sceneMotionPrompt("chibi-co-phong", 0, "Cậu bé khẽ nâng chén trà.");
    expect(chibi).toContain("camera locked");
    expect(chibi).not.toContain("camera push-in"); // chibi's line only mentions push-in to forbid it
    // non-chibi presets keep the cinematic camera move
    expect(sceneMotionPrompt("cinematic-color", 0)).toContain("camera push-in");
  });

  it("grounds motion in the narrated action instead of inventing a generic gesture", () => {
    expect(sceneMotionPrompt("cinematic-color", 0, "Cô mở cánh cổng cũ.")).toContain("mentioned door, gate or key");
    expect(sceneMotionPrompt("cinematic-color", 1, "Anh nâng chiếc điện thoại lên.")).toContain("mentioned object");
    expect(sceneMotionPrompt("cinematic-color", 2, "Ngoài trời mưa rất lớn.")).toContain("mentioned atmosphere or light");
  });
});
