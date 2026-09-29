// EL TEMA SIGUE LOS NOMBRES DE LA PÁGINA — con el script REAL del inspector en
// Chromium y el motor REAL del servidor, midiendo en la página GUARDADA.
//
// Hasta el 2026-09-29 los controles de Tema escribían sólo `--ol-*` en
// `<html style>`. Una página que no los lee —la mitad de las que escribe Len,
// con `--bg`, `--ink`, `--paper`, `--radius`— se veía cambiada en el LIENZO
// gracias a un `<style data-ol-force>` que el editor inyectaba y nunca se
// guardaba, y publicada seguía igual (memoria `el-tema-pinta-lo-que-no-guarda`).
//
// Ahora el inspector mira cómo está cableada la página y escribe en la
// variable que de verdad lee, como pide Claude Code en `artifact-design`
// («respect what already exists») y `design-sync` («never import an idiom the
// DS doesn't have»). Aquí se hace cada gesto de verdad, lo que sale por
// `openlen:edit` se aplica con el motor como en el servidor, y se abre la
// página guardada SIN editor para medirla: lienzo = guardada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer";

import { injectElementInspect } from "./use-element-inspect";
import { leerEdicion } from "./leer-edicion";
import { aplicarEdiciones, type Edicion } from "@/lib/page-engine/aplicar-ediciones";

// La familia de 11 de las 66 páginas de Len: nombres del contrato viejo y su
// oscuro en `:root.dark`.
const PROPIOS = `<!doctype html><html lang="es"><head><title>a</title><style>
:root{--bg:#faf7f2;--surface:#ffffff;--fg:#1d1b18;--fg-muted:#5b574f;--border:#e6e0d6;--accent:#b4532a;--accent-r:180,83,42;--radius:14px;--radius-lg:22px;--font-display:Georgia, serif;--font-body:Arial, sans-serif}
:root.dark{--bg:#121110;--surface:#1c1a18;--fg:#f2efe9;--fg-muted:#a8a298;--border:#2c2926}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body)}
h1{font-family:var(--font-display)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:var(--radius);padding:10px}
.glow{box-shadow:0 0 0 4px rgba(var(--accent-r), .3)}
.muted{color:var(--fg-muted)}
</style></head><body><h1>Hola</h1><div class="card"><p class="muted">Texto suave</p><a class="btn glow" href="#">Comprar</a></div></body></html>`;

// La otra familia (22 de 66): `--paper`, `--ink`, `--navy`… y el botón en
// `--navy`, que ningún nombre delata como acento: sólo el cableado.
const PAPEL = `<!doctype html><html lang="es-MX"><head><title>b</title><style>
:root{--paper:#f7f3ea;--ink:#1a2233;--line:#ddd5c4;--navy:#1f3a5f;--gold:#c9a24a;--radius:10px;--display:Georgia, serif;--body:Arial, sans-serif}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body)}
h1,h2{font-family:var(--display);color:var(--navy)}
.card{border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.btn{display:inline-block;background:var(--navy);color:var(--paper);border-radius:var(--radius);padding:10px}
.tag{background:var(--gold)}
</style></head><body><h1>Hola</h1><div class="card"><span class="tag">Nuevo</span><a class="btn" href="#">Reservar</a></div></body></html>`;

// Una página nacida del normalizador: sus nombres ya llevan a `--ol-*`.
const OL = `<!doctype html><html lang="es"><head><title>c</title>
<style data-ol-color>:root{--ol-bg:#ffffff;--ol-fg:#111111;--ol-accent:#2563eb;}</style><style>
:root{--bg:var(--ol-bg);--fg:var(--ol-fg);--accent:var(--ol-accent);--ol-radius:calc(12px * var(--ol-r-scale, 1))}
:root[data-ol-mode="dark"]{--ol-bg:#0b0b0c;--ol-fg:#f5f5f5}
body{margin:0;background:var(--bg);color:var(--fg)}
.card{border-radius:var(--ol-radius);padding:20px}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:var(--ol-radius);padding:10px}
</style></head><body><h1>Hola</h1><div class="card"><a class="btn" href="#">Ir</a></div></body></html>`;

