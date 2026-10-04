// Explicit production QC only. Each fixture uses a new project/storage prefix.
// Modes: create <source-project>, repair|verify|verify_scene1|cleanup <fixture>.
// Secrets are read locally and never written to fixture metadata or output.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kind = "partial_retry_v1";
const [mode, argument] = process.argv.slice(2);
if (!["create", "repair", "verify", "verify_scene1", "cleanup"].includes(mode) || !UUID.test(argument ?? ""))
  throw new Error("Usage: node local-tools/test_partial_retry.mjs create|repair|verify|verify_scene1|cleanup <project-uuid>");
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries((await readFile(new URL("../.env.selfhost", import.meta.url), "utf8"))
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
  }));
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Missing local backend configuration");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }) },
});
const bucket = db.storage.from("private-media");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function checked(result, operation) {
  if (result.error) throw new Error(`${operation} failed (${result.error.code ?? "request_error"})`);
  return result.data;
}
function assert(value, message) { if (!value) throw new Error(message); }
function safePath(path, prefix) {
  assert(typeof path === "string" && path.startsWith(prefix) && !path.includes(".."), "Refusing a path outside the QC fixture");
  return path;
}
async function jobs(projectId) {
  return checked(await db.from("jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }), "Load fixture jobs");
}
async function loadFixture(projectId) {
  const project = checked(await db.from("projects").select("*").eq("id", projectId).single(), "Load fixture project");
  const history = await jobs(projectId);
  const marker = history.find((job) => job.payload?.qc?.kind === kind);
  const qc = marker?.payload?.qc;
  assert(qc && UUID.test(qc.token) && UUID.test(qc.sourceProjectId) && qc.sourceProjectId !== projectId, "Not a tagged partial-retry QC fixture");
  assert(project.title === `[QC-PARTIAL-RETRY:${qc.token}]` && marker.user_id === project.user_id, "Fixture identity tag does not match");
  const prefix = `${project.user_id}/${project.id}/`;
  for (const path of qc.assetPaths ?? []) safePath(path, prefix);
  safePath(qc.repairedAudioPath, prefix);
  const scenes = checked(await db.from("scenes").select("*").eq("project_id", projectId).order("scene_order"), "Load fixture scenes");
  assert(scenes.length === 2 && scenes[0].id === qc.scene1.id && scenes[1].id === qc.scene2Id, "Fixture scenes were altered unexpectedly");
  return { project, history, marker, qc, prefix, scenes };
}
function assertScene1Unchanged(fixture) {
  const actual = fixture.scenes[0];
  const expected = fixture.qc.scene1;
  assert(actual.media_status === "ready" && actual.image_path === expected.imagePath
    && actual.audio_path === expected.audioPath && actual.actual_duration_ms === expected.durationMs
    && hash(actual.subtitles) === expected.captionsHash, "Successful scene 1 media or timing changed");
}
async function verifyScene1Binary(fixture) {
  for (const [index, path] of [fixture.qc.scene1.imagePath, fixture.qc.scene1.audioPath].entries()) {
    const data = checked(await bucket.download(safePath(path, fixture.prefix)), "Check successful scene 1 binary");
    const digest = createHash("sha256").update(new Uint8Array(await data.arrayBuffer())).digest("hex");
    assert(digest === fixture.qc.mediaHashes[index], "Successful scene 1 binary was changed during retry");
  }
}
async function copyObject(source, destination, contentType) {
  const data = checked(await bucket.download(source), "Download source media");
  const bytes = new Uint8Array(await data.arrayBuffer());
  checked(await bucket.upload(destination, bytes, { contentType, upsert: false }), "Copy QC media");
  return createHash("sha256").update(bytes).digest("hex");
}
async function createFixture(sourceId) {
  const source = checked(await db.from("projects").select("*").eq("id", sourceId).single(), "Load completed source project");
  assert(source.status === "completed" && source.settings?.textProvider === "ollama"
    && (source.settings.mediaProvider ?? "local") === "local", "Source must be a completed local video");
  const access = checked(await db.from("allowed_users").select("max_concurrent_jobs").eq("user_id", source.user_id).eq("is_active", true).single(), "Read existing account permission");
  const sourceScenes = checked(await db.from("scenes").select("*").eq("project_id", sourceId).order("scene_order"), "Load source scenes");
  assert(sourceScenes.length >= 2 && sourceScenes.slice(0, 2).every((scene) => scene.media_status === "ready"
    && scene.image_path && scene.audio_path && scene.actual_duration_ms && scene.subtitles?.length), "Source needs two real aligned ready scenes");
  const token = randomUUID();
  const projectId = randomUUID();
  const prefix = `${source.user_id}/${projectId}/`;
  const title = `[QC-PARTIAL-RETRY:${token}]`;
  const selected = sourceScenes.slice(0, 2);
  const settings = { ...source.settings, textProvider: "ollama", mediaProvider: "local" };
  const fixture = checked(await db.from("projects").insert({ id: projectId, user_id: source.user_id,
    title, source_text: selected.map((scene) => scene.narration).join(""), input_mode: "full-script",
    settings, status: "draft" }).select("*").single(), "Create QC fixture project");
  // Print only this new fixture identity, so interrupted setup can be inspected.
  console.log(JSON.stringify({ fixtureProjectId: projectId, fixtureToken: token }));
  const rows = [];
  const assetPaths = [];
  const mediaHashes = [];
  for (let index = 0; index < selected.length; index++) {
    const original = selected[index];
    const imagePath = `${prefix}generated/qc-scene-${index + 1}.png`;
    const wav = original.audio_path.endsWith(".wav");
    const audioPath = `${prefix}generated/qc-scene-${index + 1}.${wav ? "wav" : "mp3"}`;
    mediaHashes.push(await copyObject(original.image_path, imagePath, "image/png"));
    mediaHashes.push(await copyObject(original.audio_path, audioPath, wav ? "audio/wav" : "audio/mpeg"));
    assetPaths.push(imagePath, audioPath);
    rows.push({ id: randomUUID(), project_id: projectId, scene_order: index,
      narration: original.narration, image_prompt: original.image_prompt,
      estimated_duration_ms: original.estimated_duration_ms, actual_duration_ms: original.actual_duration_ms,
      image_path: imagePath, audio_path: index === 0 ? audioPath : `${prefix}generated/qc-deliberately-missing-audio.wav`,
      subtitles: original.subtitles, media_status: index === 0 ? "ready" : "pending" });
  }
  checked(await db.from("scenes").insert(rows), "Create isolated QC scenes");
  const qc = { kind, token, sourceProjectId: sourceId, assetPaths, mediaHashes,
    repairedAudioPath: assetPaths[3], scene2Id: rows[1].id,
    scene1: { id: rows[0].id, imagePath: rows[0].image_path, audioPath: rows[0].audio_path,
      durationMs: rows[0].actual_duration_ms, captionsHash: hash(rows[0].subtitles) } };
  checked(await db.from("jobs").insert({ project_id: projectId, user_id: source.user_id,
    job_type: "create_video", status: "cancelled", payload: { qc },
    idempotency_key: `qc-partial-retry:${token}`, stage: "QC fixture identity", max_attempts: 3 }), "Store QC fixture identity");
  const queued = checked(await db.rpc("continue_video", { p_user_id: fixture.user_id,
    p_project_id: projectId, p_max_concurrent: access.max_concurrent_jobs }), "Queue isolated QC pipeline");
  const job = Array.isArray(queued) ? queued[0] : queued;
  assert(job?.id && job.payload?.pipeline?.step === "media", "Fixture did not start at media checkpoint");
  console.log(JSON.stringify({ fixtureProjectId: projectId, jobId: job.id, stage: "waiting_for_expected_partial_failure" }));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const current = await loadFixture(projectId);
    assertScene1Unchanged(current);
    const currentJob = current.history.find((item) => item.id === job.id);
    if (currentJob?.status === "failed") {
      assert(currentJob.attempts === 3 && current.scenes[1].media_status === "failed", "Expected bounded three-attempt partial failure");
      await verifyScene1Binary(current);
      console.log(JSON.stringify({ pass: true, fixtureProjectId: projectId, jobId: job.id,
        attempts: currentJob.attempts, scene1Unchanged: true, scene1BinaryUnchanged: true, scene2Failed: true,
        next: `node local-tools/test_partial_retry.mjs repair ${projectId}` }));
      return;
    }
    assert(currentJob?.status !== "completed", "Missing audio unexpectedly produced a completed video");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`QC wait exceeded 120 seconds; fixture remains for inspection: ${projectId}`);
}

if (mode === "create") await createFixture(argument);
else {
  const fixture = await loadFixture(argument);
  assertScene1Unchanged(fixture);
  if (mode === "verify_scene1") {
    await verifyScene1Binary(fixture);
    console.log(JSON.stringify({ fixtureProjectId: argument, scene1Unchanged: true, scene1BinaryUnchanged: true }));
  } else if (mode === "repair") {
    assert(!fixture.history.some((job) => ["queued", "running"].includes(job.status)), "Refusing to repair an active fixture");
    checked(await bucket.download(fixture.qc.repairedAudioPath), "Check repair audio exists");
    checked(await db.from("scenes").update({ audio_path: fixture.qc.repairedAudioPath, media_status: "pending", error_message: null })
      .eq("id", fixture.qc.scene2Id).eq("project_id", fixture.project.id), "Repair only fixture scene 2");
    console.log(JSON.stringify({ repaired: true, fixtureProjectId: argument, scene1Unchanged: true, next: "Open this fixture in Studio and click Tiếp tục" }));
  } else if (mode === "verify") {
    await verifyScene1Binary(fixture);
    const latest = fixture.history.find((job) => job.id !== fixture.marker.id);
    const exports = checked(await db.from("exports").select("id,storage_path,thumbnail_path,duration_ms,width,height").eq("project_id", argument), "Read fixture exports");
    console.log(JSON.stringify({ fixtureProjectId: argument, jobId: latest?.id, status: latest?.status,
      attempts: latest?.attempts, scene1Unchanged: true, scene1BinaryUnchanged: true, scene2Status: fixture.scenes[1].media_status,
      exports: exports.map(({ storage_path, thumbnail_path, ...summary }) => summary) }));
    assert(latest?.status === "completed" && fixture.scenes[1].media_status === "ready" && exports.length === 1,
      "Fixture has not completed repaired retry yet");
    assert(fixture.scenes[1].audio_path === fixture.qc.repairedAudioPath, "Retry unexpectedly regenerated repaired scene audio");
    for (const item of exports) {
      checked(await bucket.download(safePath(item.storage_path, fixture.prefix)), "Check fixture MP4 exists");
      checked(await bucket.download(safePath(item.thumbnail_path, fixture.prefix)), "Check fixture thumbnail exists");
    }
    console.log("PASS repaired retry: existing media retained and one real export saved");
  } else if (mode === "cleanup") {
    assert(!fixture.history.some((job) => ["queued", "running"].includes(job.status)), "Refusing to clean up an active fixture");
    const exports = checked(await db.from("exports").select("storage_path,thumbnail_path").eq("project_id", argument), "List only fixture exports");
    const paths = [...new Set([...fixture.qc.assetPaths, ...fixture.scenes.flatMap((scene) => [scene.image_path, scene.audio_path]),
      ...exports.flatMap((item) => [item.storage_path, item.thumbnail_path])].filter(Boolean).map((path) => safePath(path, fixture.prefix)))];
    checked(await bucket.remove(paths), "Remove exact QC fixture objects");
    checked(await db.from("projects").delete().eq("id", argument).eq("user_id", fixture.project.user_id)
      .eq("title", `[QC-PARTIAL-RETRY:${fixture.qc.token}]`), "Remove exact tagged QC project");
    console.log(JSON.stringify({ removedFixtureProjectId: argument, removedObjects: paths.length,
      sourceProjectUnchanged: fixture.qc.sourceProjectId }));
  }
}
