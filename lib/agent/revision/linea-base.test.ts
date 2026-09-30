import { describe, expect, it } from "vitest";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { diffDelTurno } from "./diff-del-turno";
import { comoLoGuarda, ficherosDelTurno, sinIdsDeFormulario, sinLoQueAnadeElHead, type Guardar } from "./linea-base";

// La página de un caso tal como la inserta Len-Bench (o la clona una plantilla):
// sin pasar por el guardado. Comentarios, `<br/>`, un formulario sin id y sin
// ninguna etiqueta social en el `<head>`.
const CRUDA = [
  "<!doctype html>",
  "<html><head><title>FUERO — Estudio jurídico</title></head><body>",
  "<!-- HERO -->",
  "<h1>Abogados de familia</h1>",
  "<p>Desde 1978.<br/>Madrid.</p>",
  '<form><input type="text" placeholder="Tu nombre"></form>',
  "</body></html>",
].join("\n");

/** Un doble del guardado con lo que hace el de verdad fuera de Len: completa el
 *  `<head>`, estampa un id ALEATORIO y, al estampar, re-serializa (se van los
 *  comentarios y `<br/>` pasa a `<br>`). */
let siguienteId = 0;
const guardarDoble: Guardar = async (html) =>
  ensurePageMeta(html)
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/<br\/>/g, "<br>")
    .replace(/<form(?![^>]*data-ol-form-id)/g, () => `<form data-ol-form-id="id${++siguienteId}"`);

/** Sólo las líneas que cambian: el contexto del diff puede llevar cualquier cosa. */
const cambiadas = (diff: string) =>
  diff
    .split("\n")
    .filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l))
    .join("\n");

const TITULAR = ["<h1>Abogados de familia</h1>", "<h1>Abogados de familia y patrimonio</h1>"] as const;
const SOLO_EL_TITULAR = `-${TITULAR[0]}\n+${TITULAR[1]}`;

describe("las dos fotos del diff, por el mismo guardado", () => {
  it("🔴 lo que la plataforma añade al guardar NO sale como obra del turno; lo que cambió Len, sí", async () => {
    // La descripción sale del <h1> (no hay párrafo largo), así que la tarjeta de
    // después NO es la de antes: la misma tanda con otro contenido.
    const despues = await guardarDoble(CRUDA.replace(...TITULAR));
    const diff = diffDelTurno(await ficherosDelTurno([{ ruta: "/index.html", antes: CRUDA, despues }], guardarDoble));
    expect(cambiadas(diff)).toBe(SOLO_EL_TITULAR);
    // Sin la línea base, el mismo turno arrastraba todo eso: la prueba discrimina.
    const crudo = cambiadas(diffDelTurno([{ ruta: "/index.html", antes: CRUDA, despues }]));
    for (const ruido of ["og:image", "HERO", "<br/>", "data-ol-form-id"]) expect(crudo).toContain(ruido);
  });

  it("🔴 una página YA guardada antes: su tarjeta no se reescribe, y cambiar el titular no la saca al diff", async () => {
    // Al cambiar el <h1> ya no se puede demostrar la tanda entera de después;
    // es la misma de antes, byte a byte, y se anula sola.
    const antes = await guardarDoble(CRUDA);
    const despues = await guardarDoble(antes.replace(...TITULAR));
    const diff = diffDelTurno(await ficherosDelTurno([{ ruta: "/index.html", antes, despues }], guardarDoble));
    expect(cambiadas(diff)).toBe(SOLO_EL_TITULAR);
  });

  it("si el turno no cambió nada, no queda diff aunque la plataforma sí lo hiciera", async () => {
    const despues = await guardarDoble(CRUDA);
    expect(diffDelTurno(await ficherosDelTurno([{ ruta: "/index.html", antes: CRUDA, despues }], guardarDoble))).toBe("");
  });

  it("si el guardado de la foto de antes falla, se compara con ella tal cual (ruido, no silencio)", async () => {
    const falla: Guardar = async () => {
      throw new Error("Chrome colgado");
    };
    const [f] = await ficherosDelTurno([{ ruta: "/index.html", antes: CRUDA, despues: CRUDA }], falla);
    expect(f.antes).toBe(CRUDA);
  });

  it("el id de formulario sale de las dos fotos, con cualquier comilla", () => {
    expect(sinIdsDeFormulario(`<form data-ol-form-id="a1" class="x"><form data-ol-form-id='b2'><form data-ol-form-id=c3>`)).toBe(
      `<form class="x"><form><form>`,
    );
  });

  it("🔴 con el guardado DE VERDAD, la foto de antes queda como la deja la plataforma", async () => {
    const guardada = await comoLoGuarda(CRUDA);
    // Lo que añade: la tarjeta social y el id del formulario.
    expect(guardada).toContain('property="og:image"');
    expect(guardada).toMatch(/data-ol-form-id="[^"]+"/);
    // Y guardar lo ya guardado no cambia nada (salvo el id, que es suyo).
    expect(sinIdsDeFormulario(await comoLoGuarda(guardada))).toBe(sinIdsDeFormulario(guardada));
  });

  it("🔴 con el guardado DE VERDAD y un formulario estampado, la tanda se sigue demostrando", async () => {
    // Antes de `186a4d8d`, `stampFormIds` re-serializaba y la tanda salía con
    // ` >`; ahora sale con ` />`. La prueba vale con las dos.
    const guardada = await comoLoGuarda(CRUDA);
    expect(guardada).toMatch(/<meta property="og:image" content="[^"]*" \/?>/);
    const sin = sinLoQueAnadeElHead(guardada);
    expect(sin).not.toContain("og:image");
    expect(sin).toContain("<title>FUERO — Estudio jurídico</title></head>");
  });
});

