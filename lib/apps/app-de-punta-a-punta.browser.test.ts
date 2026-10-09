// @vitest-environment node
//
// UNA APP WEB DE PUNTA A PUNTA, en un Chromium de verdad (spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, F1: «hecho cuando una app
// de prueba escrita a mano da el mismo resultado en el lienzo, en los ojos de
// Len y publicada»).
//
// La misma app —un POS mínimo: productos de un JSON, un carrito con useState,
// el total en centavos, un componente por el alias @/, TypeScript, CSS
// importado y supabase-js— se abre por los TRES caminos, se pulsa lo mismo, y
// tiene que decir lo mismo y no gritar nada en la consola:
//
//   · el LIENZO: la ruta del sitio del lienzo (`/api/lienzo/site`) en su host
//     `lienzo-<etiqueta>.localhost`, como lo enrutan Caddy y next.config;
//   · los OJOS DE LEN: `renderVisualQualityViewports` con la carpeta de la
//     vista, que es literalmente lo que corre tras cada turno;
//   · la PUBLICADA: `publishToDir` al disco, servida como la sirve Caddy
//     (los .jsx/.tsx/.ts con tipo de JavaScript).
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const entorno = vi.hoisted(() => {
  process.env.AUTH_SECRET ||= "prueba-de-las-apps";
  process.env.OPENLEN_IMAGE_BAKE = "0";
  process.env.OPENLEN_FONT_BAKE = "0";
  process.env.OPENLEN_LOCALIZE = "0";
  const raiz = `${process.env.TMPDIR || "/tmp"}/openlen-apps-e2e-${process.pid}`;
  process.env.PUBLISH_ROOT = raiz;
  return { raiz };
});
const carpeta = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock("@/lib/backend/files", () => ({
  listProjectFiles: async (_projectId: string, prefix = "/") =>
    Object.fromEntries(Object.entries(carpeta.files).filter(([p]) => p.startsWith(prefix))),
}));

