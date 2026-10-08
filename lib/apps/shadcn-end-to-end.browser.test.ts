// @vitest-environment node
//
// UNA APP SHADCN DE PUNTA A PUNTA, en un Chromium de verdad (plan
// plans/app-catalog-and-bundler/01-catalog-2026-11.md, tarea 7).
//
// La app que el modelo ha visto millones de veces: un Button con cva + cn
// (clsx + tailwind-merge) y Slot de Radix, un Dialog de Radix, un formulario de
// react-hook-form validado con zod, una gráfica de recharts, una fecha de
// date-fns en español, y un index.css con `@layer base` y `@apply` sobre el
// theme del tailwind.config del cascarón (Tailwind 3, como la plantilla de
// Lovable). Se abre por los TRES caminos —lienzo, ojos de Len y publicada—, se
// pulsa lo mismo, y tiene que decir lo mismo y no gritar nada en la consola.
//
// ⚠️ Necesita red a cdn.tailwindcss.com. En pruebas `NODE_ENV` no es
// `production` y la publicada NO se hornea: usa el CDN, como el lienzo. El
// horneado de las hojas lo cubren lib/publish/optimize-html.test.ts y
// app-publish.test.ts (tarea 2).
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const entorno = vi.hoisted(() => {
  process.env.AUTH_SECRET ||= "prueba-de-las-apps";
  process.env.OPENLEN_IMAGE_BAKE = "0";
  process.env.OPENLEN_FONT_BAKE = "0";
  process.env.OPENLEN_LOCALIZE = "0";
  const raiz = `${process.env.TMPDIR || "/tmp"}/openlen-shadcn-e2e-${process.pid}`;
  process.env.PUBLISH_ROOT = raiz;
  return { raiz };
});
const carpeta = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock("@/lib/backend/files", () => ({
  listProjectFiles: async (_projectId: string, prefix = "/") =>
    Object.fromEntries(Object.entries(carpeta.files).filter(([p]) => p.startsWith(prefix))),
}));

