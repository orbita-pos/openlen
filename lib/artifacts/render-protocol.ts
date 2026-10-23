import { ArtifactError } from "./types";
import {validateAudioMix,type AudioMix} from "./audio-protocol";
export interface RenderProbe { readonly select?: { readonly selector: string; readonly value: string }; readonly click?: string; readonly expect: { readonly selector: string; readonly text: string } }
interface RenderPacketBase {
  readonly version: 1;
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly probes: readonly RenderProbe[];
}
export type ArtifactRenderPacket = RenderPacketBase & ({ readonly kind: "dashboard" } | {readonly kind:"capture";readonly route?:string} | {readonly kind:"slides-layout";readonly pageCount:number} | { readonly kind: "slides"; readonly pageCount: number; readonly nativePptxBase64: string } | {readonly kind:"audio";readonly audio:AudioMix} | { readonly kind:"motion"; readonly fps:30; readonly durationSeconds:number; readonly frameCount:number;readonly audio?:AudioMix });
export interface ArtifactRenderResult { readonly png: Uint8Array; readonly checks: readonly string[]; readonly layout?:unknown;readonly pages?: readonly Uint8Array[]; readonly pdf?: Uint8Array; readonly mp4?:Uint8Array;readonly mp3?:Uint8Array;readonly wav?:Uint8Array;readonly audio?:{readonly durationSeconds:number;readonly sampleRate:number;readonly channels:number}; readonly video?:{readonly frameCount:number;readonly fps:number;readonly durationSeconds:number} }
export type ArtifactRender = (packet: ArtifactRenderPacket, signal: AbortSignal) => Promise<ArtifactRenderResult>;
/** The frame a render opens: Chromium's viewport, and the PNG of a dashboard's first screen. */
export const RENDER_FRAME = { width: { min: 320, max: 1920 }, height: { min: 240, max: 1080 } } as const;
const RENDER_KINDS: readonly string[] = ["dashboard", "slides", "slides-layout", "motion", "capture", "audio"];
const MAX_PROBES = 20, MAX_HTML_BYTES = 8 * 1024 * 1024;

// A refused packet keeps its code for callers, and its message says which field, what it was and what it must be
// (as Claude Code's validateInput does): the author fixes the one thing that is wrong instead of guessing.
const refuse = (message: string): never => { throw new ArtifactError("invalid_render_packet", message); };
const shown = (value: unknown) => JSON.stringify(value) ?? String(value);
function inFrame(name: "width" | "height", value: unknown): void {
  const { min, max } = RENDER_FRAME[name];
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) refuse(`"${name}" is ${shown(value)}; it must be a whole number of px from ${min} to ${max}`);
}
function pages(kind: string, count: unknown): void {
  if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 50) refuse(`a ${kind} has ${shown(count)} pages; it must have 1 to 50`);
}

export function validateRenderPacket(packet: ArtifactRenderPacket): void {
  if (packet?.version !== 1) refuse(`"version" is ${shown(packet?.version)}; it must be 1`);
  if (!RENDER_KINDS.includes(packet.kind)) refuse(`"kind" is ${shown(packet.kind)}; it must be one of ${RENDER_KINDS.join(", ")}`);
  if (typeof packet.html !== "string") refuse(`"html" must be a string`);
  const bytes = Buffer.byteLength(packet.html);
  if (bytes > MAX_HTML_BYTES) refuse(`the page is ${(bytes / 1024 / 1024).toFixed(1)} MB of HTML; a render takes at most 8 MB`);
  inFrame("width", packet.width);
  inFrame("height", packet.height);
  if (!Array.isArray(packet.probes)) refuse(`"probes" must be a list`);
  if (packet.probes.length > MAX_PROBES) refuse(`"probes" has ${packet.probes.length}; at most ${MAX_PROBES}`);
  if (packet.kind === "slides") {
    pages("deck", packet.pageCount);
    if (typeof packet.nativePptxBase64 !== "string" || packet.nativePptxBase64.length > 10 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.nativePptxBase64)) refuse("the deck's PowerPoint file is missing, over 10 MB or not base64");
  }
  if (packet.kind === "slides-layout") {
    pages("slide layout", packet.pageCount);
    if (packet.probes.length) refuse(`a slide layout takes no probes (got ${packet.probes.length})`);
  }
  if (packet.kind === "motion") {
    if (packet.fps !== 30 || packet.width !== 1280 || packet.height !== 720) refuse(`a motion render is 1280×720 at 30 fps (got ${shown(packet.width)}×${shown(packet.height)} at ${shown(packet.fps)} fps)`);
    if (!Number.isFinite(packet.durationSeconds) || packet.durationSeconds < 1 || packet.durationSeconds > 120) refuse(`"durationSeconds" is ${shown(packet.durationSeconds)}; it must be from 1 to 120`);
    if (!Number.isSafeInteger(packet.frameCount) || packet.frameCount !== Math.round(packet.durationSeconds * 30) || Math.abs(packet.frameCount - packet.durationSeconds * 30) > 1e-6) refuse(`"frameCount" is ${shown(packet.frameCount)}; it must be durationSeconds × 30, a whole number`);
  }
  if (packet.kind === "capture") {
    if (packet.width !== 1280 || packet.height !== 720) refuse(`a capture is 1280×720 (got ${shown(packet.width)}×${shown(packet.height)})`);
    if (packet.probes.length !== 0) refuse(`a capture takes no probes (got ${packet.probes.length})`);
    if (packet.route !== undefined && (typeof packet.route !== "string" || !/^#\/[A-Za-z0-9\/_.~%-]{0,200}$/.test(packet.route))) refuse(`"route" is ${shown(packet.route)}; it must be a hash route such as #/sales`);
  }
  if(packet.kind==="audio"||(packet.kind==="motion"&&packet.audio)){
    const mix=validateAudioMix(packet.audio);
    if(packet.kind==="audio"&&(packet.html!==""||packet.probes.length>0)||packet.kind==="motion"&&Math.abs(mix.durationSeconds-packet.durationSeconds)>1e-6)throw new ArtifactError("invalid_audio_packet");
  }
  for (const p of packet.probes) if (!p?.expect || typeof p.expect.selector !== "string" || p.expect.selector.length > 500 || typeof p.expect.text !== "string" || p.expect.text.length > 2000
    || (p.click !== undefined && (typeof p.click !== "string" || p.click.length > 500)) || (p.select !== undefined && (typeof p.select.selector !== "string" || p.select.selector.length > 500 || typeof p.select.value !== "string" || p.select.value.length > 500))) throw new ArtifactError("invalid_render_probe");
}
