// The pages' Permissions-Policy: ONE string, five places that send it.
//
// Caddy sets it on the published page (the *.openlen.app block); the /served
// route on custom domains; the canvas, on its two routes; and the `edge` crate
// copies it for parity. Until 2026-10-13 all five said `camera=(),
// microphone=(), geolocation=()`: no page could scan a code with the camera,
// hear the microphone or ask for the location. It came in on 2026-05-25 as
// filler in the custom-domains commit, with no written reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_PERMISSIONS_POLICY } from "./permissions-policy";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");

describe("the pages' Permissions-Policy", () => {
  it("lets the page ITSELF ask for camera, microphone and location (the browser asks the visitor)", () => {
    expect(PAGE_PERMISSIONS_POLICY).toBe("camera=(self), microphone=(self), geolocation=(self)");
  });

  it("🔴 Caddy sends the same one on *.openlen.app", () => {
    const caddy = read("infra", "caddy", "Caddyfile");
    const block = caddy.slice(caddy.indexOf("\n*.openlen.app {"));
    const headers = /header \{([\s\S]*?)\n\t\}/.exec(block)![1]!;
    expect(/Permissions-Policy "([^"]*)"/.exec(headers)?.[1]).toBe(PAGE_PERMISSIONS_POLICY);
  });

  it("🔴 the edge crate copies the same one", () => {
    const rs = read("crates", "edge", "src", "server.rs");
    expect(/const PERMISSIONS_POLICY_VALUE: &str = "([^"]*)";/.exec(rs)?.[1]).toBe(PAGE_PERMISSIONS_POLICY);
  });

  it("🔴 no page route writes the string by hand again", () => {
    for (const path of [
      ["app", "api", "lienzo", "[docId]", "route.ts"],
      ["app", "api", "lienzo", "site", "[[...path]]", "route.ts"],
      ["app", "served", "[host]", "[[...path]]", "route.ts"],
    ]) {
      const src = read(...path);
      expect(src, path.join("/")).toContain("PAGE_PERMISSIONS_POLICY");
      expect(src, path.join("/")).not.toMatch(/camera=\(/);
    }
  });
});
