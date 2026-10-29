import { describe, expect, it } from "vitest";
import { finalizeImageAudit, finalizeProductionPlan } from "./anthropic";

describe("finalizeImageAudit (Claude vision QA → ImageQualityAudit)", () => {
  it("parses a clean JSON verdict", () => {
    const audit = finalizeImageAudit('{"relevant":true,"anatomy":"good","textArtifacts":"none","identity":"same","props":["tea cup"],"reason":"ok"}');
    expect(audit).toMatchObject({ relevant: true, anatomy: "good", textArtifacts: "none", identity: "same", props: ["tea cup"] });
  });

  it("tolerates markdown fences and reasoning around the JSON", () => {
    const audit = finalizeImageAudit('<think>looking…</think>\n```json\n{"relevant":false,"anatomy":"good","textArtifacts":"bad","identity":"same","props":[],"reason":"calligraphy"}\n```');
    expect(audit).toMatchObject({ relevant: false, textArtifacts: "bad", props: [] });
  });

  it("drops wardrobe/body items from props (only real props matter to the gate)", () => {
    const audit = finalizeImageAudit('{"relevant":true,"anatomy":"good","textArtifacts":"none","identity":"same","props":["robe","hair","tea pot"],"reason":"x"}');
    expect(audit?.props).toEqual(["tea pot"]);
  });

  it("defaults a missing identity to unknown", () => {
    const audit = finalizeImageAudit('{"relevant":true,"anatomy":"good","textArtifacts":"none","props":[],"reason":"x"}');
    expect(audit?.identity).toBe("unknown");
  });

  it("returns null (fail-open) on malformed / empty / wrong-enum output", () => {
    expect(finalizeImageAudit("not json")).toBeNull();
    expect(finalizeImageAudit("")).toBeNull();
    expect(finalizeImageAudit('{"relevant":true,"anatomy":"terrible","textArtifacts":"none","props":[],"reason":"x"}')).toBeNull();
  });
});

describe("finalizeProductionPlan (Claude Director plan → ProductionPlan)", () => {
  const good = JSON.stringify({
    platform: "tiktok",
    hook: { text: "Bạn có biết?", visual: "close up" },
    pacing: "fast",
    cta: "Theo dõi",
    motionScenes: [0],
    scenes: [{ narration: "Mở đầu.", imagePrompt: "a boy" }, { narration: "Chốt.", imagePrompt: "a boy smiling" }],
  });

  it("parses a clean plan", () => {
    const plan = finalizeProductionPlan(good);
    expect(plan?.platform).toBe("tiktok");
    expect(plan?.scenes).toHaveLength(2);
    expect(plan?.motionScenes).toEqual([0]);
  });

  it("tolerates markdown fences and reasoning around the JSON", () => {
    const plan = finalizeProductionPlan("<think>planning…</think>\n```json\n" + good + "\n```");
    expect(plan?.scenes[0]?.narration).toBe("Mở đầu.");
  });

  it("applies schema defaults for omitted optional fields", () => {
    const plan = finalizeProductionPlan('{"scenes":[{"narration":"x","imagePrompt":"y"}]}');
    expect(plan).not.toBeNull();
    expect(plan?.pacing).toBe("medium");
    expect(plan?.motionScenes).toEqual([]);
    expect(plan?.platform).toBeNull();
  });

  it("returns null on malformed / empty / schema-invalid output", () => {
    expect(finalizeProductionPlan("not json")).toBeNull();
    expect(finalizeProductionPlan("")).toBeNull();
    expect(finalizeProductionPlan('{"scenes":[]}')).toBeNull(); // needs at least one scene
  });
});
