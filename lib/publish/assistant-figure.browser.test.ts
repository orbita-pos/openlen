// @vitest-environment node
//
// HER FIGURE IN THE PUBLISHED BUBBLE, IN A REAL BROWSER (spec local 2026-11-10-figuras-del-asistente, §5.7): the page
// loads with her flat figure and asks for nothing; opening the bubble asks for the engine once, and the figure comes
// alive in the header; the switch, a missing file and reduced motion leave the flat one. WebGL only exists here.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { FIGURE_ENGINE } from "@/lib/figure/engine/published";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";

import { FIGURE_ENGINE_PATH, bakeAssistantPersona } from "./assistant-widget";

const PAGE = `<!doctype html><html lang="es"><body><h1>Pastelería Canela</h1></body></html>`;
const LOOK = { v: 1, shape: "heart", color: "#19c3b1", eyes: "round", eyewear: "none", accessory: "crown" } as const;

let server: Server;
let origin: string;
let releaseEgress: () => void;
/** What the server does for the next page. */
let figuras: boolean | undefined = true;
let engineThere = true;
let engineAsked = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/assistant/")) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.method === "POST" ? { respuesta: "Hola", intent: "answer" } : { asistente: true, chat: false, traspaso: false, ...(figuras === undefined ? {} : { figuras }) }));
      return;
    }
    if (req.url === `/${FIGURE_ENGINE_PATH}`) {
      engineAsked++;
      if (!engineThere) return void res.writeHead(404).end("not here");
      res.setHeader("content-type", "text/javascript; charset=utf-8");
      return void res.end(FIGURE_ENGINE.code);
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(bakeAssistantPersona(PAGE, { sub: "canela", apiBase: origin, businessName: "Pastelería Canela", persona: { name: "Lucía", look: LOOK } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hostPort = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  origin = `http://${hostPort}`;
  releaseEgress = allowEgressOrigin(hostPort);
});
afterAll(() => {
  releaseEgress?.();
  server?.close();
});

const header = () => {
  const slot = document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector(".hd .ava")!;
  const canvas = slot.querySelector("canvas");
  return {
    flat: slot.querySelector('svg [data-part="body"]') !== null,
    flatShown: (slot.querySelector("svg") as SVGElement | null)?.style.visibility !== "hidden",
    canvases: slot.querySelectorAll("canvas").length,
    canvasShown: canvas !== null && canvas.style.visibility === "visible",
  };
};
const press = (page: Page) => page.evaluate(() => (document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector(".btn") as HTMLButtonElement).click());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(o: { figuras?: boolean | undefined; engineThere?: boolean; reducedMotion?: boolean }, run: (page: Page, errors: string[]) => Promise<void>): Promise<void> {
  figuras = "figuras" in o ? o.figuras : true;
  engineThere = o.engineThere ?? true;
  engineAsked = 0;
  const browser = await lanzarChromium();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    if (o.reducedMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${origin}/`, { waitUntil: "networkidle0", timeout: 20_000 });
    await run(page, errors);
  } finally {
    await browser.close();
  }
}

describe("her figure in the published bubble", () => {
  it("🔴 the page loads with her flat figure and asks for no engine; opening the bubble asks once and she comes alive", async () => {
    await open({}, async (page, errors) => {
      expect(await page.evaluate(header)).toMatchObject({ flat: true, flatShown: true, canvases: 0 });
      expect(engineAsked).toBe(0);
      await press(page);
      await page.waitForFunction(() => document.querySelector("body > div[aria-live]")!.shadowRoot!.querySelector<HTMLCanvasElement>(".hd .ava canvas")?.style.visibility === "visible", { timeout: 30_000 });
      expect(await page.evaluate(header)).toMatchObject({ flatShown: false, canvases: 1, canvasShown: true });
      // Closed and opened again, and again: still one request, one canvas.
      await press(page);
      await press(page);
      await press(page);
      await press(page);
      await wait(300);
      expect(engineAsked).toBe(1);
      expect((await page.evaluate(header)).canvases).toBe(1);
      expect(errors).toEqual([]);
    });
  }, 90_000);

  it("🔴 with the figures switched off after the page was published, the bubble asks for no engine", async () => {
    await open({ figuras: false }, async (page, errors) => {
      await press(page);
      await wait(600);
      expect(engineAsked).toBe(0);
      expect(await page.evaluate(header)).toMatchObject({ flat: true, flatShown: true, canvases: 0 });
      expect(errors).toEqual([]);
    });
  }, 60_000);

  it("a status answer that says nothing about figures is not a yes", async () => {
    await open({ figuras: undefined }, async (page) => {
      await press(page);
      await wait(600);
      expect(engineAsked).toBe(0);
    });
  }, 60_000);

  it("🔴 an engine that does not arrive leaves her flat figure, and the page throws nothing", async () => {
    await open({ engineThere: false }, async (page, errors) => {
      await press(page);
      await wait(1000);
      expect(engineAsked).toBe(1);
      expect(await page.evaluate(header)).toMatchObject({ flat: true, flatShown: true, canvases: 0 });
      expect(errors).toEqual([]);
    });
  }, 60_000);

  it("a visitor who asked for reduced motion keeps the flat figure, with no engine", async () => {
    await open({ reducedMotion: true }, async (page) => {
      await press(page);
      await wait(600);
      expect(engineAsked).toBe(0);
      expect((await page.evaluate(header)).flatShown).toBe(true);
    });
  }, 60_000);
});
