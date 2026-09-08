import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  AvisosDelTurno,
  componerMedicion,
  defectosConDireccion,
  medicionLimpia,
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

  // ⚰️ AQUÍ VIVÍA «la sonda puede culpar al nodo equivocado, y el aviso lo
  // advierte»: exigía la frase «sube al ancestro», que era el parche de una
  // sonda rota. Se arregló la sonda el 2026-09-06 —ahora gana el que llega más
  // lejos, y a igual alcance el más superficial, cuyo padre por construcción sí
  // cabe— así que la prueba pasó a sujetar una mentira. Lo que la sustituye NO
  // es una aserción sobre el texto: son dos pruebas de navegador en
  // `lib/ai/desborde-culpable.browser.test.ts`, que es donde vive la regla.
  it("el desborde nombra al elemento y no promete de más", () => {
    const [d] = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "section#tarjeta",
      overflowCulpritOpId: "z1",
    });
    expect(d?.frase).toContain("section#tarjeta");
    expect(d?.opId).toBe("z1");
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

  /**
   * LA CLASE MUERTA VA LA ÚLTIMA, y eso es la decisión, no un detalle de orden.
   *
   * Claude Code ordena sus diagnósticos por severidad y recorta POR ABAJO
   * (`M.diagnostics.sort(severity)` y luego `slice(0, 10)`), así que lo que
   * sobra del tope es siempre lo menos grave. Un script muerto deja la página
   * inerte; un desborde la deja fea; un contraste malo la deja ilegible para
   * algunos; una clase que no pinta le quita un matiz de color. Es la menos
   * grave de las cuatro y por eso es la primera que se cae si no cabe.
   */
  it("y la clase muerta va la última: es la menos grave de las cuatro", () => {
    const ds = defectosConDireccion({
      mobileOverflow: true,
      overflowCulprit: "<div>",
      overflowCulpritOpId: "d1",
      unreadableText: [{ contrast: 1.2, texto: "x", opId: "c1" }],
      runtimeErrors: ["boom"],
      clasesMuertas: [
        { enClase: "text-sm text( --ol-fg-muted )", muerta: "text( --ol-fg-muted )", enSuLugar: "text-[var(--ol-fg-muted)]" },
      ],
    });
    expect(ds.map((d) => d.clase)).toEqual(["js", "desborde", "contraste", "clase-muerta"]);
  });

  it("dice la clase literal y con qué se sustituye — se puede copiar tal cual", () => {
    const ds = defectosConDireccion({
      clasesMuertas: [
        { enClase: "mt-3 text-sm text( --ol-fg-muted )", muerta: "text( --ol-fg-muted )", enSuLugar: "text-[var(--ol-fg-muted)]" },
      ],
    });
    expect(ds).toHaveLength(1);
    expect(ds[0]!.frase).toContain("text( --ol-fg-muted )");
    expect(ds[0]!.frase).toContain("text-[var(--ol-fg-muted)]");
    // Sin `opId` a propósito: igual que un grito del JavaScript, su literal YA
    // es la dirección — se busca por la clase, no por el nodo.
    expect(ds[0]!.opId).toBeUndefined();
  });

  // 🔴 LA RESTA DE LÍNEA BASE, que es la mitad del valor: una clase muerta que
  // el modelo se encontró hecha no es suya, y decírsela es mandarle a arreglar
  // algo que no rompió en un turno que el usuario pidió para otra cosa. Es la
  // regla del `beforeFileEdited` de Claude Code, y sale gratis porque la base se
  // mide por la MISMA dependencia.
  it("🔴 una clase muerta preexistente no se le echa en cara", () => {
    const m = {
      clasesMuertas: [
        { enClase: "x", muerta: "bg( --ol-bg )", enSuLugar: "bg-[var(--ol-bg)]" },
      ],
    };
    const avisos = new AvisosDelTurno();
    const base = new Set(defectosConDireccion(m).map((d) => d.id));
    expect(avisos.nuevos(m, base)).toBeNull();
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

/**
 * 🔴 LOS CUATRO EJES LOS TIENEN QUE LLENAR LAS DOS IMPLEMENTACIONES.
 *
 * `medirParaElModelo` está escrito DOS veces —la ruta de producción y el arnés
 * de evals— y las dos tienen que producir la misma `MedicionCruda`. Si una añade
 * un eje y la otra no:
 *
 *   · la que se queda atrás deja de decir «limpio» para siempre (el eje sale
 *     `undefined` y `medicionLimpia` calla, con razón), y
 *   · el arnés mide un sobre que no es el que recibe el modelo en producción,
 *     que es justo lo que la cabecera de `harness.ts` prohíbe.
 *
 * Ya pasó con este mismo par: el arnés no enchufaba `medirParaElModelo` ni
 * `lineaBase`, y la deriva se descubrió el 2026-09-06 intentando medir si el
 * modelo arregla lo que se le devuelve — no se podía, porque en la batería el
 * aviso no llegaba. Se comprueba el FICHERO y no el tipo, porque TypeScript no
 * puede exigir que un campo opcional se rellene.
 */
describe("la medición que llega al modelo es la misma en las dos superficies", () => {
  const FUENTES: ReadonlyArray<readonly [string, string]> = [
    ["la ruta de producción", "app/api/agent/route.ts"],
    ["el arnés de evals", "lib/agent/evals/harness.ts"],
  ];

  it.each(FUENTES)("%s compone la medición con la MISMA función", (_, ruta) => {
    const src = readFileSync(join(process.cwd(), ruta), "utf8");
    expect(
      src,
      `${ruta} compone la medición por su cuenta en vez de con componerMedicion: ` +
        "es la normalización escrita dos veces, y una se queda vieja",
    ).toContain("componerMedicion(");
  });
});

/**
 * 🔴 LA REGRESIÓN DEL FALLO DE JUNTURA — 2026-09-08.
 *
 * `visual-quality-renderer` omite `runtimeErrors` cuando la página no gritó, y
 * `medicionLimpia` exige los cuatro ejes definidos. Las dos reglas correctas, y
 * en medio «medido, y limpio» no podía emitirse NUNCA en una página limpia —que
 * es el único caso para el que existe—. Lo destapó una corrida real: PASS con
 * «el aviso nunca se emitió».
 */
describe("componerMedicion — la juntura con el renderer", () => {
  /** Un render LIMPIO tal y como lo devuelve el renderer de verdad: sin
   *  `runtimeErrors`, porque no hubo ninguno. */
  const RENDER_LIMPIO = { mobileOverflow: false, unreadableText: [] };

  it("🔴 un render limpio SÍ puede decir «limpio» — era el fallo", () => {
    const m = componerMedicion(RENDER_LIMPIO, "<p>hola</p>");
    expect(m).not.toBeNull();
    expect(medicionLimpia(m), "el turno vuelve a callar en una página limpia").not.toBeNull();
  });

  it("un grito de verdad se conserva, no se pisa con un vacío", () => {
    const m = componerMedicion({ ...RENDER_LIMPIO, runtimeErrors: ["boom"] }, "<p>x</p>");
    expect(m!.runtimeErrors).toEqual(["boom"]);
    expect(medicionLimpia(m)).toBeNull();
  });

  it("añade el cuarto eje leyendo el documento", () => {
    const m = componerMedicion(RENDER_LIMPIO, '<p class="text( --ol-fg-muted )">x</p>');
    expect(m!.clasesMuertas).toHaveLength(1);
    // Y entonces la página NO está limpia.
    expect(medicionLimpia(m)).toBeNull();
  });

  // 🔴 Y NO SE NORMALIZAN LOS OTROS DOS. El renderer los devuelve SIEMPRE, así
  // que ausentes ahí sí significan «no se midió» — normalizarlos a ciegas sería
  // afirmar un cero que nadie miró, la avería que este fichero existe para no
  // cometer.
  it.each([
    ["el desborde", { unreadableText: [] }],
    ["el contraste", { mobileOverflow: false }],
  ])("🔴 si falta %s, sigue callando", (_, bruto) => {
    expect(medicionLimpia(componerMedicion(bruto, "<p>x</p>"))).toBeNull();
  });

  it("sin render no hay medición", () => {
    expect(componerMedicion(null, "<p>x</p>")).toBeNull();
    expect(componerMedicion(undefined, "<p>x</p>")).toBeNull();
  });
});

/**
 * 🔴 EL MARCADOR DEL SOBRE ES UN CONTRATO CON QUIEN LO LEE.
 *
 * El arnés de evals captura lo que se le dijo al modelo buscando
 * `<medido-tras-editar>` en los mensajes que recibe (`harness.ts`, en
 * `openStream`) — literal, para no recomponer el sobre y crear una segunda
 * copia de la decisión. Si alguien cambia esta etiqueta, la captura no falla:
 * se queda MUDA, y todo caso con `aviso` vuelve a dar un PASS que no distingue
 * «acertó a la primera» de «lo arregló porque se lo dijimos».
 *
 * Por eso las DOS formas del sobre tienen que llevarla, y el arnés tiene que
 * seguir buscando la misma.
 */
describe("el marcador que el arnés usa para capturar el aviso", () => {
  it("lo llevan las dos formas del sobre: la que reporta y la que dice «limpio»", () => {
    const conDefecto = redactarAviso(
      defectosConDireccion({ runtimeErrors: ["boom"] }),
    );
    const limpia = medicionLimpia({
      mobileOverflow: false,
      unreadableText: [],
      runtimeErrors: [],
      clasesMuertas: [],
    });
    expect(conDefecto).toContain("<medido-tras-editar>");
    expect(limpia).toContain("<medido-tras-editar>");
  });

  it("🔴 y el arnés sigue buscando esa misma etiqueta", () => {
    const arnes = readFileSync(join(process.cwd(), "lib/agent/evals/harness.ts"), "utf8");
    expect(
      arnes,
      "el arnés ya no busca `<medido-tras-editar>`: la captura del aviso quedó muda",
    ).toContain('c.includes("<medido-tras-editar>")');
  });
});

// LA MITAD QUE FALTABA: decir que se midió y salió limpio. Sin esto, una página
// sana produce SILENCIO, y el silencio no es evidencia — un evaluador aparte se
// negó (con razón) a dar por cumplida «no desborda en móvil» leyendo un turno
// donde el agente decía «listo» y no había medición detrás.
describe("medicionLimpia", () => {
  const LIMPIA = {
    mobileOverflow: false,
    unreadableText: [],
    runtimeErrors: [],
    clasesMuertas: [],
  };

  it("con los cuatro ejes medidos y a cero, lo dice", () => {
    const t = medicionLimpia(LIMPIA);
    expect(t).toContain("no encontró defectos");
    expect(t).toContain("<medido-tras-editar>");
  });

  // Sin esta frase, «limpio» se lee como «la página está bien», que es mucho
  // más de lo que tres medidas dicen.
  it("y escribe su propio límite", () => {
    expect(medicionLimpia(LIMPIA)).toContain("Eso es TODO lo que esta medición mira");
  });

  it.each([
    ["un desborde", { ...LIMPIA, mobileOverflow: true }],
    ["un texto ilegible", { ...LIMPIA, unreadableText: [{ contrast: 1.2 }] }],
    ["un error de JavaScript", { ...LIMPIA, runtimeErrors: ["boom"] }],
    [
      "una clase que no pinta nada",
      {
        ...LIMPIA,
        clasesMuertas: [
          { enClase: "text-sm text( --ol-fg-muted )", muerta: "text( --ol-fg-muted )", enSuLugar: "text-[var(--ol-fg-muted)]" },
        ],
      },
    ],
  ])("calla si hay %s", (_, m) => {
    expect(medicionLimpia(m)).toBeNull();
  });

  // 🔴 UN CAMPO AUSENTE NO ES UN CERO. Afirmar que algo salió a cero sin
  // haberlo mirado es la misma avería que este fichero existe para no cometer.
  it.each([
    ["el desborde", { unreadableText: [], runtimeErrors: [], clasesMuertas: [] }],
    ["el contraste", { mobileOverflow: false, runtimeErrors: [], clasesMuertas: [] }],
    ["el JavaScript", { mobileOverflow: false, unreadableText: [], clasesMuertas: [] }],
    ["las clases muertas", { mobileOverflow: false, unreadableText: [], runtimeErrors: [] }],
  ])("🔴 calla si NO se midió %s", (_, m) => {
    expect(medicionLimpia(m)).toBeNull();
  });

  // El límite escrito tiene que CRECER con los ejes. Si se añade una medida y la
  // frase sigue enumerando tres, «limpio» promete menos de lo que mira y —peor—
  // el modelo o un evaluador leen una lista que ya no es la lista.
  it("🔴 el límite que escribe nombra los CUATRO ejes, no tres", () => {
    const t = medicionLimpia({ ...LIMPIA, clasesMuertas: [] })!;
    expect(t).toContain("0 desbordes");
    expect(t).toContain("0 textos ilegibles");
    expect(t).toContain("0 errores de JavaScript");
    expect(t).toContain("0 clases");
  });

  it("sin medición no hay nada que afirmar", () => {
    expect(medicionLimpia(null)).toBeNull();
    expect(medicionLimpia(undefined)).toBeNull();
  });

  // 🔴 NO ES LO MISMO QUE `nuevos() === null`. Aquél resta la línea base, así
  // que también calla cuando la página ARRASTRA un defecto que el modelo se
  // encontró hecho. Decir «limpio» ahí sería mentir.
  it("🔴 un desborde preexistente NO es una página limpia", () => {
    const conDefecto = { ...LIMPIA, mobileOverflow: true, overflowCulprit: "div", overflowCulpritOpId: "n7" };
    const avisos = new AvisosDelTurno();
    // `nuevos` calla, porque el defecto ya estaba en la base...
    expect(avisos.nuevos(conDefecto, new Set(defectosConDireccion(conDefecto).map((d) => d.id)))).toBeNull();
    // ...y aun así la página NO está limpia.
    expect(medicionLimpia(conDefecto)).toBeNull();
  });
});