import { GET } from "@/app/api/lienzo/site/[[...path]]/route";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { carpetaDeLaVista, documentoDeVista, documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
import { urlDelDocumento } from "@/lib/lienzo/host";
import { resolveRewrites } from "@/lib/lienzo/resolve-rewrites";
import { LIENZO_REWRITES } from "@/lib/lienzo/site-rewrite";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { publishToDir } from "@/lib/publish/filesystem";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const ENTORNO = { VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.openlen.app", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prueba" };

const CASCARON =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>POS</title></head>' +
  '<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';

const FICHEROS: Record<string, string> = {
  "/src/main.jsx": [
    'import { createRoot } from "react-dom/client";',
    // D3: el router por sus DOS nombres a la vez, y los iconos. Si hubiera dos
    // copias de React, sus hooks fallarían aquí («Invalid hook call»).
    'import { HashRouter, Routes, Route } from "react-router-dom";',
    'import App from "./App";',
    'import Ajustes from "./Ajustes";',
    'import "./index.css";',
    'createRoot(document.getElementById("root")).render(<HashRouter><Routes><Route path="/" element={<App />} /><Route path="/ajustes" element={<Ajustes />} /></Routes></HashRouter>);',
  ].join("\n"),
  "/src/Ajustes.jsx": [
    'import { useNavigate } from "react-router";',
    "export default function Ajustes() {",
    "  const ir = useNavigate();",
    '  return <button data-prueba="volver" onClick={() => ir("/")}>Volver</button>;',
    "}",
  ].join("\n"),
  "/src/App.tsx": [
    'import { useState } from "react";',
    'import productos from "./data/productos.json";',
    'import Producto from "@/components/Producto";',
    'import { supabase } from "@/lib/supabase";',
    'import { Link } from "react-router-dom";',
    'import { ShoppingCart } from "lucide-react";',
    "type Linea = { nombre: string; precio: number; cantidad: number };",
    "const dinero = (centavos: number) => `$${(centavos / 100).toFixed(2)}`;",
    "export default function App() {",
    "  const [carrito, setCarrito] = useState<Linea[]>([]);",
    "  const agregar = (p: { nombre: string; precio: number }) =>",
    "    setCarrito((c) => {",
    "      const ya = c.find((l) => l.nombre === p.nombre);",
    "      return ya ? c.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l)) : [...c, { ...p, cantidad: 1 }];",
    "    });",
    "  const total = carrito.reduce((s, l) => s + l.precio * l.cantidad, 0);",
    "  return (",
    "    <main>",
    "      {productos.map((p) => <Producto key={p.id} {...p} onAgregar={() => agregar(p)} />)}",
    '      <ul>{carrito.map((l) => <li key={l.nombre} data-prueba="linea">{l.nombre} × {l.cantidad}</li>)}</ul>',
    '      <p data-prueba="total">{dinero(total)}</p>',
    '      <p data-prueba="supabase">{typeof supabase.from}</p>',
    '      <ShoppingCart data-prueba="icono" />',
    '      <Link to="/ajustes" data-prueba="ir-ajustes">Ajustes</Link>',
    "    </main>",
    "  );",
    "}",
  ].join("\n"),
  "/src/components/Producto.jsx":
    'export default function Producto({ id, nombre, onAgregar }) {\n  return <button data-prueba={"agregar-" + id} onClick={onAgregar}>{nombre}</button>;\n}',
  "/src/lib/supabase.ts":
    'import { createClient } from "@supabase/supabase-js";\n' +
    "export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);",
  "/src/data/productos.json": '[{"id":"cafe","nombre":"Café","precio":3500},{"id":"pan","nombre":"Pan","precio":1200}]',
  "/src/index.css": "body { background: rgb(1, 2, 3); }",
};

/** Lo que se pulsa y lo que se lee, igual en los tres caminos. */
const PROGRAMA = `(async () => {
  const esperar = async (f) => { for (let i = 0; i < 150; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } return null; };
  const boton = (id) => document.querySelector('[data-prueba="agregar-' + id + '"]');
  if (!(await esperar(() => boton("cafe")))) return { error: "la app no se pintó" };
  boton("cafe").click();
  boton("pan").click();
  boton("cafe").click();
  await esperar(() => document.querySelector('[data-prueba="total"]')?.textContent === "$82.00");
  const leido = {
    total: document.querySelector('[data-prueba="total"]')?.textContent,
    lineas: [...document.querySelectorAll('[data-prueba="linea"]')].map((l) => l.textContent),
    supabase: document.querySelector('[data-prueba="supabase"]')?.textContent,
    fondo: getComputedStyle(document.body).backgroundColor,
    icono: document.querySelector('[data-prueba="icono"]')?.tagName.toLowerCase(),
  };
  // Las pantallas, por hash: ir y volver con el router.
  document.querySelector('[data-prueba="ir-ajustes"]').click();
  const volver = await esperar(() => document.querySelector('[data-prueba="volver"]'));
  const pantalla = location.hash;
  volver?.click();
  await esperar(() => document.querySelector('[data-prueba="total"]'));
  return { ...leido, pantalla, deVuelta: location.hash + " " + document.querySelector('[data-prueba="total"]')?.textContent };
})()`;

const ESPERADO = {
  total: "$82.00",
  lineas: ["Café × 2", "Pan × 1"],
  supabase: "function",
  fondo: "rgb(1, 2, 3)",
  icono: "svg",
  pantalla: "#/ajustes",
  deVuelta: "#/ $0.00",
};

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".tsx": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

/** La release viva: `current` es un enlace en la caja, y en un Windows sin
 *  permiso para enlaces `publishToDir` deja en su lugar un fichero con el sha. */
function releaseViva(sub: string): string {
  const current = path.join(entorno.raiz, sub, "current");
  try {
    return path.join(entorno.raiz, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    return current;
  }
}

let servidorLienzo: Server;
let servidorPublicada: Server;
let puertoLienzo = 0;
let puertoPublicada = 0;

beforeAll(async () => {
  // El lienzo: lo que hacen Caddy (`@lienzo`) y las rewrites de next.config.
  servidorLienzo = createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    const destino = resolveRewrites(LIENZO_REWRITES, host, url.pathname).pathname;
    if (!destino.startsWith("/api/lienzo/site")) return void res.writeHead(404).end();
    const ruta = destino.replace(/^\/api\/lienzo\/site/, "").split("/").filter(Boolean);
    const r = await GET(new Request(url, { headers: { host } }), { params: Promise.resolve({ path: ruta }) });
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(await r.text());
  });
  // La publicada: lo que hace Caddy en `*.openlen.app` (try_files sobre la
  // release viva, con el tipo de JavaScript para los fuentes compilados).
  servidorPublicada = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    const sub = (req.headers.host ?? "").split(".")[0]!;
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const fichero = path.join(releaseViva(sub), rel);
    try {
      if (!statSync(fichero).isFile()) throw new Error("no");
      res.writeHead(200, { "content-type": TIPOS[path.extname(fichero)] ?? "application/octet-stream" });
      res.end(readFileSync(fichero));
    } catch {
      res.writeHead(404).end();
    }
  });
  await Promise.all([
    new Promise<void>((ok) => servidorLienzo.listen(0, "127.0.0.1", ok)),
    new Promise<void>((ok) => servidorPublicada.listen(0, "127.0.0.1", ok)),
  ]);
  puertoLienzo = (servidorLienzo.address() as { port: number }).port;
  puertoPublicada = (servidorPublicada.address() as { port: number }).port;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((ok) => servidorLienzo.close(() => ok())),
    new Promise<void>((ok) => servidorPublicada.close(() => ok())),
  ]);
  rmSync(entorno.raiz, { recursive: true, force: true });
});

