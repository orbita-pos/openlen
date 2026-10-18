import { readFile,mkdir,writeFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { motionFixture } from "../lib/artifacts/testing/motion";
import { buildMotion } from "../lib/artifacts/adapters/motion/runtime";
import { stopBundlerWorker } from "../lib/apps/bundler/bundle-app";
async function main(){
  const [target,capture]=process.argv.slice(2);if(!target||!capture)throw new Error("Pass an explicit output directory and frozen synthetic-dashboard PNG");
  try{
    const input=motionFixture(new Uint8Array(await readFile(resolve(capture))));
    const built=await buildMotion(input),m=built.manifest,dir=resolve(target);await mkdir(dir,{recursive:true});
    await writeFile(join(dir,"motion.html"),built.html);
    await writeFile(join(dir,"packet.json"),JSON.stringify({version:1,kind:"motion",html:built.html,width:m.width,height:m.height,fps:m.fps,durationSeconds:m.durationSeconds,frameCount:m.frameCount,probes:[]}));
    console.log("Synthetic motion fixture compiled; browser/encoder/container verification is separate.");
  }finally{stopBundlerWorker();}
}
main().catch(()=>{console.error("Motion fixture compilation failed");process.exitCode=1;});
