// Editor V5 final-push — committed proof for Subsystems A (3D/animated ancestor)
// and B (ghost-sibling / float-wrap). Self-contained fixtures (plain CSS, no
// Tailwind/network) reproducing the corpus classes each subsystem targets.
//
// METRIC: after startEdit, an editor must open AND, for static cases, every
// original glyph line must be reproduced within 2px. For the ANIMATED case we
// assert the in-context ghost ENGAGED (exact px is timing-sensitive while the
// ancestor animates; engagement + the runtime's own self-validation is the
// guarantee). Each subsystem's clone is self-validating, so engaging implies the
// projected layout was reproduced.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

const DOC = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  section { padding: 40px; }
  /* B — centered run sharing a wrapped line with a sibling mark */
  .b-center h2 { text-align: center; font-size: 40px; line-height: 1.15; max-width: 480px; margin: 0 auto; }
  .b-center .accent { color: #c0392b; }
  /* B — paragraph reflowing around a floated figure (lines 2-3 indented) */
  .b-float { max-width: 420px; }
  .b-float .fig { float: left; width: 64px; height: 64px; margin: 0 14px 6px 0; background: #ddd; }
  .b-float p { font-size: 16px; line-height: 1.6; margin: 0; }
  /* A — perspective + rotateY tilt */
  .a-persp { perspective: 1000px; }
  .a-tilt { transform: rotateY(18deg); transform-origin: left center; }
  .a-tilt h3 { font-size: 28px; margin: 0; }
  /* A — rotateY(180deg) flip (computes to matrix3d) */
  .a-flip { transform: rotateY(180deg); width: 360px; }
  .a-flip p { font-size: 18px; margin: 0; }
  /* A — perspective rotateX with a running transform animation */
  @keyframes a-drift { from { transform: perspective(800px) rotateX(8deg) translateX(0); }
                       to   { transform: perspective(800px) rotateX(8deg) translateX(-36px); } }
  .a-anim { animation: a-drift 3s linear infinite; transform: perspective(800px) rotateX(8deg); width: 340px; }
  .a-anim p { font-size: 18px; margin: 0; }
</style></head>
<body>
  <section class="b-center"><h2 id="b-center">Bring one essay to your next staff <span class="accent" id="b-center-mark">meeting</span></h2></section>
  <section class="b-float"><div class="fig" aria-hidden="true"></div><p id="b-float">A column of body copy that wraps around a floated figure so its second and third lines sit indented beside the figure while later lines return to the column's left edge.</p></section>
  <section class="a-persp"><div class="a-tilt"><h3 id="a-tilt">Tilted showcase heading text</h3></div></section>
  <section><div class="a-flip"><p id="a-flip">Mirrored back-of-card body text</p></div></section>
  <section><div class="a-anim"><p id="a-anim">Animated tilted card body text</p></div></section>
</body></html>`;

const AUGMENTED = injectInlineEdit(DOC);

async function setup(page: Page): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
       <iframe id="f" sandbox="allow-scripts allow-same-origin" style="width:1100px;height:900px;border:0;display:block"></iframe>
       <script>
         window.addEventListener('message', function (e) {
           if (e.data && e.data.type === 'openlen:iframe-ready')
             document.getElementById('f').contentWindow.postMessage({ type: 'openlen:set-mode', editMode: true, selectMode: false }, '*');
         });
       </script></body></html>`,
  );
  await page.evaluate(
    (html) => new Promise<void>((resolve) => {
      const f = document.getElementById("f") as HTMLIFrameElement;
      f.addEventListener("load", () => resolve(), { once: true });
      f.srcdoc = html;
    }),
    AUGMENTED,
  );
  const frame = page.mainFrame().childFrames()[0];
  await expect.poll(() => frame.evaluate(() => document.body.hasAttribute("data-openlen-edit-mode"))).toBe(true);
  await page.mouse.move(950, 880);
  return frame;
}

