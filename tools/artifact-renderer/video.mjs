import { spawn,execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
const execute=promisify(execFile);
/** Trusted, fixed encoder invocation. No authored command/filename arguments. */
export function createMotionEncoder(packet,outputPath="/output/render.mp4"){
  const child=spawn("ffmpeg",["-hide_banner","-loglevel","error","-n","-f","image2pipe","-vcodec","png","-framerate",String(packet.fps),"-i","pipe:0","-frames:v",String(packet.frameCount),"-c:v","libx264","-threads","2","-preset","medium","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart","-an","-fs","240000000",outputPath],{stdio:["pipe","ignore","pipe"]});
  let stderr=0,count=0;
  const closed=new Promise((resolve,reject)=>{
    child.once("error",()=>reject(new Error("motion_encoder_unavailable")));
    child.once("close",code=>code===0?resolve():reject(new Error("motion_encode_failed")));
  });
  closed.catch(()=>undefined);
  child.stderr.on("data",chunk=>{if((stderr+=chunk.length)>64*1024)child.kill("SIGKILL");});
  child.stdin.on("error",()=>undefined);
  const watchdog=setTimeout(()=>child.kill("SIGKILL"),900_000);watchdog.unref();
  return {
    async write(bytes,index){
      if(index!==count||index>=packet.frameCount)throw new Error("motion_frame_sequence_invalid");
      await new Promise((resolve,reject)=>child.stdin.write(bytes,error=>error?reject(new Error("motion_encode_failed")):resolve()));count++;
    },
    async finish(){
      child.stdin.end();await closed;clearTimeout(watchdog);
      if(count!==packet.frameCount||(await stat(outputPath)).size>240_000_000)throw new Error("motion_frame_count_mismatch");
      const opts={timeout:120_000,maxBuffer:64*1024};
      const {stdout}=await execute("ffprobe",["-v","error","-count_frames","-show_entries","stream=codec_name,codec_type,width,height,avg_frame_rate,nb_read_frames,pix_fmt","-show_entries","format=duration","-of","json",outputPath],opts);
      const probe=JSON.parse(stdout),stream=probe.streams?.[0];
      const duration=Number(probe.format?.duration);
      if(probe.streams?.length!==1||stream.codec_type!=="video"||stream.codec_name!=="h264"||stream.pix_fmt!=="yuv420p"||stream.width!==packet.width||stream.height!==packet.height||stream.avg_frame_rate!==`${packet.fps}/1`||Number(stream.nb_read_frames)!==packet.frameCount||!Number.isFinite(duration)||Math.abs(duration-packet.durationSeconds)>1/packet.fps)throw new Error("motion_video_invalid");
      await execute("ffmpeg",["-hide_banner","-loglevel","error","-xerror","-err_detect","explode","-i",outputPath,"-f","null","-"],opts);
      return {frameCount:packet.frameCount,fps:packet.fps,durationSeconds:duration};
    },
    abort(){clearTimeout(watchdog);child.stdin.destroy();child.kill("SIGKILL");},
  };
}
