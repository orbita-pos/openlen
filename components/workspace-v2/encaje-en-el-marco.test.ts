// LO QUE SE SERIALIZA NO PUEDE LLEVAR UNA FUNCIÓN DENTRO.
//
// Las funciones de `encaje-en-el-marco.ts` no se importan en la página: se
// serializan con `.toString()` dentro del guion que se inyecta en el iframe
// (el patrón de `CORE_SRC`). Y ahí hay una trampa que costó una tarde el
// 19/09/2026:
//
//   esbuild con `keepNames` envuelve TODA función interna en
//   `__name(fn, "nombre")` — la declarada también, con la llamada detrás. Ese
//   envoltorio viaja dentro del `.toString()` hasta la página, donde `__name`
//   no existe. La llamada revienta, el ajuste no corre, y no se entera nadie:
//   ni un error en la consola del taller, porque pasa dentro del iframe.
//
// Medido: con un `const una = function () {}` dentro de `trasCargar`, el
// reemplazo dejaba la banda intacta y las tres pruebas de geometría de
// `encaje-al-reemplazar.browser.test.ts` seguían EN VERDE, porque el transform
// de vitest no pone `keepNames` y el del arnés de `.claude/qa` sí. O sea: el
// navegador no discrimina esto, y por eso la guarda es estructural.
//
// NO CUBRE el resto del código serializado del taller. `splitContainer`
// (drop-place-core.ts) lleva un `kidsOf` dentro y cae por esta misma regla —
// no está cubierto aquí porque arreglarlo es otro cambio, y bajo el build real
// (SWC, no esbuild) no se ha comprobado que pase nada.
import { describe, expect, it } from "vitest";

import {
  ajustarAlMarco,
  cajaContenido,
  medirMarco,
  trasCargar,
} from "./encaje-en-el-marco";

const SERIALIZADAS = { cajaContenido, medirMarco, ajustarAlMarco, trasCargar };

describe("el código que viaja al iframe", () => {
  for (const [nombre, fn] of Object.entries(SERIALIZADAS)) {
    it(`${nombre} no lleva ninguna función dentro`, () => {
      const src = fn.toString();
      // La primera `function` es la suya; cualquier otra, o una flecha, es una
      // función interna y es lo que el envoltorio rompe.
      const dentro = src.slice(src.indexOf("(")).match(/\bfunction\b|=>/g);
      expect(dentro, `${nombre}:\n${src}`).toBeNull();
    });

    it(`${nombre} se serializa sin envoltorios del empaquetador`, () => {
      expect(fn.toString()).not.toContain("__name");
    });
  }
});
