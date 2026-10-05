import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, type Project } from "@studio/shared";
import { estimateCost } from "./app";

const project = {
  sourceText: "abcd",
  settings: DEFAULT_PROJECT_SETTINGS,
  scenes: [],
} as unknown as Project;

describe("cost estimate narration accounting", () => {
  it("counts source text once before storyboarding", () => {
    expect(estimateCost(project).narrationCharacters).toBe(4);
  });
  it("counts actual scene narration instead of adding the original again", () => {
    const storyboard = { ...project, scenes: [{ narration: "ab" }, { narration: "cd" }] } as Project;
    expect(estimateCost(storyboard).narrationCharacters).toBe(4);
  });
  it("reports zero provider API charge for local media, not total ownership cost", () => {
    expect(estimateCost(project, true).estimatedUsd).toBe(0);
  });
});
