// NEXT'S IMAGE OPTIMIZER STAYS CLOSED (2026-10-21). GHSA-2xp9-vwfh-vxw4: `libheif`, which `sharp` uses for
// Next's image optimization, allows remote code execution when an AVIF is optimized (next < 15.5.24). OpenLen
// never uses `next/image`, yet `/_next/image` answered on openlen.com and on the canvas hosts, and any account
// can upload an AVIF that Next serves at /uploads. Closed twice: Next answers it 404 with `images.unoptimized`
// (next-server.js renders 404 when the loader isn't the default or images are unoptimized), and Caddy answers
// it 404 before it reaches Next.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

const ROOT = join(import.meta.dirname, "..", "..");
const withoutComments = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const CADDY = withoutComments(readFileSync(join(ROOT, "infra", "caddy", "Caddyfile"), "utf8"));

function block(text: string, opening: string): string {
  const i = text.indexOf(opening);
  if (i < 0) throw new Error(`no «${opening.trim()}»`);
  let depth = 0;
  for (let j = text.indexOf("{", i); j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error("unclosed block");
}

const CLOSED = /respond \/_next\/image "Not found" 404/;

describe("🔴 Next's image optimizer is closed", () => {
  it("next.config: images unoptimized, so Next itself answers /_next/image with a 404", () => {
    expect((nextConfig as { images?: { unoptimized?: boolean } }).images?.unoptimized).toBe(true);
  });

  it("next is at a version with the AVIF fix (15.5.24 or later)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const [major, minor, patch] = pkg.dependencies.next!.split(".").map(Number);
    expect(major).toBe(15);
    expect(minor! > 5 || (minor === 5 && patch! >= 24)).toBe(true);
  });

  it("Caddy answers it 404 on openlen.com, before it reaches Next", () => {
    expect(block(CADDY, "\nopenlen.com, www.openlen.com {")).toMatch(CLOSED);
  });

  it("Caddy answers it 404 on the canvas hosts too, whose handle sends everything else to Next", () => {
    const pages = block(CADDY, "\n*.openlen.app {");
    expect(block(pages, "handle @lienzo {")).toMatch(CLOSED);
  });
});
