// Explicitly invoked production QC. Creates one temporary Auth-only test user,
// never grants it studio access, then removes exactly that generated user.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries((await readFile(new URL("../.env.selfhost", import.meta.url), "utf8"))
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
  }));
const url = process.argv[2] ?? "https://air.tail743b7a.ts.net";
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = await fetch(`${url}/v1/videos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceText: "Kịch bản kiểm thử quyền truy cập." }) });
if (anon.status !== 401) throw new Error(`Anonymous access: expected 401, got ${anon.status}`);
console.log("PASS anonymous: public backend rejects video creation (401)");
let generatedUserId;
try {
  const email = `qc-denied-${randomUUID()}@example.com`;
  const password = randomUUID() + randomUUID();
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { temporary_qc: true } });
  if (created.error) throw new Error("Cannot create temporary QC Auth account");
  generatedUserId = created.data.user.id;
  const session = await db.auth.signInWithPassword({ email, password });
  if (session.error) throw new Error("Cannot sign in temporary QC Auth account");
  const denied = await fetch(`${url}/v1/videos`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.data.session.access_token}` }, body: JSON.stringify({ sourceText: "Kịch bản kiểm thử quyền truy cập." }) });
  if (denied.status !== 403) throw new Error(`Unapproved account: expected 403, got ${denied.status}`);
  console.log("PASS signed-in unapproved account: public backend rejects video creation (403)");
} finally {
  if (generatedUserId) {
    const removed = await db.auth.admin.deleteUser(generatedUserId);
    if (removed.error) throw new Error("Temporary QC account cleanup failed");
    console.log("Temporary QC Auth account removed; existing accounts unchanged");
  }
}
