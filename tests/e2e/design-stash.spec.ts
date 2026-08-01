// Repro/spec for Task 5 — data-ol-was stash in the iframe runtime.
//
// Strategy mirrors theme-reset.spec.ts: inject the REAL element-inspect
// runtime (injectElementInspect) into a normalized landing page, host it in
// an iframe, and act as the production parent — post apply-prop messages and
// read back both the live attribute (data-ol-was) and the element-selected
// payload the runtime posts.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { injectElementInspect } from "../../components/workspace-v2/use-element-inspect";

// The fully-normalized "counter" project — the real shape a user edits.
const NORMALIZED = readFileSync(
  join(process.cwd(), "crates/html-engine/tests/fixtures/chain/counter.html"),
  "utf8",
);

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

// Helper: path posicional de un selector, replicando buildPath del runtime.
async function pathOf(frame: Frame, selector: string): Promise<string> {
  return frame.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const segs: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML" && cur.parentElement) {
      let nth = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) nth += 1;
        sib = sib.previousElementSibling;
      }
      segs.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${nth})`);
      cur = cur.parentElement;
    }
    return segs.join(" > ");
  }, selector);
}

function applyStyleMsg(frame: Frame, path: string, prop: string, value: string) {
  return frame.evaluate(
    (d) => window.postMessage({ type: "openlen:apply-prop", scope: "style", path: d.path, prop: d.prop, value: d.value }, "*"),
    { path, prop, value },
  );
}

function applyResetMsg(frame: Frame, path: string, props: string[]) {
  return frame.evaluate(
    (d) => window.postMessage({ type: "openlen:apply-prop", scope: "reset", path: d.path, props: d.props }, "*"),
    { path, props },
  );
}

function applySelectMsg(frame: Frame, path: string) {
  return frame.evaluate(
    (p) => window.postMessage({ type: "openlen:apply-prop", scope: "select", path: p }, "*"),
    path,
  );
}

test("stash de primer toque + reset restaura el valor de diseño", async ({ page }) => {
  const frame = await loadInto(page, NORMALIZED);
  const path = await pathOf(frame, "h1");
  const before = await frame.evaluate(() => getComputedStyle(document.querySelector("h1")!).color);

  await applyStyleMsg(frame, path, "color", "#ff0000");
  await expect
    .poll(() => frame.evaluate(() => document.querySelector("h1")!.getAttribute("data-ol-was")))
    .toBe('{"color":""}');

  // Segundo toque NO re-stashea (el stash guarda el diseño, no el rojo).
  await applyStyleMsg(frame, path, "color", "#00ff00");
  expect(await frame.evaluate(() => document.querySelector("h1")!.getAttribute("data-ol-was"))).toBe('{"color":""}');

  await applyResetMsg(frame, path, ["color"]);
  await expect
    .poll(() => frame.evaluate(() => document.querySelector("h1")!.getAttribute("data-ol-was")))
    .toBeNull();
  expect(await frame.evaluate(() => getComputedStyle(document.querySelector("h1")!).color)).toBe(before);
});

test("element-selected reporta wasProps", async ({ page }) => {
  const frame = await loadInto(page, NORMALIZED);
  const path = await pathOf(frame, "h1");
  await applyStyleMsg(frame, path, "color", "#ff0000");
  // Selección programática vía click en edit mode:
  await frame.evaluate(() => document.body.setAttribute("data-openlen-edit-mode", ""));
  await frame.locator("h1").first().click();
  // Reading __msgs right after a click can race the postMessage delivery —
  // poll for the element-selected message carrying wasProps instead of a
  // single synchronous read (documented flaky).
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as Win).__msgs ?? []).some(
          (m) => m.type === "openlen:element-selected" && "wasProps" in m,
        ),
      ),
    )
    .toBe(true);
  const sel = await page.evaluate(() => {
    const msgs = (window as Win).__msgs ?? [];
    return msgs.filter((m) => m.type === "openlen:element-selected").pop();
  });
  expect((sel as { wasProps?: string[] }).wasProps).toEqual(["color"]);
});

test("padding en pasos escribe var(--ol-space-*) y el stash sobrevive un reorder", async ({ page }) => {
  const frame = await loadInto(page, NORMALIZED);
  const path = await pathOf(frame, "section");
  await applyStyleMsg(frame, path, "padding", "var(--ol-space-6, 1.5rem)");
  await expect
    .poll(() => frame.evaluate(() => document.querySelector("section")!.getAttribute("style")))
    .toContain("var(--ol-space-6");

  // Simular un reorder real: mover la sección al final del body.
  await frame.evaluate(() => {
    const sec = document.querySelector("section")!;
    sec.parentElement!.appendChild(sec);
  });
  // El atributo viaja con el elemento: su identidad posicional se rompió
  // (ya no es la primera <section> — un querySelector("section") plano
  // ahora resolvería a una sección DISTINTA), pero es literalmente el
  // último nodo <section> en orden de documento, así que lo re-localizamos
  // por ahí y confirmamos que el stash sigue en el nodo real que se movió.
  const stash = await frame.evaluate(() => document.querySelector("section:last-of-type")!.getAttribute("data-ol-was"));
  expect(JSON.parse(stash!)).toHaveProperty("padding");

  // Reset con el path NUEVO del elemento movido.
  const newPath = await pathOf(frame, "section:last-of-type");
  await applyResetMsg(frame, newPath, ["padding"]);
  await expect
    .poll(() => frame.evaluate(() => document.querySelector("section:last-of-type")!.getAttribute("data-ol-was")))
    .toBeNull();
});

test("breadcrumb: element-selected trae ancestros y scope select re-selecciona", async ({ page }) => {
  const frame = await loadInto(page, NORMALIZED);
  await frame.evaluate(() => document.body.setAttribute("data-openlen-edit-mode", ""));
  await frame.locator("h1").first().click();
  // Task 11 gotcha: reading __msgs right after a click can race the postMessage
  // delivery — poll instead of a single synchronous read.
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as Win).__msgs ?? []).some((m) => m.type === "openlen:element-selected"),
      ),
    )
    .toBe(true);
  const sel = await page.evaluate(() =>
    ((window as Win).__msgs ?? []).filter((m) => m.type === "openlen:element-selected").pop(),
  );
  const ancestors = (sel as { ancestors?: Array<{ path: string; tag: string }> }).ancestors ?? [];
  expect(ancestors.length).toBeGreaterThan(0);
  await applySelectMsg(frame, ancestors[0].path);
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as Win).__msgs ?? []).filter((m) => m.type === "openlen:element-selected").length,
      ),
    )
    .toBeGreaterThan(1);
  const sel2 = await page.evaluate(() =>
    ((window as Win).__msgs ?? []).filter((m) => m.type === "openlen:element-selected").pop(),
  );
  expect((sel2 as { tag?: string }).tag).toBe(ancestors[0].tag);
});
