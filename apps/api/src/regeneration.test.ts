import { describe, expect, it, vi } from "vitest";
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
