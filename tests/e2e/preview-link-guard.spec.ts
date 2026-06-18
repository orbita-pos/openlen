// Preview link guard — a srcdoc iframe has no URL of its own, so a page's hash
// / relative links resolve against the PARENT document (the /new workspace).
// Clicking a nav link like "Sign in" (href="#cta") would load /new INSIDE the
// preview = an endless loop back into OpenLen. The guard (in use-inline-edit.ts)
// blocks that navigation and smooth-scrolls same-page anchors instead — the
// behavior a visitor gets on the real published page. These tests exercise the
// genuine injected runtime in a real browser, no Next app / DB needed.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;font-family:Arial,Helvetica,sans-serif}
  nav{position:sticky;top:0;padding:16px;background:#fff}
  .spacer{height:2400px}
  #contacto{padding:80px 24px}
</style></head>
<body>
  <nav>
    <a id="signin" href="#contacto">Sign in</a>
    <a id="ext" href="https://example.com/pricing">Pricing</a>
  </nav>
  <div class="spacer">scroll region</div>
  <section id="contacto"><h2 id="contacto-h">Contacto</h2></section>
</body></html>`;

const AUGMENTED = injectInlineEdit(PAGE);

/** Host the augmented page in a real srcdoc iframe, mirroring production: a
 *  parent page (NOT the page itself) whose URL the iframe's links would
 *  otherwise resolve against. Edit mode stays OFF — visitor-style viewing. */
async function setupViewing(page: Page): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head>
     <body style="margin:0">
       <iframe id="f" sandbox="allow-scripts allow-same-origin"
               style="width:1000px;height:740px;border:0;display:block"></iframe>
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
  return page.mainFrame().childFrames()[0];
}

test.describe("Preview link guard", () => {
  test("same-page anchor scrolls in-frame and does not navigate away", async ({ page }) => {
    const frame = await setupViewing(page);
    expect(await frame.evaluate(() => window.scrollY)).toBe(0);
    expect(await frame.locator("#signin").count()).toBe(1);

    await page.frameLocator("#f").locator("#signin").click();

    // It scrolled down toward #contacto (past the 2400px spacer) …
    await expect
      .poll(() => frame.evaluate(() => Math.round(window.scrollY)))
      .toBeGreaterThan(200);
    // … and the page is STILL the page — no loop-navigation blanked the frame.
    expect(await frame.locator("#signin").count()).toBe(1);
    expect(await frame.locator("#contacto-h").count()).toBe(1);
  });

  test("external link click is suppressed — the preview never navigates off the page", async ({ page }) => {
    const frame = await setupViewing(page);

    await page.frameLocator("#f").locator("#ext").click();
    await page.waitForTimeout(150); // give any navigation a chance to fire

    expect(await frame.locator("#ext").count()).toBe(1); // page intact
    expect(await frame.evaluate(() => window.scrollY)).toBe(0); // and no scroll
  });
});
