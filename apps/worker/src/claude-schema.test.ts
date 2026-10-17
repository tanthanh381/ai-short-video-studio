import { describe, expect, it } from "vitest";
import { claudeStructuredSchema } from "./anthropic";
import { lockedVisualStoryboardJsonSchema, storyboardJsonSchema } from "./providers";

/** Claude's structured output 400s on validation keywords; the sanitizer must remove them but keep the shape. */
function keysDeep(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, found));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { found.add(key); keysDeep(child, found); }
  return found;
}

describe("claudeStructuredSchema", () => {
  it("strips keywords Claude rejects but keeps type/properties/required/additionalProperties", () => {
    const cleaned = claudeStructuredSchema(storyboardJsonSchema);
    const keys = keysDeep(cleaned);
    for (const banned of ["minItems", "maxItems", "minimum", "maximum"]) expect(keys.has(banned)).toBe(false);
    for (const kept of ["type", "properties", "required", "additionalProperties"]) expect(keys.has(kept)).toBe(true);
    // the scene fields survive
    expect((cleaned as { properties: { scenes: { items: { properties: Record<string, unknown> } } } }).properties.scenes.items.properties).toHaveProperty("estimatedDurationMs");
  });

  it("removes the locked-scene array bounds", () => {
    const keys = keysDeep(claudeStructuredSchema(lockedVisualStoryboardJsonSchema(5)));
    expect(keys.has("minItems")).toBe(false);
    expect(keys.has("maxItems")).toBe(false);
  });

  it("does not mutate the original schema", () => {
    claudeStructuredSchema(storyboardJsonSchema);
    expect((storyboardJsonSchema as { properties: { scenes: Record<string, unknown> } }).properties.scenes).toHaveProperty("maxItems");
  });
});
