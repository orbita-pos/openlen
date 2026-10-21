import { ArtifactError } from "../types";
import type { ArtifactRenderPacket, ArtifactRenderResult } from "../render-protocol";

/**
 * The line protocol of the Linux acceptance bridge (scripts/artifact-renderer-bridge.ts).
 *
 * Test glue only. In production one Linux worker process runs the adapters and
 * the container supervisor together. The acceptance splits them across the WSL
 * boundary — the adapters stay where the repo's toolchain runs, the real
 * `containerArtifactRenderer` runs next to Docker — and this is the only code
 * between them. Nothing in the product imports it.
 */
export type InspectTool = "ffprobe" | "pdfinfo" | "versions";
export type BridgeRequest =
  | { readonly type: "render"; readonly image: string; readonly token: string; readonly packet: ArtifactRenderPacket }
  | { readonly type: "inspect"; readonly image: string; readonly tool: InspectTool; readonly file?: { readonly name: string; readonly base64: string } };

export interface BridgeMetrics {
  readonly ms: number;
  /** Highest `docker stats` memory sample of the job's container; null when none was taken. */
  readonly peakMemoryBytes: number | null;
  readonly peakCpuPercent: number | null;
  /** Highest task count (processes and threads) seen, against `--pids-limit`. */
  readonly peakPids: number | null;
  readonly samples: number;
}
/** What the job left behind after the supervisor returned: both must be 0. */
export interface BridgeLeftovers {
  readonly containers: number;
  readonly tempDirectories: number;
}
export type BridgeResponse =
  | { readonly ok: true; readonly result?: EncodedRenderResult; readonly output?: string; readonly metrics: BridgeMetrics; readonly leftovers: BridgeLeftovers }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string }; readonly metrics: BridgeMetrics; readonly leftovers: BridgeLeftovers };

export interface EncodedRenderResult {
  readonly png: string;
  readonly checks: readonly string[];
  readonly pages?: readonly string[];
  readonly pdf?: string;
  readonly mp4?: string;
  readonly mp3?: string;
  readonly wav?: string;
  readonly layout?: unknown;
  readonly audio?: ArtifactRenderResult["audio"];
  readonly video?: ArtifactRenderResult["video"];
}

const KINDS = ["dashboard", "slides", "slides-layout", "motion", "capture", "audio"];
const TOOLS: readonly InspectTool[] = ["ffprobe", "pdfinfo", "versions"];
const IMAGE = /^[a-z0-9][a-z0-9._/:@-]{0,200}$/;
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

const invalid = (what: string): never => {
  throw new ArtifactError("invalid_bridge_message", what);
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function base64(value: unknown, what: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return invalid(what);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return invalid(what);
  return new Uint8Array(bytes);
}

export function parseBridgeRequest(line: string): BridgeRequest {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return invalid("request is not JSON"); }
  if (!record(value) || typeof value.image !== "string" || !IMAGE.test(value.image)) return invalid("request image");
  if (value.type === "render") {
    if (typeof value.token !== "string" || !TOKEN.test(value.token)) return invalid("request token");
    // The supervisor validates the packet in full; this only refuses what is not one.
    if (!record(value.packet) || value.packet.version !== 1 || !KINDS.includes(String(value.packet.kind))) return invalid("request packet");
    return { type: "render", image: value.image, token: value.token, packet: value.packet as unknown as ArtifactRenderPacket };
  }
  if (value.type === "inspect") {
    if (!TOOLS.includes(value.tool as InspectTool)) return invalid("inspect tool");
    if (value.tool === "versions") return { type: "inspect", image: value.image, tool: "versions" };
    const file = value.file;
    if (!record(file) || typeof file.name !== "string" || !FILE_NAME.test(file.name)) return invalid("inspect file");
    base64(file.base64, "inspect file bytes");
    return { type: "inspect", image: value.image, tool: value.tool as InspectTool, file: { name: file.name, base64: String(file.base64) } };
  }
  return invalid("request type");
}

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export function encodeRenderResult(result: ArtifactRenderResult): EncodedRenderResult {
  return {
    png: encode(result.png),
    checks: [...result.checks],
    ...(result.pages ? { pages: result.pages.map(encode) } : {}),
    ...(result.pdf ? { pdf: encode(result.pdf) } : {}),
    ...(result.mp4 ? { mp4: encode(result.mp4) } : {}),
    ...(result.mp3 ? { mp3: encode(result.mp3) } : {}),
    ...(result.wav ? { wav: encode(result.wav) } : {}),
    ...(result.layout !== undefined ? { layout: result.layout } : {}),
    ...(result.audio ? { audio: result.audio } : {}),
    ...(result.video ? { video: result.video } : {}),
  };
}

export function decodeRenderResult(value: unknown): ArtifactRenderResult {
  if (!record(value)) return invalid("result");
  if (!Array.isArray(value.checks) || value.checks.some((c) => typeof c !== "string")) return invalid("result checks");
  const optional = (key: string) => (value[key] === undefined ? {} : { [key]: base64(value[key], `result ${key}`) });
  if (value.pages !== undefined && !Array.isArray(value.pages)) return invalid("result pages");
  return {
    png: base64(value.png, "result png"),
    checks: value.checks as string[],
    ...(Array.isArray(value.pages) ? { pages: value.pages.map((p, i) => base64(p, `result page ${i}`)) } : {}),
    ...optional("pdf"),
    ...optional("mp4"),
    ...optional("mp3"),
    ...optional("wav"),
    ...(value.layout !== undefined ? { layout: value.layout } : {}),
    ...(record(value.audio) ? { audio: value.audio as unknown as NonNullable<ArtifactRenderResult["audio"]> } : {}),
    ...(record(value.video) ? { video: value.video as unknown as NonNullable<ArtifactRenderResult["video"]> } : {}),
  };
}

export function parseBridgeResponse(text: string): BridgeResponse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid("response is not JSON"); }
  if (!record(value) || !record(value.metrics) || typeof value.metrics.ms !== "number") return invalid("response metrics");
  if (!record(value.leftovers) || typeof value.leftovers.containers !== "number" || typeof value.leftovers.tempDirectories !== "number") return invalid("response leftovers");
  if (value.ok === true) return value as unknown as BridgeResponse;
  if (value.ok === false && record(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string") return value as unknown as BridgeResponse;
  return invalid("response status");
}

const UNITS: Readonly<Record<string, number>> = { B: 1, kB: 1000, KB: 1000, KiB: 1024, MB: 1000 ** 2, MiB: 1024 ** 2, GB: 1000 ** 3, GiB: 1024 ** 3 };

/** The used side of `docker stats`' MemUsage column ("512MiB / 2GiB"), in bytes. */
export function parseDockerMemory(column: string): number | null {
  const match = /^\s*([\d.]+)\s*([A-Za-z]+)\s*\//.exec(column);
  if (!match || !(match[2]! in UNITS)) return null;
  const value = Number(match[1]) * UNITS[match[2]!]!;
  return Number.isFinite(value) ? value : null;
}
