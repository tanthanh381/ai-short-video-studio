// Default mode is read-only planning. Never accepts a Supabase service-role key.
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
const root=fileURLToPath(new URL('../../',import.meta.url));
const corpus=JSON.parse(await readFile(join(root,'docs/audit/benchmark-corpus.json'),'utf8'));
for(const item of corpus.cases){
  if(!/^B\d{2}$/.test(item.id) || typeof item.sourceText!=='string' || item.sourceText.trim().length<10 || item.sourceText.length>30000 || item.sourceText.trim().split(/\s+/u).length>2000)
    throw new Error(`Invalid benchmark fixture: ${item.id}`);
}
if(new Set(corpus.cases.map(x=>x.id)).size!==10) throw new Error('Exactly ten unique cases are required');
if(!process.argv.includes('--run')){
  console.log(JSON.stringify({mode:'PLAN_ONLY',createdVideos:0,cases:corpus.cases.map(x=>({id:x.id,topic:x.topic,characters:x.sourceText.length,targetDurationSec:corpus.defaults.targetDurationSec}))},null,2));
  process.exit(0);
}
if(process.env.STUDIO_BENCHMARK_CONFIRM!=='CREATE_10_LOCAL_VIDEOS') throw new Error('Set STUDIO_BENCHMARK_CONFIRM=CREATE_10_LOCAL_VIDEOS to authorize creation');
const base=(process.env.STUDIO_API_URL??'').replace(/\/$/,'');
const endpoint=new URL(base);
if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname))) throw new Error('Use HTTPS or a local development API');
if(endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('API URL must not contain credentials, query or fragment');
const token=process.env.STUDIO_BENCHMARK_TOKEN??'';
let claims;
try{claims=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString('utf8'));}catch{throw new Error('Provide a valid short-lived QA user access token in the environment');}
if(claims.role!=='authenticated') throw new Error('Only an authenticated user token is accepted; never a service-role key');
const directory=resolve(root,process.env.STUDIO_BENCHMARK_DIR??'tmp/audit-benchmarks');
await mkdir(directory,{recursive:true});
const statePath=join(directory,'state.json');
let state;
try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={runId:randomUUID(),scope:'Authenticated API benchmark, not browser E2E',cases:{}};}
async function save(){
  const temporaryPath=statePath+'.tmp';
  try{
    await writeFile(temporaryPath,JSON.stringify(state,null,2));
    await rename(temporaryPath,statePath);
  }catch(error){
    if(error?.code==='ENOSPC'){
      // Remove only the journal's temporary file. Never delete the checkpoint
      // or downloaded videos: a later run must be able to resume safely.
      await unlink(temporaryPath,{force:true}).catch(()=>{});
      throw new Error(`Benchmark journal cannot be saved: disk is full (${statePath}). Free disk space and resume from the existing journal; no replacement video was submitted.`);
    }
    throw error;
  }
}
async function request(path,method='GET',body,key){
  const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){const error=new Error(`HTTP ${response.status} for ${path}`);error.fatal=[401,403,429].includes(response.status);throw error;}
  return response.json();
}
await request('/v1/settings'); // Verify the allowlist before creating any work.
await save();
for(const item of corpus.cases){
  const row=state.cases[item.id]??={topic:item.topic,idempotencyKey:`audit-${state.runId}-${item.id}`,startedAt:new Date().toISOString(),status:'PENDING',scores:null};
  if(row.status==='DOWNLOADED')continue;
  await save();
  try{
    if(!row.projectId){
      const result=await request('/v1/videos','POST',{sourceText:item.sourceText,settings:corpus.defaults},row.idempotencyKey);
      row.projectId=result.project.id;row.jobId=result.job.id;row.status='GENERATING';await save();
    }
    const deadline=Date.now()+45*60*1000;
    while(true){
      const jobs=await request(`/v1/projects/${row.projectId}/jobs`);
      const job=jobs.find(x=>x.id===row.jobId);
      if(!job)throw new Error('Benchmark job not found; no replacement project was created');
      if(job.status==='failed'||job.status==='cancelled')throw new Error(`Job ended with ${job.status}; successful components remain on the server`);
      if(job.status==='completed')break;
      if(Date.now()>deadline){const error=new Error('Observation timed out; server job may still be running. Resume this journal rather than submitting again.');error.fatal=true;throw error;}
      await new Promise(r=>setTimeout(r,6000));
    }
    const result=await request(`/v1/projects/${row.projectId}/result`);
    if(!result.export?.downloadUrl)throw new Error('Completed job has no downloadable export');
    const url=new URL(result.export.downloadUrl);
    if(url.protocol!=='https:' && url.hostname!=='localhost' && url.hostname!=='127.0.0.1')throw new Error('Unexpected export URL');
    // Do not forward the user's Authorization header to signed storage URLs.
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok || !response.body)throw new Error(`Export download HTTP ${response.status}`);
    const reader=response.body.getReader();const chunks=[];let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>200*1024*1024){await reader.cancel();throw new Error('Export exceeds 200 MiB benchmark download limit');}chunks.push(Buffer.from(value));}
    const output=join(directory,`${item.id}.mp4`);await writeFile(output,Buffer.concat(chunks));
    const {stdout}=await exec(process.env.FFPROBE_PATH??'ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',output],{timeout:30000});
    const probe=JSON.parse(stdout),video=probe.streams.find(x=>x.codec_type==='video'),audio=probe.streams.find(x=>x.codec_type==='audio');
    row.technicalPass=video?.codec_name==='h264' && video?.width===1080 && video?.height===1920 && audio?.codec_name==='aac' && Number(probe.format.duration)>0;
    row.probe=probe;row.exportId=result.export.id;row.file=`${item.id}.mp4`;row.status='DOWNLOADED';row.finishedAt=new Date().toISOString();row.elapsedMs=Date.parse(row.finishedAt)-Date.parse(row.startedAt);
    row.qualityStatus='NEEDS_HUMAN_REVIEW';row.scores=Object.fromEntries(corpus.criteria.map(name=>[name,null]));delete row.error;
    console.log(`${item.id}: downloaded; technical=${row.technicalPass}; editorial score NOT ASSESSED`);
  }catch(error){
    row.status='BLOCKED_OR_FAILED';row.error=String(error.message).replaceAll(token,'[redacted]').slice(0,500);await save();
    if(error.fatal)throw error;
    console.error(`${item.id}: ${row.error}`);
  }
  await save();
}
console.log(`Benchmark journal: ${statePath}. No semantic quality scores were invented.`);
if(Object.values(state.cases).some(x=>x.status!=='DOWNLOADED'||!x.technicalPass))process.exitCode=1;
