// @vitest-environment node
// ONE CHROMIUM LAUNCHER (14/10). Phase A put WebGL in the eyes' launcher
// (`lanzarChromium`); the thumbnails, the og-card, the Flight Check and the
// `describe` capture each had their own `puppeteer.launch` and stayed without
// it, so a 3D game came out blank there. A second launcher is exactly what
// stops getting the first one's fixes. This guard keeps new ones out.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIB = path.join(process.cwd(), "lib");
const OWNER = "lib/ai/visual-quality-renderer.ts";

/** The launchers that stay, each with why. Those that look at Len's pages carry
 *  `WEBGL_ARGS`; those that run HTML nobody here wrote hand Chromium `chromiumEnv()`. */
const ALLOWED: Readonly<
  Record<string, { readonly why: string; readonly viewsLensPages: boolean; readonly runsUntrustedHtml: boolean }>
> = {
  "lib/len-bench/navegador.ts": {
    why: "Len-Bench's grader: its own --host-resolver-rules so it can't reach production",
    viewsLensPages: true,
    runsUntrustedHtml: true,
  },
  "lib/agent/brazo-sin-acciones.ts": { why: "the battery's control arm, an eval tool", viewsLensPages: true, runsUntrustedHtml: true },
  "lib/templates/capture-screenshot.ts": {
    why: "a CLI that captures the curated templates, outside the server",
    viewsLensPages: false,
    runsUntrustedHtml: false,
  },
  "lib/style-match/scrape/fetch-puppeteer.ts": {
    why: "scrapes another site's styles, not a page of ours",
    viewsLensPages: false,
    runsUntrustedHtml: true,
  },
  "lib/apps/tests/runtime-harness.ts": { why: "test-only harness for the vitest runtime", viewsLensPages: false, runsUntrustedHtml: false },
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("one Chromium launcher", () => {
  const launching = sources(LIB)
    .filter((f) => readFileSync(f, "utf8").includes("puppeteer.launch("))
    .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));

  it("🔴 nothing launches Chromium on its own outside lanzarChromium and the listed exceptions", () => {
    const unexpected = launching.filter((f) => f !== OWNER && !(f in ALLOWED));
    expect(unexpected, "use lanzarChromium() from lib/ai/visual-quality-renderer.ts, or list it here with why").toEqual([]);
    expect(launching).toContain(OWNER);
  });

  it("🔴 the launchers that look at Len's pages carry WebGL (WEBGL_ARGS)", () => {
    for (const [file, { viewsLensPages }] of Object.entries(ALLOWED)) {
      if (viewsLensPages) expect(readFileSync(path.join(process.cwd(), file), "utf8"), file).toContain("...WEBGL_ARGS");
    }
    expect(readFileSync(path.join(process.cwd(), OWNER), "utf8")).toContain("...WEBGL_ARGS");
  });

  it("🔴 every launcher that runs HTML nobody here wrote hands Chromium chromiumEnv(), not process.env", () => {
    // Without `env` Puppeteer passes all of process.env: DATABASE_URL, AUTH_SECRET,
    // every provider key, to a browser running with --no-sandbox (lib/security/chromium-env.ts).
    for (const [file, { runsUntrustedHtml }] of Object.entries(ALLOWED)) {
      if (runsUntrustedHtml) expect(readFileSync(path.join(process.cwd(), file), "utf8"), file).toContain("env: chromiumEnv()");
    }
    expect(readFileSync(path.join(process.cwd(), OWNER), "utf8")).toContain("env: chromiumEnv()");
  });

  it("🔴 the launcher yields the box's CPU: every Chromium it starts is deprioritized (lib/ai/chromium-nice.ts)", () => {
    expect(readFileSync(path.join(process.cwd(), OWNER), "utf8")).toContain("deprioritizeChromium(browser.process()?.pid)");
  });

  it("thumbnails, the og-card and the Flight Check use the eyes' launcher", () => {
    for (const file of ["lib/projects/thumbnail.ts", "lib/branding/og-card.ts", "lib/publish/flight-check.ts", "lib/ai/inline-image.ts"]) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(text, file).toContain("lanzarChromium()");
      expect(text, file).not.toContain("puppeteer.launch(");
    }
  });
});
