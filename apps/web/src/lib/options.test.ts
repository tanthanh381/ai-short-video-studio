import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "@studio/shared";
import { hookTitleAllowed, isOpenAiVoice, withMediaProvider } from "./options";

describe("withMediaProvider", () => {
  it("gives OpenAI a voice it knows and the local bridge a preset it knows", () => {
    const local = { ...DEFAULT_PROJECT_SETTINGS, mediaProvider: "local" as const, voice: "doc-truyen" };
    const openai = withMediaProvider(local, "openai");
    expect(openai).toMatchObject({ mediaProvider: "openai", voice: "alloy" });
    expect(isOpenAiVoice(openai.voice)).toBe(true);
    expect(withMediaProvider({ ...openai, voice: "onyx" }, "openai").voice).toBe("onyx"); // a valid voice stays
    expect(withMediaProvider(openai, "local")).toMatchObject({ mediaProvider: "local", voice: "doc-truyen" });
    expect(withMediaProvider({ ...openai, voice: "tam-su" }, "local").voice).toBe("tam-su");
  });
  it("allows the big opening title everywhere but the story card", () => {
    expect(hookTitleAllowed({ layoutTemplate: "full-bleed" })).toBe(true);
    expect(hookTitleAllowed({ layoutTemplate: "story-card" })).toBe(false);
  });
});
