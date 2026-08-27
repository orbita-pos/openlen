// LO QUE SE ADJUNTA A UN MENSAJE SE VA CON ÉL.
//
// El compositor del chat tiene dos adjuntos: una IMAGEN y un ELEMENTO MARCADO
// («Scoped: div.video-placeholder»). Los dos se ven igual —una pastilla con su
// X— y los dos son una decisión de ESE mensaje.
//
// Pero sólo la imagen se limpiaba al enviar. El elemento marcado se quedaba
// pegado: Jesús marcaba un placeholder, mandaba su mensaje, y el turno
// SIGUIENTE seguía acotado a un elemento que ya no quería, sin más aviso que
// una pastilla que a esas alturas ya había dejado de mirar. Acotar es una
// decisión de un mensaje, no un modo.
//
// Esto no se puede medir sin montar el panel entero —es una línea dentro de un
// `useCallback` de mil líneas— así que se vigila en la fuente: que el camino de
// envío limpie LOS DOS. El modo de fallo que importa es que alguien refactorice
// y se lleve uno solo, que es exactamente como nació el fallo.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FUENTE = readFileSync(
  path.join(process.cwd(), "components", "workspace-v2", "panels", "chat-panel.tsx"),
  "utf8",
);

/** El cuerpo del envío: de donde se vacía el borrador a donde arranca el
 *  streaming. Acotar la búsqueda es lo que hace que esto signifique algo — la
 *  llamada suelta existe también en el botón de la X. */
function cuerpoDelEnvio(): string {
  const desde = FUENTE.indexOf('setDraft("");');
  const hasta = FUENTE.indexOf("setSending(true);", desde);
  expect(desde, "no se encontró el inicio del envío").toBeGreaterThan(-1);
  expect(hasta, "no se encontró el final del envío").toBeGreaterThan(desde);
  return FUENTE.slice(desde, hasta);
}

describe("al enviar un mensaje, sus adjuntos se sueltan", () => {
  it("la imagen adjunta", () => {
    expect(cuerpoDelEnvio()).toContain("setAttachedImage(null)");
  });

  it("y el elemento marcado — el que se quedaba pegado", () => {
    expect(
      cuerpoDelEnvio(),
      "el elemento marcado sobrevive al envío: el turno siguiente saldrá acotado " +
        "a algo que el usuario ya no eligió",
    ).toContain("onClearScope?.()");
  });

  /**
   * Y EL ORDEN IMPORTA. `turnScope` toma su instantánea DESPUÉS, leyendo
   * `scopedSelection` del cierre de ese render — así la petición en vuelo
   * conserva su objetivo aunque el estado ya se haya limpiado. Es la misma
   * disciplina que el propio comentario de `turnScope` declaraba para cuando el
   * usuario pulsa la X a media respuesta.
   *
   * Si alguien moviera la limpieza DESPUÉS de la instantánea no pasaría nada
   * malo; moverla a un `useEffect` o a un `await` sí — ahí el cierre ya no es
   * el mismo. Esto clava que siga siendo síncrono y antes.
   */
  it("y la instantánea del alcance se toma después, en el mismo turno síncrono", () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('setDraft("");'));
    const limpieza = cuerpo.indexOf("onClearScope?.()");
    const instantanea = cuerpo.indexOf("const turnScope = scopedSelection");
    expect(instantanea, "turnScope ya no se llama así").toBeGreaterThan(-1);
    expect(
      limpieza,
      "la limpieza del alcance dejó de ir antes de su instantánea",
    ).toBeLessThan(instantanea);
    // Nada que espere entre medias: un await ahí rompería el cierre.
    expect(cuerpo.slice(limpieza, instantanea)).not.toContain("await ");
  });
});
