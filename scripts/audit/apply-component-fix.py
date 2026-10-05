from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, f'Unexpected source in {path}'
    p.write_text(s.replace(old, new))


def create(path, content):
    p = Path(path)
    assert not p.exists(), f'Already exists: {path}'
    p.write_text(content)


create('packages/shared/src/regeneration.ts', '''import { z } from "zod";
export const regenerationComponentSchema = z.enum(["all", "image", "audio", "subtitles"]).default("all");
export type RegenerationComponent = z.infer<typeof regenerationComponentSchema>;
/** Strip client-supplied worker checkpoints and cleanup paths. */
export const regenerationRequestSchema = z.object({ sceneId: z.string().uuid(), component: regenerationComponentSchema });
''')
replace('packages/shared/src/index.ts', 'export * from "./script";', 'export * from "./script";\nexport * from "./regeneration";')
create('apps/worker/src/regeneration.ts', '''import { regenerationComponentSchema, type Scene } from "@studio/shared";
export type RegenerationCheckpoint = { imagePath: string | null; audioPath: string | null; subtitlesCompleted?: boolean };
/** Keep successful assets on retry; voice replacement invalidates dependent captions. */
export function regenerationPlan(scene: Scene, requested: unknown, previous: RegenerationCheckpoint, subtitlesEnabled: boolean) {
  const component = regenerationComponentSchema.parse(requested);
  if (component === "image" && (!scene.audioPath || !scene.actualDurationMs || (subtitlesEnabled && !scene.subtitles.length)))
    throw new Error("Cần có giọng đọc và phụ đề trước khi chỉ tạo lại ảnh. Hãy hoàn tất media còn thiếu trước.");
  if ((component === "audio" || component === "subtitles") && !scene.imagePath)
    throw new Error("Cần có ảnh trước khi chỉ sửa giọng đọc hoặc phụ đề.");
  if (component === "subtitles" && (!scene.audioPath || !subtitlesEnabled))
    throw new Error("Cần có audio và bật phụ đề trước khi đồng bộ lại phụ đề.");
  return {
    image: (component === "all" || component === "image") && scene.imagePath === previous.imagePath,
    audio: (component === "all" || component === "audio") && scene.audioPath === previous.audioPath,
    subtitles: component === "subtitles" && !previous.subtitlesCompleted,
  };
}
''')
replace('apps/worker/src/index.ts', 'import { renderProject } from "./render";', 'import { renderProject } from "./render";\nimport { regenerationPlan, type RegenerationCheckpoint } from "./regeneration";')
replace('apps/worker/src/index.ts', '''      const previous = job.payload.regeneration as { imagePath: string | null; audioPath: string | null } | undefined;
      const regenerateImage = Boolean(targetId) && scene.imagePath === previous?.imagePath;
      const regenerateAudio = Boolean(targetId) && scene.audioPath === previous?.audioPath;
      if (!regenerateImage && !regenerateAudio && sceneMediaReady(scene, project.settings.subtitle.enabled)) {''', '''      const previous = job.payload.regeneration as RegenerationCheckpoint | undefined;
      const plan = targetId
        ? regenerationPlan(scene, job.payload.component, previous!, project.settings.subtitle.enabled)
        : { image: false, audio: false, subtitles: false };
      const regenerateImage = plan.image;
      const regenerateAudio = plan.audio;
      if (!regenerateImage && !regenerateAudio && !plan.subtitles && sceneMediaReady(scene, project.settings.subtitle.enabled)) {''')
replace('apps/worker/src/index.ts', 'let subtitles = regenerateAudio ? [] : scene.subtitles;', 'let subtitles = regenerateAudio || plan.subtitles ? [] : scene.subtitles;')
replace('apps/worker/src/index.ts', '''      if (targetId) {
        const generatedPrefix''', '''      if (targetId) {
        if (plan.subtitles) {
          job.payload = { ...job.payload, regeneration: { ...previous, subtitlesCompleted: true } };
          const { error: checkpointError } = await db.from("jobs").update({ payload: job.payload }).eq("id", job.id);
          if (checkpointError) throw checkpointError;
        }
        const generatedPrefix''')