import { GET } from "@/app/api/lienzo/site/[[...path]]/route";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { carpetaDeLaVista, documentoDeVista, documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
import { urlDelDocumento } from "@/lib/lienzo/host";
import { resolveRewrites } from "@/lib/lienzo/resolve-rewrites";
import { LIENZO_REWRITES } from "@/lib/lienzo/site-rewrite";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { publishToDir } from "@/lib/publish/filesystem";

const ID = "8d2b6c1e-3f4a-4b7c-9e2d-5a6b7c8d9e0f";
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" };
const ENTORNO = { VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.openlen.app", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prueba" };

const CASCARON =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Panel</title>' +
  '<script src="https://cdn.tailwindcss.com"></script>' +
  '<script>tailwind.config = { darkMode: ["class"], theme: { extend: { colors: { background: "hsl(var(--background))", primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" } }, borderRadius: { lg: "var(--radius)" } } } }</script>' +
  '</head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';

const FICHEROS: Record<string, string> = {
  "/src/main.jsx": [
    'import { createRoot } from "react-dom/client";',
    'import App from "./App";',
    'import "./index.css";',
    'createRoot(document.getElementById("root")).render(<App />);',
  ].join("\n"),
  "/src/index.css": [
    "@tailwind base;",
    "@tailwind components;",
    "@tailwind utilities;",
    "@layer base {",
    "  :root { --background: 0 100% 50%; --primary: 240 100% 50%; --primary-foreground: 0 0% 100%; --radius: 12px; }",
    "  body { @apply bg-background; }",
    "}",
  ].join("\n"),
  "/src/lib/utils.ts": [
    'import { clsx, type ClassValue } from "clsx";',
    'import { twMerge } from "tailwind-merge";',
    "export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }",
  ].join("\n"),
  "/src/components/ui/button.tsx": [
    'import * as React from "react";',
    'import { Slot } from "@radix-ui/react-slot";',
    'import { cva, type VariantProps } from "class-variance-authority";',
    'import { cn } from "@/lib/utils";',
    'const buttonVariants = cva("inline-flex rounded-lg px-2", { variants: { variant: { default: "bg-primary text-primary-foreground" } }, defaultVariants: { variant: "default" } });',
    "type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };",
    "export const Button = React.forwardRef<HTMLButtonElement, Props>(({ className, variant, asChild = false, ...props }, ref) => {",
    '  const Comp = asChild ? Slot : "button";',
    "  return <Comp ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />;",
    "});",
  ].join("\n"),
  "/src/App.tsx": [
    'import * as DialogPrimitive from "@radix-ui/react-dialog";',
    'import { useForm } from "react-hook-form";',
    'import { zodResolver } from "@hookform/resolvers/zod";',
    'import { z } from "zod";',
    'import { BarChart, Bar } from "recharts";',
    'import { format } from "date-fns";',
    'import { es } from "date-fns/locale";',
    'import { useState } from "react";',
    'import { Button } from "@/components/ui/button";',
    'const esquema = z.object({ nombre: z.string().min(2, "Mínimo 2 letras") });',
    "export default function App() {",
    '  const [hola, setHola] = useState("");',
    "  const { register, handleSubmit, formState: { errors } } = useForm<{ nombre: string }>({ resolver: zodResolver(esquema) });",
    "  return (",
    "    <main>",
    '      <Button data-prueba="boton" className="px-4">Guardar</Button>',
    "      <DialogPrimitive.Root>",
    '        <DialogPrimitive.Trigger data-prueba="abrir">Abrir</DialogPrimitive.Trigger>',
    "        <DialogPrimitive.Portal><DialogPrimitive.Content>",
    "          <DialogPrimitive.Title>Detalle</DialogPrimitive.Title>",
    "          <DialogPrimitive.Description>Del pedido</DialogPrimitive.Description>",
    '          <DialogPrimitive.Close data-prueba="cerrar">Cerrar</DialogPrimitive.Close>',
    "        </DialogPrimitive.Content></DialogPrimitive.Portal>",
    "      </DialogPrimitive.Root>",
    '      <form onSubmit={handleSubmit((v) => setHola("Hola, " + v.nombre))}>',
    '        <input data-prueba="nombre" {...register("nombre")} />',
    '        <p data-prueba="error">{errors.nombre?.message ?? ""}</p>',
    '        <button data-prueba="enviar" type="submit">Enviar</button>',
    "      </form>",
    '      <p data-prueba="hola">{hola}</p>',
    '      <BarChart width={300} height={150} data={[{ v: 1 }, { v: 2 }, { v: 3 }]}><Bar dataKey="v" isAnimationActive={false} /></BarChart>',
    '      <p data-prueba="fecha">{format(new Date(2026, 0, 5), "EEEE d \'de\' MMMM", { locale: es })}</p>',
    "    </main>",
    "  );",
    "}",
  ].join("\n"),
};

/** Lo que se pulsa y lo que se lee, igual en los tres caminos. */
const PROGRAMA = `(async () => {
  const esperar = async (f) => { for (let i = 0; i < 200; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return null; };
  const $ = (id) => document.querySelector('[data-prueba="' + id + '"]');
  if (!(await esperar(() => $("boton")))) return { error: "la app no se pintó" };
  // El CDN procesa la hoja inyectada al vuelo: esperar a que el fondo cambie.
  await esperar(() => getComputedStyle(document.body).backgroundColor === "rgb(255, 0, 0)");
  const boton = getComputedStyle($("boton"));
  const leido = { fondo: getComputedStyle(document.body).backgroundColor, botonFondo: boton.backgroundColor, botonPadding: boton.paddingLeft, botonRadio: boton.borderTopLeftRadius };
  $("abrir").click();
  const titulo = (await esperar(() => document.querySelector('[role="dialog"]')))?.textContent ?? null;
  $("cerrar").click();
  const cerrado = !!(await esperar(() => !document.querySelector('[role="dialog"]')));
  $("enviar").click();
  const error = (await esperar(() => $("error").textContent)) ?? null;
  const fijar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  fijar.call($("nombre"), "Ana");
  $("nombre").dispatchEvent(new Event("input", { bubbles: true }));
  $("enviar").click();
  const hola = await esperar(() => $("hola").textContent);
  return { ...leido, titulo, cerrado, error, hola, barras: document.querySelectorAll(".recharts-bar-rectangle").length, fecha: $("fecha").textContent };
})()`;

const ESPERADO = {
  fondo: "rgb(255, 0, 0)",
  botonFondo: "rgb(0, 0, 255)",
  botonPadding: "16px",
  botonRadio: "12px",
  titulo: "DetalleDel pedidoCerrar",
  cerrado: true,
  error: "Mínimo 2 letras",
  hola: "Hola, Ana",
  barras: 3,
  fecha: "lunes 5 de enero",
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
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    const resultado = await page.evaluate(PROGRAMA);
    return { resultado, errores };
  } finally {
    await browser.close();
  }
}

