import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ArtifactError } from "./types";
import { validateRenderPacket, type ArtifactRender } from "./render-protocol";
import {removeArtifactContainer} from "./container-supervisor";

export function rendererContainerArgs(image: string, name: string, output: string, uid: number, gid: number): string[] {
  if (!/^[a-z0-9][a-z0-9._/:@-]{0,200}$/.test(image) || !/^openlen-artifact-[a-f0-9-]{36}$/.test(name) || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) throw new ArtifactError("invalid_renderer_config");
  // 512 tasks: Chromium plus x264 peaked at 157 for a 6 s video in the Linux
  // acceptance, and 128 failed every video. Still a hard stop for a fork bomb.
  return ["run", "--rm", "--pull", "never", "-i", "--init", "--name", name, "--label","openlen.artifact-renderer=1", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--cpus", "2", "--memory", "2g", "--memory-swap", "2g", "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m", "--mount", `type=bind,source=${output},target=/output`, "--user", `${uid}:${gid}`, image];
}
function docker(args: string[], input: string, signal?: AbortSignal): Promise<number> {
  return new Promise((done, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "ignore", "pipe"], ...(signal ? { signal } : {}) });
    // Bound stderr without logging authored strings or private data.
    let bytes = 0;
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 64 * 1024) child.kill("SIGKILL"); });
    child.once("error", reject); child.once("close", (code) => done(code ?? -1));
    child.stdin.on("error", () => undefined); child.stdin.end(input);
  });
}

/** Worker-only entry point. Never call from Next request code. Each job gets
 * an offline, read-only container with no env, credentials or DB/socket mount.
 * Only the trusted renderer writes to one empty output directory. */
export function containerArtifactRenderer(image: string, fencingToken?:string, admit?:()=>Promise<void>): ArtifactRender {
  return async (packet, signal) => {
    if (process.platform !== "linux") throw new ArtifactError("renderer_requires_linux");
    validateRenderPacket(packet); signal.throwIfAborted();
    const output = await mkdtemp(join(tmpdir(), "openlen-artifact-"));
    const name = `openlen-artifact-${fencingToken??randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new ArtifactError("render_timeout")), packet.kind === "motion" ? 900_000 : ["slides","slides-layout","audio"].includes(packet.kind) ? 180_000 : 60_000);
    try {
      await admit?.();controller.signal.throwIfAborted();
      const code = await docker(rendererContainerArgs(image, name, output, process.getuid!(), process.getgid!()), JSON.stringify(packet), controller.signal);
      signal.throwIfAborted();
      const metaPath = join(output, "result.json");
      const stat = await lstat(metaPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new ArtifactError("invalid_render_result");
      const result = JSON.parse(await readFile(metaPath, "utf8")) as { ok?: boolean; code?: string; checks?: string[]; diagnostics?: string[];audio?:{durationSeconds:number;sampleRate:number;channels:number}; video?:{frameCount:number;fps:number;durationSeconds:number} };
      if (code !== 0 || result.ok !== true) {
        const codes=["invalid_audio_packet","audio_media_invalid","audio_track_timing_invalid","audio_narration_overflow","audio_export_invalid","motion_audio_invalid","artifact_resource_missing","slide_text_overflow","slide_layout_unsupported","slide_layout_too_large","slide_element_outside_canvas","motion_contract_missing","motion_nondeterministic","motion_video_invalid","motion_frame_count_mismatch"];
        throw new ArtifactError(result.code&&codes.includes(result.code)?result.code:"artifact_render_failed",JSON.stringify(result.diagnostics?.slice(0,8)??[]));
      }
      if(packet.kind==="audio"){
        if(!Array.isArray(result.checks)||result.checks.some(c=>typeof c!=="string"||c.length>200)||!result.audio||!Number.isFinite(result.audio.durationSeconds)||Math.abs(result.audio.durationSeconds-packet.audio.durationSeconds)>1/48000||result.audio.sampleRate!==48000||result.audio.channels!==2)throw new ArtifactError("invalid_render_result");
        const bytes:Record<string,Uint8Array>={};
        for(const name of ["mp3","wav"]){const path=join(output,`audio.${name}`),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<44||stat.size>25_000_000)throw new ArtifactError("invalid_render_result");bytes[name]=new Uint8Array(await readFile(path));}
        return {png:new Uint8Array(),mp3:bytes.mp3!,wav:bytes.wav!,audio:result.audio,checks:result.checks};
      }
      const file = join(output, "render.png"); const fileStat = await lstat(file);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 16 * 1024 * 1024 || !Array.isArray(result.checks) || result.checks.some((c) => typeof c !== "string" || c.length > 200)) throw new ArtifactError("invalid_render_result");
      const png = new Uint8Array(await readFile(file));
      if(packet.kind==="slides-layout"){
        const file=join(output,"layout.json"),stat=await lstat(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new ArtifactError("invalid_render_result");
        return {png,checks:result.checks,layout:JSON.parse(await readFile(file,"utf8"))};
      }
      if(packet.kind==="motion"){
        const videoPath=join(output,"render.mp4"),stat=await lstat(videoPath);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size<32||stat.size>240_000_000||!result.video||!Number.isFinite(result.video.durationSeconds)||result.video.frameCount!==packet.frameCount||result.video.fps!==packet.fps||Math.abs(result.video.durationSeconds-packet.durationSeconds)>1/packet.fps)throw new ArtifactError("invalid_render_result");
        return {png,mp4:new Uint8Array(await readFile(videoPath)),video:result.video,checks:result.checks};
      }
      if (packet.kind === "slides") {
        let total = 0;
        const readBounded = async (name: string, max: number) => {
          const path = join(output, name); const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > max || (total += stat.size) > 240 * 1024 * 1024) throw new ArtifactError("invalid_render_result");
          return new Uint8Array(await readFile(path));
        };
        const pdf = await readBounded("render.pdf", 64 * 1024 * 1024);
        const pages = [];
        for (let i = 1; i <= packet.pageCount; i++) pages.push(await readBounded(`page-${i}.png`, 16 * 1024 * 1024));
        return { png, pdf, pages, checks: result.checks };
      }
      return { png, checks: result.checks };
    } finally {
      clearTimeout(timeout); signal.removeEventListener("abort", abort);
      // Killing docker's client does not kill the container. Always remove
      // this exact generated name before releasing its lease/temporary files.
      await removeArtifactContainer(name);
      const target = resolve(output), prefix = resolve(tmpdir()) + "/openlen-artifact-";
      if (!target.startsWith(prefix)) throw new ArtifactError("invalid_render_directory");
      await rm(target, { recursive: true, force: true });
    }
  };
}
