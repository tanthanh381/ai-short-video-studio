import { describe, expect, it } from "vitest";
import { finalizeImageAudit } from "./anthropic";

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