replace('apps/api/src/app.ts', '  cleanScriptForNarration,', '  cleanScriptForNarration,\n  regenerationRequestSchema,')
replace('apps/api/src/app.ts', '''    if (input.type === "regenerate_scene") {
      const sceneId''', '''    if (input.type === "regenerate_scene") {
      input.payload = regenerationRequestSchema.parse(input.payload);
      const sceneId''')
replace('apps/web/src/lib/api.ts', 'import type { Estimate, Job, LocalModelCatalog, Project }', 'import type { Estimate, Job, LocalModelCatalog, Project, RegenerationComponent }')
replace('apps/web/src/lib/api.ts', '  regenerateScene: (id: string, sceneId: string) =>', '  regenerateScene: (id: string, sceneId: string, component: RegenerationComponent = "all") =>')
replace('apps/web/src/lib/api.ts', 'body: JSON.stringify({ type: "regenerate_scene", payload: { sceneId } }),', 'body: JSON.stringify({ type: "regenerate_scene", payload: { sceneId, component } }),')
replace('apps/web/src/App.tsx', '  type Scene,', '  type Scene,\n  type RegenerationComponent,')
replace('apps/web/src/App.tsx', '  onRegenerate(): void;', '  onRegenerate(component?: RegenerationComponent): void;')
replace('apps/web/src/App.tsx', '        <div className="scene-foot">', '''        <details className="scene-repair" onClick={(e) => e.stopPropagation()}>
          <summary>Sửa riêng thành phần</summary>
          <div className="scene-repair-actions">
            <button type="button" disabled={!scene.audioPath || !scene.actualDurationMs}
              onClick={() => onRegenerate("image")}>Tạo lại ảnh</button>
            <button type="button" disabled={!scene.imagePath}
              onClick={() => onRegenerate("audio")}>Tạo lại giọng và phụ đề</button>
            <button type="button" disabled={!scene.imagePath || !scene.audioPath}
              onClick={() => onRegenerate("subtitles")}>Đồng bộ lại phụ đề</button>
          </div>
        </details>
        <div className="scene-foot">''')