/** Abre una URL, ejecuta el programa y recoge lo que gritó la página. */
async function abrir(url: string): Promise<{ resultado: unknown; errores: string[] }> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP *.localhost 127.0.0.1"],
  });
  const errores: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errores.push(m.text());
    });
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    const resultado = await page.evaluate(PROGRAMA);
    return { resultado, errores };
  } finally {
    await browser.close();
  }
}

const vista = (): ContextoDeVista => ({
  projectId: ID,
  title: "POS",
  sub: null,
  pagina: null,
  settings: undefined,
  logoUrl: null,
  app: APP,
  entorno: ENTORNO,
  files: FICHEROS,
});

describe("🔴 una app web hace lo mismo en el lienzo, en los ojos de Len y publicada", () => {
  it("el LIENZO (React de desarrollo, compilado al vuelo)", async () => {
    vaciarAlmacenParaPruebas();
    carpeta.files = FICHEROS;
    const html = documentoDeVista(CASCARON, vista());
    const docId = guardarDocumento({ html, projectId: ID, userId: "u1", pagina: null, app: APP, entorno: ENTORNO });
    const url = urlDelDocumento(
      { projectId: ID, docId, pagina: null, hostDeLaPeticion: `localhost:${puertoLienzo}` },
      { ...process.env, NODE_ENV: "development" },
    )!;
    const { resultado, errores } = await abrir(url);
    expect(errores).toEqual([]);
    expect(resultado).toEqual(ESPERADO);
  }, 60_000);

  it("los OJOS DE LEN (renderVisualQualityViewports con la carpeta de la vista)", async () => {
    const v = vista();
    const medida = await renderVisualQualityViewports(documentoMedible(CASCARON, v), {}, {
      behaviorProgram: PROGRAMA,
      carpeta: (await carpetaDeLaVista(v))!,
    });
    expect(medida, "el render no devolvió nada").not.toBeNull();
    expect(medida!.runtimeErrors ?? []).toEqual([]);
    expect(medida!.behaviorResult).toEqual(ESPERADO);
  }, 90_000);

  it("la PUBLICADA (React de producción, compilada al publicar)", async () => {
    await publishToDir({
      subdomain: "pos-de-prueba",
      html: CASCARON,
      files: Object.entries(FICHEROS).map(([p, content]) => ({ path: p, content })),
      app: APP,
      entorno: ENTORNO,
    });
    const { resultado, errores } = await abrir(`http://pos-de-prueba.localhost:${puertoPublicada}/`);
    expect(errores).toEqual([]);
    expect(resultado).toEqual(ESPERADO);
  }, 60_000);

  it("BRAZO DE CONTROL: sin el import map, la misma app no arranca", async () => {
    // Prueba que el programa de arriba DISCRIMINA: si la app no se pinta, no
    // devuelve lo esperado ni calla. Se publica y se le quita el import map.
    await publishToDir({
      subdomain: "pos-sin-mapa",
      html: CASCARON,
      files: Object.entries(FICHEROS).map(([p, content]) => ({ path: p, content })),
      app: APP,
      entorno: ENTORNO,
    });
    const index = path.join(releaseViva("pos-sin-mapa"), "index.html");
    writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="importmap"[\s\S]*?<\/script>/, ""));
    const { resultado, errores } = await abrir(`http://pos-sin-mapa.localhost:${puertoPublicada}/`);
    expect(resultado).toEqual({ error: "la app no se pintó" });
    expect(errores.join("\n")).toMatch(/react/i);
  }, 60_000);
});

