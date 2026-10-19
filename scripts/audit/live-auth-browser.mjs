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
 *   STUDIO_QA_GENERATE=1  continue into the new-video flow without submitting.
 *   STUDIO_QA_SUBMIT=1    submit exactly one short QA video and wait for its MP4.
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
    if (new URL(response.url()).pathname === "/auth/v1/token" && response.status() >= 400) {
      void response.json().then((body) => {
        // Keep only Supabase's diagnostic fields; never retain tokens or the submitted email/password.
        const safe = body && typeof body === "object" ? body : {};
        const code = typeof safe.error_code === "string" ? safe.error_code : typeof safe.code === "string" ? safe.code : undefined;
        const message = typeof safe.msg === "string" ? safe.msg : typeof safe.error_description === "string" ? safe.error_description : typeof safe.error === "string" ? safe.error : undefined;
        result.authError = {
          status: response.status(),
          ...(code ? { code: code.slice(0, 80) } : {}),
          ...(message ? { message: message.slice(0, 160) } : {}),
        };
      }).catch(() => {
        result.authError = { status: response.status(), message: "Supabase returned a non-JSON auth error" };
      });
    }
  }
});

function check(name, passed, detail = undefined) {
  result.checks.push({ name, passed, ...(detail ? { detail } : {}) });
  assert.equal(passed, true, name);
}

async function waitUntilEnabled(locator, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${await locator.getAttribute("aria-label") || "button"} to become enabled`);
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
    check(
      "new-video-flow-visible",
      await page.getByRole("heading", { name: /Bạn muốn kể điều gì\?|Chọn mẫu video|Tạo video/i }).count() > 0,
    );
    if (process.env.STUDIO_QA_SUBMIT === "1") {
      await page.getByLabel("Ý tưởng hoặc chủ đề").fill("Một thói quen nhỏ giúp bạn bớt suy nghĩ quá nhiều mỗi ngày.");
      const continueTo = async (heading) => {
        const nextButton = page.getByRole("button", { name: "Tiếp tục", exact: true });
        await waitUntilEnabled(nextButton);
        await nextButton.click();
        await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 120_000 });
      };
      await continueTo("Chọn mẫu video");
      const templateOptions = page.getByRole("radio");
      await waitUntilEnabled(templateOptions.first());
      await templateOptions.first().click();
      await continueTo("AI Models");
      await continueTo("Giọng đọc & nhạc nền");
      await continueTo("Logo & bố cục");
      await continueTo("Xem lại & tạo video");
      await page.getByRole("button", { name: "Tạo video hoàn chỉnh", exact: true }).click();
      await page.waitForURL((url) => /\/studio\//.test(url.pathname), { timeout: 30_000 });
      await page.getByRole("button", { name: "Tải MP4", exact: true }).waitFor({ timeout: 25 * 60_000 });
      check("one-video-render-and-download-ready", true, `path=${new URL(page.url()).pathname}`);
    }
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
