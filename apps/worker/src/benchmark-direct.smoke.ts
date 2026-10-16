/**
 * Direct benchmark: runs the worker's own modules (faithful storyboard with its quality gates, the local media bridge for
 * pictures and aligned voices, and the production renderer) on the 10 corpus cases of docs/audit/benchmark-corpus.json.
 *
 * It does NOT go through the website or the API (that needs a signed-in session, which an automated run must not create),
 * so it measures the generation and render pipeline, not login, project storage, the job queue or the studio screens.
 *
 * Run inside the worker container:  tsx src/benchmark-direct.smoke.ts <corpus.json> <outDir> [B01 B02 ...]
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_PROJECT_SETTINGS, type Project, type ProjectSettings, type Scene, visualPresetPrompt } from "@studio/shared";
import { castForScript, storyNationality, usesStoryCard } from "./card-layout";
import { LocalMediaAdapter } from "./local-media";
import { OllamaStoryboardAdapter } from "./ollama";
import {
  buildProductionImagePrompt, cleanScriptForNarration, createFaithfulStoryboard, imageAspectFor, imageSeedFor, imageStyleFor,
  vietnameseByDefault, withCast, youthfulSiblings,
} from "./providers";
import { renderProject } from "./render";

const exec = promisify(execFile);
const [corpusPath, outDir, ...only] = process.argv.slice(2);
if (!corpusPath || !outDir) throw new Error("usage: benchmark-direct.smoke.ts <corpus.json> <outDir> [case ids]");

type Case = { id: string; topic: string; hook: string; sourceText: string };
const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as { cases?: Case[] } & Record<string, unknown>;
const cases: Case[] = (corpus.cases ?? (Object.values(corpus).find(Array.isArray) as Case[])).filter((item) => !only.length || only.includes(item.id));

// One look per topic, chosen the way a channel owner would: the same retention aids everywhere.
const LOOK: Record<string, Partial<ProjectSettings>> = {
  "Triết lý": { layoutTemplate: "story-card", cardTheme: "sepia", visualPreset: "thuy-mac-sepia", voice: "triet-ly" },
  "Motivation": { visualPreset: "cinematic-color", voice: "doc-truyen" },
  "Storytelling": { layoutTemplate: "story-card", cardTheme: "blue", visualPreset: "cartoon", voice: "doc-truyen" },
  "Kiến thức": { visualPreset: "cinematic-color", voice: "thuyet-minh" },
  "Công nghệ": { visualPreset: "cinematic-color", voice: "thuyet-minh" },
  "Tài chính": { visualPreset: "cinematic-color", voice: "thuyet-minh" },
  "Psychology": { visualPreset: "watercolor", voice: "tam-su" },
  "Cybersecurity": { visualPreset: "cinematic-color", voice: "thuyet-minh" },
  "Productivity": { visualPreset: "paper-cut", voice: "thuyet-minh" },
  "Mystery": { visualPreset: "historical", voice: "doc-truyen" },
};

// Not getConfig(): the benchmark must not need (or be handed) database or API secrets, only the two local services.
const config = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "qwen3.5:4b",
  OLLAMA_NUM_CTX: Number(process.env.OLLAMA_NUM_CTX ?? 8192),
  OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE ?? "10m",
  LOCAL_MEDIA_BASE_URL: process.env.LOCAL_MEDIA_BASE_URL ?? "http://host.docker.internal:8765",
};
const token = process.env.AI_NODES_TOKEN || undefined;
const media = new LocalMediaAdapter(config.LOCAL_MEDIA_BASE_URL, token ? { token } : {});
const ollama = new OllamaStoryboardAdapter(config.OLLAMA_BASE_URL, config.OLLAMA_MODEL, { numCtx: config.OLLAMA_NUM_CTX, keepAlive: config.OLLAMA_KEEP_ALIVE });
await mkdir(outDir, { recursive: true });

const clock = () => Date.now();
const results: unknown[] = [];

for (const item of cases) {
  const work = join(outDir, item.id);
  await mkdir(work, { recursive: true });
  const times: Record<string, number> = {};
  const mark = async <T>(name: string, run: () => Promise<T>): Promise<T> => { const t = clock(); try { return await run(); } finally { times[name] = (clock() - t) / 1000; } };
  const outcome: Record<string, unknown> = { id: item.id, topic: item.topic };
  try {
    const settings: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS, textProvider: "ollama", mediaProvider: "local", captionHighlight: true, progressBar: true, sceneSfx: true,
      outroText: "Theo dõi để xem thêm", autoMusic: true, brandName: "Studio QA", ...LOOK[item.topic],
    } as ProjectSettings;
    const sourceText = cleanScriptForNarration(item.sourceText);
    const cardMode = usesStoryCard(settings);
    const nationality = storyNationality(`${item.topic}\n${sourceText}`);
    let cast = castForScript(sourceText, nationality);
    if (!cast && ollama.describeCast) cast = await ollama.describeCast({ title: item.hook, sourceText, cartoon: cardMode, people: nationality.people }).catch(() => "");
    const storyboard = await mark("storyboard", () => createFaithfulStoryboard(ollama, {
      title: item.hook, sourceText, inputMode: "full-script", rewrite: false, audience: settings.targetAudience, style: settings.style,
      duration: settings.targetDurationSec, voice: settings.voice, voiceSpeed: settings.voiceSpeed,
      visualStyle: `${settings.visualStyle}; ${visualPresetPrompt(settings.visualPreset)}`, model: null, cast,
    } as never));
    const title = cardMode ? (await ollama.writeCardTitle?.({ sourceText })?.catch(() => "")) || item.hook : "";
    const projectId = crypto.randomUUID();
    const scenes: Scene[] = storyboard.scenes.map((scene, order) => ({
      id: crypto.randomUUID(), order, narration: scene.narration,
      imagePrompt: withCast(cast, vietnameseByDefault(youthfulSiblings(scene.imagePrompt), nationality), scene.narration, cardMode),
      estimatedDurationMs: 3000, actualDurationMs: null, imagePath: null, videoPath: null, audioPath: null, thumbnailUrl: null,
      mediaStatus: "pending", errorMessage: null, annotationJson: null, subtitles: [],
    } as Scene));
    outcome.scenes = scenes.length;
    // Voices first, then pictures: one model at a time keeps a 16 GB Mac out of swap (the worker does the same).
    await mark("voices", async () => {
      for (const scene of scenes) {
        const spoken = await media.createSpeechAligned!(scene.narration, settings.voice, { speed: settings.voiceSpeed });
        const file = `${scene.id}.${spoken.contentType === "audio/wav" ? "wav" : "mp3"}`;
        await writeFile(join(work, file), spoken.audio);
        Object.assign(scene, { audioPath: file, subtitles: spoken.cues, actualDurationMs: spoken.durationMs, estimatedDurationMs: spoken.durationMs });
      }
    });
    await mark("images", async () => {
      for (const scene of scenes) {
        const png = await media.createImage(
          buildProductionImagePrompt(scene.imagePrompt, visualPresetPrompt(settings.visualPreset)), imageAspectFor(settings),
          { seed: imageSeedFor(`${projectId}:${scene.id}`), style: imageStyleFor(settings.visualStyle, settings.visualPreset), preset: settings.generationPreset },
        );
        const file = `${scene.id}.png`;
        await writeFile(join(work, file), png);
        Object.assign(scene, { imagePath: file, mediaStatus: "ready" });
      }
    });
    const project = {
      id: projectId, userId: crypto.randomUUID(), title: item.hook, sourceText, inputMode: "full-script", hook: item.hook, suggestedTitle: title,
      suggestedDescription: "", status: "rendering", settings: { ...settings, cardTitle: title }, scenes,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as Project;
    const rendered = await mark("render", () => renderProject({ ...config, FFMPEG_PATH: "ffmpeg", FFPROBE_PATH: "ffprobe" } as never, project, (path) => readFile(join(work, path)), async () => undefined));
    await copyFile(rendered.output, join(outDir, `${item.id}.mp4`));
    await copyFile(rendered.thumbnail, join(outDir, `${item.id}.jpg`));
    await writeFile(join(outDir, `${item.id}.scenes.json`), JSON.stringify(scenes.map((scene) => ({ order: scene.order, narration: scene.narration, imagePrompt: scene.imagePrompt, durationMs: scene.actualDurationMs, cues: scene.subtitles.length })), null, 1));
    outcome.durationMs = rendered.durationMs;
    outcome.ok = true;
  } catch (error) {
    outcome.ok = false;
    outcome.error = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
  }
  outcome.seconds = times;
  results.push(outcome);
  await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(outcome));
}
