// @vitest-environment node
//
// LAS DOS PÁGINAS DEL TURNO, EN UN NAVEGADOR DE VERDAD.
//
// 🔴 POR QUÉ ESTA PRUEBA. Las unitarias del camino multi-página inyectan un
// `render` y un `medir` FALSOS, así que ninguna dice si el código llega a
// arrancar Chromium dos veces en la misma verificación, ni si lo que vuelve de
// la SEGUNDA página se mide y se atribuye. Estaban todas verdes sin haber
// renderizado nunca una página — el mismo agujero que
// `suite-de-la-pagina.browser.test.ts` abrió para la suite.
//
// Y no es teórico: en el turno que originó todo esto (`proj=2d6cad43`, 19/09)
// el pool ya se colgó DOS veces con UNA sola página. Aquí se le piden dos.
//
// La VISIÓN va simulada a propósito: lo que se mide es el navegador y la
// atribución, no al crítico — una prueba que llama al modelo cuesta dinero y
// falla los días que la red va mal.
import { describe, expect, it } from "vitest";

import { verifyEditedPage } from "./verify";

const HOME = `<!doctype html><html><head><meta charset="utf-8"><title>Holi</title></head>
<body style="background:#ffffff;color:#111111;font-family:sans-serif">
  <h1>Holi viajes</h1>
  <p>Paquetes cerrados para 2026, con vuelo y alojamiento.</p>
</body></html>`;

/** Texto blanco sobre fondo blanco: ilegible de verdad, y el medidor lo lee DEL
 *  PÍXEL (ver `png-crudo.ts` / `contraste.ts`). El defecto está SÓLO aquí. */
const VIAJES = `<!doctype html><html><head><meta charset="utf-8"><title>Viajes</title></head>
<body style="background:#ffffff;font-family:sans-serif">
  <h1 style="color:#ffffff">Riviera Maya</h1>
  <p style="color:#fefefe">Siete noches con vuelo incluido desde Mazatlán.</p>
</body></html>`;

function espiaDeVision() {
  const imagenesPorLlamada: number[] = [];
  return {
    imagenesPorLlamada,
    provider: {
      stream: (req: { images?: readonly unknown[] }) => {
        imagenesPorLlamada.push(req.images?.length ?? 0);
        return (async function* () {
          yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
          yield { type: "done", stopReason: { kind: "end_turn" } };
        })() as never;
      },
    },
  };
}

describe("las páginas del turno, en Chromium", () => {
  // ⚠️ CON REINTENTO, y el motivo está medido: esta prueba pasa sola y pasa
  // junto a `suite-de-la-pagina.browser.test.ts`, pero dentro de `npm test`
  // entero se cayó una vez con `fallback` — o sea, Chromium no llegó a
  // arrancar. Es la inanición que este repo ya tiene anotada (las suites con
  // navegador fallan por máquina cargada, no por el cambio).
  //
  // El reintento NO tapa un fallo de lógica: ése falla las tres veces, porque
  // es determinista. Lo que absorbe es un arranque de navegador que no llegó.
  //
  // 🔴 Y DEJA UN HECHO OPERATIVO, que no es de la prueba: verificar dos páginas
  // pide el DOBLE de navegador que verificar una, así que bajo carga el turno
  // multi-página caerá en `no_mirado` más a menudo que el de una. Eso se ve en
  // la tarjeta («sin comprobar») y no miente, pero es coste real.
  it(
    "🔴 mira LAS DOS de verdad, y el defecto de la segunda sale con su dirección",
    { timeout: 180_000, retry: 2 },
    async () => {
      const espia = espiaDeVision();
      const v = await verifyEditedPage(
        {
          html: HOME,
          page: null,
          userPrompt: "hazme una página de viajes",
          otrasPaginas: [{ html: VIAJES, page: "viajes" }],
        },
        { provider: espia.provider as never },
      );

      // 1. Las dos se miraron de verdad — este número es el de las que
      //    llegaron a tener captura, no el de las que se pidieron.
      expect(v.paginasMiradas).toBe(2);
      // 2. UNA sola llamada, con las DOS capturas dentro. Es la forma del
      //    informe de `preview` de Claude Code.
      expect(espia.imagenesPorLlamada).toEqual([2]);
      // 3. El medidor determinista contestó para las dos.
      expect(v.conMedida).toBe(true);
      // 4. Y el defecto de la SEGUNDA página se ve, con su dirección delante.
      //    Antes del 2026-09-20 esta página no se miraba y esto salía limpio.
      expect(v.broken).toBe(true);
      expect(
        v.issues.some((i) => i.startsWith("/viajes: ")),
        `ningún issue de /viajes: ${JSON.stringify(v.issues)}`,
      ).toBe(true);
      // 5. Y TODAS van rotuladas: una frase sin dirección, con dos páginas en
      //    juego, no se puede accionar.
      expect(v.issues.every((i) => i.startsWith("/"))).toBe(true);
    },
  );

  it(
    "CONTRA-PRUEBA: una sola página sale como salía — sin rótulos",
    { timeout: 180_000, retry: 2 },
    async () => {
      const espia = espiaDeVision();
      const v = await verifyEditedPage(
        { html: HOME, page: null, userPrompt: "cambia el titular" },
        { provider: espia.provider as never },
      );
      expect(espia.imagenesPorLlamada).toEqual([1]);
      expect(v.paginasMiradas).toBe(1);
      expect(v.issues.every((i) => !i.startsWith("/"))).toBe(true);
    },
  );
});