replace('apps/web/src/App.tsx', 'async function regenerate(sceneId: string) {', 'async function regenerate(sceneId: string, component: RegenerationComponent = "all") {')
replace('apps/web/src/App.tsx', 'const job = await api.regenerateScene(id, sceneId);', 'const job = await api.regenerateScene(id, sceneId, component);')
replace('apps/web/src/App.tsx', 'onRegenerate={() => void regenerate(scene.id)}', 'onRegenerate={(component) => void regenerate(scene.id, component)}')
p = Path('apps/web/src/styles.css')
p.write_text(p.read_text() + '''
/* Targeted media repair stays usable within narrow mobile cards. */
.scene-repair { margin: 8px 0; font-size: 12px; }
.scene-repair summary { cursor: pointer; }
.scene-repair-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.scene-repair-actions button { max-width: 100%; padding: 6px 8px; font: inherit; }
''')
create('packages/shared/src/regeneration.test.ts', '''import { describe, expect, it } from "vitest";
import { regenerationRequestSchema } from "./regeneration";
const sceneId = "c84187c5-33ad-4c80-a6f3-b925ca4aee31";
describe("regeneration request", () => {
  it("keeps legacy clients compatible", () => expect(regenerationRequestSchema.parse({sceneId}).component).toBe("all"));
  it.each(["all", "image", "audio", "subtitles"])("accepts %s", component => expect(regenerationRequestSchema.parse({sceneId,component}).component).toBe(component));
  it.each(["video", "", null, 123, {}])("rejects invalid selection %j", component => expect(() => regenerationRequestSchema.parse({sceneId,component})).toThrow());
  it("rejects invalid scene ID", () => expect(() => regenerationRequestSchema.parse({sceneId:"other"})).toThrow());
  it("strips client supplied checkpoints and cleanup paths", () => expect(regenerationRequestSchema.parse({sceneId,component:"image",regeneration:{imagePath:"another-scene.png",subtitlesCompleted:true}})).toEqual({sceneId,component:"image"}));
});
''')
create('apps/worker/src/regeneration.test.ts', '''import { describe, expect, it } from "vitest";
import { sceneSchema } from "@studio/shared";
import { regenerationPlan } from "./regeneration";
const scene = sceneSchema.parse({id:"c84187c5-33ad-4c80-a6f3-b925ca4aee31",order:0,narration:"Test narration",imagePrompt:"Test image",estimatedDurationMs:5000,actualDurationMs:5000,imagePath:"old.png",audioPath:"old.wav",mediaStatus:"ready",subtitles:[{id:"3b968fb5-a00d-4b9d-8bd5-638598d9ef4d",startMs:0,endMs:4000,text:"Test narration"}]});
const previous={imagePath:scene.imagePath,audioPath:scene.audioPath};
describe("component regeneration planning", () => {
 it("image repair never regenerates voice or captions", () => expect(regenerationPlan(scene,"image",previous,true)).toEqual({image:true,audio:false,subtitles:false}));
 it("voice repair keeps image", () => expect(regenerationPlan(scene,"audio",previous,true)).toEqual({image:false,audio:true,subtitles:false}));
 it("subtitle repair keeps both media assets", () => expect(regenerationPlan(scene,"subtitles",previous,true)).toEqual({image:false,audio:false,subtitles:true}));
 it("preserves legacy all behavior", () => expect(regenerationPlan(scene,undefined,previous,true)).toEqual({image:true,audio:true,subtitles:false}));
 it("retry preserves a successful regenerated image", () => expect(regenerationPlan({...scene,imagePath:"new.png"},"image",previous,true)).toEqual({image:false,audio:false,subtitles:false}));
 it("retry preserves a successful regenerated voice", () => expect(regenerationPlan({...scene,audioPath:"new.wav"},"audio",previous,true)).toEqual({image:false,audio:false,subtitles:false}));
 it("retry all only recreates the unfinished asset", () => expect(regenerationPlan({...scene,imagePath:"new.png"},"all",previous,true)).toEqual({image:false,audio:true,subtitles:false}));
 it("retry does not transcribe after subtitle checkpoint", () => expect(regenerationPlan(scene,"subtitles",{...previous,subtitlesCompleted:true},true).subtitles).toBe(false));
 it.each(["audio","subtitles"])("missing image stops unrequested repair for %s", c => expect(() => regenerationPlan({...scene,imagePath:null},c,previous,true)).toThrow());
 it("missing voice stops image-only repair", () => expect(() => regenerationPlan({...scene,audioPath:null},"image",previous,true)).toThrow());
 it("missing captions stop image-only repair when required", () => expect(() => regenerationPlan({...scene,subtitles:[]},"image",previous,true)).toThrow());
 it("disabled captions do not block image repair", () => expect(regenerationPlan({...scene,subtitles:[]},"image",previous,false).image).toBe(true));
 it("cannot transcribe missing voice", () => expect(() => regenerationPlan({...scene,audioPath:null},"subtitles",previous,true)).toThrow());
 it("does not regenerate disabled subtitles", () => expect(() => regenerationPlan(scene,"subtitles",previous,false)).toThrow());
 it("rejects unsupported component", () => expect(() => regenerationPlan(scene,"invalid",previous,true)).toThrow());
});
''')
create('apps/web/src/lib/regeneration.test.ts', '''import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
vi.mock("./config", () => ({ appConfig: { apiUrl: "https://api.example", demoMode: false } }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-session" } } }) } } }));
afterEach(() => vi.unstubAllGlobals());
describe("selective regeneration client", () => {
 it.each(["all","image","audio","subtitles"] as const)("sends exactly %s", async component => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"job"}),{status:202}));vi.stubGlobal("fetch",fetcher);
  await api.regenerateScene("project","scene",component);
  const [url,init]=fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.example/v1/projects/project/jobs");
  expect(JSON.parse(init.body)).toEqual({type:"regenerate_scene",payload:{sceneId:"scene",component}});
 });
 it("defaults old client calls to all", async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"job"}),{status:202}));vi.stubGlobal("fetch",fetcher);
  await api.regenerateScene("project","scene");
  expect(JSON.parse(fetcher.mock.calls[0]![1].body).payload.component).toBe("all");
 });
});
''')
create('apps/api/src/regeneration.test.ts', '''import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { DEFAULT_PROJECT_SETTINGS } from "@studio/shared";
const user="c84187c5-33ad-4c80-a6f3-b925ca4aee31", project="3b968fb5-a00d-4b9d-8bd5-638598d9ef4d", scene="73865c65-6b9c-4220-997c-75bece066dde", now="2026-10-05T00:00:00.000Z";
function fixture(){
 const writes:Record<string,unknown>[]=[];
 const job={id:"9e4517ae-8462-4c4c-b1c7-45c79bf6af3c",project_id:project,user_id:user,job_type:"regenerate_scene",status:"queued",progress:0,stage:"queued",error_message:null,attempts:0,max_attempts:3,created_at:now,updated_at:now};
 const db={auth:{getUser:vi.fn(async()=>({data:{user:{id:user,email:"qa@example.test"}},error:null}))},from(table:string){
  let mutation=false;
  const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,gte:()=>q,update:()=>q,
   upsert:(v:Record<string,unknown>)=>{mutation=true;writes.push(v);return q;},single:()=>q,maybeSingle:()=>q,
   then(resolve:(v:unknown)=>unknown){
    const data=table==="allowed_users"?{user_id:user,is_active:true,daily_budget_usd:5,max_concurrent_jobs:1}
     :table==="projects"?{id:project,user_id:user,title:"QA",source_text:"A valid test script",input_mode:"full-script",status:"draft",settings:{...DEFAULT_PROJECT_SETTINGS,textProvider:"ollama"},created_at:now,updated_at:now}
     :table==="scenes"?[{id:scene,scene_order:0,narration:"Test",image_prompt:"A scene",estimated_duration_ms:5000,actual_duration_ms:5000,image_path:"image.png",audio_path:"voice.wav",media_status:"ready",error_message:null,subtitles:[]}]
     :table==="jobs"&&mutation?job:[];
    return Promise.resolve(resolve({data,error:null,count:0}));
   }};return q;
 }};
 const config={ALLOWED_ORIGINS:"http://localhost:5173",MAX_UPLOAD_MB:50,DAILY_BUDGET_USD:5,MAX_CONCURRENT_JOBS:1,LOCAL_MEDIA_FEATURES_ENABLED:true};
 return {app:createApp(config as never,db as never),writes};
}
describe("selective regeneration endpoint",()=>{
 it.each(["all","image","audio","subtitles"])("queues %s and strips private checkpoints",async component=>{
  const f=fixture();const r=await request(f.app).post(`/v1/projects/${project}/jobs`).set("Authorization","Bearer fixture").send({type:"regenerate_scene",payload:{sceneId:scene,component,regeneration:{imagePath:"should-not-be-used.png",subtitlesCompleted:true}}});
  expect(r.status).toBe(202);expect(f.writes[0]!.payload).toEqual({sceneId:scene,component});
 });
 it("rejects unsupported component before inserting job",async()=>{
  const f=fixture();const r=await request(f.app).post(`/v1/projects/${project}/jobs`).set("Authorization","Bearer fixture").send({type:"regenerate_scene",payload:{sceneId:scene,component:"wrong"}});
  expect(r.status).toBe(400);expect(f.writes).toEqual([]);
 });
 it("requires authentication",async()=>{
  const f=fixture();const r=await request(f.app).post(`/v1/projects/${project}/jobs`).send({type:"regenerate_scene",payload:{sceneId:scene,component:"image"}});
  expect(r.status).toBe(401);expect(f.writes).toEqual([]);
 });
});
''')
print('Scoped component repair patch applied; run all checks before committing.')
