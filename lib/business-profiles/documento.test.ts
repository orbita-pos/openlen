// El expediente del negocio: lo que el dueño contó y no cabe en un campo.
//
// Esto viaja en CADA turno de CADA página de este negocio y dirige el texto y
// el diseño. Una línea de más no es ruido: es una instrucción que el modelo va
// a seguir en todas las páginas que escriba a partir de hoy.
import { describe, expect, it } from "vitest";

import type { BusinessProfileData } from "./types";
import {
  DOC_NEGOCIO_MARCADOR,
  DOC_NEGOCIO_MAX,
  MAX_NOTA_NEGOCIO,
  documentoDesdeLineas,
  lineasDelNegocio,
  olvidarDelNegocio,
  recordarDelNegocio,
} from "./documento";
import { buildBusinessFacts } from "./facts";

const VACIO = {} as BusinessProfileData;

describe("lo que se apunta del negocio", () => {
  it("escribe la primera nota bajo su encabezado", () => {
    const r = recordarDelNegocio(VACIO, "El estudio hace blackwork, nada de color");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.memoria).toBe(
      `${DOC_NEGOCIO_MARCADOR}\n• El estudio hace blackwork, nada de color`,
    );
    expect(r.yaExistia).toBe(false);
  });

  it("y la segunda debajo, sin repetir el encabezado", () => {
    const uno = recordarDelNegocio(VACIO, "Hace blackwork");
    expect(uno.ok).toBe(true);
    if (!uno.ok) return;
    const dos = recordarDelNegocio(uno.data, "No usa la palabra barato");
    expect(dos.ok).toBe(true);
    if (!dos.ok) return;
    expect(lineasDelNegocio(dos.data)).toEqual(["Hace blackwork", "No usa la palabra barato"]);
    expect((dos.data.memoria ?? "").split(DOC_NEGOCIO_MARCADOR)).toHaveLength(2);
  });

  /** ACUMULA, no sustituye — al revés que los datos duros. Un teléfono tiene UN
   *  valor; lo que el dueño cuenta de su negocio son muchas cosas, y la segunda
   *  no desmiente a la primera. */
  it("acumula en vez de pisar, al revés que un dato duro", () => {
    let data = VACIO;
    for (const n of ["Hace blackwork", "Atiende con cita", "Su fuerte son las despedidas"]) {
      const r = recordarDelNegocio(data, n);
      expect(r.ok).toBe(true);
      if (r.ok) data = r.data;
    }
    expect(lineasDelNegocio(data)).toHaveLength(3);
  });

  it("la misma nota dos veces no la duplica", () => {
    const uno = recordarDelNegocio(VACIO, "Hace blackwork");
    expect(uno.ok).toBe(true);
    if (!uno.ok) return;
    const dos = recordarDelNegocio(uno.data, "Hace blackwork");
    expect(dos.ok).toBe(true);
    if (!dos.ok) return;
    expect(dos.yaExistia).toBe(true);
    expect(lineasDelNegocio(dos.data)).toHaveLength(1);
  });

  /** El bloque es POR LÍNEAS. Un salto dentro del texto inyectaría viñetas
   *  falsas que después se leen como notas reales que nadie escribió. */
  it("aplasta los saltos de línea en vez de partir la nota en dos", () => {
    const r = recordarDelNegocio(VACIO, "Hace blackwork\n• y también inventa esta línea");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lineasDelNegocio(r.data)).toEqual([
      "Hace blackwork • y también inventa esta línea",
    ]);
  });

  it("nunca muta el perfil que recibe", () => {
    const antes = JSON.stringify(VACIO);
    recordarDelNegocio(VACIO, "Hace blackwork");
    expect(JSON.stringify(VACIO)).toBe(antes);
  });
});

