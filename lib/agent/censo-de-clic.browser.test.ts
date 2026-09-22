// 🔴 LA PRECONDICIÓN: un clic que no puede hacer nada se dice ANTES de actuar.
//
// La forma de Claude Code, provocada en su propio arnés:
//
//   → «No changes to make: old_string and new_string are exactly the same.»
//
// y su contrato lo dice en voz alta: «…» La acción
// reporta su propio efecto; NUNCA se observa el mundo después para deducirlo.
//
// Aquí el análogo de `…` es un `clic` cuya
// cadena entera —elemento, ancestros, `document`— no tiene un solo manejador.
// Es fallo DEL INSTRUMENTO (`deLaPrueba: true`), no de la página.
//
// ⚠️ DE NAVEGADOR Y CON NAVEGACIÓN DE VERDAD. `page.setContent` usa
// `document.write` y NO crea documento nuevo, así que `evaluateOnNewDocument`
// no llega a instalarse y el censo saldría a cero para todo — medido en su día
// en `inline-image.ts:173`. Por eso se carga con `cargarEnOrigenReal`, que es
// el camino que usan los ojos del agente.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";

import { leerFallos, leerVacuas, specProgram, PRELUDIO_CENSO_CLIC, type PasoSpec } from "./behavior-spec";
import { cargarEnOrigenReal } from "@/lib/ai/origen-de-medida";

