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
  formaDePrueba,
  seguimientoDelRechazo,
  derivarClic,
  conDesplazaDerivado,
  conClicDerivado,
  conGrupoDerivado,
  claseDeSinAccion,
  avisoParaLaTarjeta,
  notaSpec,
  HECHO_SIN_COMPROBAR,
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

  // 🔴 LO QUE CAMBIA ES EL ASPECTO, NO EL TEXTO.
  //
  // Un botón que se marca como activo, una fila que se tacha, un tema que se
  // vuelve oscuro: ninguno cambia de texto ni de visibilidad, así que las cinco
  // formas anteriores no los ven. Y es justo el sitio donde vive el segundo
  // punto ciego medido del JavaScript del modelo — poner la clase y olvidar el
  // CSS del estado.
  it("acepta que:\"estilo\" con el NOMBRE de una propiedad", () => {
    const r = parseBehaviorSpec([
      { clic: "#tema", entonces: [{ donde: "body", que: "estilo", valor: "background-color" }] },
    ]);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos[0]!.entonces[0]).toEqual({
      donde: "body",
      que: "estilo",
      valor: "background-color",
    });
  });

  it("y también una variable de tema", () => {
    const r = parseBehaviorSpec([
      { clic: "#tema", entonces: [{ donde: "body", que: "estilo", valor: "--ol-bg" }] },
    ]);
    expect(r.kind).toBe("spec");
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

  // 🔴 «estilo» PIDE UN NOMBRE DE PROPIEDAD, y se comprueba AQUÍ y no en el
  // navegador. Un nombre inventado devuelve "" en las dos medidas —antes y
  // después— y el navegador lo leería como «no cambió»: la prueba acusaría a la
  // página de un fallo que es del nombre, y el modelo se pondría a reescribir
  // un script que está bien.
  it("«estilo» sin propiedad, o con algo que no es una propiedad, se rechaza", () => {
    for (const valor of [
      undefined,
      "",
      "background-color: red", // una declaración entera — la confusión natural
      "rgb(255, 0, 0)", // el valor en vez del nombre
      "BackgroundColor", // camelCase del DOM, no CSS
      "1",
    ]) {
      const r = parseBehaviorSpec([
        {
          clic: "#a",
          entonces: [{ donde: "#b", que: "estilo", ...(valor === undefined ? {} : { valor }) }],
        },
      ]);
      expect(r, `aceptó "${valor}"`).toEqual({ kind: "error", reason: "falta_valor", paso: 1 });
    }
  });

  it("y su aviso enseña la diferencia entre el nombre y el valor", () => {
    const aviso = specRechazoAviso("falta_valor", 1);
    expect(aviso).toContain("background-color");
    expect(aviso).toMatch(/NOMBRE/);
  });

  // ⚠️ ESTA REGLA SE MUDÓ AL NAVEGADOR el 2026-09-04, no se retiró.
  //
  // La protección sigue siendo la misma —un selector que casa con varios hace
  // la prueba ambigua, y una prueba ambigua MIENTE— pero ya no la decide una
  // regex en el servidor, sino `querySelectorAll(sel).length` dentro del
  // programa. Es la regla del `Edit` de Claude Code: casa una vez o falla.
  //
  // 🔴 POR QUÉ SE MUDÓ, medido sobre 16 páginas: de las 11 pruebas que el
  // modelo declaró, la regex tiró 2 BUENAS — entre ellas un `:nth-child(3)`,
  // que es la forma estándar de CSS de señalar UN elemento, o sea exactamente
  // lo que el prompt pedía. Y la regla que aplicábamos no era la que
  // decíamos: aceptaba `#reserva a` y rechazaba `…`.
  //
  // Aquí ya sólo se comprueba la cordura de tamaño. Lo demás —ambiguo,
  // inexistente, no-CSS— lo fija `prueba-selector.browser.test.ts`, donde de
  // verdad se ejecuta, y como fallo DE LA PRUEBA que no acusa a la página.
  it("un selector con forma rara ya NO se rechaza aquí: lo cuenta el navegador", () => {
    for (const sel of ["#a, #b", "div:has(> p)", "*", "#lista .fila:nth-child(3)"]) {
      expect(parseBehaviorSpec([{ clic: sel, entonces: [{ donde: "#r", que: "cambia" }] }]).kind, sel)
        .toBe("spec");
    }
  });

  it("pero una cadena vacía o kilométrica sigue siendo basura", () => {
    for (const sel of ["", "   ", "#" + "a".repeat(90), "#a\nb"]) {
      expect(parseBehaviorSpec([{ clic: sel, entonces: [{ donde: "#r", que: "cambia" }] }]).kind, JSON.stringify(sel))
        .toBe("error");
    }
  });

  // Rechazo ENTERO, nunca a medias: probar la mitad de la promesa y decir que
  // pasó es peor que no probar.
  it("un paso malo tumba la tanda entera", () => {
    const r = parseBehaviorSpec([
      { clic: "#bueno", entonces: [{ donde: "#r", que: "cambia" }] },
      { clic: "", entonces: [{ donde: "#r", que: "cambia" }] },
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

  // 🔴 UN FALLO DEL INSTRUMENTO NO ACUSA AL SUJETO.
  //
  // `deLaPrueba` lo ponía `leerFallos` y lo leía UN solo sitio —el `break` que
  // evita reintentar—. Las dos frases lo ignoraban, así que un selector que no
  // resuelve salía como «tu página no cumple lo prometido» en los dos canales.
  //
  // MEDIDO EN PRODUCCIÓN el 2026-09-21 (`projectChatMessages`, 40 turnos con
  // verificación): 2 pruebas declaradas fallidas, **2 de 2 del instrumento**,
  // las 2 pidiéndole al dueño que revisara una página sana. Con los 3 del
  // 2026-09-04 van 0 de 5 aciertos acusando. Es la disciplina del `Edit` de
  // Claude Code: cuando la comprobación no sostiene la acusación, no acusa.
  describe("un fallo DE LA PRUEBA no se cuenta como fallo de la página", () => {
    const delInstrumento = [
      { paso: 1, mensaje: "#carrusel .swiper-slide señala 10 elementos, no uno", deLaPrueba: true },
    ] as const;
    const deLaPagina = [{ paso: 1, mensaje: "#resultado no cambió" }] as const;

    it("al usuario: no habla de la página y NO ofrece revisarla", () => {
      const n = notaSpec(delInstrumento);
      expect(n).toMatch(/no llegó a correr/);
      expect(n).toMatch(/no dice nada sobre la página/);
      // La oferta es la que mandaba a perseguir un fallo inexistente.
      expect(n).not.toMatch(/dime si quieres que lo revise/);
      // Y el hecho medido viaja igual: se dice lo que se vio.
      expect(n).toContain("señala 10 elementos, no uno");
    });

    it("al modelo: le PROHÍBE tocar el runtime y le nombra el arreglo", () => {
      const a = avisoSpec(delInstrumento);
      expect(a).toMatch(/NO toques el runtime/);
      expect(a).toMatch(/señale UN elemento/);
      // Éste es el canal que aún edita (`ai-design`): mandarlo a reescribir el
      // script por un selector malo es reescribir código que funciona.
      expect(a).not.toMatch(/edit target="runtime" que lleve el script COMPLETO/);
    });

    it("un fallo de verdad de la página sigue acusando igual", () => {
      expect(notaSpec(deLaPagina)).toMatch(/no se cumplió/);
      expect(notaSpec(deLaPagina)).toMatch(/dime si quieres que lo revise/);
      expect(avisoSpec(deLaPagina)).toMatch(/target="runtime"/);
    });

    it("mezclados: cada mitad se atribuye a quien es", () => {
      const n = notaSpec([...deLaPagina, ...delInstrumento]);
      expect(n).toMatch(/no se cumplió/);
      expect(n).toMatch(/falló en mi comprobación, no en la página/);
      // El fallo real NO se diluye: la página sigue señalada.
      expect(n).toContain("#resultado no cambió");
    });
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

  // ── LAS DOS MITADES, medidas ───────────────────────────────────────────────
  //
  // 🔴 EL FALLO QUE `estilo` EXISTE PARA VER. El script pone la clase, el CSS
  // no la define: se ejecuta, no lanza, la consola queda limpia, y el control
  // nace MUDO. Ninguna de las otras cinco formas lo ve — el texto no cambia, y
  // el elemento se sigue viendo igual de bien antes y después.
  //
  // Las dos páginas de abajo son IDÉNTICAS salvo por una regla de CSS. Ésa es
  // toda la diferencia entre un tema que funciona y uno que no, y hasta hoy
  // ninguna prueba del repo podía distinguirlas.
  const TEMA = (conCss: boolean) => `<!doctype html><html><head><style>
body { background: #ffffff; }
${conCss ? "body.oscuro { background: #101014; }" : ""}
</style></head><body>
<p id="titulo">Mi Negocio</p><button id="tema">tema</button>
<script>document.getElementById("tema").addEventListener("click", function () {
  document.body.classList.toggle("oscuro");
});</script></body></html>`;

  it("ve el cambio de aspecto cuando el CSS del estado SÍ existe", async () => {
    const fallos = await correr(TEMA(true), [
      { clic: "#tema", veces: 1, entonces: [{ donde: "body", que: "estilo", valor: "background-color" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 30_000);

  it("🔴 y CAZA el control mudo: la clase se pone y el CSS no la define", async () => {
    const fallos = await correr(TEMA(false), [
      { clic: "#tema", veces: 1, entonces: [{ donde: "body", que: "estilo", valor: "background-color" }] },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("no cambió su background-color");
  }, 30_000);

  it("y las otras cinco formas NO lo ven — por eso hacía falta la sexta", async () => {
    // El mismo botón mudo, comprobado como se podía comprobar hasta hoy: el
    // texto no cambia y el elemento se ve igual, así que `cambia`, `visible` y
    // compañía dan la página por buena. Esto no es un detalle de esta prueba:
    // es la razón de existir de `estilo`, y sin dejarlo escrito alguien la
    // borrará por redundante.
    const fallosVisible = await correr(TEMA(false), [
      { clic: "#tema", veces: 1, entonces: [{ donde: "body", que: "visible" }] },
    ]);
    expect(fallosVisible).toEqual([]);
  }, 30_000);

  it("un nombre de propiedad que el navegador no conoce se dice como tal, no como «no cambió»", async () => {
    const fallos = await correr(TEMA(true), [
      { clic: "#tema", veces: 1, entonces: [{ donde: "body", que: "estilo", valor: "--no-existe" }] },
    ]);
    expect(fallos).toHaveLength(1);
    // Acusar a la página de un fallo que es del nombre manda al modelo a
    // reescribir un script que está bien.
    expect(fallos[0]!.mensaje).toContain("no tiene la propiedad");
  }, 30_000);
});

// ─── LA CLAVE QUE SOBRA, DICHA POR SU NOMBRE ────────────────────────────────
//
// El analizador ignoraba en silencio las claves que no conoce. Si el modelo
// escribía `click` en vez de `clic`, la prueba salía `sin_accion` y el aviso
// decía «NINGÚN paso pulsa ni escribe» — a un modelo que creía estar pulsando.
// MEDIDO el 2026-09-17: `sin_accion` en casi todas las vueltas del carrito, y
// un turno que se quedó sin pasos reintentando la prueba sin ningún otro
// rechazo. Claude Code valida con el esquema y NOMBRA la clave:
describe("las claves que no existen", () => {
  const MIRA = { donde: "#total", que: "cambia" };

  it("un rechazo nombra las claves que sobran, con su ruta", () => {
    const r = parseBehaviorSpec([{ click: "#add", entonces: [{ ...MIRA, esperado: "1" }] }]);
    expect(r).toEqual({
      kind: "error",
      reason: "sin_accion",
      desconocidas: ["prueba[0].click", "prueba[0].entonces[0].esperado"],
    });
  });

  it("y el aviso se las dice al modelo junto con las buenas", () => {
    const aviso = specRechazoAviso("sin_accion", undefined, ["prueba[0].click"]);
    expect(aviso).toContain("`prueba[0].click`");
    expect(aviso).toContain("clic, veces, escribe y entonces");
    expect(aviso).toContain("donde, que y valor");
  });

  // No se vuelve más estricto: una clave de más en una prueba que SÍ se puede
  // correr no la tira. Rechazar entero por un adorno sería el defecto de
  // «descartadas en la puerta» que este fichero ya bajó una vez.
  it("una prueba buena con una clave de más sigue siendo buena", () => {
    expect(parseBehaviorSpec([{ clic: "#add", nota: "x", entonces: [MIRA] }]).kind).toBe("spec");
  });

  it("sin claves de más, el rechazo no cambia de forma", () => {
    expect(parseBehaviorSpec([{ entonces: [MIRA] }])).toEqual({ kind: "error", reason: "sin_accion" });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DERIVAR EL CLIC EN VEZ DE PEDIRLO (2026-09-19).
  //
  // 🔴 POR QUÉ, con tres medidas y no con una idea: `sin_accion` —una promesa
  // cuyos pasos sólo MIRAN y no pulsan— salió el 17/09 en casi todas las
  // vueltas del carrito, el 18/09 en producción, y el 19/09 en la corrida de
  // dos turnos del escenario `carrito`, donde además el contador dijo
  // `sigue_mal`: el modelo recibió el aviso con la corrección pegada y repitió
  // la misma forma. La maquinaria que consume la promesa funciona; el modelo
  // no la alimenta.
  //
  // LA VARA ES CLAUDE CODE. Allí, una entrada que no valida se
  // intenta REPARAR antes de juzgarla, y sólo si sigue mal se devuelve el error
  // con su steer. Aquí la reparación es posible sin inventar nada: el
  // JavaScript que el modelo ACABA DE ESCRIBIR dice qué elemento responde a un
  // clic. No se adivina — se lee su propio código.
  describe("derivarClic", () => {
    it("🔴 lee el elemento que el runtime cablea a un clic", () => {
      const runtime = `
        var n = 0;
        document.getElementById("agregar").addEventListener("click", function () {
          n += 1; document.getElementById("total").textContent = n + " €";
        });`;
      expect(derivarClic(runtime)).toBe("#agregar");
    });

    it("🔴 vale también con querySelector y con la variable de por medio", () => {
      const runtime = `
        var boton = document.querySelector("#añadir-pieza");
        boton.addEventListener("click", pintar);`;
      expect(derivarClic(runtime)).toBe("#añadir-pieza");
    });

    // Delegación: el id aparece DESPUÉS del listener. Es la forma que más usa
    // el modelo cuando pinta la lista entera en cada cambio.
    it("lo encuentra aunque el id venga detrás (delegación)", () => {
      const runtime = `
        document.addEventListener("click", function (e) {
          if (e.target.closest("#vaciar")) vaciar();
        });`;
      expect(derivarClic(runtime)).toBe("#vaciar");
    });

    // 🔴 NO SE PULSA LO QUE SE MIRA. Si la promesa vigila `#total`, pulsar
    // `#total` comprobaría que un elemento se cambia a sí mismo: pasaría
    // siempre o nunca, y las dos cosas son inútiles.
    it("🔴 evita los selectores que la promesa ya vigila", () => {
      const runtime = `
        document.getElementById("total").addEventListener("click", nada);
        document.getElementById("agregar").addEventListener("click", sumar);`;
      expect(derivarClic(runtime, ["#total"])).toBe("#agregar");
    });

    // CONTRA-PRUEBA: sin nada que pulsar NO se inventa un selector. Devolver
    // uno a ciegas convertiría una promesa mal escrita en una promesa FALSA,
    // que es peor: entraría en la suite y acusaría a la página desde dentro.
    it("🔴 CONTRA-PRUEBA: si el runtime no cablea ningún clic, no se inventa", () => {
      expect(derivarClic("var x = 1; setInterval(tic, 1000);")).toBeNull();
      expect(derivarClic("")).toBeNull();
    });
  });

  describe("conClicDerivado", () => {
    const SIN_ACCION = [
      { entonces: [{ donde: "#total", que: "cambia" }] },
      { entonces: [{ donde: "#lista", que: "contiene", valor: "Mesa" }] },
    ];
    const RUNTIME = `document.getElementById("agregar").addEventListener("click", sumar);`;

    it("🔴 le pone el clic al PRIMER paso y deja los demás", () => {
      const reparada = conClicDerivado(SIN_ACCION, RUNTIME) as typeof SIN_ACCION;
      expect(reparada).not.toBeNull();
      expect((reparada[0] as { clic?: string }).clic).toBe("#agregar");
      expect(reparada[1]).toEqual(SIN_ACCION[1]);
    });

    // Y LO QUE IMPORTA: que lo reparado PASE. Una reparación que no convierte
    // el rechazo en una promesa válida no ha reparado nada.
    it("🔴 lo reparado ya pasa el validador", () => {
      expect(parseBehaviorSpec(SIN_ACCION).kind).toBe("error");
      expect(parseBehaviorSpec(conClicDerivado(SIN_ACCION, RUNTIME)).kind).toBe("spec");
    });

    it("CONTRA-PRUEBA: una promesa que YA pulsa no se toca", () => {
      expect(conClicDerivado(RULETA, RUNTIME)).toBeNull();
    });

    it("CONTRA-PRUEBA: sin runtime que leer, no hay reparación", () => {
      expect(conClicDerivado(SIN_ACCION, "")).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LO QUE LEE EL DUEÑO ES OTRO SUJETO (2026-09-18).
  //
  // La tarjeta ámbar estrenó enseñando el aviso del MODELO: «NINGÚN paso pulsa
  // ni escribe… dale a alguno un `clic:"#selector"`». Eso explica por qué
  // tiramos NUESTRA prueba; al dueño no le sirve de nada — él no manda pruebas.
  //
  // LA VARA, vista en Claude Code: cuando no se puede observar si algo ocurrió,
  // no dicen «hecho» ni «falló», dicen NO CONFIRMADO, nombran qué se ignora y
  // dicen qué hacer: «…» Tres piezas, y la tercera cambia según quién lee: el
  // modelo tiene que rehacer la prueba, el dueño tiene que pulsar el botón.
  //
  // 🔴 EL HECHO ES UNO Y SE COMPARTE, que es la regla de siempre: dos
  // redacciones del mismo suceso son dos verdades. Lo que cambia es el paso
  // siguiente, no lo ocurrido — por eso las dos salen de la misma constante y
  // esta prueba lo vigila.
  describe("avisoParaLaTarjeta", () => {
    it("🔴 le habla al dueño: qué no se comprobó y qué hacer", () => {
      const aviso = avisoParaLaTarjeta();
      expect(aviso).toContain("el cambio se guardó");
      expect(aviso).toMatch(/pruéba|comprueba/i);
      // Nada de la receta del modelo: el dueño no manda `clic` ni `entonces`.
      expect(aviso).not.toContain("clic:");
      expect(aviso).not.toContain("entonces");
    });

    it("🔴 el HECHO es el mismo que lee el modelo, palabra por palabra", () => {
      expect(avisoParaLaTarjeta()).toContain(HECHO_SIN_COMPROBAR);
      expect(specRechazoAviso("sin_accion")).toContain(HECHO_SIN_COMPROBAR);
    });

    // Cabe en la línea de una tarjeta sin comerse el resto de la fila.
    it("cabe en una tarjeta", () => {
      expect(avisoParaLaTarjeta().length).toBeLessThan(180);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL SEGUIMIENTO DEL RECHAZO (2026-09-18).
  //
  // Es el peldaño que Claude Code tiene y aquí faltaba. Allí, cuando la entrada
  // del modelo viene mal, se cuenta si el intento siguiente quedó bien o sigue
  // mal. Aquí eso no existía, y por eso que `sin_accion` saliera «en casi todas las
  // vueltas del carrito» se supo porque alguien leyó los logs a mano el 17/09.
  //
  // No juzga la prueba: sólo compara el rechazo de antes con el de ahora.
  describe("seguimientoDelRechazo", () => {
    it("🔴 sin rechazo previo no hay nada que contar", () => {
      expect(seguimientoDelRechazo(null, "sin_accion")).toBeNull();
      expect(seguimientoDelRechazo(undefined, null)).toBeNull();
    });

    it("🔴 el intento que ya no lo trae ARREGLÓ el anterior", () => {
      expect(seguimientoDelRechazo("sin_accion", null)).toBe("arreglada");
    });

    it("🔴 el mismo motivo otra vez es el caso que hay que ver venir", () => {
      expect(seguimientoDelRechazo("sin_accion", "sin_accion")).toBe("sigue_mal");
    });

    // Distinto motivo NO es «sigue mal»: el modelo movió algo, sólo que se
    // dejó otra cosa. Contarlos juntos escondería la diferencia entre un
    // modelo que no entiende el aviso y uno que va acercándose.
    it("un motivo distinto se cuenta aparte", () => {
      expect(seguimientoDelRechazo("sin_accion", "sin_expectativa")).toBe("otro_motivo");
    });
  });

  // Para el log: la FORMA de lo que llegó, sin los valores.
  it("formaDePrueba resume la estructura", () => {
    expect(formaDePrueba([{ click: "#a", entonces: [MIRA, MIRA] }, { entonces: [MIRA] }])).toBe(
      "[{click,entonces[2]},{entonces[1]}]",
    );
    expect(formaDePrueba('[{"clic":"#a"}]')).toBe("string(15)");
    expect(formaDePrueba(undefined)).toBe("undefined");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 `desplaza` — LA ACCIÓN DE LO QUE SE DISPARA SOLO (2026-09-21).
//
// MEDIDO en una corrida de la batería, caso `contador-se-construye` («los
// números suben solos CUANDO SE VEAN»): el runtime salió con 0 listeners de
// clic —un IntersectionObserver no cablea ninguno— así que la prueba sólo podía
// MIRAR, `sin_accion` la rechazó, y al reintentar el modelo mandó lo mismo.
// La regla era insatisfacible para esa familia entera.
//
// UN VERBO Y NO UNA EXENCIÓN: una exención vuelve la regla instatable («algún
// paso debe actuar, salvo cuando…») y ya está medido lo que cuesta eso —cinco
// reintentos y `turn_limit`, 2026-08-30, este MISMO caso—. Es la forma de
// Claude Code al quedarse corto de vocabulario (`replace_all`, `pages`,
// `run_in_background`): un parámetro explícito, nunca una precondición floja.
describe("desplaza, el verbo de lo que se dispara al verse", () => {
  it("🔴 una prueba que SÓLO desplaza ya es una acción — antes se rechazaba", () => {
    const r = parseBehaviorSpec([{ desplaza: "#numeros", entonces: [{ donde: "#numeros", que: "cambia" }] }]);
    expect(r.kind).toBe("spec");
    if (r.kind === "spec") expect(r.pasos[0]!.desplaza).toBe("#numeros");
  });

  // CONTRA-PRUEBA: la regla NO se ha aflojado. Un paso que sólo mira sigue
  // siendo `sin_accion`, que es lo único que esa regla existe para cazar.
  it("CONTRA-PRUEBA: mirar y ya sigue siendo sin_accion", () => {
    const r = parseBehaviorSpec([{ entonces: [{ donde: "#numeros", que: "cambia" }] }]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("sin_accion");
  });

  // ⚠️ LA FORMA DEL SELECTOR SE MUDÓ AL NAVEGADOR el 2026-09-04 (ver arriba),
  // así que aquí no se rechaza: sólo queda la cordura de tamaño. Lo que SÍ hay
  // que clavar es la PARIDAD — `desplaza` tiene que recibir exactamente el
  // mismo trato que `clic`, o tendríamos dos reglas para la misma cosa y el
  // modelo no podría saber cuál aplica.
  it("desplaza recibe el MISMO trato que clic para cualquier selector", () => {
    for (const sel of ["#ok", "<<>>", ".a .b", "", "x".repeat(400)]) {
      const conClic = parseBehaviorSpec([
        { clic: sel, entonces: [{ donde: "#n", que: "cambia" }] },
      ]);
      const conDesplaza = parseBehaviorSpec([
        { desplaza: sel, entonces: [{ donde: "#n", que: "cambia" }] },
      ]);
      expect(conDesplaza.kind, `divergen con "${sel.slice(0, 20)}"`).toBe(conClic.kind);
      if (conClic.kind === "error" && conDesplaza.kind === "error") {
        expect(conDesplaza.reason).toBe(conClic.reason);
      }
    }
  });

  it("y el aviso del rechazo NOMBRA el verbo, o el modelo no puede usarlo", () => {
    expect(specRechazoAviso("sin_accion")).toContain("desplaza");
  });

  // 🔴 NOMBRARLO NO BASTA: TIENE QUE LLEGAR ANTES QUE LA ALTERNATIVA.
  //
  // MEDIDO el 21/09 sobre el aviso de entonces: 456 caracteres, `clic` en el
  // 122 y `desplaza` en el 362 — o sea, la frase decía DOS VECES «dale a
  // alguno un clic» antes de mencionar la única salida que ese caso tenía. Y
  // el modelo, tras el rechazo, mandó `clic`. El diagnóstico no era «falta
  // decirlo» sino «está dicho en el sitio equivocado».
  // 🔴 EL STEER TIENE QUE NOMBRAR LA SALIDA QUE LA PÁGINA SÍ TIENE.
  //
  // MEDIDO por ssh el 21/09: 9 de 16 llamadas a `editar_runtime` en producción
  // salen `sin_accion`, en 4 proyectos. Tres de esos cuatro cablean los
  // botones con `createElement` y NO tienen id —leído en la página de un
  // usuario: `…` sobre un botón sin id—. Y este
  // aviso les decía `clic:"#selector"`: le señalábamos al modelo justo lo que
  // su página no tiene.
  //
  // La salida existe, el catálogo la manda (regla 5: nombrar el botón POR SU
  // TEXTO) y el navegador la resuelve (`porNombre`). Faltaba aquí, que es
  // donde el modelo la necesita.
  //
  // Es la forma de Claude Code: cuando no se puede reparar la entrada, se
  // nombra la regla Y la forma correcta de la llamada.
  // 🔴 Y REDIRIGE A LA OTRA RUTA, que es como Claude Code saca a alguien de una
  // herramienta que no encaja: el error dice que ese fichero no es un cuaderno
  // y nombra la herramienta que sí sirve. No anuncia más fuerte: nombra la
  // salida en el punto del fallo.
  //
  // Medido el 21/09: con las dos rutas ofrecidas en la descripción, 0 de 4
  // casos usaron `prueba_js` — y el bloque llega en el carácter 3039 de 4592.
  // Aquí llega cuando el DSL acaba de no servirle.
  it("🔴 y redirige a `prueba_js` cuando el DSL no da para expresarlo", () => {
    expect(specRechazoAviso("sin_accion")).toContain("prueba_js");
  });

  it("🔴 el aviso ofrece nombrar el botón por su TEXTO, no sólo un #id", () => {
    const aviso = specRechazoAviso("sin_accion");
    expect(aviso).toMatch(/texto/i);
  });

  // 🔴 Y SIN PUNTO DOBLE. Lo dejó la reescritura del orden: `specRechazoAviso`
  // COMPONE la frase entera —se remata ella sola con « El cambio sí se
  // guardó.»— así que un motivo que ya acabe en punto produce «primero.. El».
  // Se comprueba en TODOS los motivos, no sólo en el que se tocó: el defecto
  // es de la composición, y el siguiente que se reescriba lo repetiría.
  it("ningún motivo produce un punto doble al componerse", () => {
    for (const motivo of [
      "sin_accion", "sin_expectativa", "falta_valor", "demasiados_pasos",
      "paso_invalido", "vacia",
    ] as const) {
      const a = specRechazoAviso(motivo as never, 1);
      expect(a, `«${motivo}» produce ".." en: ${a.slice(0, 90)}`).not.toMatch(/\.\./);
    }
  });

  it("🔴 y `desplaza` llega ANTES que `clic`: el orden era el defecto", () => {
    const aviso = specRechazoAviso("sin_accion");
    const donde = aviso.indexOf("desplaza");
    const alterno = aviso.indexOf("clic");
    expect(donde).toBeGreaterThanOrEqual(0);
    expect(donde, `desplaza en ${donde}, clic en ${alterno}`).toBeLessThan(alterno);
  });
});

// LA PRUEBA QUE DE VERDAD LO DEMUESTRA: un IntersectionObserver REAL, en
// Chromium. Sin esto, todo lo de arriba sólo comprueba que el validador acepta
// una clave — no que el scroll ARRANQUE nada.
describe("desplaza, contra un IntersectionObserver de verdad", () => {
  // El contador vive 2.000px más abajo, o sea fuera del viewport al cargar.
  const CONTADOR = `<!doctype html><html><body>
<div style="height:2000px">relleno</div>
<p id="numeros">0</p>
<script>
new IntersectionObserver(function (es) {
  if (es[0].isIntersecting) document.getElementById("numeros").textContent = "5000";
}).observe(document.getElementById("numeros"));
<\/script></body></html>`;

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

  it("🔴 desplazar hasta el contador lo ARRANCA y la promesa se cumple", async () => {
    const fallos = await correr(CONTADOR, [
      { desplaza: "#numeros", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 30_000);

  // 🔴 EL BRAZO DE CONTROL, y sin él lo de arriba no prueba nada: si el paso
  // pasara por esperar y no por desplazar, esta misma prueba saldría verde con
  // un runtime que no hace nada. Aquí el observer no existe, así que el número
  // no cambia por mucho que se desplace.
  it("CONTROL: sin el observer, desplazar no cambia nada y falla", async () => {
    const mudo = CONTADOR.replace("new IntersectionObserver", "window.noop || function(){};(");
    const fallos = await correr(mudo, [
      { desplaza: "#numeros", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("no cambió");
  }, 30_000);

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 ¿PUEDE UNA PROMESA CUMPLIRSE SIN PROBAR NADA? (sospecha del 2026-09-21)
  //
  // El caso `contador-se-construye` salió CUMPLIDO con una prueba de forma
  // `[{clic,veces,entonces[1]}]` sobre un runtime de 0 listeners de clic. La
  // sospecha: `cambia` compara contra una foto tomada ANTES de la acción y sale
  // en cuanto algo se mueve — sin comprobar que lo haya movido la acción. Un
  // contador que se anima solo lo satisface, y el clic es decorativo.
  //
  // Esto NO es una opinión sobre el modelo: es una propiedad de `specProgram`,
  // y por eso se mide aquí, en Chromium, gratis y repetible, en vez de pagar
  // una corrida que daría una muestra sola y no reproducible.
  //
  // El contador SE VE al cargar (no hay relleno delante), así que el observer
  // se dispara por su cuenta: es justo el escenario de una prueba con `clic`
  // que nunca desplaza nada.
  const ANIMADO = (cuerpoBoton: string) => `<!doctype html><html><body>
<p id="numeros">0</p>
<button id="boton">Ver</button>
<script>
${cuerpoBoton}
new IntersectionObserver(function (es) {
  if (!es[0].isIntersecting) return;
  var n = 0;
  var t = setInterval(function () {
    n += 400;
    document.getElementById("numeros").textContent = String(n);
    if (n >= 5000) clearInterval(t);
  }, 100);
}).observe(document.getElementById("numeros"));
<\/script></body></html>`;

  // ⚠️ ESTO MIDE EL PROGRAMA DESNUDO, SIN EL CENSO. `correr` usa `setContent`,
  // donde `evaluateOnNewDocument` no llega a instalarse, así que el registro no
  // existe y la precondición es fail-open — que es justo lo que este caso fija:
  // sin censo, el agujero sigue abierto. Con censo se cierra, y eso se mide en
  // `censo-de-clic.browser.test.ts`, que navega de verdad.
  it("🔴 SIN CENSO, un clic sobre un botón MUERTO cumple la promesa igual", async () => {
    const fallos = await correr(ANIMADO(""), [
      { clic: "#boton", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 30_000);

  // 🔴 EL BRAZO DE CONTROL, y sin él lo de arriba no demuestra nada: si el paso
  // pasara por cualquier motivo del arnés, esto saldría verde también. Mismo
  // botón muerto, mismo clic, mismo `cambia` — pero sin nada que se anime. Si
  // falla, lo que hizo pasar al de arriba fue la animación y sólo la animación.
  it("CONTROL: el MISMO botón muerto, sin animación, falla — el clic no movía nada", async () => {
    const quieto = ANIMADO("").replace("new IntersectionObserver", "window.noop || function(){};(");
    const fallos = await correr(quieto, [
      { clic: "#boton", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("no cambió");
  }, 30_000);

  // 🔴 Y NO ES COSA DE `cambia`. Ése al menos toma una foto de ANTES, así que
  // exige que algo se mueva. `contiene`, `es`, `visible` y `oculto` se miden en
  // absoluto contra el estado de AHORA: si la página ya cumple al cargar, el
  // bucle sale en la primera vuelta y la promesa se da por buena sin que la
  // acción haya tenido que hacer nada. Aquí el botón también está muerto Y el
  // texto ya estaba puesto de antemano.
  it("🔴 `contiene` ni siquiera necesita que nada se mueva: si ya se cumplía, pasa", async () => {
    const yaPuesto = `<!doctype html><html><body>
<div id="exito">¡Gracias!</div><button id="boton">Enviar</button>
</body></html>`;
    const fallos = await correr(yaPuesto, [
      { clic: "#boton", veces: 1, entonces: [{ donde: "#exito", que: "contiene", valor: "Gracias" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ¿PUEDE EXISTIR LA PRECONDICIÓN? — el censo de manejadores (2026-09-21)
//
// La forma de Claude Code para «esta acción no puede hacer nada» NO es medir el
// mundo después: es que la acción FALLE antes. Provocado en el propio arnés:
//
//   → «No changes to make: old_string and new_string are exactly the same.»
//
// y el contrato lo dice en voz alta: «…» O sea, la
// acción reporta su propio efecto; nadie observa el mundo para deducirlo.
//
// El análogo aquí: un `clic` cuya cadena ENTERA (elemento → ancestros →
// document) no tiene un solo manejador de clic es `…` — un fallo DEL INSTRUMENTO, que no acusa a la página.
//
// Esto NO lo implementa: MIDE si se puede implementar sin mentir. Dos cosas que
// tienen que salir bien o la precondición no vale.
describe("el censo de manejadores de clic, medido por CDP", () => {
  // La cadena hacia ARRIBA. `DOMDebugger.getEventListeners` con `depth:-1` baja
  // por el subárbol, NO sube — medido: la delegación salía 0 y habría acusado
  // en falso a un botón vivo, que es el defecto de 0-de-5 otra vez.
  const censoDeClic = async (client: any, sel: string): Promise<number> => {
    const { result: largo } = await client.send("Runtime.evaluate", {
      expression: `(() => { var n = 0, e = document.querySelector(${JSON.stringify(sel)});
        while (e) { n++; e = e.parentElement; } return n + 1; })()`,
    });
    const { result: cadena } = await client.send("Runtime.evaluate", {
      expression: `(() => { var o = [], e = document.querySelector(${JSON.stringify(sel)});
        while (e) { o.push(e); e = e.parentElement; } o.push(document); return o; })()`,
    });
    let total = 0;
    for (let i = 0; i < Number(largo.value); i++) {
      const { result: nodo } = await client.send("Runtime.callFunctionOn", {
        functionDeclaration: "function (i) { return this[i]; }",
        objectId: cadena.objectId,
        arguments: [{ value: i }],
      });
      if (!nodo.objectId) continue;
      const r = await client.send("DOMDebugger.getEventListeners", { objectId: nodo.objectId });
      total += (r.listeners ?? []).filter((l: { type: string }) => l.type === "click").length;
    }
    return total;
  };

  const conPagina = async <T,>(html: string, fn: (page: any, client: any) => Promise<T>): Promise<T> => {
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      return await fn(page, await page.createCDPSession());
    } finally {
      await browser.close();
    }
  };

  // El runtime que el modelo escribió DE VERDAD en `contador-se-construye`:
  // sube al verse, con IntersectionObserver y sin cablear un solo clic.
  const COMO_EL_CONTADOR = `<!doctype html><html><body>
<section id="cifras"><p id="numeros">0</p></section>
<button id="empezar">Ver cifras</button>
<script>
new IntersectionObserver(function (es) {
  if (!es[0].isIntersecting) return;
  var n = 0;
  var t = setInterval(function () {
    n += 400;
    document.getElementById("numeros").textContent = String(n);
    if (n >= 5000) clearInterval(t);
  }, 100);
}).observe(document.getElementById("numeros"));
<\/script></body></html>`;

  it("🔴 (1) el censo va ANTES del guardia: specProgram se autoenvenena", async () => {
    const [antes, despues] = await conPagina(COMO_EL_CONTADOR, async (page, client) => {
      const a = await censoDeClic(client, "#empezar");
      await page.evaluate(
        specProgram([{ clic: "#empezar", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] }]),
      );
      return [a, await censoDeClic(client, "#empezar")];
    });
    // Antes: el botón está muerto de verdad y se ve.
    expect(antes).toBe(0);
    // Después: el guardia de specProgram vive en `document` y sale en la
    // cadena. Medir aquí haría que NINGÚN botón saliera nunca muerto.
    expect(despues).toBeGreaterThan(0);
  }, 30_000);

  // (2) LO QUE NO PUEDE PASAR NUNCA: marcar muerto un botón vivo. Las tres
  // formas de estar vivo, y la delegación es la que más usa el modelo.
  it("🔴 (2) CONTROL: ningún botón vivo sale a cero — no puede acusar en falso", async () => {
    const vivos = {
      "addEventListener directo": `<button id="b">x</button>
        <script>document.getElementById('b').addEventListener('click', function(){});<\/script>`,
      "propiedad onclick": `<button id="b">x</button>
        <script>document.getElementById('b').onclick = function(){};<\/script>`,
      "delegación en un contenedor": `<div id="z"><button id="b">x</button></div>
        <script>document.getElementById('z').addEventListener('click', function(){});<\/script>`,
      "delegación en document": `<div id="z"><button id="b">x</button></div>
        <script>document.addEventListener('click', function(){});<\/script>`,
    };
    for (const [nombre, cuerpo] of Object.entries(vivos)) {
      const n = await conPagina(`<!doctype html><html><body>${cuerpo}</body></html>`, (_p, c) =>
        censoDeClic(c, "#b"),
      );
      expect(n, `"${nombre}" salió a cero y habría acusado en falso`).toBeGreaterThan(0);
    }
  }, 60_000);
});

// ── 🔴 REPARAR HACIA `desplaza`, NO SÓLO HACIA `clic` (2026-09-21) ──────────
//
// MEDIDO en corrida de pago ($0,024, 21/09), caso `contador-se-construye`, CON
// el aviso de `sin_accion` ya reordenado para nombrar `desplaza` primero: el
// modelo mandó `[{entonces[1]}]` —sólo mirar—, se le rechazó, y volvió a mandar
// `[{entonces[1]}]`. `sigue_mal · antes sin_accion · ahora sin_accion`.
//
// O sea que el diagnóstico tampoco era «está dicho en el sitio equivocado».
// Decirlo mejor no lo arregla: hay que HACERLO. Y la máquina ya tenía el dato
// — el propio log del reparador imprime «0 listener(s) de clic», que es
// exactamente la señal de que esto se dispara al verse.
//
// `conClicDerivado` ya es la reparación de entrada de Claude Code, contada
// igual: si el intento quedó bien o sigue mal. Sólo le faltaba el otro verbo.
describe("la promesa sin acción se repara hacia `desplaza` cuando toca", () => {
  const OBSERVER = `
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) subir(document.getElementById("numeros"));
    });
    io.observe(document.getElementById("numeros"));`;

  it("🔴 con un runtime que observa el viewport, le pone el `desplaza` que falta", () => {
    const reparada = conDesplazaDerivado(
      [{ entonces: [{ donde: "#numeros", que: "cambia" }] }],
      OBSERVER,
    );
    expect(reparada).not.toBeNull();
    const r = parseBehaviorSpec(reparada);
    expect(r.kind).toBe("spec");
    if (r.kind === "spec") expect(r.pasos[0]!.desplaza).toBe("#numeros");
  });

  // 🔴 EL BRAZO DE CONTROL, y sin él esto repararía cualquier cosa: un runtime
  // que NO se dispara al verse no tiene por qué desplazarse a ningún sitio, y
  // fabricarle una promesa falsa es peor que dejarla rechazada.
  it("CONTROL: sin nada que observe el viewport, NO repara", () => {
    expect(
      conDesplazaDerivado(
        [{ entonces: [{ donde: "#numeros", que: "cambia" }] }],
        'document.getElementById("b").addEventListener("click", subir);',
      ),
    ).toBeNull();
  });

  it("CONTROL: si la promesa YA actúa, no se toca", () => {
    expect(
      conDesplazaDerivado(
        [{ clic: "#b", entonces: [{ donde: "#numeros", que: "cambia" }] }],
        OBSERVER,
      ),
    ).toBeNull();
    expect(
      conDesplazaDerivado(
        [{ desplaza: "#x", entonces: [{ donde: "#numeros", que: "cambia" }] }],
        OBSERVER,
      ),
    ).toBeNull();
  });

  it("CONTROL: sin un `donde` del que sacarlo, no se inventa nada", () => {
    expect(conDesplazaDerivado([{ entonces: [] }], OBSERVER)).toBeNull();
  });
});

// ── 🔴 LA CLASE DE FORMA DE UN `sin_accion` ────────────────────────────────
//
// La CLASE DE FORMA, que es el peldano que faltaba: una telemetria de
// entradas mal formadas que solo cuenta «fallo» no sirve para arreglar nada.
// Aqui ya se contaba el RESULTADO de la reparacion y no la clase — y sin
// clase, «56% de sin_accion» no dice QUE reparacion falta escribir.
describe("claseDeSinAccion — por que salio sin accion, no solo que salio", () => {
  const SOLO_MIRA = [{ entonces: [{ donde: "#total", que: "cambia" }] }];

  it("un runtime que mira el viewport es `observador` — lo repara `desplaza`", () => {
    const r = claseDeSinAccion(SOLO_MIRA, "new IntersectionObserver(function(e){});");
    expect(r).toBe("observador");
    // Y la reparacion de esa clase existe de verdad.
    expect(conDesplazaDerivado(SOLO_MIRA, "new IntersectionObserver(function(e){});")).not.toBeNull();
  });

  it("un listener con id cerca es `con_id` — lo repara `clic`", () => {
    const rt = 'document.getElementById("girar").addEventListener("click", function(){});';
    expect(claseDeSinAccion(SOLO_MIRA, rt)).toBe("con_id");
    expect(conClicDerivado(SOLO_MIRA, rt)).not.toBeNull();
  });

  // 🔴 LA CLASE QUE IMPORTA. Es la de produccion —3 de los 4 proyectos que
  // salieron `sin_accion` el 2026-09-21 cablean asi— y es la unica que HOY no
  // tiene reparacion: hay listeners, pero ningun id que nombrar.
  it("🔴 listeners SIN id es `sin_id`, y ninguna reparacion la coge", () => {
    const rt = 'var b=document.createElement("button"); b.addEventListener("click", function(){ render(); });';
    expect(claseDeSinAccion(SOLO_MIRA, rt)).toBe("sin_id");
    expect(conClicDerivado(SOLO_MIRA, rt), "si esto repara, la clase esta mal puesta").toBeNull();
    expect(conDesplazaDerivado(SOLO_MIRA, rt)).toBeNull();
  });

  it("sin clic y sin observador es `sin_listener`", () => {
    expect(claseDeSinAccion(SOLO_MIRA, 'document.title = "hola";')).toBe("sin_listener");
  });

  it("lo que no es una lista de objetos es `forma_rara`", () => {
    expect(claseDeSinAccion(null, "x")).toBe("forma_rara");
    expect(claseDeSinAccion([], "x")).toBe("forma_rara");
    expect(claseDeSinAccion(["no soy un paso"], "x")).toBe("forma_rara");
  });
});

// ── 🔴 LA REPARACION DE `sin_id` ───────────────────────────────────────────
//
// La clase que mas pesa (3 de 4 proyectos en produccion) y la que no tenia
// reparacion: TODO lo promovible de esos runtimes casa con VARIOS elementos.
//
// NO elige un boton. Promueve el selector que el PROPIO MODELO uso para
// cablear y le pone `cualquiera: true`, que es la autorizacion explicita a
// desambiguar: ante un objetivo ambiguo no se elige, se exige que alguien
// DECLARE que da igual cual.
describe("conGrupoDerivado — el grupo que el modelo cableo", () => {
  const SOLO_MIRA = [{ entonces: [{ donde: "#carrito-total", que: "cambia" }] }];

  it("🔴 promueve el selector de un querySelectorAll, con el grupo declarado", () => {
    const rt = "document.querySelectorAll('.add').forEach(function(b){ b.addEventListener('click', add); });";
    const r = conGrupoDerivado(SOLO_MIRA, rt) as Array<Record<string, unknown>>;
    expect(r, "no promovio nada del runtime del modelo").not.toBeNull();
    expect(r[0]?.clic).toBe(".add");
    expect(r[0]?.cualquiera, "sin `cualquiera` el selector multiple se rechaza igual").toBe(true);
    // Y la promesa reparada YA VALE: es lo unico que importa al final.
    expect(parseBehaviorSpec(r).kind).toBe("spec");
  });

  it("coge un selector de atributo, que es como cablea las pestanas", () => {
    const rt = "var b=document.createElement('button'); b.setAttribute('data-deck-tab', i);" +
      " document.querySelectorAll('[data-deck-tab]').forEach(function(x){ x.addEventListener('click', ir); });";
    const r = conGrupoDerivado(SOLO_MIRA, rt) as Array<Record<string, unknown>>;
    expect(r[0]?.clic).toBe("[data-deck-tab]");
  });

  // 🔴 NO PULSA LO QUE LA PROMESA MIRA. Pulsar el propio marcador que se espera
  // que cambie es la trampa del clic decorativo, ya medida.
  it("🔴 nunca promueve un selector que la promesa esta mirando", () => {
    const mira = [{ entonces: [{ donde: ".total", que: "cambia" }] }];
    expect(conGrupoDerivado(mira, "document.querySelectorAll('.total')")).toBeNull();
  });

  it("no promueve un id: de eso ya se encarga conClicDerivado, que va antes", () => {
    expect(conGrupoDerivado(SOLO_MIRA, "document.querySelector('#girar')")).toBeNull();
  });

  // 🔴 NO JUZGA SI \"PARECE UN BOTON\" — aqui vivia una lista negra de
  // contenedores y se retiro. Quien lo sabe de verdad es el censo de clic
  // muerto, que corre con el DOM delante y culpa a la PRUEBA, no a la pagina
  // (ver la prueba de navegador). Decidirlo tambien aqui era una segunda capa
  // juzgando lo mismo desde peor sitio, y ya se habia equivocado una vez.
  it("🔴 promueve un selector que NO parece un control: eso lo juzga el censo", () => {
    const r = conGrupoDerivado(SOLO_MIRA, "document.querySelectorAll('.wrap div')") as Array<Record<string, unknown>>;
    expect(r, "se filtro a ojo lo que el navegador sabe comprobar").not.toBeNull();
    expect(r[0]?.clic).toBe(".wrap div");
  });

  it("no promueve una LISTA ni una pseudo-clase: no son UN grupo", () => {
    expect(conGrupoDerivado(SOLO_MIRA, "document.querySelectorAll('.a, .b')")).toBeNull();
    expect(conGrupoDerivado(SOLO_MIRA, "document.querySelectorAll('.t:hover')")).toBeNull();
  });

  // 🔴 EL CASO REAL DE LA CORRIDA, que la primera version se dejo fuera por
  // rechazar toda descendencia: el modelo cableo con '#tabs button'. Termina en
  // un CONTROL, asi que se promueve — lo que importa es a que apunta.
  it("🔴 promueve '#tabs button', que es como cablea las pestanas de verdad", () => {
    const rt = "var tabs = document.querySelectorAll('#tabs button');" +
      " tabs.forEach(function(b){ b.addEventListener('click', ir); });";
    const r = conGrupoDerivado(SOLO_MIRA, rt) as Array<Record<string, unknown>>;
    expect(r, "el selector real del modelo se quedo sin promover").not.toBeNull();
    expect(r[0]?.clic).toBe("#tabs button");
    expect(r[0]?.cualquiera).toBe(true);
    expect(parseBehaviorSpec(r).kind).toBe("spec");
  });

  it("CONTRA-PRUEBA: si la promesa YA actua, no repara nada", () => {
    const yaActua = [{ clic: "#b", entonces: [{ donde: "#t", que: "cambia" }] }];
    expect(conGrupoDerivado(yaActua, "document.querySelectorAll('.add')")).toBeNull();
  });

  it("CONTRA-PRUEBA: un runtime sin selectores del modelo no da nada", () => {
    expect(conGrupoDerivado(SOLO_MIRA, "var b=document.createElement('button');")).toBeNull();
  });
});
