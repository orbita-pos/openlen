import { describe, expect, it } from "vitest";

import {
  MAX_PASOS,
  avisoSpec,
  leerFallos,
  parseBehaviorSpec,
  specProgram,
  VENTANA_PRUEBA_MS,
  type PasoSpec,
  specRechazoAviso,
} from "./behavior-spec";

const RULETA = [{ clic: "#girar", entonces: [{ donde: "#resultado", que: "cambia" }] }];

describe("lo que el modelo puede prometer", () => {
  it("acepta la promesa de una ruleta", () => {
    const r = parseBehaviorSpec(RULETA);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos[0]!.clic).toBe("#girar");
    expect(r.pasos[0]!.veces).toBe(1);
  });

  it("acepta un carrito: tres clics y un total exacto", () => {
    const r = parseBehaviorSpec([
      { clic: "#add", veces: 3, entonces: [{ donde: "#total", que: "es", valor: "3" }] },
    ]);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos[0]!.veces).toBe(3);
  });

  it("acepta una calculadora: escribe y luego comprueba", () => {
    const r = parseBehaviorSpec([
      {
        escribe: { "#precio": "100" },
        clic: "#calcular",
        entonces: [{ donde: "#iva", que: "contiene", valor: "16" }],
      },
    ]);
    expect(r.kind).toBe("spec");
  });

  it("sin prueba no hay error — es opcional", () => {
    expect(parseBehaviorSpec(undefined).kind).toBe("ninguna");
    expect(parseBehaviorSpec(null).kind).toBe("ninguna");
  });
});

describe("lo que NO se acepta, y por qué", () => {
  // Mirar elementos quietos no comprueba una promesa de COMPORTAMIENTO —
  // comprueba el HTML. La regla es de la PRUEBA ENTERA, no de su primer paso.
  it("una prueba en la que NADIE pulsa ni escribe no prueba nada", () => {
    const r = parseBehaviorSpec([
      { entonces: [{ donde: "#x", que: "visible" }] },
      { entonces: [{ donde: "#y", que: "visible" }] },
    ]);
    // Sin `paso`: el defecto es de la lista, y colgarle un número mandaría al
    // modelo a arreglar un paso concreto que no tiene nada de malo.
    expect(r).toEqual({ kind: "error", reason: "sin_accion" });
  });

  // ⬆️ INVERTIDA el 2026-08-30. Antes esto exigía que el PRIMER paso actuara, y
  // MEDIDO dos veces en `contador-se-construye`: el modelo escribe «el contador
  // muestra 0» y luego «pulso +, muestra 1» — que es como se escribe una prueba
  // en cualquier parte. Le tirábamos la prueba entera, reintentaba, la volvía a
  // escribir igual, y agotaba `turn_limit`. Mejorar el TEXTO del rechazo no lo
  // arregló (se probó y salió peor: 123k → 148k tokens). No estaba
  // desinformado: escribía bien y la regla estaba mal.
  it("y un primer paso que sólo MIRA ya se acepta, si alguno actúa", () => {
    const r = parseBehaviorSpec([
      { entonces: [{ donde: "#cuenta", que: "es", valor: "0" }] },
      { clic: "#mas", entonces: [{ donde: "#cuenta", que: "es", valor: "1" }] },
    ]);
    expect(r.kind).toBe("spec");
    expect(r.kind === "spec" && r.pasos).toHaveLength(2);
  });

  // MEDIDO: el modelo escribe un paso que sólo mira DESPUÉS de uno que actúa
  // («…y además el resultado contiene "¡"»). Es una comprobación adicional
  // sobre el estado que dejó el anterior, y rechazarla tiraba 2 de cada 4
  // pruebas bien intencionadas.
  it("un paso posterior SÍ puede sólo comprobar", () => {
    const r = parseBehaviorSpec([
      { clic: "#girar", entonces: [{ donde: "#resultado", que: "cambia" }] },
      { entonces: [{ donde: "#resultado", que: "contiene", valor: "¡" }] },
    ]);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos).toHaveLength(2);
    expect(r.pasos[1]!.clic).toBeUndefined();
  });

  it("un paso sin expectativa tampoco", () => {
    expect(parseBehaviorSpec([{ clic: "#girar", entonces: [] }])).toEqual({
      kind: "error",
      reason: "sin_expectativa",
      paso: 1,
    });
  });

  it("«contiene» sin con qué comparar se rechaza", () => {
    const r = parseBehaviorSpec([
      { clic: "#a", entonces: [{ donde: "#b", que: "contiene" }] },
    ]);
    expect(r).toEqual({ kind: "error", reason: "falta_valor", paso: 1 });
  });

  // Un selector que casa con varios elementos hace la prueba ambigua, y una
  // prueba ambigua MIENTE — dice que pasó sobre un elemento que no era.
  it("un selector ambiguo o raro se rechaza", () => {
    for (const sel of ["#a, #b", "div:has(> p)", "*", "#a'); alert(1)//"]) {
      expect(parseBehaviorSpec([{ clic: sel, entonces: [{ donde: "#r", que: "cambia" }] }]).kind, sel)
        .toBe("error");
    }
  });

  // Rechazo ENTERO, nunca a medias: probar la mitad de la promesa y decir que
  // pasó es peor que no probar.
  it("un paso malo tumba la tanda entera", () => {
    const r = parseBehaviorSpec([
      { clic: "#bueno", entonces: [{ donde: "#r", que: "cambia" }] },
      { clic: "#a, #b", entonces: [{ donde: "#r", que: "cambia" }] },
    ]);
    expect(r.kind).toBe("error");
  });

  it("se acota el número de pasos y de clics", () => {
    const muchos = Array.from({ length: MAX_PASOS + 1 }, () => RULETA[0]);
    expect(parseBehaviorSpec(muchos)).toEqual({ kind: "error", reason: "demasiados_pasos" });
    // 999 clics es un bucle disfrazado — se recorta, no se rechaza.
    const r = parseBehaviorSpec([{ clic: "#a", veces: 999, entonces: [{ donde: "#r", que: "cambia" }] }]);
    expect(r.kind === "spec" && r.pasos[0]!.veces).toBe(10);
  });
});

