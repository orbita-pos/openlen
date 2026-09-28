// lib/len-bench/servidor-publicada.test.ts
// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subDeLaPagina } from "@/lib/publish/request-origin";
import { PREFIJOS_A_NEXT, servirPublicada } from "./servidor-publicada";

let raiz = "";
let next: http.Server;
let nextUrl = "";
const hostsVistos: string[] = [];
const origenesVistos: (string | undefined)[] = [];

beforeAll(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "lb-pub-"));
  const rel = path.join(raiz, "demo", "current");
  fs.mkdirSync(path.join(rel, "menu"), { recursive: true });
  fs.mkdirSync(path.join(raiz, "demo", "assets"), { recursive: true });
  fs.writeFileSync(path.join(rel, "index.html"), "<h1>HOME</h1>");
  fs.writeFileSync(path.join(rel, "menu", "index.html"), "<h1>MENU</h1>");
  fs.writeFileSync(path.join(raiz, "demo", "assets", "a.css"), "body{}");
  // Lo que deja publishToDir en Windows sin modo desarrollador: `current` no
  // es un enlace sino un FICHERO con el sha de la release.
  fs.mkdirSync(path.join(raiz, "win", "releases", "abc123"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "win", "releases", "abc123", "index.html"), "<h1>RELEASE</h1>");
  fs.writeFileSync(path.join(raiz, "win", "current"), "abc123", "utf8");
  next = http.createServer((req, res) => {
    hostsVistos.push(String(req.headers.host));
    origenesVistos.push(req.headers.origin);
    res.end(`NEXT ${req.method} ${req.url}`);
  });
  await new Promise<void>((r) => next.listen(0, "127.0.0.1", r));
  const a = next.address() as { port: number };
  nextUrl = `http://127.0.0.1:${a.port}`;
});
afterAll(() => new Promise<void>((r) => next.close(() => r())));

describe("servirPublicada", () => {
  it("sirve la home, las rutas limpias y los assets, como Caddy", async () => {
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    try {
      expect(await (await fetch(`${s.url}/`)).text()).toBe("<h1>HOME</h1>");
      expect(await (await fetch(`${s.url}/menu/`)).text()).toBe("<h1>MENU</h1>");
      expect(await (await fetch(`${s.url}/menu`)).text()).toBe("<h1>MENU</h1>");
      expect(await (await fetch(`${s.url}/assets/a.css`)).text()).toBe("body{}");
    } finally {
      await s.cerrar();
    }
  });
  it("un enlace roto devuelve la HOME, porque eso hace try_files en producción", async () => {
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    try {
      expect(await (await fetch(`${s.url}/no-existe/`)).text()).toBe("<h1>HOME</h1>");
    } finally {
      await s.cerrar();
    }
  });
  it("manda /api/f/ a Next con el Host de la publicada", async () => {
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    try {
      const r = await fetch(`${s.url}/api/f/demo`, { method: "POST", body: "x=1" });
      expect(await r.text()).toBe("NEXT POST /api/f/demo");
      expect(hostsVistos.at(-1)).toBe("demo.openlen.app");
    } finally {
      await s.cerrar();
    }
  });
  // 🔴 Control del 26/09 (carrito #1, punto-de-venta #3): la página de Len
  // guardaba en un almacén, Chromium mandaba `Origin: http://127.0.0.1:<p>`,
  // `subDeLaPagina` daba null y `/api/d/` contestaba 404. En producción el
  // Origin es el host de la publicada.
  it("🔴 el Origin de la propia publicada llega a Next como el de su host, y la ruta sabe de qué página viene", async () => {
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    try {
      await fetch(`${s.url}/api/d/demo/carrito`, { method: "POST", headers: { origin: s.url }, body: "{}" });
      expect(origenesVistos.at(-1)).toBe("https://demo.openlen.app");
      const headers = new Headers({ origin: String(origenesVistos.at(-1)), host: "demo.openlen.app" });
      expect(await subDeLaPagina({ headers, baseHost: "openlen.app", resolveCustomDomain: async () => null })).toBe("demo");
    } finally {
      await s.cerrar();
    }
  });
  // BRAZO DE CONTROL: un Origin AJENO pasa tal cual, para que el relé entre
  // proyectos (`request-origin.ts`) se siga viendo en el banco.
  it("un Origin de otra página pasa tal cual", async () => {
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    try {
      await fetch(`${s.url}/api/d/demo/carrito`, { method: "POST", headers: { origin: "https://otra.openlen.app" }, body: "{}" });
      expect(origenesVistos.at(-1)).toBe("https://otra.openlen.app");
    } finally {
      await s.cerrar();
    }
  });
  it("los prefijos son los `handle` del bloque *.openlen.app del Caddyfile, ni uno más ni uno menos", () => {
    // El Caddyfile es lo que corre en producción: la fuente, no otra copia. Si
    // gana un `handle`, la publicada de Len-Bench lo mandaría a try_files y el
    // grader vería la HOME donde producción responde Next.
    const caddy = fs.readFileSync(path.join(process.cwd(), "infra", "caddy", "Caddyfile"), "utf8");
    const inicio = caddy.indexOf("\n*.openlen.app {");
    expect(inicio, "no encuentro el bloque *.openlen.app").toBeGreaterThan(-1);
    const bloque = caddy.slice(inicio, caddy.indexOf("\n}", inicio));
    const handles = [...bloque.matchAll(/^\s*handle(?:_path)?\s+(\/\S+?)\*/gm)].map((m) => m[1]);
    expect(handles.length).toBeGreaterThan(5);
    expect(new Set(handles)).toEqual(new Set([...PREFIJOS_A_NEXT, "/assets/"]));
  });
  it("cerrar no espera a las conexiones que el navegador deja abiertas", async () => {
    // Medido en graders.browser.test.ts: tras enviar un formulario, Chromium
    // deja su conexión viva y `server.close()` a secas esperaba para siempre.
    // En el conductor sería una corrida colgada después de calificar.
    const s = await servirPublicada({ raiz, sub: "demo", next: nextUrl, hostPublicado: "demo.openlen.app" });
    const { port } = new URL(s.url);
    const sock = net.connect(Number(port), "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));
    sock.write("GET / HTTP/1.1\r\nHost: demo\r\n"); // petición a medias: la conexión NO está ociosa
    const r = await Promise.race([
      s.cerrar().then(() => "cerrado"),
      new Promise((res) => setTimeout(() => res("colgado"), 2_000)),
    ]);
    sock.destroy();
    expect(r).toBe("cerrado");
  });
  it("si `current` es el fichero con el sha que deja Windows, sirve esa release", async () => {
    const s = await servirPublicada({ raiz, sub: "win", next: nextUrl, hostPublicado: "win.openlen.app" });
    try {
      expect(await (await fetch(`${s.url}/`)).text()).toBe("<h1>RELEASE</h1>");
    } finally {
      await s.cerrar();
    }
  });
});
