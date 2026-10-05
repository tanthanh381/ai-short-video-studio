// Runs only on an explicitly authorized QA runner. Never records credentials,
// session state, signed URLs, or existing project content in public artifacts.
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {generateKeyPairSync, privateDecrypt, constants, createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mode=process.argv[2], run=process.env.GITHUB_RUN_ID;
const site='https://tanthanh381.github.io/ai-short-video-studio/';
const repository='tanthanh381/ai-short-video-studio';
const branch='qa/2026-10-05-authenticated';
const privateDir=`/dev/shm/studio-qa-${run}`;
const out='qa-artifacts';
await mkdir(out,{recursive:true});
await mkdir(privateDir,{recursive:true,mode:0o700});
let secrets=[];
function mask(value){if(value){secrets.push(value);console.log(`::add-mask::${value}`);}}
function clean(value){let s=String(value);for(const x of secrets)s=s.replaceAll(x,'[redacted]');return s.replace(/https?:\/\/[^\s"']+/g,m=>{try{const u=new URL(m);return u.origin+u.pathname;}catch{return '[url]';}}).slice(0,1800);}
async function save(name,value){await writeFile(join(out,name),JSON.stringify(value,null,2));}
if(mode==='prepare'){
 const response=await fetch(site,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Website preflight HTTP ${response.status}`);
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 await writeFile(join(privateDir,'key.pem'),privateKey,{mode:0o600});
 await mkdir('qa-handshake',{recursive:true});
 await writeFile('qa-handshake/public.json',JSON.stringify({run,algorithm:'RSA-OAEP-SHA256',publicKey,expiresAt:Date.now()+15*60*1000},null,2));
 console.log('Website reachable; one-time public key published. Private key stays only in runner tmpfs.');
 process.exit(0);
}
const require=createRequire('/tmp/studio-qa/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
let context,page,config;
async function attach(state){context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(state?{storageState:state}:{})});page=await context.newPage();page.setDefaultTimeout(20000);}
async function session(){const s=await page.evaluate(()=>{for(const k of Object.keys(localStorage)){if(k.startsWith('sb-')&&k.endsWith('-auth-token')){try{const v=JSON.parse(localStorage.getItem(k));if(v?.access_token)return v;}catch{}}}return null;});if(!s?.access_token)throw new Error('QA session unavailable');mask(s.access_token);mask(s.refresh_token);return s;}
async function api(path,method='GET',body,key){
 const s=await session();
 const response=await context.request.fetch(config.api+path,{method,headers:{authorization:`Bearer ${s.access_token}`,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body!==undefined?{data:body}:{}),timeout:30000});
 let data=null;try{data=await response.json();}catch{}
 return {status:response.status(),data};
}
async function screenshot(name){await page.screenshot({path:join(out,name),fullPage:true,mask:[page.locator('.user-row'),page.locator('input[type=email]'),page.locator('input[type=password]')]});}
async function persist(){await context.storageState({path:join(privateDir,'state.json')});await writeFile(join(privateDir,'config.json'),JSON.stringify(config),{mode:0o600});}
const status={run,mode,startedAt:new Date().toISOString(),checks:[],errors:[]};
try{
 if(mode==='login'){
  let envelope;
  for(let n=0;n<90;n++){
   const u=`https://api.github.com/repos/${repository}/contents/.qa/envelope-${run}.json?ref=${encodeURIComponent(branch)}`;
   const response=await fetch(u,{headers:{authorization:`Bearer ${process.env.GH_READ_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
   if(response.ok){const file=await response.json();envelope=JSON.parse(Buffer.from(file.content,'base64').toString());break;}
   if(response.status!==404)throw new Error(`Envelope fetch HTTP ${response.status}`);
   await sleep(8000);
  }
  if(!envelope||envelope.run!==run)throw new Error('No valid encrypted QA input received before timeout');
  const decoded=privateDecrypt({key:await readFile(join(privateDir,'key.pem')),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from(run)},Buffer.from(envelope.ciphertext,'base64'));
  const credentials=JSON.parse(decoded.toString());decoded.fill(0);
  await rm(join(privateDir,'key.pem'),{force:true});
  if(credentials.run!==run||credentials.expiresAt<Date.now())throw new Error('QA authorization expired or wrong run');
  mask(credentials.email);mask(credentials.password);
  config={api:null,auth:null,publishableKey:null};
  await attach();
  page.on('request',request=>{const u=new URL(request.url());if(u.pathname.startsWith('/v1/'))config.api=u.origin;if(u.pathname==='/auth/v1/token'){config.auth=u.origin;config.publishableKey=request.headers().apikey;}});
  let authStatus=null;
  page.on('response',response=>{if(new URL(response.url()).pathname==='/auth/v1/token')authStatus=response.status();});
  await page.goto(site,{waitUntil:'networkidle',timeout:45000});
  await page.locator('input[type=email]').fill(credentials.email);
  await page.locator('input[type=password]').fill(credentials.password);
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  try{await page.waitForURL(url=>!url.pathname.endsWith('/login'),{timeout:45000});}catch{
   status.authHttp=authStatus;status.errors.push(clean(await page.locator('.notice').allTextContents()));
   await screenshot('login-blocked.png');throw new Error('Website login did not complete; no password guesses or account changes attempted');
  }
  credentials.password='';credentials.email='';
  await page.waitForTimeout(2500);
  if(!config.api)throw new Error('No API origin observed after login');
  const settings=await api('/v1/settings');
  status.checks.push({name:'password-login',pass:true,authHttp:authStatus},{name:'allowlist',pass:settings.status===200,http:settings.status});
  if(settings.status!==200)throw new Error(`Account API access HTTP ${settings.status}`);
  status.capabilities=settings.data.capabilities;
  const models=await api('/v1/local-models');status.models=models.status===200?models.data:{http:models.status};
  const list=await api('/v1/projects');status.existingProjects={http:list.status,count:Array.isArray(list.data)?list.data.length:null};
  status.existingActiveCount=Array.isArray(list.data)?list.data.filter(p=>['queued','rendering','generating_media'].includes(p.status)).length:null;
  for(const route of ['new','media','exports','settings']){
   await page.goto(site+route,{waitUntil:'networkidle',timeout:45000});
   status.checks.push({name:`route-${route}`,pass:!page.url().endsWith('/login')});
  }
  await page.setViewportSize({width:390,height:844});await page.goto(site+'new',{waitUntil:'networkidle'});
  status.checks.push({name:'authenticated-mobile-overflow',pass:await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)});
  await screenshot('new-mobile.png');
  await page.setViewportSize({width:1440,height:1000});
  // Input validation uses no valid create request and therefore creates no projects.
  for(const [name,value] of [['empty',''],['spaces','   '],['too-short','x'],['too-long','x'.repeat(30001)],['wrong-type',42]]){
   const r=await api('/v1/videos','POST',{sourceText:value});status.checks.push({name:`reject-${name}`,pass:r.status===400,http:r.status});
  }
  const none=await api('/v1/projects/00000000-0000-4000-8000-000000000099');status.checks.push({name:'unknown-project-denied',pass:none.status===404,http:none.status});
  await persist();
  status.outcome='AUTHENTICATED';
 }else if(mode==='case'){
  const id=process.argv[3];if(!/^B\d\d$/.test(id))throw new Error('Invalid case identifier');status.case=id;
  try{config=JSON.parse(await readFile(join(privateDir,'config.json')));}catch{throw new Error('Authenticated preflight did not complete');}
  const corpus=JSON.parse(await readFile('docs/audit/benchmark-corpus.json'));
  const item=corpus.cases.find(x=>x.id===id);if(!item)throw new Error('Unknown case');
  await attach(join(privateDir,'state.json'));await page.goto(site+'new',{waitUntil:'networkidle',timeout:45000});
  if(page.url().endsWith('/login'))throw new Error('Session expired before benchmark');
  try{const blocked=await readFile(join(privateDir,'blocked.txt'),'utf8');if(blocked)throw new Error(blocked);}catch(e){if(e.code!=='ENOENT')throw e;}
  let created;
  if(id==='B01'){
   const textarea=page.locator('textarea').first();await textarea.fill(item.sourceText);
   const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/videos'&&r.request().method()==='POST',{timeout:45000});
   await page.getByRole('button',{name:'Tạo video',exact:true}).click();
   const response=await responsePromise;created={status:response.status(),data:await response.json()};
   status.creationPath='public-website-browser';
  }else{
   created=await api('/v1/videos','POST',{sourceText:item.sourceText,settings:corpus.defaults},`qa-${run}-${id}`);
   status.creationPath='authenticated-api';
  }
  if(created.status!==202){if([401,403,429,503].includes(created.status))await writeFile(join(privateDir,'blocked.txt'),`Generation blocked by HTTP ${created.status}; no further jobs submitted`);throw new Error(`Create video HTTP ${created.status}: ${clean(created.data?.error??'')}`);}
  const projectId=created.data.project.id;let jobId=created.data.job.id;
  status.projectId=projectId;status.jobId=jobId;status.topic=item.topic;status.targetDurationSec=created.data.project.settings.targetDurationSec;status.events=[];
  await save(`${id}.json`,status);
  await page.goto(site+`studio/${projectId}`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(1500);
  if(id==='B01'){
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
   status.checks.push({name:'refresh-project-while-processing',pass:page.url().includes(projectId)});
   await context.setOffline(true);await sleep(2500);await context.setOffline(false);await sleep(1500);
   const recovered=await api(`/v1/projects/${projectId}/jobs`);status.checks.push({name:'network-resume-same-job',pass:recovered.status===200&&recovered.data.some(j=>j.id===jobId)});
   await screenshot('B01-processing.png');
  }
  const deadline=Date.now()+12*60*1000;let lastStage='',retries=0;
  while(Date.now()<deadline){
   const response=await api(`/v1/projects/${projectId}/jobs`);if(response.status!==200)throw new Error(`Job observation HTTP ${response.status}`);
   const job=response.data.find(x=>x.id===jobId);if(!job)throw new Error('Original benchmark job not found');
   const stage=`${job.status}:${job.stage}:${job.progress}`;
   if(stage!==lastStage){status.events.push({at:new Date().toISOString(),status:job.status,stage:clean(job.stage),progress:job.progress});lastStage=stage;await save(`${id}.json`,status);console.log(`${id}: ${clean(stage)}`);}
   if(job.status==='completed')break;
   if(job.status==='failed'||job.status==='cancelled'){
    status.lastJobError=clean(job.errorMessage??job.stage);
    if(retries===0&&job.status==='failed'){
     const before=await api(`/v1/projects/${projectId}`);status.beforeRetrySceneHashes=before.data?.scenes?.map(s=>({id:s.id,status:s.mediaStatus,image:createHash('sha256').update(s.imagePath??'').digest('hex'),audio:createHash('sha256').update(s.audioPath??'').digest('hex')}));
     const retry=await api(`/v1/jobs/${jobId}/retry`,'POST');status.retryHttp=retry.status;retries++;
     if(retry.status===202){jobId=retry.data.id;status.jobId=jobId;await sleep(5000);continue;}
    }
    await writeFile(join(privateDir,'blocked.txt'),'A benchmark job failed after a bounded retry; further submissions stopped to avoid repeating infrastructure failures');
    throw new Error(`Generation failed: ${status.lastJobError}`);
   }
   await sleep(6000);
  }
  const result=await api(`/v1/projects/${projectId}/result`);
  if(!result.data?.export){await writeFile(join(privateDir,'blocked.txt'),'Observation deadline reached; a server job may still be running. Do not create duplicates');throw new Error('No final export within observation deadline; server job retained');}
  const project=await api(`/v1/projects/${projectId}`);
  status.sceneCount=project.data.scenes.length;
  status.narrationMatchesSource=project.data.scenes.map(s=>s.narration).join('')===item.sourceText;
  status.scenes=project.data.scenes.map(s=>({id:s.id,order:s.order,narration:s.narration,imagePrompt:s.imagePrompt,durationMs:s.actualDurationMs,mediaStatus:s.mediaStatus,subtitles:s.subtitles,imageHash:createHash('sha256').update(s.imagePath??'').digest('hex'),audioHash:createHash('sha256').update(s.audioPath??'').digest('hex')}));
  await page.reload({waitUntil:'networkidle',timeout:45000});
  const player=page.locator('video.result-video');await player.waitFor({timeout:30000});
  await player.evaluate(v=>{v.muted=true;return v.play();});await sleep(1300);
  status.checks.push({name:'preview-playing',pass:await player.evaluate(v=>v.currentTime>0&&v.videoWidth>0)});
  await player.evaluate(v=>v.pause());await screenshot(`${id}-complete.png`);
  const mp4=join(out,`${id}.mp4`);
  if(id==='B01'){
   const download=page.waitForEvent('download',{timeout:120000});
   await page.getByRole('button',{name:/Tải MP4/}).first().click();
   await(await download).saveAs(mp4);status.downloadPath='browser-download-button';
  }else{
   const u=new URL(result.data.export.downloadUrl);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co'))throw new Error('Unexpected signed-storage origin');
   const response=await fetch(u,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Download HTTP ${response.status}`);
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>200*1024*1024)throw new Error('Export too large');await writeFile(mp4,bytes);status.downloadPath='signed-storage';
  }
  const probe=await exec('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate','-of','json',mp4],{timeout:30000});
  status.probe=JSON.parse(probe.stdout);status.videoCreated=true;status.qualityScores=null;
  status.qualityStatus='REQUIRES_EDITORIAL_REVIEW';
  const duration=Number(status.probe.format.duration);
  await exec('ffmpeg',['-y','-v','error','-i',mp4,'-vf',`fps=1/${Math.max(1,duration/6)},scale=270:480,tile=3x2`,'-frames:v','1',join(out,`${id}-contact-sheet.jpg`)],{timeout:60000});
  await page.goto(site+'new',{waitUntil:'domcontentloaded'});await page.goto(site+`studio/${projectId}`,{waitUntil:'networkidle'});
  status.checks.push({name:'reopen-export',pass:await page.locator('video.result-video').count()===1});
  await persist();status.outcome='VIDEO_DOWNLOADED';
 }else if(mode==='cleanup'){
  // This run's session only; never reset passwords or sign out other sessions.
  try{
   config=JSON.parse(await readFile(join(privateDir,'config.json')));await attach(join(privateDir,'state.json'));await page.goto(site,{waitUntil:'domcontentloaded'});
   const s=await session();
   const response=await context.request.post(config.auth+'/auth/v1/logout?scope=local',{headers:{apikey:config.publishableKey,authorization:`Bearer ${s.access_token}`},timeout:15000});
   status.checks.push({name:'qa-session-signout-local',pass:response.ok(),http:response.status()});
  }catch(e){status.errors.push(clean(e.message));}
  await rm(privateDir,{recursive:true,force:true});status.outcome='PRIVATE_RUNNER_FILES_REMOVED';
 }else throw new Error('Unknown mode');
}catch(error){status.outcome='BLOCKED_OR_FAILED';status.errors.push(clean(error.message));process.exitCode=1;}
finally{
 status.finishedAt=new Date().toISOString();status.elapsedMs=Date.parse(status.finishedAt)-Date.parse(status.startedAt);
 if(page&&mode==='case'&&status.outcome!=='VIDEO_DOWNLOADED'){try{await screenshot(`${status.case??'case'}-blocked.png`);}catch{}}
 await save(mode==='case'?`${status.case??'case'}.json`:`${mode}.json`,status);
 await browser.close();
 console.log(JSON.stringify({mode,case:status.case,outcome:status.outcome,checks:status.checks,errors:status.errors}));
}
