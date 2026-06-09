// LIVE smoke for the Google Fonts bake — hits the real css2 endpoint and
// fonts.gstatic.com. Needs network egress; gated so CI/sandboxes skip it.
//
// Run via: OPENLEN_LIVE_TESTS=1 npx tsx --test lib/publish/font-bake.live.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { bakeGoogleFonts } from "./font-bake";

const LIVE = process.env.OPENLEN_LIVE_TESTS === "1";

test("live: bakes Inter 400/700 from the real Google Fonts API", { skip: !LIVE }, async () => {
  const subDir = await mkdtemp(path.join(tmpdir(), "font-bake-live-"));
  await mkdir(path.join(subDir, "assets"), { recursive: true });
  try {
    const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap" rel="stylesheet">
</head><body><h1>live</h1></body></html>`;

    const r = await bakeGoogleFonts({ html, subDir });
    assert.equal(r.stylesheetsBaked, 1);
    assert.ok(r.filesLocalized > 0);
    assert.ok(!r.html.includes("fonts.googleapis.com"));
    assert.ok(!r.html.includes("fonts.gstatic.com"));
    // The css2 response is unicode-range split — every subset must be local.
    assert.match(r.html, /url\(\/assets\/f-[a-f0-9]{12}\.woff2\)/);

    const files = await readdir(path.join(subDir, "assets"));
    assert.ok(files.filter((f) => f.startsWith("f-") && f.endsWith(".woff2")).length > 0);
  } finally {
    await rm(subDir, { recursive: true, force: true }).catch(() => {});
  }
});