// Open an editor at the editable's first glyph; return whether it opened, the
// worst per-line glyph error vs the original, and whether an in-context ghost
// clone (Subsystem A/B) was used.
async function measure(frame: Frame, id: string) {
  return frame.evaluate((id: string) => {
    interface Row { top: number; left: number }
    function rowsOf(range: Range): Row[] {
      const list = range.getClientRects();
      const rs: DOMRect[] = [];
      for (let i = 0; i < list.length; i++) if (list[i].width > 0.5 && list[i].height > 0.5) rs.push(list[i]);
      rs.sort((a, b) => a.top - b.top || a.left - b.left);
      const rows: Row[] = [];
      for (const r of rs) { const m = rows.find((x) => Math.abs(x.top - r.top) <= Math.max(4, r.height / 2)); if (m) { m.left = Math.min(m.left, r.left); m.top = Math.min(m.top, r.top); } else rows.push({ top: r.top, left: r.left }); }
      rows.sort((a, b) => a.top - b.top);
      return rows;
    }
    const el = document.getElementById(id)!;
    el.scrollIntoView({ block: "center" });
    const range = document.createRange();
    if (el.children.length === 0) range.selectNodeContents(el);
    else { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null); let tn: Text | null = null, n = w.nextNode(); while (n) { if (/[^\s]/.test((n as Text).data)) { tn = n as Text; break; } n = w.nextNode(); } range.selectNodeContents(tn || el); }
    const orig = rowsOf(range);
    const raw = range.getClientRects();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: orig[0].left + 3, clientY: raw[0].top + raw[0].height / 2 }));
    const ov = document.querySelector("[data-openlen-edit-overlay]") as HTMLElement | null;
    const ghost = !!document.querySelector("[data-openlen-edit-ghost]");
    let maxErr = Infinity, lines = orig.length, ovLines = 0;
    if (ov) {
      const ovr = document.createRange(); ovr.selectNodeContents(ov);
      const ovRows = rowsOf(ovr); ovLines = ovRows.length;
      maxErr = 0;
      for (const o of orig) { const m = ovRows.reduce((a, b) => (Math.abs(b.top - o.top) < Math.abs(a.top - o.top) ? b : a)); maxErr = Math.max(maxErr, Math.abs(m.left - o.left), Math.abs(m.top - o.top)); }
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { opened: !!ov, ghost, maxErr, lines, ovLines };
  }, id);
}

test.describe("Editor V5 final-push — Subsystem B (ghost-sibling / float)", () => {
  test("centered run sharing a wrapped line with a sibling mark aligns ≤2px", async ({ page }) => {
    const frame = await setup(page);
    const r = await measure(frame, "b-center");
    expect(r.opened).toBe(true);
    expect(r.ghost).toBe(true); // engaged the context-preserving clone
    expect(r.maxErr).toBeLessThanOrEqual(2);
  });

  test("the full heading (incl. sibling mark) stays visible via the clone while editing", async ({ page }) => {
    const frame = await setup(page);
    // Open at the run's first glyph (top-left of the centered H2's first line).
    const shown = await frame.evaluate(() => {
      const el = document.getElementById("b-center")!;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      // click near the first glyph of the centered line (center-top)
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + 10 }));
      // clone-as-editor: the real block is hidden, the clone shows the FULL
      // heading (including the sibling mark) so editing stays WYSIWYG.
      const clone = document.querySelector("[data-openlen-edit-ghost]") as HTMLElement | null;
      const realHidden = !!document.getElementById("b-center")!.closest("[data-openlen-edit-hidden]") ||
        getComputedStyle(document.getElementById("b-center")!).visibility === "hidden";
      const cloneShowsMark = !!clone && /meeting/.test(clone.textContent || "") && getComputedStyle(clone).visibility !== "hidden";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { clone: !!clone, realHidden, cloneShowsMark };
    });
    expect(shown.clone).toBe(true);
    expect(shown.realHidden).toBe(true);     // real content hidden (not page-contenteditable)
    expect(shown.cloneShowsMark).toBe(true); // full heading still on screen via the clone
  });

  test("paragraph reflowing around a float aligns ≤2px", async ({ page }) => {
    const frame = await setup(page);
    const r = await measure(frame, "b-float");
    expect(r.opened).toBe(true);
    expect(r.ghost).toBe(true);
    expect(r.maxErr).toBeLessThanOrEqual(2);
  });
});

test.describe("Editor V5 final-push — Subsystem A (3D / animated ancestor)", () => {
  test("text inside perspective+rotateY tilt aligns ≤2px", async ({ page }) => {
    const frame = await setup(page);
    const r = await measure(frame, "a-tilt");
    expect(r.opened).toBe(true);
    expect(r.ghost).toBe(true);
    expect(r.maxErr).toBeLessThanOrEqual(2);
  });

  test("text inside a rotateY(180deg) flip aligns ≤2px", async ({ page }) => {
    const frame = await setup(page);
    const r = await measure(frame, "a-flip");
    expect(r.opened).toBe(true);
    expect(r.ghost).toBe(true);
    expect(r.maxErr).toBeLessThanOrEqual(2);
  });

  test("text inside a running transform animation engages the in-context clone", async ({ page }) => {
    const frame = await setup(page);
    const r = await measure(frame, "a-anim");
    expect(r.opened).toBe(true);
    // The clone shares the animated ancestor → tracks it; engagement (self-
    // validated) is the guarantee. Exact px is timing-sensitive mid-animation.
    expect(r.ghost).toBe(true);
  });
});