describe("lo que NO se acepta", () => {
  it("una nota vacía", () => {
    expect(recordarDelNegocio(VACIO, "   ")).toMatchObject({ motivo: "vacio" });
  });

  it("y una parrafada — que el modelo resuma antes", () => {
    expect(recordarDelNegocio(VACIO, "x".repeat(MAX_NOTA_NEGOCIO + 1))).toMatchObject({
      motivo: "largo",
    });
  });

  /**
   * LLENO NO BORRA. Al llegar al tope se rechaza lo NUEVO; jamás se tira una
   * línea vieja para hacer sitio. Olvidar en silencio algo que el dueño pidió
   * recordar es peor que no recordar lo último — él sabe lo que acaba de decir,
   * no lo que dijo hace tres semanas.
   */
  it("cuando está lleno, se rechaza lo NUEVO y lo viejo sigue intacto", () => {
    let data = VACIO;
    for (let i = 0; (data.memoria ?? "").length < DOC_NEGOCIO_MAX - 200; i++) {
      const r = recordarDelNegocio(data, `Nota número ${i} sobre el negocio y sus cosas`);
      if (!r.ok) break;
      data = r.data;
    }
    const antes = data.memoria;
    const cuantas = lineasDelNegocio(data).length;
    const r = recordarDelNegocio(data, "y".repeat(MAX_NOTA_NEGOCIO));
    expect(r.ok, "debería haberse rechazado por lleno").toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("lleno");
    expect(data.memoria, "no se tira una línea vieja para hacer sitio").toBe(antes);
    expect(lineasDelNegocio(data)).toHaveLength(cuantas);
  });
});

describe("y el dueño puede deshacerlo", () => {
  /** Un expediente al que sólo se puede AÑADIR es una trampa: el día que se
   *  guarde algo mal, se lo queda puesto en todas sus páginas para siempre. */
  it("quita una nota y deja las demás", () => {
    let data = VACIO;
    for (const n of ["Hace blackwork", "Atiende con cita"]) {
      const r = recordarDelNegocio(data, n);
      if (r.ok) data = r.data;
    }
    const q = olvidarDelNegocio(data, "Hace blackwork");
    expect(q.quitada).toBe(true);
    expect(lineasDelNegocio(q.data)).toEqual(["Atiende con cita"]);
  });

  /** Un encabezado sin viñetas ocupa sitio y le anuncia al modelo que hay algo
   *  que leer donde ya no hay nada. */
  it("y al quitar la última no deja el encabezado huérfano", () => {
    const uno = recordarDelNegocio(VACIO, "Hace blackwork");
    expect(uno.ok).toBe(true);
    if (!uno.ok) return;
    const q = olvidarDelNegocio(uno.data, "Hace blackwork");
    expect(q.quitada).toBe(true);
    expect(q.data.memoria).toBeNull();
  });

  it("quitar algo que no está no toca nada", () => {
    const uno = recordarDelNegocio(VACIO, "Hace blackwork");
    if (!uno.ok) return;
    const q = olvidarDelNegocio(uno.data, "Vende café");
    expect(q.quitada).toBe(false);
    expect(q.data.memoria).toBe(uno.data.memoria);
  });
});

