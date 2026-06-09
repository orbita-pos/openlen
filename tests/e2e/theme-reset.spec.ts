// Repro — the Looks picker "Original" (↺) reset losing the page's color.
//
// Strategy mirrors inline-edit.spec.ts: inject the REAL element-inspect runtime
// (injectElementInspect) into a normalized landing page, host it in an iframe,
// and act as the production parent — capture the first `openlen:page-meta` into
// a baseline (the same shape page.tsx's readThemeBaseline builds), apply a Look
// preset bundle, then "reset" by re-applying the baseline. We then read the
// page's actual computed colors to see whether the original is truly restored.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { injectElementInspect } from "../../components/workspace-v2/use-element-inspect";
import { THEME_PRESETS } from "../../lib/theme-presets";

// The fully-normalized "counter" project — the real shape a user edits: --ol-*
// tokens live in <style data-ol-*>:root{}</style> blocks (NOT inline on <html>).
const NORMALIZED = readFileSync(
  join(process.cwd(), "crates/html-engine/tests/fixtures/chain/counter.html"),
  "utf8",
);

// Mirror of page.tsx readThemeBaseline — build the "Original" reset bundle from
// a page-meta payload, reading the AUTHORED block (the :root-declared theme,
// invariant to an applied Look) and falling back to the flat meta.
function readThemeBaseline(m: Record<string, unknown>): Record<string, string> {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const a =
    m.authored && typeof m.authored === "object"
      ? (m.authored as Record<string, unknown>)
      : m;
  return {
    "--ol-bg": str(a.bg),
    "--ol-surface": str(a.surface),
    "--ol-fg": str(a.fg),
    "--ol-border": str(a.border),
    "--ol-accent": str(a.accent),
    "--ol-font-display": str(a.displayFont),
    "--ol-r-scale": num(a.radiusScale),
    "--ol-text-scale": num(a.typeScale),
    "--ol-space-scale": num(a.spaceScale),
  };
}

type Win = Window & { __msgs?: Array<Record<string, unknown>> };