describe("el programa que corre en el navegador", () => {
  // La trampa que costó una sesión: page.evaluate(() => …) pasa por esbuild,
  // que inyecta el ayudante `__name`, y `__name` no existe en el navegador.
  it("no lleva funciones NOMBRADAS (el ayudante __name no existe en Chrome)", () => {
    const p = specProgram(parseBehaviorSpec(RULETA).kind === "spec" ? RULETA as never : []);
    expect(p).not.toMatch(/function\s+[A-Za-z_$]/);
    expect(p).not.toContain("__name");
  });

  it("los pasos viajan como JSON, no interpolados en el código", () => {
    const p = specProgram([
      { clic: "#a", veces: 1, entonces: [{ donde: "#r", que: "es", valor: '");alert(1)//' }] },
    ]);
    // El valor hostil vive dentro de una cadena JSON, no como código suelto.
    expect(p).toContain("JSON.parse");
    expect(p).not.toMatch(/\);alert\(1\)\/\/"\s*[;)]/);
  });
});

describe("lo que devuelve el navegador", () => {
  it("se leen los fallos y el paso se cuenta desde 1 (como lo lee un humano)", () => {
    expect(leerFallos([[0, "#total no cambió"]])).toEqual([{ paso: 1, mensaje: "#total no cambió" }]);
  });

  // No medir NO es medir mal: cualquier forma inesperada se descarta en vez de
  // inventar un fallo.
  it("una respuesta rara no acusa a la página", () => {
    expect(leerFallos(null)).toEqual([]);
    expect(leerFallos("boom")).toEqual([]);
    expect(leerFallos([{ nope: 1 }])).toEqual([]);
  });
});

