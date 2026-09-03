// EL PASEO POR HERMANOS TAMBIÉN TIENE QUE SABER RENDIRSE.
//
// 🔴 MEDIDO el 2026-09-02 en la portada de una inmobiliaria: titular BLANCO
// sobre una foto oscurecida por un velo hermano. El paseo por hermanos sólo
// lee `backgroundColor` —transparente tanto en el <img> como en el div del
// degradado— así que saltaba los dos y caía al blanco por defecto del <body>.
// Resultado: «#ffffff sobre #ffffff a 1.00:1», un hallazgo INVENTADO que costó
// 17 ediciones, 8 búsquedas de foto, y dejó la portada peor que la de partida:
// media pantalla en sólido tapando la foto que el usuario había pedido.
//
// El paseo por ANCESTROS ya trata las dos cosas bien (foto ⇒ incierto,
// degradado ⇒ velo compuesto). Esto sujeta que el de hermanos haga lo mismo.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

// Un PNG 1×1 como data: URI — carga sin red y sin fichero, así que la prueba no
// depende de que el catálogo de imágenes esté vivo. (Y el sandbox de este repo
// no tiene salida HTTP: una URL remota renderiza como imagen rota y mediríamos
// un destrozo inventado nuestro.)
//
// ⚠️ EL FIXTURE VIEJO ERA `rgba(0,255,0,0.5)` — verde TRANSLÚCIDO. Compuesto
// sobre el <body> blanco daba `#80ff80`, y el titular BLANCO encima estaba a
// 1,27:1: invisible de verdad. El caso de abajo pasaba porque el medidor se
// rendía ante cualquier foto, no porque el texto se leyera. Midiendo el píxel
// eso ya no cuela, así que las fotos son OPACAS y cada una prueba su dirección.
const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mMQkFAAAACEAEn2c0sWAAAAAElFTkSuQmCC"; // rgb(16,24,32)
const FOTO_CLARA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP49OEFAAWiAsvPbVntAAAAAElFTkSuQmCC"; // rgb(242,240,232)

// La portada de Aurora reducida a su esqueleto: foto hermana + velo hermano +
// texto blanco encima. Abajo, un brazo de control invisible DE VERDAD.
//
// ⚠️ El brazo de control va en NEGRO SOBRE NEGRO, no en blanco sobre blanco, y
// no es cosmético: la deduplicación de hallazgos usa la clave
// `${probe}|${background}` y en una página sin `data-ol-probe` el probe es
// siempre -1, así que sólo sobrevive UN hallazgo por color de fondo. Con el
// control también en #ffffff, el falso positivo del titular lo tapaba y la
// prueba medía la deduplicación en vez de medir el detector.
const HERO = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
</style></head><body>
<section style="position:relative">
  <div style="position:absolute;inset:0">
    <img src="${FOTO}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(to right, rgba(2,6,23,0.90) 0%, rgba(2,6,23,0.55) 100%)"></div>
  </div>
  <div style="position:relative;padding:80px">
    <h1 style="color:#ffffff;margin:0">Encuentra casa en Monterrey</h1>
  </div>
</section>
<p style="color:#101010;background:#101010;padding:20px">Mariscos frescos desde 1987</p>
</body></html>`;

const sobreFoto = (foto: string) => `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
</style></head><body>
<section style="position:relative">
  <img src="${foto}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  <div style="position:relative;padding:80px">
    <h1 style="color:#ffffff;margin:0">Titular sobre la foto</h1>
  </div>
