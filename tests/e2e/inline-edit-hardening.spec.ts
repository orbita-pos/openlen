// Editor V5 hardening — committed glyph-fidelity + visual-regression suite.
//
// The full 290-body corpus diagnostic (scripts/editor-v5/diagnose.ts) needs
// prod R2 + an offline Tailwind build, so it stays a dev tool. THIS suite bakes
// the real-corpus patterns it surfaced into self-contained fixtures (plain CSS,
// no Tailwind CDN / network) so CI proves the fixes hold:
//
//   - FlowDeck hero: centered text-wrap:balance H1 with a trailing colored span
//     (the prod report: overlay ~30% right + grey partner still visible). RUN.
//   - run inside a PADDED parent (overlay must not inherit the parent padding).
//   - run with PRETTY-PRINTED leading/trailing whitespace (forced pre-wrap host
//     would render the newlines literally → spurious wrap).
//   - multi-line element + multi-line run (left): line-fragment alignment.
//   - element inside a TRANSFORMED ancestor (containing-block + glyph anchor).
//   - gradient-clipped (background-clip:text) heading.
//
// METRIC = glyph fidelity: every original text LINE must be reproduced by the
// overlay within 1.5px (left + top). Plus the V5 invariants: the page DOM is
// never contenteditable, and an open→commit-no-op cycle leaves the rendered
// page byte-identical.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