describe("una página NUEVA: fuera sólo lo que se DEMUESTRA que puso ensurePageMeta", () => {
  // Como las de `una-pagina-por-area`: Len escribió su descripción, sus
  // `og:title`/`og:description` y su favicon; la plataforma añadió la tarjeta.
  const DE_LEN = [
    "<!doctype html>",
    "<html><head>",
    "<title>Herencias y sucesiones — FUERO</title>",
    '<meta name="description" content="Testamentos y particiones." />',
    '<meta property="og:title" content="Herencias y sucesiones — FUERO" />',
    '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />',
    "</head><body><h1>Herencias</h1><p>Testamentos, particiones y legados entre herederos.</p></body></html>",
  ].join("\n");

  it("quita la tanda que añadió el guardado y deja entero lo que escribió Len", async () => {
    const guardada = ensurePageMeta(DE_LEN);
    expect(guardada).toContain("og:image");
    expect(sinLoQueAnadeElHead(guardada)).toBe(DE_LEN);
    const [f] = await ficherosDelTurno([{ ruta: "/herencias/index.html", antes: null, despues: guardada }], guardarDoble);
    expect(f.antes).toBeNull();
    expect(f.despues).toBe(DE_LEN);
  });

  it("🔴 lo que escribió Len aunque sea de la misma clase (su og:image, su twitter:card) se queda", () => {
    const suyo = DE_LEN.replace(
      "</head>",
      '<meta property="og:image" content="https://ejemplo.com/foto.jpg" /><meta name="twitter:card" content="summary" /></head>',
    );
    const guardada = ensurePageMeta(suyo);
    expect(sinLoQueAnadeElHead(guardada)).toBe(suyo);
  });

  it("🔴 lo que no se puede demostrar se queda: la tarjeta hecha con el título que Len cambió después", () => {
    const guardada = ensurePageMeta(DE_LEN).replace("<title>Herencias y sucesiones — FUERO</title>", "<title>Sucesiones</title>");
    const tarjeta = /<meta property="og:image"[^>]*>/.exec(guardada)![0];
    expect(sinLoQueAnadeElHead(guardada)).toContain(tarjeta);
    expect(sinLoQueAnadeElHead(guardada)).toContain("<title>Sucesiones</title>");
  });

  it("sin `<head>` no hay nada que quitar", () => {
    expect(sinLoQueAnadeElHead("<h1>Menú</h1>")).toBe("<h1>Menú</h1>");
  });
});
