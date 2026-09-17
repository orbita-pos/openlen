// QUIÉN LE CONTESTA A LA GENTE QUE ENTRA EN TU PÁGINA.
//
// Ésa es la pregunta que el 2026-09-16 ninguna superficie contestaba, y contra
// la que se juzga esta funcionalidad. La tabla de abajo ES el diseño.
import { describe, expect, it } from "vitest";
import { estadoDeLaBurbuja } from "./estado-de-la-burbuja";

describe("estadoDeLaBurbuja", () => {
  const casos = [
    { asistente: false, chat: false, publicada: true, cambiosSinPublicar: false, esperado: "nadie" },
    { asistente: true, chat: false, publicada: true, cambiosSinPublicar: false, esperado: "soloIA" },
    { asistente: false, chat: true, publicada: true, cambiosSinPublicar: false, esperado: "soloTu" },
    { asistente: true, chat: true, publicada: true, cambiosSinPublicar: false, esperado: "ambos" },
    // 🔴 EL QUINTO ESTADO, y sin él la franja MIENTE: sin publicar, la burbuja
    // no existe todavía para nadie.
    { asistente: true, chat: true, publicada: false, cambiosSinPublicar: false, esperado: "ambosSinPublicar" },
    { asistente: false, chat: false, publicada: false, cambiosSinPublicar: false, esperado: "nadieSinPublicar" },
    { asistente: false, chat: true, publicada: false, cambiosSinPublicar: false, esperado: "soloTuSinPublicar" },
    // 🔴 Y EL SEXTO, que la primera versión no veía: PUBLICADA pero con los
    // ajustes cambiados después. La burbuja se hornea al publicar, así que la
    // página viva sigue con lo de antes hasta que se vuelva a publicar.
    { asistente: true, chat: false, publicada: true, cambiosSinPublicar: true, esperado: "soloIASinPublicar" },
    // 🔴 …PERO APAGAR NO ESPERA A PUBLICAR, y por eso esta fila dice `nadie` y
    // no `nadieSinPublicar`. Con todo apagado y la página publicada, el
    // visitante ya no puede hablar con nadie: el servidor rechaza (403 el
    // asistente, 404 el chat) y desde el 2026-09-17 la burbuja horneada
    // pregunta el estado al cargar y se retira sola. Decir «cuando publiques»
    // aquí es pedir un trámite que no cambia nada.
    //
    // La otra fila de `nadieSinPublicar` —la de arriba, con publicada:false—
    // sigue en pie: ahí no hay página viva, y «cuando publiques» es exacto.
    { asistente: false, chat: false, publicada: true, cambiosSinPublicar: true, esperado: "nadie" },
  ] as const;

  for (const c of casos) {
    it(`asistente=${c.asistente} chat=${c.chat} publicada=${c.publicada} cambios=${c.cambiosSinPublicar} → ${c.esperado}`, () => {
      expect(estadoDeLaBurbuja(c)).toBe(c.esperado);
    });
  }

  it("BRAZO DE CONTROL: publicar CAMBIA la respuesta", () => {
    // Si `publicada` se ignorara, todas las filas de arriba pasarían igual y la
    // franja diría que funciona algo que nadie puede ver.
    const base = { asistente: true, chat: true, cambiosSinPublicar: false };
    expect(estadoDeLaBurbuja({ ...base, publicada: true })).not.toBe(
      estadoDeLaBurbuja({ ...base, publicada: false }),
    );
  });

  it("🔴 BRAZO DE CONTROL: los cambios sin publicar CAMBIAN la respuesta", () => {
    // Si se ignoraran, encender el asistente sobre una página publicada haría
    // decir «contesta la IA» a la franja mientras la página viva no tiene
    // burbuja — y apagarlo, «no contesta nadie» con la burbuja todavía puesta.
    const base = { asistente: true, chat: false, publicada: true };
    expect(estadoDeLaBurbuja({ ...base, cambiosSinPublicar: false })).not.toBe(
      estadoDeLaBurbuja({ ...base, cambiosSinPublicar: true }),
    );
  });
});