</section>
</body></html>`;

describe("el paseo por hermanos", () => {
  it("🔴 NO inventa blanco cuando un velo hermano oscurece la foto", async () => {
    const medido = await renderVisualQualityViewports(HERO);
    const malos = medido?.unreadableText ?? [];
    const inventado = malos.find((m) => (m.texto ?? "").includes("Monterrey"));
    expect(
      inventado,
      `hallazgo inventado sobre el titular: ${JSON.stringify(inventado)}`,
    ).toBeUndefined();
  }, 60_000);

  // BRAZO DE CONTROL, en el MISMO documento: si el arreglo cegara el detector,
  // esta prueba lo caza. Sin ella, «no encuentra nada» pasaría por éxito.
  it("y sigue viendo el texto que de verdad es invisible", async () => {
    const medido = await renderVisualQualityViewports(HERO);
    const malos = medido?.unreadableText ?? [];
    expect(malos.some((m) => (m.texto ?? "").includes("Mariscos"))).toBe(true);
  }, 60_000);

  // Una foto OSCURA: el titular blanco encima se lee — 17,89:1 medido. La
  // dirección que sujeta este caso es «no inventes sobre una foto», y ahora se
  // cumple por haberlo MEDIDO, no por rendirse.
  it("no inventa un hallazgo sobre una foto que sí deja leer el texto", async () => {
    const medido = await renderVisualQualityViewports(sobreFoto(FOTO));
    const malos = medido?.unreadableText ?? [];
    expect(
      malos.some((m) => (m.texto ?? "").includes("Titular")),
      `hallazgo inventado: ${JSON.stringify(malos)}`,
    ).toBe(false);
  }, 60_000);

  // 🔴 LA MITAD QUE FALTABA, y que hasta hoy NADIE vigilaba: la misma página
  // con una foto CLARA deja el titular blanco a 1,14:1 — invisible. El paseo
  // por CSS se rendía ante CUALQUIER foto, así que este texto salía a
  // producción sin que nadie lo mirara. Y con «Born With Imagery» casi todo
  // hero lleva foto: el contraste del titular no se comprobaba JAMÁS.
  it("y SÍ ve el titular claro sobre una foto clara", async () => {
    const medido = await renderVisualQualityViewports(sobreFoto(FOTO_CLARA));
    const malos = medido?.unreadableText ?? [];
    expect(
      malos.some((m) => (m.texto ?? "").includes("Titular")),
      `no lo vio: ${JSON.stringify(malos)}`,
    ).toBe(true);
  }, 60_000);
});

// ─── LA DEDUPLICACIÓN NO PUEDE ESCONDER PROBLEMAS DISTINTOS ──────────────────
//
// 🔴 MEDIDO el 2026-09-02 con una sonda: la clave era `${probe}|${background}`,
// y `data-ol-probe` sólo lo escribe la reparación del lado de Crear
// (lib/document/repair-unreadable-text.ts) — en el camino del Agente NADIE lo
// pone, así que `probe` vale siempre -1 y la clave se reducía al color de
// fondo. Consecuencia: de todos los textos invisibles sobre blanco sólo
// sobrevivía UNO, y el resto desaparecía en silencio.
//
// Se vio en vivo: el falso positivo del titular estaba tapando a un párrafo que
// era invisible DE VERDAD, en el mismo documento.
const DOS_INVISIBLES = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
</style></head><body>
<h1 style="color:#ffffff;background:#ffffff;margin:0;padding:20px">Titular fantasma</h1>
<p style="color:#ffffff;background:#ffffff;padding:20px">Parrafo fantasma</p>
</body></html>`;

// Y el motivo por el que la deduplicación EXISTE: una regla que apaga una lista
// entera no puede producir cuarenta hallazgos iguales. Mismo color, misma
// etiqueta ⇒ es el mismo problema repetido, y se colapsa.
const LISTA_APAGADA = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  li{color:#ffffff;background:#ffffff;padding:8px}
</style></head><body>
<ul><li>Uno</li><li>Dos</li><li>Tres</li><li>Cuatro</li><li>Cinco</li></ul>
</body></html>`;

describe("la deduplicación de hallazgos", () => {
  it("🔴 NO colapsa dos elementos DISTINTOS que comparten color de fondo", async () => {
    const medido = await renderVisualQualityViewports(DOS_INVISIBLES);
    const malos = medido?.unreadableText ?? [];
    expect(
      malos.some((m) => (m.texto ?? "").includes("Titular fantasma")),
      `sólo salió: ${JSON.stringify(malos.map((m) => m.texto))}`,
    ).toBe(true);
    expect(
      malos.some((m) => (m.texto ?? "").includes("Parrafo fantasma")),
      `sólo salió: ${JSON.stringify(malos.map((m) => m.texto))}`,
    ).toBe(true);
  }, 60_000);

  // BRAZO DE CONTROL: sin esto, «deduplicar menos» pasaría por arreglo aunque
  // hubiéramos quitado la deduplicación entera y devuelto la inundación.
  it("y SIGUE colapsando la misma regla repetida sobre cinco <li>", async () => {
    const medido = await renderVisualQualityViewports(LISTA_APAGADA);
    const malos = medido?.unreadableText ?? [];
    expect(malos.length, `esperaba 1 hallazgo, salieron ${malos.length}`).toBe(1);
  }, 60_000);
});
