import { describe, expect, it } from "vitest";
import {
  AvisosDelTurno,
  defectosConDireccion,
  redactarAviso,
  type MedicionCruda,
} from "@/lib/agent/aviso-medido";

const sana: MedicionCruda = {};

describe("defectosConDireccion — qué entra y qué NO", () => {
  it("una página sana no produce nada, y el sobre queda en null", () => {
    expect(defectosConDireccion(sana)).toEqual([]);
    expect(redactarAviso([])).toBeNull();
  });

  it("no medir devuelve vacío, no un falso 'está bien'", () => {
    expect(defectosConDireccion(null)).toEqual([]);
    expect(defectosConDireccion(undefined)).toEqual([]);
  });

  it("el desborde entra CON dirección, con el ancho y con la clase", () => {
    const [d] = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: '<div class="grid">',
      overflowCulpritRight: 482.4,
      overflowCulpritKind: "caja",
      overflowCulpritOpId: "bs",
    });
    expect(d?.clase).toBe("desborde");
    expect(d?.opId).toBe("bs");
    expect(d?.frase).toContain("482px");
    expect(d?.frase).toContain('<div class="grid">');
    // La clase decide el arreglo: sin esto el modelo toca anchos donde no
    // mueven nada.
    expect(d?.frase).toContain("CAJA");
  });

  it("el desborde de TINTA manda a overflow-wrap y desaconseja los anchos", () => {
    const [d] = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "<code>",
      overflowCulpritKind: "tinta",
      overflowCulpritOpId: "k2",
    });
    expect(d?.frase).toContain("overflow-wrap");
    expect(d?.frase).toContain("NO con anchos");
  });

  it("🔴 un desborde SIN culpable no se dice: «algo se sale» no se puede arreglar", () => {
    expect(defectosConDireccion({ mobileOverflow: true })).toEqual([]);
  });

  it("🔴 la sonda puede culpar al nodo equivocado, y el aviso lo advierte", () => {
    // Medido en `documentacion#3`: culpaba a un <code> de 14 caracteres con el
    // documento a 585px. La sonda mide el MÁS PROFUNDO, no el causante.
    const [d] = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "<code>",
      overflowCulpritOpId: "z1",
    });
    expect(d?.frase).toContain("más profundo");
    expect(d?.frase).toContain("sube al ancestro");
  });

  it("el contraste entra con su dirección, el peor primero, y se acota a dos", () => {
    const ds = defectosConDireccion({
      unreadableText: [
        { contrast: 3.1, texto: "Tres", opId: "c" },
        { contrast: 1.0, texto: "Uno", opId: "a" },
        { contrast: 2.0, texto: "Dos", opId: "b" },
      ],
    });
    expect(ds).toHaveLength(2);
    expect(ds[0]?.opId).toBe("a");
    expect(ds[0]?.frase).toContain("1.00:1");
    expect(ds[1]?.opId).toBe("b");
  });

  it("el JavaScript entra con su mensaje LITERAL, no con una categoría", () => {
    const [d] = defectosConDireccion({
      runtimeErrors: ["TypeError: Assignment to constant variable."],
    });
    expect(d?.clase).toBe("js");
    expect(d?.frase).toContain("Assignment to constant variable.");
  });

  it("los gritos se acotan a tres: más suele ser el mismo fallo rebotando", () => {
    const ds = defectosConDireccion({
      runtimeErrors: ["a", "b", "c", "d", "e"],
    });
    expect(ds.filter((d) => d.clase === "js")).toHaveLength(3);
  });

  it("🔴 tipografía y geometría NO entran: no nombran un nodo", () => {
    // Se miden y se cuentan en otro sitio (`objectiveBreakage`, que es de
    // Crear). Aquí mandarían al modelo a buscar a ciegas.
    const ds = defectosConDireccion({
      // @ts-expect-error — a propósito: se le pasa la forma de la medición
      // completa para probar que estos campos NO se leen aquí.
      invalidGeometry: true,
      typographyHierarchy: { rule: "h1_missing", h1FontPx: null, heroBodyFontPx: null },
    });
    expect(ds).toEqual([]);
  });

  it("el orden es de severidad: el JavaScript por delante del desborde", () => {
    const ds = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "<div>",
      overflowCulpritOpId: "d1",
      unreadableText: [{ contrast: 1.2, texto: "x", opId: "c1" }],
      runtimeErrors: ["boom"],
    });
    expect(ds.map((d) => d.clase)).toEqual(["js", "desborde", "contraste"]);
  });
});

describe("redactarAviso — el sobre", () => {
  it("lleva la dirección literal, para que se pueda copiar a una op", () => {
    const texto = redactarAviso(defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "<div>",
      overflowCulpritOpId: "bs",
    }));
    expect(texto).toContain("[data-op-id=bs]");
  });

  it("dice al modelo que decide él, y cómo hablarle al usuario", () => {
    const texto = redactarAviso(defectosConDireccion({ runtimeErrors: ["boom"] })) ?? "";
    // No somos un reparador: se informa y decide el modelo.
    expect(texto).toContain("si era intencional");
    // Y la regla de cómo se le habla a una persona: nunca el data-op-id.
    expect(texto).toContain("nunca con el data-op-id");
  });

  it("se acota a cuatro defectos", () => {
    const ds = defectosConDireccion({
      runtimeErrors: ["a", "b", "c"],
      mobileOverflow: true,
      overflowCulprit: "<div>",
      overflowCulpritOpId: "d",
      unreadableText: [
        { contrast: 1, texto: "x", opId: "x" },
        { contrast: 2, texto: "y", opId: "y" },
      ],
    });
    expect(ds.length).toBeGreaterThan(4);
    const lineas = (redactarAviso(ds) ?? "").split("\n").filter((l) => l.startsWith("- "));
    expect(lineas).toHaveLength(4);
  });
});

describe("AvisosDelTurno — no repetirse, y saber callarse", () => {
  it("el mismo defecto se dice UNA vez", () => {
    const m: MedicionCruda = {
      mobileOverflow: true,
      overflowCulprit: "<div>",
      overflowCulpritOpId: "bs",
    };
    const a = new AvisosDelTurno();
    expect(a.nuevos(m)).toContain("data-op-id=bs");
    expect(a.nuevos(m)).toBeNull();
  });

  it("un defecto en OTRO nodo sí se dice", () => {
    const a = new AvisosDelTurno();
    a.nuevos({ mobileOverflow: true, overflowCulprit: "<div>", overflowCulpritOpId: "bs" });
    const segundo = a.nuevos({
      mobileOverflow: true,
      overflowCulprit: "<p>",
      overflowCulpritOpId: "zz",
    });
    expect(segundo).toContain("data-op-id=zz");
  });

  it("una página sana no gasta ni un token", () => {
    expect(new AvisosDelTurno().nuevos(sana)).toBeNull();
  });

  it("el fusible se funde a los tres fallos SEGUIDOS", () => {
    const a = new AvisosDelTurno();
    expect(a.fallo()).toBe(false);
    expect(a.fallo()).toBe(false);
    expect(a.apagado).toBe(false);
    expect(a.fallo()).toBe(true);
    expect(a.apagado).toBe(true);
  });

  it("una medición que sí corre vuelve a poner el contador a cero", () => {
    const a = new AvisosDelTurno();
    a.fallo();
    a.fallo();
    a.ok();
    a.fallo();
    a.fallo();
    expect(a.apagado).toBe(false);
  });
});