async function loadInto(page: Page, html: string): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head>
     <body style="margin:0">
       <iframe id="f" sandbox="allow-scripts allow-same-origin"
               style="width:1000px;height:740px;border:0;display:block"></iframe>
       <script>
         window.__msgs = [];
         window.addEventListener('message', function (e) {
           if (!e.data || typeof e.data !== 'object') return;
           window.__msgs.push(e.data);
         });
       </script>
     </body></html>`,
  );
  await page.evaluate(
    (h) =>
      new Promise<void>((resolve) => {
        const f = document.getElementById("f") as HTMLIFrameElement;
        f.addEventListener("load", () => resolve(), { once: true });
        f.srcdoc = h;
      }),
    injectElementInspect(html),
  );
  const frame = page.mainFrame().childFrames()[0];
  // Wait until the script has posted its first page-meta.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as Win).__msgs ?? []).some(
            (m) => m.type === "openlen:page-meta",
          ),
      ),
    )
    .toBe(true);
  return frame;
}

function firstMeta(page: Page) {
  return page.evaluate(() => {
    const msgs = (window as Win).__msgs ?? [];
    const pm = msgs.find((m) => m.type === "openlen:page-meta");
    return (pm as { meta: Record<string, unknown> }).meta;
  });
}

// Read the page's effective colors — what the user actually SEES.
function readEffective(frame: Frame) {
  return frame.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const bodyCs = getComputedStyle(document.body);
    return {
      olAccent: cs.getPropertyValue("--ol-accent").trim(),
      olAccentR: cs.getPropertyValue("--ol-accent-r").trim(),
      olBg: cs.getPropertyValue("--ol-bg").trim(),
      // The page aliases --accent: var(--ol-accent); this is the real accent
      // every button/gradient reads.
      pageAccent: cs.getPropertyValue("--accent").trim(),
      bodyBg: bodyCs.backgroundColor,
      bodyColor: bodyCs.color,
    };
  });
}

async function applyBundle(frame: Frame, tokens: Record<string, string>) {
  await frame.evaluate((t) => {
    window.postMessage(
      { type: "openlen:apply-prop", scope: "theme-bundle", tokens: t },
      "*",
    );
  }, tokens);
  // Let the message handler run + recompute.
  await frame.evaluate(() => new Promise((r) => setTimeout(r, 30)));
}

test("Original reset restores the page color after applying a Look", async ({
  page,
}) => {
  const frame = await loadInto(page, NORMALIZED);

  const meta = await firstMeta(page);
  const baseline = readThemeBaseline(meta);
  const original = await readEffective(frame);
  console.log("META:", JSON.stringify(meta));
  console.log("BASELINE:", JSON.stringify(baseline));
  console.log("ORIGINAL EFFECTIVE:", JSON.stringify(original));

  // The original should have a real accent (the page is born-canonical).
  expect(original.olAccent).not.toBe("");

  // Apply a clearly-different Look (Crisp = blue accent, white bg).
  const crisp = THEME_PRESETS.find((p) => p.id === "crisp")!;
  await applyBundle(frame, crisp.tokens);
  const looked = await readEffective(frame);
  console.log("AFTER LOOK:", JSON.stringify(looked));
  expect(looked.olAccent.toLowerCase()).toBe("#2563eb");

  // Click "Original" — re-apply the captured baseline.
  await applyBundle(frame, baseline);
  const reset = await readEffective(frame);
  console.log("AFTER RESET:", JSON.stringify(reset));

  // The page must return to its original color.
  expect(reset.olAccent).toBe(original.olAccent);
  expect(reset.olAccentR).toBe(original.olAccentR);
  expect(reset.pageAccent).toBe(original.pageAccent);
  expect(reset.bodyBg).toBe(original.bodyBg);
  expect(reset.bodyColor).toBe(original.bodyColor);
});

test("RELOAD after a Look: Original still restores the true original color", async ({
  page,
}) => {
  // First load — capture the true original, apply a Look, then grab the DOM the
  // editor would PERSIST (serialize <html>, as html-changed would: inline look
  // tokens on <html> + the untouched :root token blocks).
  const frame = await loadInto(page, NORMALIZED);
  const trueOriginal = await readEffective(frame);
  console.log("TRUE ORIGINAL:", JSON.stringify(trueOriginal));

  const crisp = THEME_PRESETS.find((p) => p.id === "crisp")!;
  await applyBundle(frame, crisp.tokens);
  const savedHtml = await frame.evaluate(
    () => "<!doctype html>" + document.documentElement.outerHTML,
  );

  // Second load — reload the SAVED html (look baked into inline <html>).
  const frame2 = await loadInto(page, savedHtml);
  const reloadedMeta = await firstMeta(page);
  console.log("RELOADED META.authored:", JSON.stringify(reloadedMeta.authored));

  // The live accent is the Look (correct — that's the current state)...
  expect(String(reloadedMeta.accent).toLowerCase()).toBe("#2563eb");
  // ...and tokens the page never authored (surface/font here) must NOT leak the
  // Look into the baseline — they read null so the reset removes them.
  const authored = reloadedMeta.authored as Record<string, unknown>;
  expect(authored.surface).toBeFalsy();
  expect(authored.displayFont).toBeFalsy();
  // ...but the captured "Original" baseline is the page's TRUE original.
  const baseline = readThemeBaseline(reloadedMeta);
  expect(baseline["--ol-accent"].toLowerCase()).toBe(
    trueOriginal.olAccent.toLowerCase(),
  );

  // And clicking Original after the reload restores the true original color.
  await applyBundle(frame2, baseline);
  const reset = await readEffective(frame2);
  console.log("AFTER RESET (post-reload):", JSON.stringify(reset));
  expect(reset.olAccent.toLowerCase()).toBe(trueOriginal.olAccent.toLowerCase());
  expect(reset.pageAccent.toLowerCase()).toBe(
    trueOriginal.pageAccent.toLowerCase(),
  );
  expect(reset.bodyBg).toBe(trueOriginal.bodyBg);
  expect(reset.bodyColor).toBe(trueOriginal.bodyColor);
});
