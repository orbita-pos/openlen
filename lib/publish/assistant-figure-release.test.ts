// THE FIGURE ENGINE IN THE RELEASE (spec local 2026-11-10-figuras-del-asistente, §5.7): a page published with the
// person's own assistant carries the engine as a file of the site itself, at the path her bubble asks for; any other
// page carries none.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/assistant-figure-release.test.ts
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olfig-"));
process.env.PUBLISH_ROOT = root;

import { FIGURE_ENGINE } from "@/lib/figure/engine/published";

import { FIGURE_ENGINE_PATH } from "./assistant-widget";
import { publishToDir } from "./filesystem";

after(() => rmSync(root, { recursive: true, force: true }));

function release(sub: string): string {
  const current = path.join(root, sub, "current");
  try {
    return path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    return current;
  }
}
const PAGE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Canela</title></head><body><h1>Pastelería Canela</h1></body></html>';
const LOOK = { v: 1, shape: "heart", color: "#19c3b1", eyes: "round", eyewear: "none", accessory: "crown" } as const;

describe("the figure engine in the release", () => {
  it("🔴 a page with her bubble carries the engine where the bubble asks for it, byte for byte", async () => {
    await publishToDir({ subdomain: "conella", html: PAGE, assistant: { enabled: true, businessName: "Pastelería Canela", persona: { name: "Lucía", look: LOOK } } });
    const html = readFileSync(path.join(release("conella"), "index.html"), "utf8");
    assert.ok(html.includes(`/${FIGURE_ENGINE_PATH}`), "her bubble names the engine's file");
    assert.ok(html.includes('data-part=\\"body\\"') || html.includes('data-part="body"'), "her flat figure is baked in");
    assert.equal(readFileSync(path.join(release("conella"), FIGURE_ENGINE_PATH), "utf8"), FIGURE_ENGINE.code);
  });

  it("today's assistant, or none, carries no engine", async () => {
    await publishToDir({ subdomain: "sinella", html: PAGE, assistant: { enabled: true, businessName: "Taller" } });
    assert.ok(!existsSync(path.join(release("sinella"), FIGURE_ENGINE_PATH)));
    await publishToDir({ subdomain: "sinnada", html: PAGE });
    assert.ok(!existsSync(path.join(release("sinnada"), FIGURE_ENGINE_PATH)));
  });
});
