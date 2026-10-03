import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "./config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("worker config", () => {
  it("cho phep chay khi khoa AI dang de trong", () => {
    process.env = {
      ...original,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_example",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    };

    const config = getConfig();
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