const DOC = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  section { padding: 40px; }
  .hero h1 { font-size: 48px; line-height: 1.1; text-align: center; text-wrap: balance;
             max-width: 620px; margin: 0 auto; }
  .hero .muted { color: #9aa0a6; }
  .badge { display: inline-flex; padding: 6px 14px; border: 1px solid #ddd; border-radius: 999px;
           font-size: 13px; }
  .lead { font-size: 18px; line-height: 1.6; max-width: 360px; }
  .lead a { color: #c0392b; }
  .narrow { font-size: 16px; line-height: 1.5; max-width: 280px; }
  .fx { transform: translate(8px, 4px); will-change: transform; }
  .fx h2 { font-size: 30px; margin: 0; }
  .grad { font-size: 44px; font-weight: 800; text-align: center;
          background-image: linear-gradient(90deg,#ff5a36,#c0392b);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .editorial p { font-size: 17px; line-height: 1.7; max-width: 440px; text-indent: 28px; }
</style></head>
<body>
  <section class="hero">
    <h1 id="flowdeck">See the bug. <span class="muted" id="fd-muted">Not the stack trace.</span></h1>
  </section>
  <section>
    <div class="badge" id="badge">
          Lisbon HQ · Est. 2019 <span class="muted" aria-hidden="true" id="badge-dot">●</span></div>
  </section>
  <section>
    <p class="lead" id="lead">Move quickly with <strong id="lead-b">bold</strong> intent and a
      <a href="https://example.com" id="lead-a">clear link</a> that wraps across more than one line here.</p>
  </section>
  <section>
    <p class="narrow" id="narrow">A blazing-fast block of text that is forced to wrap onto several
      lines so multi-line element fidelity is exercised end to end.</p>
  </section>
  <section class="fx"><h2 id="fx-title">Inside a transformed ancestor</h2></section>
  <section><h2 class="grad" id="grad">Gradient clipped headline text</h2></section>
  <section class="editorial"><p id="editorial">First-line indented editorial paragraph body copy that
      runs onto multiple lines to verify the mirrored text-indent survives the overlay round-trip.</p></section>
</body></html>`;

const AUGMENTED = injectInlineEdit(DOC);

async function setup(page: Page): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head>
     <body style="margin:0">
       <iframe id="f" sandbox="allow-scripts allow-same-origin"
               style="width:1100px;height:900px;border:0;display:block"></iframe>
       <script>
         window.addEventListener('message', function (e) {
           if (e.data && e.data.type === 'openlen:iframe-ready') {
             document.getElementById('f').contentWindow.postMessage(
               { type: 'openlen:set-mode', editMode: true, selectMode: false }, '*');
           }
         });
       </script>
     </body></html>`,
  );
  await page.evaluate(
    (html) =>
      new Promise<void>((resolve) => {
        const f = document.getElementById("f") as HTMLIFrameElement;
        f.addEventListener("load", () => resolve(), { once: true });
        f.srcdoc = html;
      }),
    AUGMENTED,
  );
  const frame = page.mainFrame().childFrames()[0];
  await expect
    .poll(() => frame.evaluate(() => document.body.hasAttribute("data-openlen-edit-mode")))
    .toBe(true);
  await page.mouse.move(900, 880);
  return frame;
}

const overlayCount = (frame: Frame) => frame.locator("[data-openlen-edit-overlay]").count();

// Measure original glyph LINES, drive the real startEdit via the editable id,
// measure overlay glyph LINES, return the worst per-line left/top error (px).
// Mirrors the corpus diagnostic's glyph-fidelity metric, in-browser.
async function glyphError(
  frame: Frame,
  id: string,
  runStart: boolean,
): Promise<{ existed: boolean; rows: number; ovRows: number; maxErr: number; firstDx: number; firstDy: number }> {
  return frame.evaluate(
    ([id, runStart]: [string, boolean]) => {
      interface Row { top: number; left: number; right: number }
      function rowsOf(range: Range): Row[] {
        const list = range.getClientRects();
        const rs: DOMRect[] = [];
        for (let i = 0; i < list.length; i++) if (list[i].width > 0.5 && list[i].height > 0.5) rs.push(list[i]);
        rs.sort((a, b) => a.top - b.top || a.left - b.left);
        const rows: Row[] = [];
        for (const r of rs) {
          const band = Math.max(4, r.height / 2);
          const row = rows.find((x) => Math.abs(x.top - r.top) <= band);
          if (row) { row.left = Math.min(row.left, r.left); row.top = Math.min(row.top, r.top); }
          else rows.push({ top: r.top, left: r.left, right: r.right });
        }
        rows.sort((a, b) => a.top - b.top);
        return rows;
      }
      const el = document.getElementById(id)!;
      el.scrollIntoView({ block: "center" });
      const range = document.createRange();
      if (runStart) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let tn: Text | null = null, n = w.nextNode();
        while (n) { if (/[^\s]/.test((n as Text).data)) { tn = n as Text; break; } n = w.nextNode(); }
        range.selectNodeContents(tn || el);
      } else {
        range.selectNodeContents(el);
      }
      const orig = rowsOf(range);
      const o0 = orig[0];
      const raw = range.getClientRects();
      el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, view: window,
        clientX: o0.left + 3, clientY: raw[0].top + raw[0].height / 2,
      }));
      const ov = document.querySelector("[data-openlen-edit-overlay]") as HTMLElement | null;
      if (!ov) return { existed: false, rows: orig.length, ovRows: 0, maxErr: Infinity, firstDx: Infinity, firstDy: Infinity };
      const ovRange = document.createRange();
      ovRange.selectNodeContents(ov);
      const ovRows = rowsOf(ovRange);
      let maxErr = 0;
      for (const orow of orig) {
        const m = ovRows.reduce((a, b) => (Math.abs(b.top - orow.top) < Math.abs(a.top - orow.top) ? b : a));
        maxErr = Math.max(maxErr, Math.abs(m.left - orow.left), Math.abs(m.top - orow.top));
      }
      const firstDx = ovRows[0].left - o0.left;
      const firstDy = ovRows[0].top - o0.top;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { existed: true, rows: orig.length, ovRows: ovRows.length, maxErr, firstDx, firstDy };
    },
    [id, runStart] as [string, boolean],
  );
}