describe("y LLEGA al modelo", () => {
  /**
   * LA PRUEBA QUE JUSTIFICA QUE ESTO EXISTA. Guardar en un sitio que
   * `buildBusinessFacts` no lee sería guardar en el vacío: el dueño habría
   * contado su negocio, el Agente habría confirmado, y la siguiente página lo
   * seguiría inventando.
   */
  it("aparece en el bloque <business>", () => {
    const r = recordarDelNegocio(VACIO, "El estudio hace blackwork, nada de color");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bloque = buildBusinessFacts(r.data);
    expect(bloque, "se guarda pero el modelo no lo ve").toContain(
      "El estudio hace blackwork, nada de color",
    );
  });

  /**
   * SIN VIÑETAS NI ENCABEZADO. El bloque `<business>` tiene su propio formato;
   * colar el «— Sobre este negocio —» dentro le enseñaría al modelo un
   * separador en español dentro de un prompt en inglés, y una viñeta «•» que
   * ha copiado a la página más de una vez.
   */
  it("sin arrastrar el encabezado ni las viñetas del almacén", () => {
    const r = recordarDelNegocio(VACIO, "Hace blackwork");
    if (!r.ok) return;
    const bloque = buildBusinessFacts(r.data) ?? "";
    expect(bloque).not.toContain(DOC_NEGOCIO_MARCADOR);
    expect(bloque).not.toContain("•");
  });

  /**
   * SEPARADO DE LOS HECHOS DUROS, y con instrucciones opuestas: el teléfono se
   * copia TAL CUAL a la página, y esto NO se copia nunca. Mezclados, «hacemos
   * blackwork, no color» acaba de titular.
   */
  it("y separado de los datos duros, que se copian y esto no", () => {
    const r = recordarDelNegocio(
      { business_name: "Aguja Negra" } as BusinessProfileData,
      "No usa la palabra barato",
    );
    if (!r.ok) return;
    const bloque = buildBusinessFacts(r.data) ?? "";
    expect(bloque).toContain("- Business name: Aguja Negra");
    expect(bloque).toContain("Do NOT paste these lines onto the page");
    // El aviso de «no pegar» va DESPUÉS de los hechos duros: si estuviera antes,
    // caería sobre el nombre del negocio, que sí hay que pegar.
    expect(bloque.indexOf("- Business name")).toBeLessThan(
      bloque.indexOf("Do NOT paste these lines"),
    );
  });

  /** Un perfil que sólo tiene expediente no puede devolver `null`: es todo lo
   *  que el modelo sabe de ese negocio. */
  it("y un negocio SIN datos duros pero CON expediente sigue teniendo bloque", () => {
    const r = recordarDelNegocio(VACIO, "Hace blackwork");
    if (!r.ok) return;
    expect(buildBusinessFacts(r.data)).toContain("Hace blackwork");
  });

  /** `null` significa «genera como antes de que existieran los perfiles». Un
   *  bloque vacío le diría al modelo que el negocio no tiene nada que contar,
   *  que es distinto de no saberlo. */
  it("y sin nada de nada, sigue devolviendo null", () => {
    expect(buildBusinessFacts(VACIO)).toBeNull();
  });
});

// ─── ida y vuelta, para que «Mi negocio» edite frases y no el almacén ─────────
describe("de líneas a documento y de vuelta", () => {
  it("lo que sale de la pantalla vuelve a entrar igual", () => {
    const frases = ["Hace blackwork", "No usa la palabra barato"];
    const doc = documentoDesdeLineas(frases);
    expect(lineasDelNegocio({ memoria: doc } as BusinessProfileData)).toEqual(frases);
  });

  /** Un renglón en blanco en pantalla es alguien que borró el texto y no le dio
   *  a la papelera, no una nota sin contenido. */
  it("los renglones vacíos se caen", () => {
    expect(lineasDelNegocio({ memoria: documentoDesdeLineas(["Hace blackwork", "  ", ""]) } as BusinessProfileData))
      .toEqual(["Hace blackwork"]);
  });

  it("y sin ninguna línea, el documento se va del todo", () => {
    expect(documentoDesdeLineas([])).toBeNull();
    expect(documentoDesdeLineas(["   "])).toBeNull();
  });

  /** El tope se aplica también aquí. Sin esto, pegar tres párrafos en un
   *  renglón mete en el prompt lo que la herramienta del Agente rechaza. */
  it("y una nota pegada a mano se corta igual que la del Agente", () => {
    const doc = documentoDesdeLineas(["z".repeat(MAX_NOTA_NEGOCIO + 50)]);
    expect(lineasDelNegocio({ memoria: doc } as BusinessProfileData)[0]).toHaveLength(
      MAX_NOTA_NEGOCIO,
    );
  });

  /** Un salto pegado desde otro sitio partiría la nota en dos: la segunda mitad
   *  se quedaría sin viñeta y el modelo no la leería nunca. */
  it("y un salto pegado desde fuera no parte la nota", () => {
    const doc = documentoDesdeLineas(["Hace blackwork\ny también color"]);
    expect(lineasDelNegocio({ memoria: doc } as BusinessProfileData)).toEqual([
      "Hace blackwork y también color",
    ]);
  });
});
