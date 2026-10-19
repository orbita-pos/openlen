import { ArtifactError } from "./types";
export interface RenderProbe { readonly select?: { readonly selector: string; readonly value: string }; readonly click?: string; readonly expect: { readonly selector: string; readonly text: string } }
interface RenderPacketBase {
  readonly version: 1;
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly probes: readonly RenderProbe[];
}
export type ArtifactRenderPacket = RenderPacketBase & ({ readonly kind: "dashboard" } | {readonly kind:"capture"} | {readonly kind:"slides-layout";readonly pageCount:number} | { readonly kind: "slides"; readonly pageCount: number; readonly nativePptxBase64: string } | { readonly kind:"motion"; readonly fps:30; readonly durationSeconds:number; readonly frameCount:number });
export interface ArtifactRenderResult { readonly png: Uint8Array; readonly checks: readonly string[]; readonly layout?:unknown;readonly pages?: readonly Uint8Array[]; readonly pdf?: Uint8Array; readonly mp4?:Uint8Array; readonly video?:{readonly frameCount:number;readonly fps:number;readonly durationSeconds:number} }
export type ArtifactRender = (packet: ArtifactRenderPacket, signal: AbortSignal) => Promise<ArtifactRenderResult>;
export function validateRenderPacket(packet: ArtifactRenderPacket): void {
  if (packet?.version !== 1 || !["dashboard", "slides", "slides-layout","motion","capture"].includes(packet.kind) || typeof packet.html !== "string" || Buffer.byteLength(packet.html) > 8 * 1024 * 1024
    || !Number.isSafeInteger(packet.width) || packet.width < 320 || packet.width > 1920 || !Number.isSafeInteger(packet.height) || packet.height < 240 || packet.height > 1080
    || !Array.isArray(packet.probes) || packet.probes.length > 20) throw new ArtifactError("invalid_render_packet");
  if (packet.kind === "slides" && (!Number.isSafeInteger(packet.pageCount) || packet.pageCount < 1 || packet.pageCount > 50 || typeof packet.nativePptxBase64 !== "string" || packet.nativePptxBase64.length > 10 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.nativePptxBase64))) throw new ArtifactError("invalid_render_packet");
  if(packet.kind==="slides-layout"&&(!Number.isSafeInteger(packet.pageCount)||packet.pageCount<1||packet.pageCount>50||packet.probes.length))throw new ArtifactError("invalid_render_packet");
  if(packet.kind==="motion"&&(packet.fps!==30||packet.width!==1280||packet.height!==720||!Number.isFinite(packet.durationSeconds)||packet.durationSeconds<1||packet.durationSeconds>120||!Number.isSafeInteger(packet.frameCount)||packet.frameCount!==Math.round(packet.durationSeconds*30)||Math.abs(packet.frameCount-packet.durationSeconds*30)>1e-6))throw new ArtifactError("invalid_render_packet");
  if(packet.kind==="capture"&&(packet.width!==1280||packet.height!==720||packet.probes.length!==0))throw new ArtifactError("invalid_render_packet");
  for (const p of packet.probes) if (!p?.expect || typeof p.expect.selector !== "string" || p.expect.selector.length > 500 || typeof p.expect.text !== "string" || p.expect.text.length > 2000
    || (p.click !== undefined && (typeof p.click !== "string" || p.click.length > 500)) || (p.select !== undefined && (typeof p.select.selector !== "string" || p.select.selector.length > 500 || typeof p.select.value !== "string" || p.select.value.length > 500))) throw new ArtifactError("invalid_render_probe");
}
