import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ArtifactError } from "./types";
import { validateRenderPacket, type ArtifactRender } from "./render-protocol";

export function rendererContainerArgs(image: string, name: string, output: string, uid: number, gid: number): string[] {
  if (!/^[a-z0-9][a-z0-9._/:@-]{0,200}$/.test(image) || !/^openlen-artifact-[a-f0-9-]{36}$/.test(name) || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) throw new ArtifactError("invalid_renderer_config");
  return ["run", "--rm", "--pull", "never", "-i", "--init", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--cpus", "2", "--memory", "2g", "--memory-swap", "2g", "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m", "--mount", `type=bind,source=${output},target=/output`, "--user", `${uid}:${gid}`, image];
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
export function containerArtifactRenderer(image: string): ArtifactRender {
  return async (packet, signal) => {
    if (process.platform !== "linux") throw new ArtifactError("renderer_requires_linux");
    validateRenderPacket(packet); signal.throwIfAborted();
    const output = await mkdtemp(join(tmpdir(), "openlen-artifact-"));
    const name = `openlen-artifact-${randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new ArtifactError("render_timeout")), 60_000);
    try {
      const code = await docker(rendererContainerArgs(image, name, output, process.getuid!(), process.getgid!()), JSON.stringify(packet), controller.signal);
      signal.throwIfAborted();
      const metaPath = join(output, "result.json");
      const stat = await lstat(metaPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new ArtifactError("invalid_render_result");
      const result = JSON.parse(await readFile(metaPath, "utf8")) as { ok?: boolean; code?: string; checks?: string[]; diagnostics?: string[] };
      if (code !== 0 || result.ok !== true) throw new ArtifactError(result.code === "artifact_resource_missing" ? result.code : "artifact_render_failed", JSON.stringify(result.diagnostics?.slice(0, 8) ?? []));
      const file = join(output, "render.png"); const fileStat = await lstat(file);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 16 * 1024 * 1024 || !Array.isArray(result.checks) || result.checks.some((c) => typeof c !== "string" || c.length > 200)) throw new ArtifactError("invalid_render_result");
      return { png: new Uint8Array(await readFile(file)), checks: result.checks };
    } finally {
      clearTimeout(timeout); signal.removeEventListener("abort", abort);
      // Killing docker's client does not kill the container. Always remove
      // this exact generated name before releasing its lease/temporary files.
      await docker(["rm", "-f", name], "", AbortSignal.timeout(10_000)).catch(() => undefined);
      const target = resolve(output), prefix = resolve(tmpdir()) + "/openlen-artifact-";
      if (!target.startsWith(prefix)) throw new ArtifactError("invalid_render_directory");
      await rm(target, { recursive: true, force: true });
    }
  };
}
