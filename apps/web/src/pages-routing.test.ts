import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GitHub Pages routing", () => {
  it("co trang 404 chuyen URL con ve SPA", () => {
    const html = readFileSync(
      new URL("../public/404.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain("ai-short-video-studio");
    expect(html).toContain("sessionStorage");
  });
});
