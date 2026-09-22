import { describe, expect, it } from "vitest";
import { avisoParaElDueno, motivoDelFallo, TOPE_MOTIVO } from "./motivo-del-fallo";

describe("motivoDelFallo", () => {
  it("🔴 saca el motivo de una respuesta fallida", () => {
    expect(motivoDelFallo({ ok: false, error: "módulo desconocido" })).toBe(
      "módulo desconocido",
    );
  });

  // Las herramientas no se pusieron de acuerdo en el nombre de la clave, y
  // exigirlo ahora sería cambiar 27 ficheros para que la tarjeta hable.
  it("acepta las tres claves que las herramientas usan de verdad", () => {
    expect(motivoDelFallo({ ok: false, motivo: "llena" })).toBe("llena");
    expect(motivoDelFallo({ ok: false, reason: "no_guardado" })).toBe("no_guardado");
  });

  it("`error` gana cuando vienen varias", () => {
    expect(motivoDelFallo({ ok: false, error: "el bueno", reason: "el otro" })).toBe(
      "el bueno",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LA FRASE GANA AL CÓDIGO (2026-09-18, medido en el diario de producción).
  //
  // En Claude Code el texto del error es UNO y es PROSA: la
  // interfaz pinta el mismo string que leyó el modelo. Aquí la respuesta viene
  // partida en tres claves —`error` a veces es un código, `detalle` es la
  // frase, `como_hacerlo` es la instrucción al modelo— y preferir `error` le
  // ponía a la tarjeta un slug donde la frase estaba al lado.
  //
  // Éste es el turno de verdad: «ponme un carrito con base de datos», el
  // 2026-09-18 a las 19:50. La tarjeta decía «Changing the structure · failed»
  // y el diario guardaba esto.
  it("🔴 con `detalle`, la tarjeta enseña la FRASE y no el código", () => {
    const detalle =
      "1 edit(s) apuntaban al <html> o al <body>, lo que habría reemplazado la página ENTERA. No se guardó nada.";
    expect(
      motivoDelFallo({
        ok: false,
        error: "op_contra_la_raiz",
        detalle,
        como_hacerlo:
          'Para CSS usa un edit con target="styles"; para una hoja de fuentes, target="head". Para cambiar el contenido, apunta al data-op-id del elemento concreto, nunca al del body.',
      }),
    ).toBe(detalle);
  });

  // El OTRO fallo del mismo turno: ahí `error` ya era la frase, y se enseña
  // igual que antes. Las dos ramas salen del mismo turno a propósito.
  it("sin `detalle`, el `error` sigue siendo lo que se enseña", () => {
    expect(
      motivoDelFallo({
        ok: false,
        error:
          "<section> tiene 1 hijo(s) elemento: poner texto aqui los borraria. Apunta al hijo que de verdad lleva el texto — sus ids son: 5r.",
        documento: "[67119 bytes]",
        como_hacerlo: "Los data-op-id de `documento` son los BUENOS.",
      }),
    ).toContain("<section> tiene 1 hijo(s)");
  });

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

    // CONTRA-PRUEBA: una llamada que FALLÓ ya tiene su motivo rojo, y dos
    // motivos en una fila ni caben ni se leen.
    it("CONTRA-PRUEBA: con ok:false no añade ámbar sobre el rojo", () => {
      expect(
        avisoParaElDueno({ ok: false, aviso_critico: "algo" }),
      ).toBeUndefined();
    });

    // CONTRA-PRUEBA: una respuesta limpia sigue saliendo VERDE. Sin esto, el
    // cambio podría pintar ámbar a todo y el color dejaría de decir nada.
    it("CONTRA-PRUEBA: sin aviso, nada que pintar", () => {
      expect(avisoParaElDueno({ ok: true, edits_aplicados: 3 })).toBeUndefined();
      expect(avisoParaElDueno({ ok: true, aviso_critico: "   " })).toBeUndefined();
      expect(avisoParaElDueno({ ok: true, aviso_critico: 42 })).toBeUndefined();
    });
  });

  // CONTRA-PRUEBA: `como_hacerlo` es la corrección que va AL MODELO —como la
  // que Claude Code pega a una entrada inválida—, no algo que quepa en una línea de
  // tarjeta. Sin esta contra-prueba, añadirlo a la lista de claves pasaría
  // desapercibido y la tarjeta enseñaría instrucciones de herramienta.
  it("CONTRA-PRUEBA: `como_hacerlo` no se pinta, es para el modelo", () => {
    expect(
      motivoDelFallo({ ok: false, como_hacerlo: 'usa un edit con target="styles"' }),
    ).toBeUndefined();
  });

  // CONTRA-PRUEBA: lo que salió bien no tiene motivo que contar, y una tarjeta
  // verde con un motivo pegado sería peor que no tener motivo.
  it("CONTRA-PRUEBA: una respuesta que fue bien no da motivo", () => {
    expect(motivoDelFallo({ ok: true, error: "no es un fallo" })).toBeUndefined();
    expect(motivoDelFallo({ error: "sin ok no se juzga" })).toBeUndefined();
  });

  it("un motivo vacío o que no es texto no cuenta", () => {
    expect(motivoDelFallo({ ok: false, error: "   " })).toBeUndefined();
    expect(motivoDelFallo({ ok: false, error: 42 })).toBeUndefined();
    expect(motivoDelFallo({ ok: false })).toBeUndefined();
    expect(motivoDelFallo(undefined)).toBeUndefined();
  });

  // Se corta CON MARCA, nunca en silencio: Claude Code escribe
  // `... [N characters truncated] ...` en vez de dejar la frase a medias sin
  // avisar. Aquí basta el puntito, porque el motivo entero vive en el diario.
  it("corta con marca y no en silencio", () => {
    const largo = "x".repeat(TOPE_MOTIVO + 50);
    const cortado = motivoDelFallo({ ok: false, error: largo })!;
    expect(cortado).toHaveLength(TOPE_MOTIVO + 1);
    expect(cortado.endsWith("…")).toBe(true);
  });
});
