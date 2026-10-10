import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  authRedirectUrl,
  clearAuthCallbackParams,
  readAuthCallbackError,
  resetPasswordView,
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

describe("password reset page", () => {
  it("waits for the emailed link to sign the person in instead of bouncing to the login page", () => {
    // Before: loading + no user went to /login, the session then arrived, and the login page opened the dashboard.
    expect(resetPasswordView({ loading: true, user: null, isDemo: false })).toBe("wait");
    expect(resetPasswordView({ loading: false, user: { id: "u" }, isDemo: false })).toBe("form");
    expect(resetPasswordView({ loading: false, user: null, isDemo: false })).toBe("login"); // expired or missing link
    expect(resetPasswordView({ loading: false, user: { id: "u" }, isDemo: true })).toBe("login");
  });
});
