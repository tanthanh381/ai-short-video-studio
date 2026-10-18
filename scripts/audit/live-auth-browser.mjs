/**
 * Authenticated live smoke test.
 *
 * This file intentionally never prints, screenshots, or uploads credentials.
 * It is opt-in because a full video generation spends local AI/worker capacity.
 *
 * Required environment:
 *   STUDIO_LIVE_URL       public Studio URL (for example GitHub Pages)
 *   STUDIO_QA_EMAIL       QA account email
 *   STUDIO_QA_PASSWORD    QA account password
 *
 * Optional:
 *   STUDIO_QA_GENERATE=1  continue into the new-video flow; does not submit a
 *                         generation job unless explicitly extended below.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.STUDIO_LIVE_URL?.trim();
const email = process.env.STUDIO_QA_EMAIL?.trim();
const password = process.env.STUDIO_QA_PASSWORD;

for (const [name, value] of [["STUDIO_LIVE_URL", baseUrl], ["STUDIO_QA_EMAIL", email], ["STUDIO_QA_PASSWORD", password]]) {
  if (!value) throw new Error(`${name} is required; credentials are never printed or stored`);
}

const result = { scope: "authenticated live smoke", checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (error) => result.errors.push(`pageerror: ${error.message}`));
page.on("response", (response) => {
  if (response.url().includes("/auth/v1/")) {
    result.authResponses ??= [];
    result.authResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  }
});

function check(name, passed, detail = undefined) {
  result.checks.push({ name, passed, ...(detail ? { detail } : {}) });
  assert.equal(passed, true, name);
}

try {
  const root = new URL(baseUrl);
  root.hash = "";
  root.search = "";
  await page.goto(new URL("login", root).toString(), { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
  // Give the browser storage adapter a moment to flush the Supabase session;
  // the following hard navigation intentionally verifies persistence.
  await page.waitForTimeout(1_000);
  const postLoginStorage = await page.evaluate(() => ({
    local: Object.keys(localStorage).filter((key) => key.startsWith("sb-")).length,
    localKeys: Object.keys(localStorage),
    session: Object.keys(sessionStorage).length,
  }));
  check(
    "session-persisted-before-reload",
    postLoginStorage.local > 0,
    `authStorage=${postLoginStorage.local}; sessionStorage=${postLoginStorage.session}; keys=${postLoginStorage.localKeys.join(",") || "none"}`,
  );
  check("email-login-redirects-to-app", true);

  const protectedRoutes = ["", "new", "library", "settings", "system"];
  for (const route of protectedRoutes) {
    await page.goto(new URL(route, root).toString(), { waitUntil: "networkidle", timeout: 30_000 });
    const currentUrl = new URL(page.url());
    const storageKeys = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((key) => key.startsWith("sb-")).length,
      session: Object.keys(sessionStorage).length,
    }));
    check(
      `protected-route:${route || "home"}`,
      !currentUrl.pathname.endsWith("/login"),
      `path=${currentUrl.pathname}; authStorage=${storageKeys.local}; sessionStorage=${storageKeys.session}`,
    );
  }

  if (process.env.STUDIO_QA_GENERATE === "1") {
    await page.goto(new URL("new", root).toString(), { waitUntil: "networkidle", timeout: 30_000 });
    check("new-video-flow-visible", await page.getByRole("heading", { name: /Tạo video/i }).count() > 0);
    // Deliberately stop before submission. Generation requires an explicit,
    // separately reviewed test case so a CI smoke run cannot create jobs by accident.
  }

  check("no-browser-page-errors", result.errors.length === 0);
  console.log(JSON.stringify({ ...result, credentialValuesOmitted: true }, null, 2));
} catch (error) {
  result.errors.push(error instanceof Error ? error.message : String(error));
  console.log(JSON.stringify({ ...result, credentialValuesOmitted: true }, null, 2));
  process.exitCode = 1;
} finally {
  await mkdir("audit-artifacts", { recursive: true });
  await writeFile("audit-artifacts/live-auth-browser.json", JSON.stringify({ ...result, credentialValuesOmitted: true }, null, 2));
  await browser.close();
}