describe("los avisos", () => {
  it("el del modelo nombra el paso, el elemento, y le prohíbe cantar victoria", () => {
    const a = avisoSpec([{ paso: 1, mensaje: "#resultado no cambió" }]);
    expect(a).toContain("#resultado");
    expect(a).toMatch(/NO le digas al usuario que funciona/);
    // Y le dice que NO es sintaxis, o buscará el bug donde no está.
    expect(a).toMatch(/NO es un fallo de sintaxis/);
  });

  it("el del usuario dice que su cambio SÍ se guardó", () => {
    expect(specRechazoAviso("sin_accion")).toContain("El cambio sí se guardó");
  });

  // 🔴 UN RECHAZO QUE NO SE PUEDE ARREGLAR CUESTA EL TURNO ENTERO.
  //
  // MEDIDO el 2026-08-30 en la batería (`contador-se-construye`): el modelo
  // recibió cinco veces «un paso no hacía nada (ni pulsar ni escribir)»,
  // reintentó cinco veces, y agotó `turn_limit` sin acertar una sola. El aviso
  // llegaba —eso ya funcionaba— pero no decía QUÉ paso de los seis ni cuál era
  // la regla. Y la regla es asimétrica: sólo el PRIMERO necesita acción.
  describe("el rechazo dice dónde y cómo, no sólo qué", () => {
    it("nombra el paso que falló", () => {
      const r = parseBehaviorSpec([
        { clic: "#add", entonces: [{ donde: "#total", que: "cambia" }] },
        { entonces: [{ donde: "#total", que: "es" }] }, // 2º: sin `valor`
      ]);
      expect(r).toMatchObject({ kind: "error", reason: "falta_valor", paso: 2 });
      expect(specRechazoAviso("falta_valor", 2)).toContain("el paso 2");
    });

    it("y el de «nadie actúa» dice que sirve CUALQUIER paso", () => {
      const aviso = specRechazoAviso("sin_accion");
      expect(aviso).toMatch(/NINGÚN paso/);
      // La mitad que evita el malentendido caro: sin ella, «ponle acción al
      // primero» es la lectura natural — y era justo la regla equivocada.
      expect(aviso).toMatch(/no hace falta que sea el primero/);
      // Y no nombra un paso: el defecto es de la lista.
      expect(aviso).not.toMatch(/el paso \d/);
    });

    it("la entrada malformada tiene su propio motivo, y ése sí nombra el paso", () => {
      const r = parseBehaviorSpec([
        { clic: "#a", entonces: [{ donde: "#b", que: "cambia" }] },
        "esto no es un paso",
      ]);
      expect(r).toMatchObject({ kind: "error", reason: "paso_invalido", paso: 2 });
      // Antes esto también se llamaba `sin_accion`, así que al modelo se le
      // hablaba de acciones cuando lo roto era la FORMA.
      expect(specRechazoAviso("paso_invalido", 2)).toMatch(/el paso 2 no tiene la forma/);
    });

    // BRAZO DE CONTROL: los rechazos de la LISTA no hablan de un paso, y
    // colgarles uno inventado mandaría al modelo a mirar donde no es.
    it("pero un rechazo de la lista entera no inventa un paso", () => {
      expect(parseBehaviorSpec([])).toEqual({ kind: "error", reason: "vacia" });
      expect(specRechazoAviso("vacia")).not.toMatch(/el paso \d/);
    });
  });
});

// ── EN UN NAVEGADOR DE VERDAD ───────────────────────────────────────────────
//
// 🔴 El defecto que sólo se ve así, medido el 2026-08-23 sobre una página que
// DeepSeek acababa de escribir: un pomodoro CORRECTO —`setInterval(…, 1000)`,
// consola limpia, 24:59 al segundo— cuya propia prueba fallaba SIEMPRE, porque
// se comprobaba a los 0 ms. Ningún doble lo habría enseñado: el bug es el
// tiempo, y un `evaluate` simulado no tiene tiempo dentro.
describe("la ventana de espera, con Chrome", () => {
  const RELOJ = `<!doctype html><html><body>
<p id="reloj">25:00</p><button id="empezar">ir</button>
<script>document.getElementById("empezar").addEventListener("click", function () {
  setTimeout(function () { document.getElementById("reloj").textContent = "24:59"; }, 900);
});</script></body></html>`;

  const correr = async (html: string, pasos: readonly PasoSpec[]) => {
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      return leerFallos(await page.evaluate(specProgram(pasos)));
    } finally {
      await browser.close();
    }
  };

  it("un cambio que tarda 900 ms se da por bueno", async () => {
    const fallos = await correr(RELOJ, [
      { clic: "#empezar", veces: 1, entonces: [{ donde: "#reloj", que: "cambia" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 30_000);

  it("y un botón cableado a NADA sigue fallando — la ventana no perdona, espera", async () => {
    // El control arm. Sin él, «espera 1,5 s» podría estar tapando el fallo que
    // esto existe para encontrar en vez de esperando a que se cumpla.
    const mudo = RELOJ.replace('getElementById("empezar")', 'getElementById("empezarr")?');
    const fallos = await correr(mudo, [
      { clic: "#empezar", veces: 1, entonces: [{ donde: "#reloj", que: "cambia" }] },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("no cambió");
  }, 30_000);

  it("sale en cuanto se cumple: un paso que pasa al instante no paga la ventana", async () => {
    const instante = `<!doctype html><html><body><p id="r">a</p><button id="b">x</button>
<script>document.getElementById("b").addEventListener("click", function () {
  document.getElementById("r").textContent = "b";
});</script></body></html>`;
    const t0 = Date.now();
    const fallos = await correr(instante, [
      { clic: "#b", veces: 1, entonces: [{ donde: "#r", que: "es", valor: "b" }] },
    ]);
    expect(fallos).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(VENTANA_PRUEBA_MS + 10_000);
  }, 30_000);
});
