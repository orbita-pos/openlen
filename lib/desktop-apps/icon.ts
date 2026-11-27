// THE ICON OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.5): a tool has its own (`iconPath`, a
// file of the version that is installed); an ordinary app has none, so OpenLen draws one — the initial of its name on a
// colour taken from it, the way Claude draws an artifact's. An SVG with `sizes: "any"` in the manifest; whether Chrome and
// Edge take it for the install (or want a 192 and a 512 PNG) is checked by installing for real, not here.
import { isBlobPointer } from "@/lib/files/blob-pointer";

import type { DesktopAppRow } from "./store";

export interface IconDeps {
  readRelease(sha: string): Promise<Record<string, { readonly content: string; readonly contentType: string }> | null>;
  getBlob(pointer: string): Promise<Uint8Array>;
}

async function realDeps(): Promise<IconDeps> {
  const [toolStore, blob] = await Promise.all([import("@/lib/tools/store"), import("@/lib/files/blob")]);
  return { readRelease: toolStore.readRelease, getBlob: (p) => blob.getBlob(p) };
}

const MIME_BY_EXTENSION: ReadonlyArray<readonly [string, string]> = [
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"],
];

/** The type a tool's icon file says it is (its manifest only allows these). */
export function iconMimeType(iconPath: string): string | undefined {
  const path = iconPath.toLowerCase();
  return MIME_BY_EXTENSION.find(([extension]) => path.endsWith(extension))?.[1];
}

function firstCharacter(name: string): string {
  const text = name.trim();
  if (!text) return "?";
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)][0]?.segment ?? "?";
  return first.toLocaleUpperCase();
}

/** FNV-1a over the name: the same name is always the same colour. */
function hueOf(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A square tile edge to edge (so a platform that rounds or masks it keeps the letter inside its safe zone) with the
 *  name's initial in white. Dark enough, at every hue, for a glyph this big. */
export function letterIconSvg(name: string): string {
  const fill = `hsl(${hueOf(name)} 55% 36%)`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<rect width="512" height="512" fill="${fill}"/>` +
    `<text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="280" font-weight="600" fill="#ffffff">${escapeXml(firstCharacter(name))}</text>` +
    `</svg>`
  );
}

// From openlen.com, so a tool's SVG — written by Len — is sent with a CSP sandbox: as an image it draws, and opened on its
// own it can never run as a page here (the same as `/api/tools/<id>/icon`).
const HEADERS = {
  "cache-control": "private, no-cache",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
};

/** The icon of a row the caller has already decided the person may see. */
export async function desktopIconResponse(row: Pick<DesktopAppRow, "name" | "iconPath" | "releaseSha">, deps?: IconDeps): Promise<Response> {
  if (row.iconPath) {
    const d = deps ?? (await realDeps());
    const file = (await d.readRelease(row.releaseSha))?.[row.iconPath];
    if (file) {
      const body = isBlobPointer(file.content) ? new Uint8Array(await d.getBlob(file.content)) : file.content;
      return new Response(body, { status: 200, headers: { ...HEADERS, "content-type": file.contentType } });
    }
  }
  return new Response(letterIconSvg(row.name), { status: 200, headers: { ...HEADERS, "content-type": "image/svg+xml; charset=utf-8" } });
}
