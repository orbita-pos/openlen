import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { repairUnreadableText } from "./repair-unreadable-text";

// El defecto real, reducido: el modelo diseñó una barra transparente para que
// flotara sobre el hero oscuro y le puso un color claro sin fondo propio, pero
// la banda que hay debajo sigue pintando crema. Tres elementos más abajo el
// MISMO patrón es correcto, porque ahí sí hay una imagen detrás. La prueba
// existe para que la medición siga distinguiendo los dos casos: es la única
// diferencia entre arreglar el menú y romper el hero.
const HOTEL = `<!doctype html><html style="--ol-bg:#f4eee2;--ol-fg:#26261f"><head><style>
  *{box-sizing:border-box}html,body{margin:0}body{background:#f4eee2;font-family:Arial,sans-serif}
  .band{background:#f4eee2;padding:24px}
  .site-head,.site-head a{color:#f6efe2;text-decoration:none;font-size:18px}
  .hero{background-image:linear-gradient(#1b2921,#0d130f);padding:120px 24px}
  .hero h1{color:#f6efe2;font-size:56px;margin:0}
  .hero p{color:#f6efe2;font-size:18px}
</style></head><body>
  <section class="band"><div class="site-head"><a href="#">Casa del Lago</a> <span>Reservar</span></div></section>
  <section class="hero"><h1>Ocho habitaciones frente al lago</h1><p>Un hotel boutique entre el bosque de pino y el agua.</p></section>
</body></html>`;

describe("contraste medido en el render", () => {
  it("ve el menú invisible, lo arregla, y deja en paz el texto que está sobre la foto", async () => {
    const before = await renderVisualQualityViewports(HOTEL);
    // Un null aquí no es "la página está bien": es que la medición no corrió.
    expect(before).not.toBeNull();
    expect(before?.unreadableText?.length).toBeGreaterThan(0);
    // Todo lo señalado sale de la banda crema. El hero nunca entra: encima de
    // una imagen no se sabe qué hay debajo, y una duda no es un hallazgo.
    expect(before?.unreadableText?.every((finding) => finding.background === "#f4eee2")).toBe(true);

    const repaired = await repairUnreadableText(HOTEL, renderVisualQualityViewports);
    expect(repaired.repaired).toBeGreaterThan(0);
    // El hero conserva su color claro tal cual lo escribió el modelo.
    expect(repaired.html).toContain(".hero h1{color:#f6efe2");

    const after = await renderVisualQualityViewports(repaired.html);
    expect(after).not.toBeNull();
    expect(after?.unreadableText).toEqual([]);
  }, 90_000);
});

// Un velo decorativo casi transparente no tapa nada, pero la guarda "cualquier
// background-image es incierto" silenciaba el hero entero. Medido en una página
// generada: titular crema sobre crema a 1.1:1, entregado sin que nadie lo viera.
//
// ⚠️ ESTE FIXTURE USABA `radial-gradient(<stop> 1px, transparent 0)` con
// `background-size: 20px 20px`, o sea PUNTOS DE 1 PX sobre una rejilla de 20:
// cubren ~0,8 % del área y NO TAPAN NADA. El paseo por CSS componía ese velo a
// plena fuerza sobre todo el fondo — imaginaba un baño que no existe. MEDIDO el
// 2026-09-02: los tres alfas de abajo daban el MISMO fondo `#fbf7f0` y el MISMO
// 1,10:1, y el caso de 0,6 llevaba pasando desde el 19/08 sobre esa premisa
// falsa. Ahora el velo es un BAÑO UNIFORME, que es lo que la prueba creía estar
// poniendo, y las dos direcciones se cumplen por haberlas medido.
const page = (stop: string) => `<!doctype html><html style="--ol-bg:#fbf7f0;--ol-fg:#1e4d3b"><head><style>
  *{box-sizing:border-box}html,body{margin:0}body{background:#fbf7f0;font-family:Arial,sans-serif}
  .hero{background-color:#fbf7f0;background-image:linear-gradient(${stop},${stop});padding:80px 24px}
  .hero h1{color:#f3ecdb;font-size:56px;margin:0}
</style></head><body>
  <header class="hero"><h1>Donde cada niño descubre su propio horizonte</h1></header>
</body></html>`;

describe("un degradado decorativo no es una foto", () => {
  it("ve el titular crema sobre crema detrás de los puntos", async () => {
    const measured = await renderVisualQualityViewports(page("rgba(30,77,59,0.05)"));
    expect(measured?.unreadableText?.length ?? 0).toBeGreaterThan(0);

    const repair = await repairUnreadableText(page("rgba(30,77,59,0.05)"), renderVisualQualityViewports);
    expect(repair.repaired).toBe(1);
    const after = await renderVisualQualityViewports(repair.html);
    expect(after?.unreadableText?.length ?? 0).toBe(0);
  }, 60_000);

  // MEDIDO: el velo oscuro al 0,6 compone `#769183` y el titular crema queda a
  // 2,90:1 — se lee. Es el brazo «no lo inventes».
  it("se sigue callando cuando el degradado sí tapa el fondo", async () => {
    const measured = await renderVisualQualityViewports(page("rgba(30,77,59,0.6)"));
    expect(measured?.unreadableText?.length ?? 0).toBe(0);
  }, 60_000);

  // MEDIDO: el velo claro al 0,28 compone `#f8e5c2` y el titular crema queda a
  // 1,05:1 — no rescata nada. Es el brazo «el velo claro no salva al texto».
  it("ve el titular bajo un velo claro por encima del viejo umbral", async () => {
    const measured = await renderVisualQualityViewports(page("rgba(242,184,75,0.28)"));
    expect(measured?.unreadableText?.length ?? 0).toBeGreaterThan(0);
  }, 60_000);

  // ⚠️ Aquí vivía un comentario que decía «un velo oscuro a 0.28 sobre crema
  // deja el texto en 1.69:1». Ese número se midió contra el fixture VIEJO —el
  // patrón de puntos de 1 px, que no tapaba nada— y con el baño uniforme ya no
  // vale: medido el 2026-09-02, el velo claro a 0.28 compone `#f8e5c2` y deja
  // el titular en 1,05:1, y el oscuro a 0.6 compone `#769183` y lo deja en
  // 2,90:1. Las dos direcciones las fijan los dos casos de aquí arriba, cada
  // uno con su número medido; no hace falta un tercero.
});
