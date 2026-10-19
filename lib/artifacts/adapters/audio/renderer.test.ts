// @vitest-environment node
import { expect,it } from "vitest";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pcmToWav } from "./pcm";
import { validateRenderPacket } from "../../render-protocol";
const run=promisify(execFile);
function tone(hz:number,seconds:number){const pcm=Buffer.alloc(seconds*48000);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*hz*i/24000)),i*2);return pcmToWav(pcm).wav;}
const track=(seconds=1)=>({dataBase64:Buffer.from(tone(440,seconds)).toString("base64"),mime:"audio/wav",role:"narration",startSeconds:0,trimSeconds:0,gain:1,fadeInSeconds:0,fadeOutSeconds:0});
it("validates audio packets, rejecting arbitrary URLs, codecs, negative gains and aggregate input overflows",()=>{
  const packet={version:1,kind:"audio",html:"",width:1280,height:720,probes:[],audio:{durationSeconds:2,duckMusic:true,tracks:[track()]}};
  expect(()=>validateRenderPacket(packet as never)).not.toThrow();
  for(const patch of [{mime:"text/html"},{gain:-1},{dataBase64:"https://evil"},{startSeconds:2},{role:"narration",trimSeconds:1},{url:"file:///etc/passwd"}])expect(()=>validateRenderPacket({...packet,audio:{...packet.audio,tracks:[{...track(),...patch}]}} as never)).toThrow();
});
it("mixes actual WAV tracks with ducked music and exports decodable MP3/WAV of the requested duration",async()=>{
  const {mixAudioTracks}=await import("../../../../tools/artifact-renderer/audio.mjs");
  const dir=await mkdtemp(join(tmpdir(),"len-audio-test-"));
  try{
    const result=await mixAudioTracks({durationSeconds:2,duckMusic:true,tracks:[track(),{...track(2),role:"music",gain:0.2,fadeInSeconds:0.1,fadeOutSeconds:0.2}]},dir);
    expect(result).toMatchObject({durationSeconds:2,sampleRate:48000,channels:2});
    const wav=await readFile(join(dir,"audio.wav")),mp3=await readFile(join(dir,"audio.mp3"));expect(wav.length).toBeGreaterThan(100_000);expect(mp3.length).toBeGreaterThan(1000);
    const {stdout}=await run("ffprobe",["-v","error","-show_entries","stream=codec_name,codec_type,sample_rate,channels","-of","json",join(dir,"audio.mp3")]);expect(JSON.parse(stdout).streams).toEqual([expect.objectContaining({codec_name:"mp3",codec_type:"audio",sample_rate:"48000",channels:2})]);
    const raw=await run("ffmpeg",["-v","error","-i",join(dir,"audio.wav"),"-f","s16le","-ac","1","-ar","24000","pipe:1"],{encoding:"buffer",maxBuffer:200_000});
    const pcm=raw.stdout;const rms=(from:number,to:number)=>{let sum=0;for(let i=from*24000;i<to*24000;i++)sum+=pcm.readInt16LE(i*2)**2;return Math.sqrt(sum/((to-from)*24000));};
    expect(rms(0.2,0.8)).toBeGreaterThan(500);expect(rms(1.5,1.8)).toBeGreaterThan(20);
  }finally{await rm(dir,{recursive:true,force:true});}
},30_000);
it("encodes real video with AAC sound while preserving all thirty H264 frames",async()=>{
  const {createMotionEncoder}=await import("../../../../tools/artifact-renderer/video.mjs");
  const dir=await mkdtemp(join(tmpdir(),"len-audio-video-"));
  const packet={fps:30,frameCount:30,durationSeconds:1,width:1280,height:720,audio:{durationSeconds:1,duckMusic:true,tracks:[track()]}};
  let encoder:ReturnType<typeof createMotionEncoder>|undefined;
  try{
    await run("ffmpeg",["-v","error","-f","lavfi","-i","color=c=black:s=1280x720","-frames:v","1",join(dir,"frame.png")]);
    encoder=createMotionEncoder(packet,join(dir,"render.mp4"));
    const png=await readFile(join(dir,"frame.png"));for(let i=0;i<30;i++)await encoder.write(png,i);
    expect(await encoder.finish()).toMatchObject({frameCount:30,fps:30,durationSeconds:1});
    const {stdout}=await run("ffprobe",["-v","error","-count_frames","-show_entries","stream=codec_name,codec_type,nb_read_frames","-of","json",join(dir,"render.mp4")]);
    expect(JSON.parse(stdout).streams).toEqual([expect.objectContaining({codec_name:"h264",nb_read_frames:"30"}),expect.objectContaining({codec_name:"aac",codec_type:"audio"})]);
  }finally{encoder?.abort();await rm(dir,{recursive:true,force:true});}
},30_000);
it("rejects corrupt media and narration overrun instead of delivering silent or clipped audio",async()=>{
  const {mixAudioTracks}=await import("../../../../tools/artifact-renderer/audio.mjs");
  const dir=await mkdtemp(join(tmpdir(),"len-audio-bad-"));
  try{
    await expect(mixAudioTracks({durationSeconds:1,duckMusic:true,tracks:[track(2)]},dir)).rejects.toThrow("audio_narration_overflow");
    await expect(mixAudioTracks({durationSeconds:1,duckMusic:true,tracks:[{...track(),dataBase64:Buffer.from("not audio").toString("base64")}]},dir)).rejects.toThrow();
  }finally{await rm(dir,{recursive:true,force:true});}
},30_000);
