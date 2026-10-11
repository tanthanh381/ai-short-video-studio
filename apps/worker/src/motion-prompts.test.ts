import { describe, expect, it } from "vitest";
import { sceneMotionPrompt } from "./motion-prompts";

describe("scene motion prompts", () => {
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
});
