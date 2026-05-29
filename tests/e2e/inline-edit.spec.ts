// Editor V5 — e2e + visual regression (Phase 8.2).
//
// Strategy: inject the REAL runtime (injectInlineEdit) into a sample landing
// page, host it in an iframe, and simulate the production parent — respond to
// `openlen:iframe-ready` with `openlen:set-mode {editMode:true}` and collect
// every `openlen:html-changed`. This exercises the genuine overlay mechanics
// in a real browser with no Next app / DB / crate dependency.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

const SAMPLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; color: #111; }
  .hero { padding: 48px; }
  .hero h1 { font-size: 40px; line-height: 1.1; text-wrap: balance; max-width: 620px; margin: 0 0 16px; }
  .lead { font-size: 18px; color: #444; margin: 0; max-width: 620px; }
  .lead a { color: #c0392b; text-decoration: underline; }
  .fx { transform: translateZ(0) scale(1.0); will-change: transform; padding: 24px 48px; }
  .fx h2 { font-size: 28px; margin: 0; }
  .cta { display: inline-block; margin: 24px 48px; padding: 12px 22px; background: #ff5a36; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; }
  .empty { padding: 0 48px; min-height: 24px; }
  [dir="rtl"] { font-size: 22px; padding: 0 48px; }
</style></head>
<body>
  <section class="hero">
    <h1 id="hero">Your design backlog, prioritized by impact today</h1>
    <p class="lead" id="lead">Ship faster with <strong id="b">bold</strong> moves and a <a href="https://example.com" id="lnk">clear link</a> forward.</p>
  </section>
  <div class="fx"><h2 id="fx-title">Inside a transformed ancestor</h2></div>
  <a class="cta" id="cta" href="#">Get started</a>
  <p dir="rtl" id="rtl">مرحبا بكم في صفحتنا</p>
</body></html>`;

const AUGMENTED = injectInlineEdit(SAMPLE);

type Win = Window & { __msgs?: Array<Record<string, unknown>> };

/** Load the host page (iframe + parent bridge), inject the augmented sample,
 *  and wait until edit mode is live in the frame. Returns the editor frame. */
async function setup(page: Page): Promise<Frame> {
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
           if (e.data.type === 'openlen:iframe-ready') {
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
  // Park the mouse off the iframe so no :hover affordance bleeds into shots.
  await page.mouse.move(500, 780);
  return frame;
}

const overlayCount = (frame: Frame) =>
  frame.locator("[data-openlen-edit-overlay]").count();
const pageEditableCount = (frame: Frame) =>
  frame.locator("[contenteditable]:not([data-openlen-edit-overlay])").count();
const msgs = (page: Page) => page.evaluate(() => (window as Win).__msgs || []);

test.describe("Editor V5 overlay", () => {
  test("never puts contenteditable on the page DOM", async ({ page }) => {
    const frame = await setup(page);
    expect(await pageEditableCount(frame)).toBe(0);
    expect(await overlayCount(frame)).toBe(0);

    await page.frameLocator("#f").locator("#hero").click();
    await expect.poll(() => overlayCount(frame)).toBe(1);

    // Exactly one contenteditable exists and it is the overlay; the <h1> is
    // NOT editable — text-wrap:balance keeps running on the page DOM.
    expect(await frame.locator("[contenteditable]").count()).toBe(1);
    expect(await pageEditableCount(frame)).toBe(0);
    expect(
      await frame.locator("#hero").evaluate((el) => el.hasAttribute("contenteditable")),
    ).toBe(false);
  });

  test("edits a clean text element and persists via html-changed", async ({ page }) => {
    const frame = await setup(page);
    await page.frameLocator("#f").locator("#hero").click();
    await expect.poll(() => overlayCount(frame)).toBe(1);

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Edited hero headline");
    await page.keyboard.press("Enter");

    await expect.poll(() => overlayCount(frame)).toBe(0);
    expect(await frame.locator("#hero").textContent()).toBe("Edited hero headline");

    // A clean html-changed was posted: contains the new text, none of the
    // editor instrumentation markers.
    await expect
      .poll(async () => {
        const all = await msgs(page);
        return all.some(
          (m) =>
            m.type === "openlen:html-changed" &&
            m.source === "inline-edit" &&
            typeof m.outerHtml === "string" &&
            (m.outerHtml as string).includes("Edited hero headline") &&
            !(m.outerHtml as string).includes("data-openlen-edit-overlay") &&
            !(m.outerHtml as string).includes("data-openlen-editable"),
        );
      })
      .toBe(true);
  });

  test("preserves inline marks when editing a run (strong + link survive)", async ({ page }) => {
    const frame = await setup(page);
    // Click the leading text run of the paragraph (before the <strong>).
    const box = await frame.locator("#lead").boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + 12, box!.y + 8);
    await expect.poll(() => overlayCount(frame)).toBe(1);

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Move quickly with ");
    await page.keyboard.press("Enter");
    await expect.poll(() => overlayCount(frame)).toBe(0);

    // The bold span and the link (with its href) are untouched.
    expect(await frame.locator("#lead #b").textContent()).toBe("bold");
    expect(await frame.locator("#lead #lnk").getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(await frame.locator("#lead").innerHTML()).toContain("Move quickly with ");
  });

  test("positions the overlay over an element inside a transformed ancestor", async ({ page }) => {
    const frame = await setup(page);
    await page.frameLocator("#f").locator("#fx-title").click();
    await expect.poll(() => overlayCount(frame)).toBe(1);

    const target = await frame.locator("#fx-title").boundingBox();
    const overlay = await frame.locator("[data-openlen-edit-overlay]").boundingBox();
    expect(target && overlay).toBeTruthy();
    // Self-correcting placement should land within ~2px of the real element
    // despite the ancestor transform / will-change.
    expect(Math.abs(overlay!.x - target!.x)).toBeLessThan(2);
    expect(Math.abs(overlay!.y - target!.y)).toBeLessThan(2);
  });

  test("Escape cancels without mutating the page", async ({ page }) => {
    const frame = await setup(page);
    const original = await frame.locator("#hero").textContent();
    await page.frameLocator("#f").locator("#hero").click();
    await expect.poll(() => overlayCount(frame)).toBe(1);
    await page.keyboard.type("junk that should be discarded");
    await page.keyboard.press("Escape");
    await expect.poll(() => overlayCount(frame)).toBe(0);
    expect(await frame.locator("#hero").textContent()).toBe(original);
  });

  test("does not open an overlay on an element with no editable text", async ({ page }) => {
    const frame = await setup(page);
    // The CTA has text, but click a known-empty spot — the empty <p> has no
    // text node so it was never marked editable; clicking it does nothing.
    await frame.evaluate(() => {
      const p = document.createElement("p");
      p.className = "empty";
      p.id = "blank";
      p.textContent = "   ";
      document.body.appendChild(p);
    });
    await page.frameLocator("#f").locator("#blank").click({ force: true });
    await page.waitForTimeout(150);
    expect(await overlayCount(frame)).toBe(0);
  });

  test("visual: page is pixel-identical after a no-op edit cycle (fidelity)", async ({ page }) => {
    const frame = await setup(page);
    const fx = page.locator("#f");

    // Baseline artifact for the suite (created on first --update-snapshots run).
    await expect(fx).toHaveScreenshot("page-idle.png");

    const before = await fx.screenshot();
    // Open the hero overlay then cancel — the page text is restored unchanged.
    await page.frameLocator("#f").locator("#hero").click();
    await expect.poll(() => overlayCount(frame)).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => overlayCount(frame)).toBe(0);
    await page.mouse.move(500, 780);
    const after = await fx.screenshot();

    // Opening + closing an overlay leaves the rendered page byte-identical:
    // the overlay never touched the page DOM (goal #7/#9).
    expect(Buffer.compare(before, after)).toBe(0);
  });
});
