import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAudioMixFilter } from "./render-quality";
const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
async function samples(filter: string, loud = false): Promise<number[]> {
  const voice = loud ? "aevalsrc='1.6*sin(2*PI*440*t)':s=48000:d=2" : "aevalsrc='if(between(t,1,3),0.4*sin(2*PI*440*t),0)':s=48000:d=6";
  const args = ["-hide_banner","-loglevel","error","-f","lavfi","-i",voice];
  if (!loud) args.push("-f","lavfi","-i","aevalsrc='0.3*sin(2*PI*180*t)':s=48000:d=6");
  args.push("-filter_complex",filter,"-map","[a]","-ac","1","-ar","48000","-f","f64le","pipe:1");
  const { stdout } = await exec(ffmpeg,args,{encoding:"buffer",maxBuffer:16*1024*1024,timeout:30000});
  const values: number[] = [];
  for(let i=0;i<stdout.length;i+=8) values.push(stdout.readDoubleLE(i));
  return values;
}
function amplitude(values: number[],start: number,end: number) {
  let real=0,imaginary=0;
  const first=Math.round(start*48000),last=Math.round(end*48000);
  for(let i=first;i<last;i++) {
    const phase=2*Math.PI*180*(i-first)/48000;
    real+=values[i]!*Math.cos(phase); imaginary+=values[i]!*Math.sin(phase);
  }
  return 2*Math.hypot(real,imaginary)/(last-first);
}
const baseline="[1:a]volume=0.5,afade=t=out:st=5:d=1[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]";
const measurements=[];
for(const [variant,filter] of [["before",baseline],["after",buildAudioMixFilter(true,.5,6000)]]) {
  const values=await samples(filter!);
  const duckingDb=20*Math.log10(amplitude(values,1.5,2.5)/amplitude(values,.4,.9));
  assert.equal(values.length,6*48000,"Audio timeline must stay six seconds");
  if(variant==="after") assert(duckingDb < -8,"Music must attenuate during speech");
  measurements.push({variant,duckingDb,durationSec:values.length/48000});
}
const limited=await samples(buildAudioMixFilter(false,0,2000),true);
const peak=limited.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
assert(peak<=.951,"Limiter must protect voice even without music");
assert.equal(limited.length,2*48000);
console.log(JSON.stringify({scope:"Synthetic signal regression, not TTS quality",measurements,noMusicPeak:peak},null,2));