// Colores escritos a mano: el Tema no tiene dónde escribir.
const A_MANO = `<!doctype html><html lang="es"><head><title>d</title><style>
body{margin:0;background:#ffffff;color:#222222}
.btn{display:inline-block;background:#e11d48;color:#fff;border-radius:8px;padding:10px}
</style></head><body><h1>Hola</h1><a class="btn" href="#">Ir</a></body></html>`;

// Un Look del panel (el preset «crisp»), tal como lo manda `applyThemeBundle`.
const LOOK = {
  "--ol-bg": "#eef2ff",
  "--ol-surface": "#f6f7f9",
  "--ol-fg": "#0b0d12",
  "--ol-border": "#c7d2fe",
  "--ol-accent": "#2563eb",
  "--ol-font-display": "'Courier New', monospace",
  "--ol-r-scale": "0.75",
  "--ol-text-scale": "1",
  "--ol-space-scale": "1",
};

let browser: Browser | null = null;
beforeAll(async () => {
  const { default: puppeteer } = await import("puppeteer");
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function abrir(doc: string) {
  const page = await browser!.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  // El oyente va dentro del lienzo, antes que nada: `setContent` no pasa por
  // los scripts de arranque de puppeteer. La guardada se calcula sobre `doc`,
  // que no lo lleva.
  const oyente = `<script>
    window.__ediciones = [];
    window.__meta = null;
    window.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.type === 'openlen:edit') window.__ediciones.push(e.data);
      if (e.data.type === 'openlen:page-meta') window.__meta = e.data.meta;
    });
  </script>`;
  const lienzo = injectElementInspect(doc).replace("<head>", "<head>" + oyente);
  await page.setContent(lienzo, { waitUntil: "load" });
  await espera(150);
  return page;
}

async function mandar(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => window.postMessage({ type: "openlen:apply-prop", ...m }, "*"), msg);
  // `postMessage` se entrega en otra vuelta del bucle de eventos, y la
  // respuesta del inspector en otra más.
  await espera(200);
}

/** Lo que el taller mandó, pasado por su frontera y aplicado como el servidor. */
async function guardado(page: Page, doc: string): Promise<string> {
  const crudas = (await page.evaluate("window.__ediciones")) as unknown[];
  const leidas = crudas.map(leerEdicion);
  expect(leidas.every((e) => e !== null), "una edición no pasó la frontera").toBe(true);
  const r = aplicarEdiciones(doc, leidas as Edicion[]);
  expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
  return r.ok ? r.html : "";
}

interface Medida {
  fondo: string;
  texto: string;
  boton: string;
  radioBoton: string;
  radioTarjeta: string;
  titulo: string;
  suave: string;
  brillo: string;
}

function medir(page: Page): Promise<Medida> {
  return page.evaluate(() => {
    const cs = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    return {
      fondo: cs("body")?.backgroundColor ?? "",
      texto: cs("body")?.color ?? "",
      boton: cs(".btn")?.backgroundColor ?? "",
      radioBoton: cs(".btn")?.borderTopLeftRadius ?? "",
      radioTarjeta: cs(".card")?.borderTopLeftRadius ?? "",
      titulo: cs("h1")?.fontFamily ?? "",
      suave: cs(".muted")?.color ?? "",
      brillo: cs(".glow")?.boxShadow ?? "",
    };
  });
}

/** La página GUARDADA, abierta sin editor: lo que ve quien la visita. */
async function medirGuardada(html: string): Promise<Medida> {
  const page = await browser!.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await medir(page);
  } finally {
    await page.close();
  }
}

