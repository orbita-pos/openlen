// @vitest-environment node
// EL MODO DISEÑO EN EL LIENZO, con la app de verdad en Chromium. La página de
// prueba ES el lienzo (window.parent === window), así que los mensajes que el
// script manda al taller se recogen en la propia página.
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { entradaServida } from "@/lib/apps/servir";
import { injectDesignMode } from "./inject-design-mode";

afterAll(() => stopBundlerWorker());

const ESQ = esqueletoDeApp({ titulo: "Caja" });
const APP = ESQ.app;
// Una pantalla con un enlace, un botón que vuelve a montar el título con otra
// `key` (nodo NUEVO) y una segunda pantalla.
const APP_TSX = [
  'import { useState } from "react";', // 1
  'import { Routes, Route, Link } from "react-router-dom";', // 2
  "function Inicio() {", // 3
  "  const [n, setN] = useState(0);", // 4
  "  return (", // 5
  "    <main>", // 6
  '      <h1 key={n} id="titulo">Hola</h1>', // 7
  '      <Link id="ir" to="/otra">Otra</Link>', // 8
  '      <button id="mas" onClick={() => setN(n + 1)}>Más</button><p id="mix">Clicks {n}</p>', // 9
  "    </main>", // 10
  "  );", // 11
  "}", // 12
  'function Otra() { return <h1 id="otra">Otra</h1>; }', // 13
  'export default function App() { return <Routes><Route path="/" element={<Inicio />} /><Route path="/otra" element={<Otra />} /></Routes>; }', // 14
].join("\n");
const CARPETA = { ...ESQ.ficheros, "/src/App.tsx": APP_TSX };

