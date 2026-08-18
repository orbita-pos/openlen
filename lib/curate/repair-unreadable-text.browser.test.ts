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
