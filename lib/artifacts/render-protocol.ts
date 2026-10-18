import { ArtifactError } from "./types";
export interface RenderProbe { readonly select?: { readonly selector: string; readonly value: string }; readonly click?: string; readonly expect: { readonly selector: string; readonly text: string } }
export interface ArtifactRenderPacket {
  readonly version: 1;
  readonly kind: "dashboard";
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly probes: readonly RenderProbe[];
}
export interface ArtifactRenderResult { readonly png: Uint8Array; readonly checks: readonly string[] }
export type ArtifactRender = (packet: ArtifactRenderPacket, signal: AbortSignal) => Promise<ArtifactRenderResult>;
export function validateRenderPacket(packet: ArtifactRenderPacket): void {
  if (packet?.version !== 1 || packet.kind !== "dashboard" || typeof packet.html !== "string" || Buffer.byteLength(packet.html) > 8 * 1024 * 1024
    || !Number.isSafeInteger(packet.width) || packet.width < 320 || packet.width > 1920 || !Number.isSafeInteger(packet.height) || packet.height < 240 || packet.height > 1080
    || !Array.isArray(packet.probes) || packet.probes.length > 20) throw new ArtifactError("invalid_render_packet");
  for (const p of packet.probes) if (!p?.expect || typeof p.expect.selector !== "string" || p.expect.selector.length > 500 || typeof p.expect.text !== "string" || p.expect.text.length > 2000
    || (p.click !== undefined && (typeof p.click !== "string" || p.click.length > 500)) || (p.select !== undefined && (typeof p.select.selector !== "string" || p.select.selector.length > 500 || typeof p.select.value !== "string" || p.select.value.length > 500))) throw new ArtifactError("invalid_render_probe");
}