async function abrir(carpeta: Record<string, string> = CARPETA, esperar: string | null = "#titulo") {
  const shell = injectDesignMode(ESQ.html);
  const entrada = entradaServida(APP.entrada, await bundleApp({ carpeta, app: APP, modo: "desarrollo" }), carpeta);
  const srv = createServer((req, res) => {
    const js = req.url === APP.entrada;
    res.writeHead(js || req.url === "/" ? 200 : 404, { "content-type": js ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    res.end(js ? entrada : req.url === "/" ? shell : "");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const dir = srv.address();
  if (dir === null || typeof dir === "string") throw new Error("sin puerto");
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __msgs: unknown[] };
    w.__msgs = [];
    window.addEventListener("message", (e) => w.__msgs.push(e.data));
  });
  await page.goto(`http://127.0.0.1:${dir.port}/#/`, { waitUntil: "load", timeout: 20_000 });
  if (esperar) await page.waitForSelector(esperar, { timeout: 20_000 });
  else await new Promise((r) => setTimeout(r, 500));
  const enviar = (msg: unknown) => page.evaluate((m) => window.postMessage(m, "*"), msg as never);
  const recibidos = (tipo: string) =>
    page.evaluate((t) => (window as unknown as { __msgs: { type?: string }[] }).__msgs.filter((m) => m && m.type === t), tipo);
  return { page, enviar, recibidos, cerrar: async () => { await browser.close(); srv.close(); } };
}

describe("el modo Diseño en el lienzo de una app", () => {
  it("🔴 elegir un elemento manda su cadena, su pantalla y sus estilos", async () => {
    const v = await abrir();
    try {
      await v.enviar({ type: "openlen:set-mode", designMode: true });
      await v.page.click("#titulo");
      await new Promise((r) => setTimeout(r, 200));
      const [m] = (await v.recibidos("openlen:design-selected")) as { selection: { key: string; chain: { path: string; line: number }[]; screen: string; styles: Record<string, string>; textEditable: boolean } }[];
      expect(m, "no llegó la selección").toBeTruthy();
      expect(m!.selection.chain[0]).toMatchObject({ path: "/src/App.tsx", line: 7 });
      expect(m!.selection.screen).toBe("#/");
      expect(m!.selection.styles["font-size"]).toMatch(/px$/);
      expect(m!.selection.textEditable).toBe(true);
      expect(Array.isArray((m!.selection as unknown as { fonts: unknown }).fonts)).toBe(true);
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("el clic no llega a la app: un <Link> no navega mientras se elige", async () => {
    const v = await abrir();
    try {
      await v.enviar({ type: "openlen:set-mode", designMode: true });
      await v.page.click("#ir");
      await new Promise((r) => setTimeout(r, 300));
      expect(await v.page.evaluate(() => location.hash)).toBe("#/");
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("🔴 la vista previa se aplica, sobrevive a un nodo NUEVO de React y se restaura", async () => {
    const v = await abrir();
    try {
      const preview = { type: "openlen:design-preview", key: "k", screen: "#/", target: { path: "/src/App.tsx", line: 7, tag: "h1" }, styles: { color: "rgb(255, 0, 0)" }, text: "Adiós" };
      await v.enviar(preview);
      await new Promise((r) => setTimeout(r, 100));
      const color = () => v.page.evaluate(() => getComputedStyle(document.getElementById("titulo")!).color);
      expect(await color()).toBe("rgb(255, 0, 0)");
      expect(await v.page.evaluate(() => document.getElementById("titulo")!.textContent)).toBe("Adiós");
      await v.page.click("#mas"); // sin modo Diseño, el botón funciona: monta otro <h1>
      await new Promise((r) => setTimeout(r, 300));
      expect(await color(), "el nodo nuevo perdió la vista previa").toBe("rgb(255, 0, 0)");
      await v.enviar({ type: "openlen:design-clear", key: "k" });
      await new Promise((r) => setTimeout(r, 100));
      expect(await color()).not.toBe("rgb(255, 0, 0)");
      expect(await v.page.evaluate(() => document.getElementById("titulo")!.textContent)).toBe("Hola");
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("🔴 la vista previa de un texto con varios nodos no le quita a React sus nodos: al restaurar sigue actualizándose", async () => {
    const v = await abrir();
    try {
      const texto = () => v.page.evaluate(() => document.getElementById("mix")!.textContent);
      expect(await texto()).toBe("Clicks 0");
      await v.enviar({ type: "openlen:design-preview", key: "t", screen: "#/", target: { path: "/src/App.tsx", line: 9, tag: "p" }, styles: {}, text: "Otro texto" });
      await new Promise((r) => setTimeout(r, 100));
      expect(await texto()).toBe("Otro texto");
      await v.page.click("#mas"); // React cambia {n} mientras dura la vista previa
      await new Promise((r) => setTimeout(r, 200));
      expect(await texto(), "la vista previa se perdió con el repintado").toBe("Otro texto");
      await v.enviar({ type: "openlen:design-clear", key: "t" });
      await new Promise((r) => setTimeout(r, 100));
      expect(await texto(), "al restaurar volvió un valor viejo").toBe("Clicks 1");
      await v.page.click("#mas");
      await new Promise((r) => setTimeout(r, 200));
      expect(await texto(), "React ya no actualiza el texto: sus nodos se quedaron fuera").toBe("Clicks 2");
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("la vista previa es de su pantalla: en otra no se pinta", async () => {
    const v = await abrir();
    try {
      await v.enviar({ type: "openlen:design-preview", key: "k2", screen: "#/", target: { path: "/src/App.tsx", line: 13, tag: "h1" }, styles: { color: "rgb(0, 128, 0)" } });
      await v.page.evaluate(() => { location.hash = "#/otra"; });
      await v.page.waitForSelector("#otra");
      await new Promise((r) => setTimeout(r, 200));
      expect(await v.page.evaluate(() => getComputedStyle(document.getElementById("otra")!).color)).not.toBe("rgb(0, 128, 0)");
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("🔴 con la app rota (capa de error), encenderlo lo apaga solo y lo dice", async () => {
    const v = await abrir({ ...CARPETA, "/src/App.tsx": "export default function App() { return <div>; }\n" }, null);
    try {
      expect(await v.page.evaluate(() => !!document.querySelector("openlen-error-overlay"))).toBe(true);
      await v.enviar({ type: "openlen:set-mode", designMode: true });
      await new Promise((r) => setTimeout(r, 100));
      expect(await v.recibidos("openlen:design-exit")).toEqual([{ type: "openlen:design-exit", reason: "broken" }]);
      expect(await v.page.evaluate(() => document.body.hasAttribute("data-openlen-design-mode"))).toBe(false);
    } finally {
      await v.cerrar();
    }
  }, 90_000);

  it("Esc pide salir del modo", async () => {
    const v = await abrir();
    try {
      await v.enviar({ type: "openlen:set-mode", designMode: true });
      await v.page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 100));
      expect((await v.recibidos("openlen:design-exit")).length).toBe(1);
    } finally {
      await v.cerrar();
    }
  }, 90_000);
});
