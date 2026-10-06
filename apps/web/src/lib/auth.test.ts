import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  authRedirectUrl,
  clearAuthCallbackParams,
  readAuthCallbackError,
} from "./auth";

describe("Google OAuth helpers", () => {
  it("builds a callback URL inside the GitHub Pages base path", () => {
    expect(authRedirectUrl("https://tanthanh381.github.io", "/ai-short-video-studio/")).toBe(
      "https://tanthanh381.github.io/ai-short-video-studio/",
    );
    expect(authRedirectUrl("http://localhost:5173", "/", "reset-password")).toBe(
      "http://localhost:5173/reset-password",
    );
  });

  it("translates provider and redirect errors into actionable Vietnamese messages", () => {
    expect(authErrorMessage("provider is not enabled")).toContain("chưa được bật");
    expect(authErrorMessage("redirect_uri_not_allowed")).toContain("Redirect URLs");
    expect(authErrorMessage("access_denied")).toContain("hủy đăng nhập");
  });

  it("reads callback errors from query or hash and removes OAuth parameters safely", () => {
    expect(readAuthCallbackError("?error=access_denied", "")).toContain("hủy đăng nhập");
    expect(readAuthCallbackError("", "#error_description=provider+is+not+enabled")).toContain(
      "chưa được bật",
    );
    expect(clearAuthCallbackParams("https://example.test/app/?code=abc&keep=1#error=oops&keep=2")).toBe(
      "/app/?keep=1#keep=2",
    );
  });
});
