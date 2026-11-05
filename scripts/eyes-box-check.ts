// scripts/eyes-box-check.ts
// Checks that a REAL box of SANDBOX_TEMPLATE can show Len motion the way Kimi looks at its work (spec
// local 2026-11-05-ojos-que-ven-el-movimiento, §8.2, §8.3, §8.6, §10): Pillow for contact_sheet.py,
// WebGL in Playwright's Chromium (and with which launch options), Playwright's page.clock driving a
// requestAnimationFrame game, and the verify skill's contact_sheet.py on frames made there. Says
// OK/FAIL per check, prints the launch options that gave WebGL, and kills the box.
//
// Needs E2B_API_KEY and the template built (npm run sandbox:template). Costs cents of E2B.
//
// Run: npm run eyes:box-check

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SANDBOX_TEMPLATE } from "../lib/agent/sandbox/config";
import { PLAYWRIGHT_BROWSERS, PLAYWRIGHT_DIR } from "../lib/agent/sandbox/template-files";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Run = { exitCode: number; stdout: string; stderr: string };
type Box = {
  commands: { run(cmd: string, o?: { timeoutMs?: number }): Promise<Run> };
  files: { write(path: string, data: string | ArrayBuffer): Promise<unknown> };
  kill(): Promise<unknown>;
};

async function run(box: Box, cmd: string, timeoutMs = 180_000): Promise<Run> {
  try {
    return await box.commands.run(cmd, { timeoutMs });
  } catch (e) {
    const x = e as Partial<Run>;
    if (typeof x?.exitCode !== "number") throw e;
    return { exitCode: x.exitCode, stdout: String(x.stdout ?? ""), stderr: String(x.stderr ?? "") };
  }
}

const short = (r: Run) => `exit ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(-400)}`;
const D = "/tmp/eyes-check";
const ENV = `PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS} NODE_PATH=${PLAYWRIGHT_DIR}/node_modules`;

/** The launch options tried, in order: Chromium's defaults, then the two SwiftShader spellings. */
const LAUNCHES: readonly (readonly string[])[] = [
  [],
  ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
  ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
];

// WebGL: a canvas cleared red, its renderer, a pixel read back, and a screenshot of it.
const WEBGL_JS = `
const { chromium } = require("@playwright/test");
(async () => {
  const launches = JSON.parse(process.argv[2]);
  const out = [];
  for (const [i, args] of launches.entries()) {
    const b = await chromium.launch({ args });
    try {
      const p = await b.newPage();
      await p.setContent('<canvas id="c" width="200" height="100"></canvas><script>' +
        'var gl = document.getElementById("c").getContext("webgl", { preserveDrawingBuffer: true });' +
        'var dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");' +
        'window.__r = gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "webgl") : null;' +
        'if (gl) { gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }' +
        '</script>');
      const renderer = await p.evaluate(() => window.__r);
      await p.locator("#c").screenshot({ path: "${D}/webgl-" + i + ".png" });
      out.push({ args, renderer });
    } catch (e) {
      out.push({ args, renderer: null, error: String(e).slice(0, 200) });
    } finally {
      await b.close();
    }
  }
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(String(e)); process.exit(2); });
`;

// page.clock: a requestAnimationFrame game that moves 1 px a frame. Four runs: 800 ms in one go (twice)
// and 8 × 100 ms with a screenshot after each (twice), to see whether each way repeats itself and
// whether screenshots advance the game. The first screenshot run keeps its 8 frames.
const CLOCK_JS = `
const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch();
  const out = { plain: [], shots: [] };
  try {
    for (const way of ["plain", "plain", "shots", "shots"]) {
      const p = await b.newPage({ viewport: { width: 400, height: 200 } });
      // Installed, time still flows by itself; paused, it only moves with runFor (playwright.dev/docs/clock).
      await p.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await p.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
      await p.setContent('<canvas id="c" width="400" height="200"></canvas><script>' +
        'window.x = 0; var g = document.getElementById("c").getContext("2d");' +
        'function f() { window.x += 1; g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 200); g.fillStyle = "#c33"; g.fillRect(window.x, 60, 60, 60); requestAnimationFrame(f); }' +
        'requestAnimationFrame(f);</script>');
      if (way === "plain") await p.clock.runFor(800);
      else {
        for (let i = 0; i < 8; i++) {
          await p.clock.runFor(100);
          const keep = out.shots.length === 0;
          await p.screenshot(keep ? { path: "${D}/frames/" + String(i).padStart(2, "0") + ".png" } : {});
        }
      }
      out[way].push(await p.evaluate(() => window.x));
      await p.close();
    }
  } finally {
    await b.close();
  }
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(String(e)); process.exit(2); });
`;

