// Editor V5 hardening — empirical single-body inspector. Dumps, per editable,
// the original glyph rects vs the overlay glyph rects + the box facts that
// explain any divergence (width, padding, position). Tells artifact from bug.
//   npx tsx --tsconfig tsconfig.eval.json scripts/editor-v5/debug-one.ts <bodyId> [maxEls]

import { chromium } from "playwright";
import { loadTailwindCss, prepareDoc, readBody, readManifest } from "./corpus-lib";

async function main() {
  const bodyId = process.argv[2] || "about-01";
  const maxEls = process.argv[3] ? parseInt(process.argv[3], 10) : 12;
  const { entries } = readManifest();
  const e = entries.find((x) => x.id === bodyId);
  if (!e) throw new Error(`no body ${bodyId}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript("window.__name = window.__name || function (f) { return f; };");
  await ctx.route("**/*", (r) => {
    const u = r.request().url();
    return u.startsWith("data:") || u.startsWith("about:") || u.startsWith("blob:")
      ? r.continue()
      : r.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", () => {});
  await page.setContent(prepareDoc(readBody(e), loadTailwindCss()), {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(() => document.body.setAttribute("data-openlen-edit-mode", ""));
  await page.waitForFunction(
    () => document.querySelectorAll("[data-openlen-editable]").length > 0,
    { timeout: 3000 },
  ).catch(() => {});

  const dump = await page.evaluate((maxEls) => {
    const W = (rs: DOMRectList | DOMRect[]) =>
      Array.from(rs).map((r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    function firstNonBlank(root: Node): Text | null {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let n = w.nextNode();
      while (n) { if (/[^\s]/.test((n as Text).data)) return n as Text; n = w.nextNode(); }
      return null;
    }
    const out: unknown[] = [];
    const els = Array.from(document.querySelectorAll("[data-openlen-editable]")) as HTMLElement[];
    for (let i = 0; i < Math.min(maxEls, els.length); i++) {
      const el = els[i];
      el.scrollIntoView({ block: "center" });
      const mode = el.children.length === 0 ? "element" : "run";
      const range = document.createRange();
      let styleSource: HTMLElement = el;
      if (mode === "element") range.selectNodeContents(el);
      else { const tn = firstNonBlank(el); if (!tn) continue; range.selectNodeContents(tn); styleSource = tn.parentElement as HTMLElement; }
      const orig = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
      if (!orig.length) continue;
      const o0 = orig[0];
      const ss = getComputedStyle(styleSource);
      const srcText = (mode === "element" ? el.textContent : (firstNonBlank(el) as Text).data) || "";
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: o0.left + 3, clientY: o0.top + o0.height / 2, view: window }));
      const ov = document.querySelector("[data-openlen-edit-overlay]") as HTMLElement | null;
      const wrapEl = document.querySelector("[data-openlen-edit-wrap]") as HTMLElement | null;
      let ovInfo: Record<string, unknown> = { missing: true };
      if (ov) {
        const ovcs = getComputedStyle(ov);
        const ovr = document.createRange(); ovr.selectNodeContents(ov);
        ovInfo = {
          missing: false,
          position: ov.style.position,
          styleW: ov.style.width,
          padL: ovcs.paddingLeft, padT: ovcs.paddingTop,
          ovWS: ovcs.whiteSpace, ovLH: ovcs.lineHeight, ovTextAlign: ovcs.textAlign,
          ovText: (ov.textContent || "").slice(0, 40),
          wrapRect: wrapEl ? `${Math.round(wrapEl.getBoundingClientRect().left)},${Math.round(wrapEl.getBoundingClientRect().top)} ${Math.round(wrapEl.getBoundingClientRect().width)}x${Math.round(wrapEl.getBoundingClientRect().height)}` : "n/a",
          boxRect: `${Math.round(ov.getBoundingClientRect().left)},${Math.round(ov.getBoundingClientRect().top)} ${Math.round(ov.getBoundingClientRect().width)}x${Math.round(ov.getBoundingClientRect().height)}`,
          glyphRects: W(ovr.getClientRects()),
        };
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      out.push({
        i, tag: el.tagName.toLowerCase(), mode, children: el.children.length,
        elRect: `${Math.round(el.getBoundingClientRect().width)}w`,
        ssPad: `L${ss.paddingLeft} R${ss.paddingRight} T${ss.paddingTop}`,
        srcWS: ss.whiteSpace, srcLH: ss.lineHeight, srcFS: ss.fontSize, srcAlign: ss.textAlign,
        srcText: srcText.slice(0, 40),
        origGlyphs: W(orig),
        overlay: ovInfo,
      });
    }
    return out;
  }, maxEls);

  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