describe("el Tema escribe en las variables que la página lee", () => {
  it("nombres propios: el Look cambia la página GUARDADA igual que el lienzo", async () => {
    const page = await abrir(PROPIOS);
    try {
      const antes = await medir(page);
      await mandar(page, { scope: "theme-bundle", tokens: LOOK });
      const lienzo = await medir(page);
      const guardada = await medirGuardada(await guardado(page, PROPIOS));
      expect(guardada).toEqual(lienzo);
      expect(lienzo.fondo).toBe("rgb(238, 242, 255)");
      expect(lienzo.texto).toBe("rgb(11, 13, 18)");
      expect(lienzo.boton).toBe("rgb(37, 99, 235)");
      expect(lienzo.titulo).toContain("Courier New");
      // El triplete de la página sigue al acento: su brillo rgba() también.
      expect(lienzo.brillo).toContain("rgba(37, 99, 235, 0.3)");
      // 14px y 22px por 0,75.
      expect(lienzo.radioBoton).toBe("10.5px");
      expect(lienzo.radioTarjeta).toBe("16.5px");
      expect(antes.fondo).not.toBe(lienzo.fondo);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("nombres propios: el panel sabe qué hay (y que letra y densidad no)", async () => {
    const page = await abrir(PROPIOS);
    try {
      const meta = (await page.evaluate("window.__meta")) as Record<string, unknown>;
      expect(meta.tema).toEqual({ colores: true, fuentes: true, radio: true, letra: false, densidad: false });
      expect(meta.hasDark).toBe(true);
      // «Original» lee lo que la página declara, por sus nombres.
      expect(meta.authored).toMatchObject({ bg: "#faf7f2", fg: "#1d1b18", accent: "#b4532a", displayFont: "Georgia, serif" });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("nombres propios: el oscuro enciende SU :root.dark, y se guarda", async () => {
    const page = await abrir(PROPIOS);
    try {
      await mandar(page, { scope: "theme", prop: "data-ol-mode", value: "dark" });
      const lienzo = await medir(page);
      const html = await guardado(page, PROPIOS);
      const guardada = await medirGuardada(html);
      expect(guardada).toEqual(lienzo);
      expect(lienzo.fondo).toBe("rgb(18, 17, 16)");
      // Los tokens que el Tema no toca también voltean: el oscuro es el de la página.
      expect(lienzo.suave).toBe("rgb(168, 162, 152)");
      expect(html).toMatch(/<html[^>]*class="dark"/);
      const meta = (await page.evaluate("window.__meta")) as Record<string, unknown>;
      expect(meta.mode).toBe("dark");
      // Y se apaga: la clase se va.
      await mandar(page, { scope: "theme", prop: "data-ol-mode", value: "" });
      const html2 = await guardado(page, PROPIOS);
      expect(html2).not.toMatch(/<html[^>]*class=/);
      expect((await medirGuardada(html2)).fondo).toBe("rgb(250, 247, 242)");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("nombres propios: un Look en oscuro (el camino del panel) — lienzo = guardada", async () => {
    const page = await abrir(PROPIOS);
    try {
      // applyLookForMode en oscuro: el paquete claro, la paleta oscura derivada
      // encima, y el modo.
      await mandar(page, {
        scope: "theme-bundle",
        tokens: { ...LOOK, "--ol-bg": "#101322", "--ol-surface": "#191d2e", "--ol-fg": "#e8eaf4", "--ol-border": "#2b3047", "--ol-accent": "#7aa2ff" },
      });
      await mandar(page, { scope: "theme", prop: "data-ol-mode", value: "dark" });
      const lienzo = await medir(page);
      const guardada = await medirGuardada(await guardado(page, PROPIOS));
      expect(guardada).toEqual(lienzo);
      expect(lienzo.fondo).toBe("rgb(16, 19, 34)");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("la tipografía: el par escribe en --font-display y --font-body de la página", async () => {
    const page = await abrir(PROPIOS);
    try {
      await mandar(page, { scope: "fonts", displayCss: "'Courier New', monospace", bodyCss: "Verdana, sans-serif", href: "" });
      const lienzo = await medir(page);
      const html = await guardado(page, PROPIOS);
      expect(await medirGuardada(html)).toEqual(lienzo);
      expect(lienzo.titulo).toContain("Courier New");
      expect(html).toContain("--font-body: Verdana, sans-serif");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("--paper / --ink / --navy: el acento es la variable de los BOTONES", async () => {
    const page = await abrir(PAPEL);
    try {
      const meta = (await page.evaluate("window.__meta")) as Record<string, unknown>;
      expect(meta.tema).toEqual({ colores: true, fuentes: true, radio: true, letra: false, densidad: false });
      expect(meta.hasDark).toBe(false);
      expect((meta.authored as Record<string, unknown>).accent).toBe("#1f3a5f");
      await mandar(page, { scope: "theme-bundle", tokens: LOOK });
      await mandar(page, { scope: "theme", prop: "--ol-r-scale", value: "0" });
      const lienzo = await medir(page);
      const html = await guardado(page, PAPEL);
      expect(await medirGuardada(html)).toEqual(lienzo);
      expect(lienzo.fondo).toBe("rgb(238, 242, 255)");
      expect(lienzo.texto).toBe("rgb(11, 13, 18)");
      expect(lienzo.boton).toBe("rgb(37, 99, 235)");
      expect(lienzo.radioBoton).toBe("0px");
      expect(lienzo.radioTarjeta).toBe("0px");
      // --gold no es el acento ni se toca.
      expect(html).not.toContain("--gold: #2563eb");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("--ol-*: escribe --ol-* y NO pisa --bg, que ya lleva a --ol-bg", async () => {
    const page = await abrir(OL);
    try {
      const meta = (await page.evaluate("window.__meta")) as Record<string, unknown>;
      expect(meta.tema).toMatchObject({ colores: true, radio: true });
      expect(meta.hasDark).toBe(true);
      await mandar(page, { scope: "theme-bundle", tokens: LOOK });
      const lienzo = await medir(page);
      const html = await guardado(page, OL);
      expect(await medirGuardada(html)).toEqual(lienzo);
      expect(lienzo.fondo).toBe("rgb(238, 242, 255)");
      expect(lienzo.radioBoton).toBe("9px");
      // Un --bg inline cortaría la cadena, y el bloque oscuro de --ol-bg ya no
      // llegaría a la página.
      expect(html).not.toMatch(/style="[^"]*--bg:/);
      await mandar(page, { scope: "theme-bundle", tokens: { "--ol-bg": "", "--ol-fg": "" } });
      await mandar(page, { scope: "theme", prop: "data-ol-mode", value: "dark" });
      const oscuro = await medir(page);
      const html2 = await guardado(page, OL);
      expect(await medirGuardada(html2)).toEqual(oscuro);
      expect(oscuro.fondo).toBe("rgb(11, 11, 12)");
    } finally {
      await page.close();
    }
  }, 60_000);

  it("colores a mano: el panel lo dice y el lienzo NO finge un cambio", async () => {
    const page = await abrir(A_MANO);
    try {
      const meta = (await page.evaluate("window.__meta")) as Record<string, unknown>;
      expect(meta.tema).toEqual({ colores: false, fuentes: false, radio: false, letra: false, densidad: false });
      expect(meta.hasDark).toBe(false);
      // Ya no hay CSS forzado en el lienzo.
      expect(await page.evaluate(() => document.querySelector("style[data-ol-force]"))).toBeNull();
      const antes = await medir(page);
      await mandar(page, { scope: "theme-bundle", tokens: LOOK });
      const lienzo = await medir(page);
      expect(lienzo).toEqual(antes);
      expect(await medirGuardada(await guardado(page, A_MANO))).toEqual(lienzo);
    } finally {
      await page.close();
    }
  }, 60_000);
});