test.describe("Editor V5 hardening — glyph fidelity", () => {
  const cases: Array<{ id: string; run: boolean; name: string }> = [
    { id: "flowdeck", run: true, name: "FlowDeck centered balance hero (run before colored span)" },
    { id: "badge", run: true, name: "run inside a padded parent" },
    { id: "lead", run: true, name: "leading run before inline marks (multi-line)" },
    { id: "narrow", run: false, name: "multi-line block element (left)" },
    { id: "fx-title", run: false, name: "element inside a transformed ancestor" },
    { id: "grad", run: false, name: "gradient-clipped heading" },
    { id: "editorial", run: false, name: "editorial paragraph with text-indent" },
  ];

  for (const c of cases) {
    test(`overlay glyphs align ≤1.5px — ${c.name}`, async ({ page }) => {
      const frame = await setup(page);
      const r = await glyphError(frame, c.id, c.run);
      expect(r.existed).toBe(true); // an overlay opened for this editable
      // Every original line is reproduced by the overlay within 1.5px.
      expect(Math.abs(r.firstDx)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(r.firstDy)).toBeLessThanOrEqual(1.5);
      expect(r.maxErr).toBeLessThanOrEqual(1.5);
    });
  }

  test("FlowDeck: the trailing colored span is NOT hidden when editing the leading run", async ({ page }) => {
    const frame = await setup(page);
    await page.frameLocator("#f").locator("#flowdeck").click({ position: { x: 8, y: 8 } });
    await expect.poll(() => overlayCount(frame)).toBe(1);
    // Run-mode hides ONLY the clicked run; the colored partner stays visible.
    const mutedHidden = await frame
      .locator("#fd-muted")
      .evaluate((el) => getComputedStyle(el).visibility === "hidden" || el.closest("[data-openlen-edit-hidden]") != null);
    expect(mutedHidden).toBe(false);
  });

  test("open→commit no-op leaves the rendered page byte-identical (all fixtures)", async ({ page }) => {
    const frame = await setup(page);
    const fx = page.locator("#f");
    await frame.evaluate(() => window.scrollTo(0, 0));
    await expect(fx).toHaveScreenshot("hardening-idle.png");
    const before = await fx.screenshot();
    for (const c of cases) {
      // Open the overlay at the editable's first glyph, then commit with no
      // typing. dispatch on the editable element itself (e.target must be the
      // marked node — synthetic events ignore coordinates for hit-testing).
      await frame.evaluate((id) => {
        const el = document.getElementById(id)!;
        el.scrollIntoView({ block: "center" });
        const range = document.createRange();
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let tn: Text | null = null, n = w.nextNode();
        while (n) { if (/[^\s]/.test((n as Text).data)) { tn = n as Text; break; } n = w.nextNode(); }
        range.selectNodeContents(tn || el);
        const r = range.getClientRects()[0] || el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: r.left + 3, clientY: r.top + r.height / 2 }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); // commit, no typing
      }, c.id);
    }
    await expect.poll(() => overlayCount(frame)).toBe(0);
    await frame.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(900, 880);
    const after = await fx.screenshot();
    expect(Buffer.compare(before, after)).toBe(0);
  });

  test("overlay creation + position + style-mirror is fast (<16ms)", async ({ page }) => {
    const frame = await setup(page);
    const timings = await frame.evaluate(() => {
      const ids = ["flowdeck", "badge", "lead", "narrow", "fx-title", "grad", "editorial"];
      const out: number[] = [];
      for (const id of ids) {
        const el = document.getElementById(id)!;
        el.scrollIntoView({ block: "center" });
        const range = document.createRange();
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let tn: Text | null = null, n = w.nextNode();
        while (n) { if (/[^\s]/.test((n as Text).data)) { tn = n as Text; break; } n = w.nextNode(); }
        range.selectNodeContents(tn || el);
        const r = range.getClientRects()[0] || el.getBoundingClientRect();
        const t0 = performance.now();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: r.left + 3, clientY: r.top + r.height / 2 }));
        out.push(performance.now() - t0); // startEdit runs synchronously in the handler
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
      return out;
    });
    const worst = Math.max(...timings);
    expect(worst).toBeLessThan(16);
  });
});