// What a PNG holds at its center, and its size.
const PIXEL_PY = `
import json, sys
from PIL import Image
out = {}
for p in sys.argv[1:]:
    im = Image.open(p).convert("RGB")
    w, h = im.size
    out[p] = {"size": [w, h], "center": im.getpixel((w // 2, h // 2))}
print(json.dumps(out))
`;

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const { Sandbox } = await import("e2b");
  console.log(`box from ${SANDBOX_TEMPLATE}…`);
  const box = (await Sandbox.create(SANDBOX_TEMPLATE, { apiKey, timeoutMs: 15 * 60_000 })) as unknown as Box;
  try {
    await run(box, `mkdir -p ${D}/frames`);

    const pil = await run(box, `python3 -c "import PIL; print(PIL.__version__)"`);
    check("Pillow imports in the box", pil.exitCode === 0, pil.exitCode === 0 ? `PIL ${pil.stdout.trim()}` : short(pil));

    await box.files.write(`${D}/webgl.cjs`, WEBGL_JS);
    await box.files.write(`${D}/pixel.py`, PIXEL_PY);
    const webgl = await run(box, `cd ${D} && ${ENV} node webgl.cjs '${JSON.stringify(LAUNCHES)}'`);
    const tried = webgl.exitCode === 0 ? (JSON.parse(webgl.stdout.trim().split("\n").pop()!) as { args: string[]; renderer: string | null; error?: string }[]) : [];
    check("Playwright's Chromium launches in the box", webgl.exitCode === 0, webgl.exitCode === 0 ? "" : short(webgl));
    const shots = tried.map((_, i) => `${D}/webgl-${i}.png`);
    const pixels = shots.length ? await run(box, `python3 ${D}/pixel.py ${shots.join(" ")}`) : null;
    const centers = pixels?.exitCode === 0 ? (JSON.parse(pixels.stdout) as Record<string, { center: number[] }>) : {};
    const working: string[][] = [];
    for (const [i, t] of tried.entries()) {
      const c = centers[shots[i]!]?.center;
      const red = !!c && c[0]! > 200 && c[1]! < 60 && c[2]! < 60;
      if (t.renderer && red) working.push(t.args);
      check(
        `WebGL with [${t.args.join(" ") || "Chromium's defaults"}]`,
        !!t.renderer && red,
        `renderer ${t.renderer ?? "none"}; center ${c ? `rgb(${c.join(",")})` : "unread"}${t.error ? `; ${t.error}` : ""}`,
      );
    }
    console.log(`\nWEBGL_LAUNCH_ARGS_FOR_THE_BOX = ${JSON.stringify(working[0] ?? null)}\n`);

    await box.files.write(`${D}/clock.cjs`, CLOCK_JS);
    const clock = await run(box, `cd ${D} && ${ENV} node clock.cjs`);
    const xs = clock.exitCode === 0 ? (JSON.parse(clock.stdout.trim().split("\n").pop()!) as { plain: number[]; shots: number[] }) : null;
    check(
      "page.clock moves a requestAnimationFrame game ~48–50 frames in 800 ms, the same both runs",
      !!xs && xs.plain[0] === xs.plain[1] && xs.plain[0]! >= 46 && xs.plain[0]! <= 50,
      xs ? `x = ${JSON.stringify(xs.plain)}` : short(clock),
    );
    check(
      "with a screenshot after each runFor, the game repeats itself run to run",
      !!xs && xs.shots[0] === xs.shots[1],
      xs ? `x = ${JSON.stringify(xs.shots)} (in one go: ${xs.plain[0]})` : short(clock),
    );

    const script = readFileSync(join(process.cwd(), "lib/agent/skills/bundled/verify/scripts/contact_sheet.py"), "utf8");
    await box.files.write(`${D}/contact_sheet.py`, script);
    const labels = Array.from({ length: 8 }, (_, i) => `--label 't=${(i + 1) * 100}ms'`).join(" ");
    const sheet = await run(box, `python3 ${D}/contact_sheet.py --out ${D}/sheet.png ${labels} ${D}/frames && python3 ${D}/pixel.py ${D}/sheet.png`);
    const size = sheet.exitCode === 0 ? (JSON.parse(sheet.stdout.trim().split("\n").pop()!) as Record<string, { size: number[] }>)[`${D}/sheet.png`]?.size : undefined;
    check("contact_sheet.py joins the 8 frames into one image at most 1708 px wide (DeepSeek V4.1's 16:9 edge)", !!size && size[0]! <= 1708, size ? `${size.join("×")}` : short(sheet));
    const noOut = await run(box, `python3 ${D}/contact_sheet.py ${D}/frames`);
    check("contact_sheet.py without --out exits 1 with the reason", noOut.exitCode === 1 && /--out/.test(noOut.stderr), short(noOut));
  } finally {
    await box.kill().catch(() => undefined);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
