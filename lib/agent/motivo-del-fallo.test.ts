import { describe, expect, it } from "vitest";
import { avisoParaElDueno, TOPE_MOTIVO } from "./motivo-del-fallo";

// ⚰️ `motivoDelFallo` (2026-09-18 → 03/10) sacaba de una respuesta FALLIDA el
// texto que leyó el modelo para pintarlo en la tarjeta roja. Se retiró con N41:
// con Len en inglés el dueño leía «you made that name up…». La roja dice ahora
// su `ownerReason` (lib/agent/owner-reason.ts); sus pruebas, en
// owner-reason.test.ts, loop.test.ts y motivo-llega-a-la-tarjeta.test.ts.

// ─────────────────────────────────────────────────────────────────────────
// 🔴 UNA DE TRECE ERA LAS QUE LLEGABAN (2026-09-21).
//
// `tools.ts` tiene 17 claves `extra.*`, 13 de ellas señales de avería con su
// guarda —`handlers_muertos`, `contenido_perdido`, `css_sin_efecto`…—. El
// bucle leía CUATRO claves de la respuesta para pintar: `ok`, `cambio`,
// `error` y `prueba_descartada`. Las otras doce viajaban en `aviso_critico`,
// cuyo único consumidor era el modelo vía «nunca cierres un turno callando un
// aviso» — o sea, una señal que dependía de que Len se acordara.
//
// MEDIDO antes de escribirlo, sobre 90 llamadas con diario en producción: 15
// traían `aviso_critico`, 9 eran rechazos de spec (ya ámbar desde el
// despliegue del 20/09) y quedan 6 — un 6,7%. No inunda.
describe("cualquier aviso al modelo llega al dueño, no sólo la prueba", () => {
  it("🔴 un aviso_critico solo YA pinta ámbar", () => {
    expect(
      avisoParaElDueno({
        ok: true,
        aviso_critico: "Escribiste CSS que NUNCA se aplica: `.bar.warn > i`",
      }),
    ).toBe("Escribiste CSS que NUNCA se aplica: `.bar.warn > i`");
  });

  // CONTRA-PRUEBA: una llamada que FALLÓ ya tiene su tarjeta roja, y dos
  // motivos en una fila ni caben ni se leen.
  it("CONTRA-PRUEBA: con ok:false no añade ámbar sobre el rojo", () => {
    expect(avisoParaElDueno({ ok: false, aviso_critico: "algo" })).toBeUndefined();
  });

  // CONTRA-PRUEBA: una respuesta limpia sigue saliendo VERDE. Sin esto, el
  // cambio podría pintar ámbar a todo y el color dejaría de decir nada.
  it("CONTRA-PRUEBA: sin aviso, nada que pintar", () => {
    expect(avisoParaElDueno({ ok: true, edits_aplicados: 3 })).toBeUndefined();
    expect(avisoParaElDueno({ ok: true, aviso_critico: "   " })).toBeUndefined();
    expect(avisoParaElDueno({ ok: true, aviso_critico: 42 })).toBeUndefined();
  });

  // Se corta CON MARCA, nunca en silencio: Claude Code escribe
  // `... [N characters truncated] ...` en vez de dejar la frase a medias sin
  // avisar. Aquí basta el puntito, porque el aviso entero vive en el diario.
  it("corta con marca y no en silencio", () => {
    const largo = "x".repeat(TOPE_MOTIVO + 50);
    const cortado = avisoParaElDueno({ ok: true, aviso_critico: largo })!;
    expect(cortado).toHaveLength(TOPE_MOTIVO + 1);
    expect(cortado.endsWith("…")).toBe(true);
  });
});
