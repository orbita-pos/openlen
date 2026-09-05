// EL VERBO QUE FALTABA: `atributo`.
//
// 🔴 ESTO NO ES UNA HIPÓTESIS, ES UNA CORRIDA. El 2026-09-04, sobre 16 páginas
// generadas de verdad, la prueba declarada acusó a 3 páginas y ACERTÓ EN 0. Se
// abrieron una por una y la primera, `quiz`, decía esto:
//
//     el modelo quiso comprobar «el botón deja de estar deshabilitado»
//     y escribió  {que:"estilo", valor:"disabled"}
//
// `disabled` es un ATRIBUTO, no una propiedad CSS. No teníamos verbo para «un
// atributo cambió», así que el modelo usó el único que se le parecía — y la
// prueba suspendió a una página que funcionaba. Es la CUARTA vez que un
// destrozo atribuido al modelo resulta ser un verbo que faltaba en nuestro
// vocabulario ([[el-verbo-que-faltaba-op-text]]).
//
// 🔴 Y POR QUÉ ESTE FICHERO ES DE NAVEGADOR Y NO PUEDE SER OTRA COSA:
// `visual-quality-renderer.test.ts` MOCKEA `page.evaluate`, así que nunca
// ejecuta el programa que devuelve `specProgram`. Un verbo nuevo probado ahí
// saldría verde sin haberse ejecutado jamás. Hay que añadir el fichero a mano
// al `include` de `vitest.config.ts`, que es LISTA BLANCA.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";

import { specProgram, leerFallos, parseBehaviorSpec } from "./behavior-spec";
import type { PasoSpec } from "./behavior-spec";

async function correr(html: string, pasos: PasoSpec[]) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const bruto = await page.evaluate(specProgram(pasos));
    return leerFallos(bruto);
  } finally {
    await browser.close();
  }
}

const marco = (cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`;

// EL CASO `quiz`, reducido a lo esencial: un botón que nace deshabilitado y que
// el JavaScript del modelo habilita al elegir una opción. La página FUNCIONA —
// es la misma forma que tenía la que suspendimos.
const QUIZ = marco(`
  <button id="opcion">Madrid</button>
  <button id="enviar" disabled>Enviar</button>
  <script>
    document.getElementById('opcion').addEventListener('click', function () {
      document.getElementById('enviar').removeAttribute('disabled');
    });
  </script>`);

describe("`atributo` ve el estado de un control, que es donde vive", () => {
  it("el botón deja de estar deshabilitado y la promesa se cumple", async () => {
    const fallos = await correr(QUIZ, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "atributo", valor: "disabled" }] },
    ]);
    expect(fallos, `acusó a una página correcta: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  // 🔴 EL BRAZO DE CONTROL, y aquí vale doble: sin él, la prueba de arriba
  // pasaría igual si `atributo` no comprobara absolutamente nada.
  it("CONTRA-PRUEBA: si el botón sigue deshabilitado, sí se acusa", async () => {
    const rota = QUIZ.replace("removeAttribute('disabled')", "blur()");
    const fallos = await correr(rota, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "atributo", valor: "disabled" }] },
    ]);
    expect(fallos.length).toBe(1);
    // Fallo de la PÁGINA, no de la prueba: aquí la acusación sí se sostiene.
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("disabled");
  }, 60_000);

  // LA MEDIDA DEL ANTES Y DEL DESPUÉS, en la dirección contraria: un atributo
  // que APARECE cuenta igual que uno que desaparece.
  it("un atributo que aparece también es un cambio", async () => {
    const PANEL = marco(`
      <button id="abrir">Más</button>
      <div id="panel"></div>
      <script>
        document.getElementById('abrir').addEventListener('click', function () {
          document.getElementById('panel').setAttribute('aria-expanded', 'true');
        });
      </script>`);
    const fallos = await correr(PANEL, [
      { clic: "#abrir", veces: 1, entonces: [{ donde: "#panel", que: "atributo", valor: "aria-expanded" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 60_000);

  // UN `disabled` PRESENTE SE LEE CADENA VACÍA en HTML. Si `atributoDe`
  // devolviera "" en vez de `null` para el ausente, quitarlo no se vería como
  // cambio y este caso pasaría a fallar en silencio sobre una página correcta.
  it("quitar un atributo booleano se ve como cambio (ausente ≠ cadena vacía)", async () => {
    const fallos = await correr(QUIZ, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "atributo", valor: "disabled" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 60_000);

  // EL NOMBRE EQUIVOCADO NO SE DISFRAZA DE «no cambió». Es la misma disciplina
  // que `estilo`: decirlo así es lo que separa que el modelo corrija el nombre
  // de que se ponga a reescribir un script que está bien.
  it("un atributo que no está ni antes ni después lo dice, y no dice «no cambió»", async () => {
    const fallos = await correr(QUIZ, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "atributo", valor: "checked" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.mensaje).toContain("ni antes ni después");
  }, 60_000);
});

// LO QUE ESTE VERBO VIENE A SUSTITUIR, ejecutado. No es una nota histórica: es
// la demostración de que la página de `quiz` estaba bien y el vocabulario mal.
describe("el fallo MEDIDO que este verbo cierra", () => {
  it("`estilo` con `disabled` acusa a la página buena; `atributo` no", async () => {
    // Pasa el validador —`disabled` tiene forma de propiedad CSS— y revienta
    // en el navegador, que es exactamente lo que ocurrió en la corrida.
    const conEstilo = await correr(QUIZ, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "estilo", valor: "disabled" }] },
    ]);
    expect(conEstilo.length, "el fallo original ya no se reproduce").toBe(1);

    const conAtributo = await correr(QUIZ, [
      { clic: "#opcion", veces: 1, entonces: [{ donde: "#enviar", que: "atributo", valor: "disabled" }] },
    ]);
    expect(conAtributo, "la misma página, con el verbo correcto").toEqual([]);
  }, 90_000);
});

// LA PUERTA, que es donde se puede decir POR QUÉ. Un nombre inventado devuelve
// `null` en las dos medidas y se leería como «no cambió»: se caza antes.
describe("la puerta del verbo `atributo`", () => {
  const paso = (valor: unknown) => [
    { clic: "#b", entonces: [{ donde: "#x", que: "atributo", valor }] },
  ];

  it("acepta un nombre de atributo normal", () => {
    expect(parseBehaviorSpec(paso("aria-expanded")).kind).toBe("spec");
  });

  it("rechaza lo que no es un nombre de atributo", () => {
    for (const malo of ["background-color: red", "", "Disabled", "a".repeat(60), 7]) {
      const r = parseBehaviorSpec(paso(malo));
      expect(r.kind, `aceptó ${JSON.stringify(malo)}`).toBe("error");
    }
  });

  // 🔴 `class` SE ACEPTA A PROPÓSITO. `estilo` es mejor verbo para lo que la
  // clase provoca, pero este validador rechaza la prueba ENTERA, y una puerta
  // nueva volvería a subir el número que B acababa de bajar (descartadas en la
  // puerta 4 → 1). La preferencia se dice en el prompt, que es donde el modelo
  // puede leerla.
  it("acepta `class` en vez de tirar la prueba entera", () => {
    expect(parseBehaviorSpec(paso("class")).kind).toBe("spec");
  });
});
