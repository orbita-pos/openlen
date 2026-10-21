/**
 * THE LINUX SIDE OF THE RENDERER ACCEPTANCE (docs/artifacts-renderer.md).
 *
 * `scripts/artifact-linux-acceptance.ts` bundles this file into one
 * self-contained .mjs and runs it with plain `node` next to Docker. It reads one
 * request line on stdin and answers with one line on stdout:
 *
 * - `render`: the REAL `containerArtifactRenderer` — the production docker
 *   arguments, timeouts, cancellation and cleanup — on the local image, while
 *   `docker stats` samples the job's container for its peak memory and CPU.
 * - `inspect`: an independent offline check of a produced file (ffprobe,
 *   pdfinfo) or the image's tool versions, in a throwaway container of the
 *   same image with no network.
 *
 * A later stdin line `cancel` aborts the job the way a worker's signal would.
 * Test glue only: never imported by the product.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { containerArtifactRenderer } from "../lib/artifacts/render-container";
import { ArtifactError } from "../lib/artifacts/types";
import {
  encodeRenderResult,
  parseBridgeRequest,
  parseDockerMemory,
  type BridgeLeftovers,
  type BridgeMetrics,
  type BridgeRequest,
  type BridgeResponse,
} from "../lib/artifacts/acceptance/bridge-protocol";

function run(command: string, args: readonly string[], maxBytes = 4 * 1024 * 1024): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < maxBytes) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8"); });
    child.once("error", (error) => resolve({ code: -1, stdout, stderr: String(error) }));
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function leftovers(token?: string): Promise<BridgeLeftovers> {
  const containers = token
    ? (await run("docker", ["ps", "-a", "-q", "--filter", `name=^/openlen-artifact-${token}$`])).stdout.split("\n").filter(Boolean).length
    : 0;
  const tempDirectories = (await readdir(tmpdir())).filter((name) => name.startsWith("openlen-artifact-")).length;
  return { containers, tempDirectories };
}

/** Polls `docker stats` for one container until stopped. Samples taken before
 * the container exists, or after it is gone, are simply skipped. */
function sampleContainer(name: string) {
  let peakMemoryBytes: number | null = null, peakCpuPercent: number | null = null, peakPids: number | null = null, samples = 0, stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const out = await run("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}}|{{.CPUPerc}}|{{.PIDs}}", name]);
      const [memory, cpu, pids] = out.code === 0 ? out.stdout.trim().split("|") : [];
      const bytes = memory ? parseDockerMemory(memory) : null;
      const percent = cpu ? Number.parseFloat(cpu) : Number.NaN;
      if (bytes !== null) { samples++; peakMemoryBytes = Math.max(peakMemoryBytes ?? 0, bytes); }
      if (Number.isFinite(percent)) peakCpuPercent = Math.max(peakCpuPercent ?? 0, percent);
      const tasks = pids ? Number.parseInt(pids, 10) : Number.NaN;
      if (Number.isFinite(tasks)) peakPids = Math.max(peakPids ?? 0, tasks);
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })();
  return async () => { stopped = true; await loop; return { peakMemoryBytes, peakCpuPercent, peakPids, samples }; };
}

const VERSIONS = [
  'echo "node $(node --version)"',
  "chromium --version",
  "soffice --version 2>/dev/null | head -1",
  "ffmpeg -version | head -1",
  "pdftoppm -v 2>&1 | head -1",
  'echo "fonts $(fc-list | wc -l)"',
  'echo "puppeteer $(node -p "require(\\"/renderer/node_modules/puppeteer/package.json\\").version")"',
].join("; ");

async function inspect(request: Extract<BridgeRequest, { type: "inspect" }>): Promise<string> {
  const isolated = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "--user", `${process.getuid!()}:${process.getgid!()}`];
  if (request.tool === "versions") {
    const out = await run("docker", [...isolated, "--entrypoint", "sh", request.image, "-c", VERSIONS]);
    if (out.code !== 0) throw new ArtifactError("inspect_failed", out.stderr.slice(0, 2000));
    return out.stdout;
  }
  const directory = await mkdtemp(join(tmpdir(), "openlen-inspect-"));
  try {
    await writeFile(join(directory, request.file!.name), Buffer.from(request.file!.base64, "base64"));
    const target = `/in/${request.file!.name}`;
    const args = request.tool === "ffprobe"
      ? ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames,sample_rate,channels:format=duration", "-of", "json", target]
      : [target];
    const out = await run("docker", [...isolated, "--mount", `type=bind,source=${directory},target=/in,readonly`, "--entrypoint", request.tool, request.image, ...args]);
    if (out.code !== 0) throw new ArtifactError("inspect_failed", out.stderr.slice(0, 2000));
    return out.stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof ArtifactError) return { code: error.code, message: error.message.slice(0, 4000) };
  if (error instanceof Error && error.name === "AbortError") return { code: "aborted", message: error.message.slice(0, 500) };
  return { code: "bridge_error", message: String(error instanceof Error ? error.message : error).slice(0, 2000) };
}

async function answer(request: BridgeRequest, signal: AbortSignal): Promise<BridgeResponse> {
  const started = Date.now();
  if (request.type === "inspect") {
    const metrics = (): BridgeMetrics => ({ ms: Date.now() - started, peakMemoryBytes: null, peakCpuPercent: null, peakPids: null, samples: 0 });
    try { return { ok: true, output: await inspect(request), metrics: metrics(), leftovers: await leftovers() }; }
    catch (error) { return { ok: false, error: describe(error), metrics: metrics(), leftovers: await leftovers() }; }
  }
  const stop = sampleContainer(`openlen-artifact-${request.token}`);
  try {
    const result = await containerArtifactRenderer(request.image, request.token)(request.packet, signal);
    const sampled = await stop();
    return { ok: true, result: encodeRenderResult(result), metrics: { ms: Date.now() - started, ...sampled }, leftovers: await leftovers(request.token) };
  } catch (error) {
    const sampled = await stop();
    return { ok: false, error: describe(error), metrics: { ms: Date.now() - started, ...sampled }, leftovers: await leftovers(request.token) };
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const controller = new AbortController();
let started = false;
lines.on("line", (line) => {
  if (started) {
    if (line.trim() === "cancel") controller.abort(new ArtifactError("acceptance_cancelled"));
    return;
  }
  started = true;
  void (async () => {
    let response: BridgeResponse;
    try {
      response = await answer(parseBridgeRequest(line), controller.signal);
    } catch (error) {
      response = { ok: false, error: describe(error), metrics: { ms: 0, peakMemoryBytes: null, peakCpuPercent: null, peakPids: null, samples: 0 }, leftovers: await leftovers() };
    }
    await new Promise<void>((resolve) => process.stdout.write(`${JSON.stringify(response)}\n`, () => resolve()));
    lines.close();
    process.stdin.destroy();
  })();
});
