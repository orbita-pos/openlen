import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArtifactRender, ArtifactRenderPacket } from "../render-protocol";
import { ArtifactError } from "../types";
import {
  decodeRenderResult,
  parseBridgeResponse,
  type BridgeLeftovers,
  type BridgeMetrics,
  type BridgeRequest,
  type BridgeResponse,
} from "./bridge-protocol";

/**
 * The Windows side of the WSL bridge, shared by the Linux acceptance
 * (scripts/artifact-linux-acceptance.ts) and the trial worker
 * (scripts/artifact-trial-worker.ts). Test glue only, like the bridge.
 */

export function linuxPath(windowsPath: string): string {
  const full = resolve(windowsPath);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(full);
  if (!match) throw new Error(`not a drive path: ${full}`);
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g, "/")}`;
}

/** Runs one program inside the distro as given: --exec, no Linux shell re-reading the line. */
export function wsl(distro: string, args: readonly string[]): { code: number; stdout: string; stderr: string } {
  const out = spawnSync("wsl.exe", ["-d", distro, "--exec", ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return { code: out.status ?? -1, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

/** Bundles the bridge — the real supervisor and nothing else — into one .mjs. Returns its sha256. */
export async function bundleBridge(outfile: string): Promise<string> {
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["scripts/artifact-renderer-bridge.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
    tsconfig: "tsconfig.json", outfile, logLevel: "warning",
    banner: { js: "import { createRequire as ___cr } from 'module'; const require = ___cr(import.meta.url);" },
  });
  return createHash("sha256").update(await readFile(outfile)).digest("hex");
}

export interface BridgeCall {
  readonly kind: string;
  readonly ok: boolean;
  readonly code?: string;
  readonly metrics: BridgeMetrics;
  readonly leftovers: BridgeLeftovers;
}

export function createBridge(o: { distro: string; node: string; bridgeFile: string; image: string }) {
  const bridgeLinux = linuxPath(o.bridgeFile);

  function call(request: BridgeRequest, signal?: AbortSignal): Promise<BridgeResponse> {
    return new Promise((done, fail) => {
      const child = spawn("wsl.exe", ["-d", o.distro, "--exec", o.node, bridgeLinux], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      const chunks: Buffer[] = [];
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16 * 1024) stderr += chunk.toString("utf8"); });
      // A worker's job signal, carried across: the bridge aborts the real supervisor.
      const cancel = () => { child.stdin.write("cancel\n"); };
      signal?.addEventListener("abort", cancel, { once: true });
      child.stdin.on("error", () => undefined);
      child.once("error", fail);
      child.once("close", () => {
        signal?.removeEventListener("abort", cancel);
        const last = Buffer.concat(chunks).toString("utf8").trim().split("\n").pop() ?? "";
        try { done(parseBridgeResponse(last)); }
        catch { fail(new Error(`the bridge gave no answer: ${stderr.slice(0, 2000)}`)); }
      });
      child.stdin.write(`${JSON.stringify(request)}\n`);
      if (signal?.aborted) cancel();
    });
  }

  /** An ArtifactRender for one container job named after `token`. `onCall` sees every packet and outcome. */
  function render(token: () => string, onCall?: (packet: ArtifactRenderPacket, outcome: BridgeCall) => void | Promise<void>): ArtifactRender {
    return async (packet, signal) => {
      const response = await call({ type: "render", image: o.image, token: token(), packet }, signal);
      await onCall?.(packet, { kind: packet.kind, ok: response.ok, ...(response.ok ? {} : { code: response.error.code }), metrics: response.metrics, leftovers: response.leftovers });
      if (!response.ok) throw new ArtifactError(response.error.code, response.error.message);
      if (!response.result) throw new ArtifactError("bridge_result_missing");
      return decodeRenderResult(response.result);
    };
  }

  async function inspect(tool: "ffprobe" | "pdfinfo", name: string, bytes: Uint8Array): Promise<string> {
    const response = await call({ type: "inspect", image: o.image, tool, file: { name, base64: Buffer.from(bytes).toString("base64") } });
    if (!response.ok) throw new ArtifactError(response.error.code, response.error.message);
    return response.output ?? "";
  }

  return { call, render, inspect };
}
export type Bridge = ReturnType<typeof createBridge>;
