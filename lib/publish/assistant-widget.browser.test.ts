// @vitest-environment node
//
// HER VISUALS IN A REAL BROWSER (spec local 2026-11-06-asistente-propio, §5; phase 2B): the published page with her
// bubble, served locally, in the eyes' Chromium. In jsdom an iframe inside a shadow root has no window, so what the
// frame says back — its height, a link, who is talking — can only be checked here.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";

import { bakeAssistantPersona } from "./assistant-widget";

const VISUAL =
  '<a id="ok" href="#pedir">Reservar</a> <a id="bad" href="https://example.org/pagar">Pagar</a>' +
  '<div style="height:900px">huecos</div>';
const PAGE = `<!doctype html><html lang="es"><body><h1>Pastelería Canela</h1><section id="pedir" style="margin-top:2000px">Pedidos</section></body></html>`;

let server: Server;
let origin: string;
let releaseEgress: () => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/assistant/")) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        res.end(JSON.stringify({ respuesta: "Estos son los huecos:\n\n¿Reservas?", intent: "answer", visuals: [{ title: "huecos", code: VISUAL, at: 21 }] }));
      } else res.end(JSON.stringify({ asistente: true, chat: false, traspaso: false }));
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(bakeAssistantPersona(PAGE, { sub: "canela", apiBase: origin, businessName: "Pastelería Canela", persona: { name: "Lucía", color: "#5FB8A6", shape: "drop" } }));
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

describe("her visuals in the published page's bubble", () => {
  it("🔴 a sandboxed frame that can't fetch, is held to 480px, and only follows links to the business", async () => {
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      const said: string[] = [];
      page.on("console", (m) => said.push(m.text()));
      page.on("pageerror", (e) => said.push(String(e)));
      await page.goto(`${origin}/`, { waitUntil: "load", timeout: 20_000 });
      const hasHost = await page.evaluate(() => Boolean(document.querySelector("body > div[aria-live]")));
      expect(hasHost, `${said.join(" | ")} || ${(await page.content()).slice(0, 300)}`).toBe(true);
      await page.evaluate(() => {
        const root = document.querySelector("body > div[aria-live]")!.shadowRoot!;
        (root.querySelector(".btn") as HTMLButtonElement).click();
        (root.querySelector(".ip input") as HTMLInputElement).value = "¿huecos el sábado?";
        (root.querySelector(".ip") as HTMLFormElement).requestSubmit();
      });
      const frameEl = await page.waitForFunction(() => document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector("iframe"), { timeout: 10_000 });
      const frame = await frameEl.asElement()!.contentFrame();
      await frame!.waitForSelector("#ok", { timeout: 10_000 });

      // Held to 480px, from the frame's own height message.
      await page.waitForFunction(() => (document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector("iframe") as HTMLIFrameElement).style.height === "480px", { timeout: 10_000 });

      // A null origin, and no fetch: the CSP stops it before it leaves.
      const inside = await frame!.evaluate(
        () =>
          new Promise<{ origin: string; violated: string }>((resolve) => {
            document.addEventListener("securitypolicyviolation", (e) => resolve({ origin: location.origin, violated: e.violatedDirective }));
            fetch("https://example.org/robo?d=1").catch(() => {});
            setTimeout(() => resolve({ origin: location.origin, violated: "none" }), 3000);
          }),
      );
      expect(inside).toEqual({ origin: "null", violated: "connect-src" });

      // Another site: nothing happens. The business's own anchor: the page goes there.
      await frame!.click("#bad");
      await new Promise((r) => setTimeout(r, 300));
      expect(page.url()).toBe(`${origin}/`);
      await frame!.click("#ok");
      await page.waitForFunction(() => location.hash === "#pedir", { timeout: 5_000 });
      expect(page.url()).toBe(`${origin}/#pedir`);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