const marco = (cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`;

// El runtime con la forma del caso medido (`contador-se-construye`): sube al
// VERSE, con IntersectionObserver, sin cablear un solo clic.
const CONTADOR_QUE_SUBE_SOLO = marco(`
  <section><p id="numeros">0</p></section>
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
  <\/script>`);

const PASO_CON_CLIC: readonly PasoSpec[] = [
  { clic: "#empezar", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
];

async function correr(html: string, pasos: readonly PasoSpec[], opciones: { censo: boolean }) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    if (opciones.censo) await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
    await cargarEnOrigenReal(page, html);
    return leerFallos(await page.evaluate(specProgram(pasos)));
  } finally {
    await browser.close();
  }
}

describe("el censo de clic: una acción que no puede hacer nada se dice antes", () => {
  it("🔴 un clic sobre una cadena SIN manejador es fallo DE LA PRUEBA, no de la página", async () => {
    const fallos = await correr(CONTADOR_QUE_SUBE_SOLO, PASO_CON_CLIC, { censo: true });
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  // La anatomía, fila por fila: el HECHO contado, ni una palabra sobre la
  // página, y el arreglo NOMBRADO y ramificado por intención.
  it("🔴 y el mensaje cuenta el hecho y ramifica el arreglo por intención", async () => {
    const fallos = await correr(CONTADOR_QUE_SUBE_SOLO, PASO_CON_CLIC, { censo: true });
    const m = fallos[0]!.mensaje;
    expect(m).toContain("#empezar");
    expect(m).toContain("manejador de clic");
    // La salida honesta para una conducta que se dispara al VERSE, con el
    // selector concreto ya puesto: es lo que la tarea 3.4 quería y esto se traga.
    expect(m).toContain('desplaza:"#numeros"');
    // NI UNA PALABRA sobre la página: es nuestro instrumento el que no aplica.
    expect(m).not.toMatch(/página|pagina/i);
    // 🔴 Y LO QUE YA SE COMPROBÓ, DICHO. Un buen mensaje de herramienta no se
    // queda en «falló»: remata con un `(note: …)` que cuenta lo que la
    // herramienta YA intentó o YA sabe, para que quien lee no lo repita ni
    // busque donde ya se miró. Sin esto, un modelo que lee «no tiene manejador»
    // puede irse a cablear un onclick o una delegación que el censo ya descartó.
    expect(m).toContain("(note:");
    // 🔴 EL REGISTRO DE SUS MENSAJES DE HERRAMIENTA: van de 62 a 212
    // caracteres, mediana ~100, y NI UNA mayúscula enfática — son declarativas
    // planas.
    //
    // Se mide la prosa FIJA —descontados los dos selectores, que los pone el
    // modelo y pueden llegar a 80 cada uno— porque es la única parte que
    // decidimos nosotros.
    const prosa = m.replace("#empezar", "").replace("#numeros", "");
    expect(prosa.length, `la prosa fija son ${prosa.length} chars; su techo es 212`)
      .toBeLessThanOrEqual(212);
    expect(m, "mayúsculas enfáticas: eso es costumbre de esta casa, no suya")
      .not.toMatch(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/);
    expect(m).toMatch(/onclick/);
    expect(m).toMatch(/document/);
  }, 60_000);

  // 🔴 LO QUE NO PUEDE PASAR NUNCA: marcar muerto un botón vivo. La delegación
  // es la forma que más usa el modelo (medido en el carrito: 4 de 5 manejadores
  // viven en elementos sin id, creados al vuelo).
  it("🔴 CONTROL: un botón vivo por DELEGACIÓN no se acusa", async () => {
    const delegado = marco(`
      <div id="zona"><button id="empezar">+1</button></div>
      <p id="numeros">0</p>
      <script>
        document.getElementById("zona").addEventListener("click", function () {
          document.getElementById("numeros").textContent = "1";
        });
      <\/script>`);
    const fallos = await correr(delegado, PASO_CON_CLIC, { censo: true });
    expect(fallos).toEqual([]);
  }, 60_000);

  it("🔴 CONTROL: y uno vivo por la propiedad `.onclick` tampoco", async () => {
    const porPropiedad = marco(`
      <button id="empezar">+1</button><p id="numeros">0</p>
      <script>
        document.getElementById("empezar").onclick = function () {
          document.getElementById("numeros").textContent = "1";
        };
      <\/script>`);
    const fallos = await correr(porPropiedad, PASO_CON_CLIC, { censo: true });
    expect(fallos).toEqual([]);
  }, 60_000);

  // 🔴 FAIL-OPEN, que es la regla de esta prueba desde que existe: sin censo
  // instalado no se acusa a nadie. No medir no es medir mal — y es lo que
  // protege a los renderizadores que no instalen el preludio.
  it("🔴 sin el preludio instalado, la precondición se calla del todo", async () => {
    const fallos = await correr(CONTADOR_QUE_SUBE_SOLO, PASO_CON_CLIC, { censo: false });
    expect(fallos).toEqual([]);
  }, 60_000);

  // 🔴 EL RECORTE SE COMÍA EL ARREGLO. `leerFallos` cortaba el mensaje a 200
  // caracteres, y `selectorValido` acepta hasta 80 — con dos selectores largos
  // lo que desaparecía era el `desplaza:"…"` del final, o sea el defecto que
  // este fichero entero existe para arreglar, cometido DENTRO del arreglo.
  //
  // ⚠️ Y recortar el selector DENTRO del `desplaza:` no es opción: le daría al
  // modelo un selector que no existe. Un mensaje que miente es peor que uno
  // corto — es la doctrina de degradación del repo.
  //
  // AL PEOR CASO QUE `parseBehaviorSpec` acepta: 80 y 80.
  it("🔴 al peor caso de selector (80+80) el arreglo entero SOBREVIVE", async () => {
    const claseBoton = "b".repeat(78);
    const claseCifra = "c".repeat(78);
    const clic = `.${claseBoton}`;
    const donde = `.${claseCifra}`;
    expect(clic.length).toBe(79);
    const largo = marco(
      `<p class="${claseCifra}">0</p><button class="${claseBoton}">Ver</button>`,
    );
    const fallos = await correr(
      largo,
      [{ clic, veces: 1, entonces: [{ donde, que: "cambia" }] }],
      { censo: true },
    );
    expect(fallos).toHaveLength(1);
    // El arreglo ENTERO, con su selector completo y utilizable.
    expect(fallos[0]!.mensaje).toContain(`desplaza:"${donde}"`);
  }, 60_000);

  // 🔴 LA FRONTERA, que es lo que casi se pierde al escribir esto.
  //
  // Una promesa GUARDADA se verificó CUMPLIÉNDOSE el día que se guardó. Si hoy
  // su clic no tiene manejador, el que cambió es la PÁGINA — es la regresión
  // más valiosa que mide el repo. Aplicarle la precondición la callaría Y
  // haría que `retirarPruebas` la BORRASE, así que el carrito roto no se
  // volvería a cazar nunca. Lo cazó `suite-de-la-pagina.browser.test.ts`.
  //
  // Mismo botón muerto, mismo paso, dos sitios distintos de la lista.
  it("🔴 la precondición NO alcanza a las promesas guardadas, sólo a la del turno", async () => {
    const dosPasos = [
      { clic: "#empezar", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
      { clic: "#empezar", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] },
    ] as const;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
      await cargarEnOrigenReal(page, CONTADOR_QUE_SUBE_SOLO);
      // Sólo el PRIMER paso es de este turno.
      const fallos = leerFallos(
        await page.evaluate(specProgram(dosPasos as unknown as PasoSpec[], 1)),
      );
      expect(fallos).toHaveLength(1);
      expect(fallos[0]!.paso).toBe(1);
      expect(fallos[0]!.mensaje).toContain("manejador de clic");
    } finally {
      await browser.close();
    }
  }, 60_000);
});

// ── 🔴 LA EXPECTATIVA QUE YA SE CUMPLÍA ANTES DE ACTUAR ─────────────────────
//
// MEDIDO en corrida de pago el 2026-09-21: `contador-se-construye` salió PASS
// con esta promesa —
// — o sea, pulsa el propio contador y comprueba que contenga 5.000, que es lo
// que el contador alcanza SOLO por su IntersectionObserver. Verde sin probar
// nada. `contiene`, `es`, `visible` y `oculto` se miden en absoluto contra el
// ahora: si ya se cumplía, pasan.
//
// LA FORMA NO SE INVENTA. En Claude Code, el chequeo que no pudo comprobar no
// aprueba y dice por qué. Lo que se copia es que el estado SE VE y lleva
// motivo; lo que NO se copia es que no apruebe: su eval es una puerta de CI, y esto corre dentro del turno pagado de alguien,
// donde acusar a una página sana ya está medido en 0 de 5.
//
// Así que aquí NO es un fallo: es un tercer canal que no acusa a nadie.
describe("una expectativa que ya se cumplía no puede probar la acción", () => {
  const YA_SE_CUMPLIA = marco(`
    <button id="b">Ver</button><div id="exito">¡Gracias!</div>
    <script>document.getElementById("b").addEventListener("click", function(){});<\/script>`);

  it("🔴 se marca como VACUA, y no como fallo de la página", async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
      await cargarEnOrigenReal(page, YA_SE_CUMPLIA);
      const bruto = await page.evaluate(
        specProgram([
          { clic: "#b", veces: 1, entonces: [{ donde: "#exito", que: "contiene", valor: "Gracias" }] },
        ]),
      );
      // No acusa: `leerFallos` no la ve.
      expect(leerFallos(bruto)).toEqual([]);
      // Pero SE VE, con su motivo.
      const vacuas = leerVacuas(bruto);
      expect(vacuas).toHaveLength(1);
      expect(vacuas[0]!.mensaje).toContain("#exito");
      expect(vacuas[0]!.mensaje).toMatch(/ya se cumplía antes/i);
    } finally {
      await browser.close();
    }
  }, 60_000);

  // 🔴 CONTROL: una promesa que SÍ discrimina no se marca. Sin esto, lo de
  // arriba saldría igual con cualquier cosa.
  it("CONTROL: si la acción es la que lo pone, no se marca nada", async () => {
    const loPoneElClic = marco(`
      <button id="b">Ver</button><div id="exito"></div>
      <script>document.getElementById("b").addEventListener("click", function(){
        document.getElementById("exito").textContent = "¡Gracias!";
      });<\/script>`);
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
      await cargarEnOrigenReal(page, loPoneElClic);
      const bruto = await page.evaluate(
        specProgram([
          { clic: "#b", veces: 1, entonces: [{ donde: "#exito", que: "contiene", valor: "Gracias" }] },
        ]),
      );
      expect(leerFallos(bruto)).toEqual([]);
      expect(leerVacuas(bruto)).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);

  // 🔴 Y UN PASO SIN ACCIÓN NO SE MARCA NUNCA. La regla del 2026-08-30 —un paso
  // posterior SÍ puede sólo comprobar el estado que dejó el anterior— se tomó
  // midiendo que rechazarlo tiraba 2 de cada 4 pruebas buenas. Marcar esos
  // pasos volvería a castigar justo eso.
  it("CONTROL: un paso que sólo comprueba nunca se marca", async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
      await cargarEnOrigenReal(page, YA_SE_CUMPLIA);
      const bruto = await page.evaluate(
        specProgram([
          { clic: "#b", veces: 1, entonces: [{ donde: "#b", que: "visible" }] },
          { entonces: [{ donde: "#exito", que: "contiene", valor: "Gracias" }] },
        ]),
      );
      // El paso 2 no actúa: se queda fuera pase lo que pase.
      expect(leerVacuas(bruto).every((v) => v.paso === 1)).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

// 🔴 LO QUE LA LISTA NEGRA CREIA QUE HACIA FALTA, Y YA HACIA ESTO.
//
// En `conGrupoDerivado` vivia un filtro que descartaba selectores que «no
// parecian un control» (div, span, li…). Se retiro el 2026-09-22 porque quien
// lo sabe de verdad es el censo, que corre con el DOM delante. Un objetivo que
// no sirve se descarta con una comprobacion DEFINIDA que ademas nombra la
// salida, no con una corazonada sobre si «parece un boton».
//
// ⚠️ Y ESTA PRUEBA VIVE AQUI Y NO EN `prueba-selector.browser.test.ts`: alli se
// carga con `setContent`, que NO instala el preludio, asi que el censo es
// fail-open y el fallo se le acaba colgando a la pagina. Se escribio alli
// primero y salio en rojo diciendo exactamente eso.
describe("un contenedor promovido no acusa a la pagina", () => {
  const CONTENEDOR_MUERTO = marco(`
    <div class="wrap"><div>Uno</div><div>Dos</div></div>
    <div id="total">0</div>`);
  const PASO_AL_CONTENEDOR: readonly PasoSpec[] = [
    { clic: ".wrap div", cualquiera: true, veces: 1, entonces: [{ donde: "#total", que: "cambia" }] },
  ];

  it("🔴 el censo lo caza, culpa a la PRUEBA y nombra el arreglo", async () => {
    const fallos = await correr(CONTENEDOR_MUERTO, PASO_AL_CONTENEDOR, { censo: true });
    expect(fallos.length).toBe(1);
    expect(fallos[0]?.deLaPrueba, "acuso a la pagina de un selector que promovimos nosotros").toBe(true);
    expect(fallos[0]?.mensaje).toMatch(/no tiene manejador de clic/);
    expect(fallos[0]?.mensaje, "no nombra el arreglo").toMatch(/desplaza/);
  }, 60_000);

  // CONTRA-PRUEBA, y es la que explica donde vive esta prueba: SIN censo el
  // mismo caso se le cuelga a la pagina. Fail-open, documentado — y el motivo
  // de que el preludio tenga que estar puesto en la ruta de verdad.
  it("CONTRA-PRUEBA: sin censo, el mismo caso acusa a la pagina", async () => {
    const fallos = await correr(CONTENEDOR_MUERTO, PASO_AL_CONTENEDOR, { censo: false });
    expect(fallos.length).toBe(1);
    expect(fallos[0]?.deLaPrueba ?? false).toBe(false);
  }, 60_000);
});
