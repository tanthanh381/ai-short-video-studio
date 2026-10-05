import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire('/tmp/component-browser/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch();
const result={scope:'Browser UI integration with synthetic authentication and intercepted API; no live login or AI generation',checks:[],errors:[]};
await mkdir('component-artifacts',{recursive:true});
const user='c84187c5-33ad-4c80-a6f3-b925ca4aee31',projectId='3b968fb5-a00d-4b9d-8bd5-638598d9ef4d',sceneId='73865c65-6b9c-4220-997c-75bece066dde';
const fakeUser={id:user,email:'qa@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-05T00:00:00Z'};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const fakeSession={access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user,exp:4102444800,role:'authenticated'})+'.fixture',refresh_token:'fixture-refresh-token',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:fakeUser};
const project={id:projectId,userId:user,title:'QA component repair',sourceText:'A test script for component repair.',inputMode:'full-script',hook:'',suggestedTitle:'',suggestedDescription:'',status:'draft',settings:{textProvider:'ollama',mediaProvider:'local',targetAudience:'Vietnamese viewers',style:'ke-chuyen',targetDurationSec:60,aspectRatio:'9:16',voice:'doc-truyen',localModels:{storyboard:null,image:null,tts:null,transcribe:null},visualStyle:'Cinematic',allowUploads:true,backgroundMusicPath:null,musicVolume:0.12,rewriteFullScript:false,subtitle:{enabled:true,preset:'classic',position:'bottom',fontColor:'#FFFFFF',outlineColor:'#101828',backgroundColor:'#000000',backgroundOpacity:0.35}},scenes:[{id:sceneId,order:0,narration:'A test script for component repair.',imagePrompt:'A notebook on a desk',estimatedDurationMs:5000,actualDurationMs:5000,imagePath:'fixture/image.png',audioPath:'fixture/audio.wav',thumbnailUrl:null,mediaStatus:'ready',errorMessage:null,subtitles:[{id:'9e4517ae-8462-4c4c-b1c7-45c79bf6af3c',startMs:0,endMs:4000,text:'A test script for component repair.'}]}],createdAt:'2026-10-05T00:00:00Z',updatedAt:'2026-10-05T00:00:00Z'};
try{
 for(const [component,label] of [['image','Tạo lại ảnh'],['audio','Tạo lại giọng và phụ đề'],['subtitles','Đồng bộ lại phụ đề']]){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(s=>localStorage.setItem('sb-qa-auth-auth-token',JSON.stringify(s)),fakeSession);
  let submitted=null;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname==='127.0.0.1')return route.continue();
   if(url.hostname==='qa-auth.supabase.co')return route.fulfill({json:{user:fakeUser}});
   if(url.hostname!=='qa-api.invalid')return route.abort();
   let body={};
   if(url.pathname==='/v1/settings')body={dailyBudgetUsd:0,maxConcurrentJobs:1,capabilities:{supabase:true,ai:false,openai:false,anthropic:false,ollama:true,localMedia:true,render:true}};
   else if(url.pathname==='/v1/local-models')body={available:false,storyboard:{models:[],default:null},image:{models:[],default:null},tts:{models:[],default:null},transcribe:{models:[],default:null}};
   else if(url.pathname.endsWith('/estimate'))body={imageCount:1,narrationCharacters:40,transcriptionMinutes:1,estimatedUsd:0,note:'Fixture'};
   else if(url.pathname.endsWith('/media/sign'))body={url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=',expiresIn:300};
   else if(url.pathname.endsWith('/result'))body={export:null,expiresIn:300};
   else if(url.pathname.endsWith('/jobs')){
    if(req.method()==='POST'){submitted=req.postDataJSON();body={id:'9e4517ae-8462-4c4c-b1c7-45c79bf6af3c',projectId,userId:user,type:'regenerate_scene',status:'completed',progress:100,stage:'Fixture only',errorMessage:null,createdAt:project.createdAt,updatedAt:project.updatedAt};}
    else body=[];
   }else if(url.pathname===`/v1/projects/${projectId}`)body=project;
   else if(url.pathname==='/v1/projects')body=[project];
   return route.fulfill({status:200,json:body});
  });
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto(`http://127.0.0.1:4173/ai-short-video-studio/studio/${projectId}`,{waitUntil:'networkidle',timeout:30000});
  await page.locator('.scene-repair summary').click({timeout:20000});
  await page.getByRole('button',{name:label,exact:true}).click();
  for(let n=0;n<40&&!submitted;n++)await page.waitForTimeout(100);
  assert.deepEqual(submitted,{type:'regenerate_scene',payload:{sceneId,component}});
  result.checks.push({name:`repair-${component}-payload`,passed:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  result.checks.push({name:`repair-${component}-mobile-overflow`,passed:!overflow});
  await page.screenshot({path:`component-artifacts/repair-${component}.png`,fullPage:true});
  await context.close();
 }
 assert.equal(result.errors.length,0);
 assert(result.checks.every(c=>c.passed));
}catch(e){result.errors.push(String(e.message));process.exitCode=1;}
finally{await browser.close();await writeFile('component-artifacts/browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