const vista = (): ContextoDeVista => ({
  projectId: ID,
  title: "Panel",
  sub: null,
  pagina: null,
  settings: undefined,
  logoUrl: null,
  app: APP,
  entorno: ENTORNO,
  files: FICHEROS,
});

describe("🔴 una app shadcn hace lo mismo en el lienzo, en los ojos de Len y publicada", () => {
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
  }, 90_000);

  it("los OJOS DE LEN (renderVisualQualityViewports con la carpeta de la vista)", async () => {
    const v = vista();
    const medida = await renderVisualQualityViewports(documentoMedible(CASCARON, v), {}, {
      behaviorProgram: PROGRAMA,
      carpeta: carpetaDeLaVista(v)!,
    });
    expect(medida, "el render no devolvió nada").not.toBeNull();
    expect(medida!.runtimeErrors ?? []).toEqual([]);
    expect(medida!.behaviorResult).toEqual(ESPERADO);
  }, 120_000);

  it("la PUBLICADA (React de producción, compilada al publicar)", async () => {
    await publishToDir({
      subdomain: "panel-shadcn",
      html: CASCARON,
      files: Object.entries(FICHEROS).map(([p, content]) => ({ path: p, content })),
      app: APP,
      entorno: ENTORNO,
    });
    const { resultado, errores } = await abrir(`http://panel-shadcn.localhost:${puertoPublicada}/`);
    expect(errores).toEqual([]);
    expect(resultado).toEqual(ESPERADO);
  }, 90_000);

  it("BRAZO DE CONTROL: sin el procesado de Tailwind, el fondo del @apply no está", async () => {
    // Prueba que lo que pinta el fondo es el `<style type="text/tailwindcss">`
    // procesado (tarea 1), no otra cosa: con `text/css` el navegador tira el
    // `@apply` y el fondo se queda sin pintar.
    await publishToDir({
      subdomain: "panel-sin-tailwind",
      html: CASCARON,
      files: Object.entries(FICHEROS).map(([p, content]) => ({ path: p, content })),
      app: APP,
      entorno: ENTORNO,
    });
    const main = path.join(releaseViva("panel-sin-tailwind"), "src", "main.jsx");
    const compilado = readFileSync(main, "utf8");
    expect(compilado).toContain('s.type="text/tailwindcss"');
    writeFileSync(main, compilado.replace('s.type="text/tailwindcss"', 's.type="text/css"'));
    const { resultado } = await abrir(`http://panel-sin-tailwind.localhost:${puertoPublicada}/`);
    expect((resultado as { fondo?: string }).fondo).not.toBe("rgb(255, 0, 0)");
  }, 90_000);
});
