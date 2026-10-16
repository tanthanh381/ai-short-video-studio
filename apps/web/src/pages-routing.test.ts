import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATIC_ROUTES } from "../vite.config";

describe("GitHub Pages routing", () => {
  it("co trang 404 chuyen URL con ve SPA", () => {
    const html = readFileSync(
      new URL("../public/404.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain("ai-short-video-studio");
    expect(html).toContain("sessionStorage");
  });

  it("every fixed page of the app has its own copy on Pages (answers 200, not the 404 redirect)", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const declared = [...app.matchAll(/path="\/?([a-z-]+)"/gu)].map((match) => match[1]!).filter((route) => route !== "*");
    expect(declared.length).toBeGreaterThan(8);
    expect([...STATIC_ROUTES].sort()).toEqual([...new Set(declared)].sort());
  });
});
