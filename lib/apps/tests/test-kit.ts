// lib/apps/tests/test-kit.ts — EL KIT DE PRUEBAS de las apps (plan 04): lo que
// una prueba importa además de su app y su catálogo — Testing Library y lo de
// vitest que corre en un navegador (`@vitest/expect`, `@vitest/spy`) —,
// construido y CONGELADO como un catálogo (`npm run apps:vendor`) en
// `public/app-vendor/test-kit-<versión>/desarrollo/`. React NO va dentro: lo
// pone el catálogo de la app (una copia, o los hooks se rompen). No se publica
// nunca: sólo lo cargan las pruebas, en el Chromium de los ojos.
//
// Puro: lo leen el servidor, `apps:vendor` y las pruebas.
import path from "node:path";
import type { Catalogo } from "@/lib/apps/dependencias";

export const TEST_KIT_NAME = "test-kit-2026-10";

export const TEST_KIT: Catalogo = {
  versiones: {
    "@sinonjs/fake-timers": "15.4.0",
    "@testing-library/dom": "10.4.2",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@vitest/expect": "4.1.11",
    "@vitest/spy": "4.1.11",
    "@vitest/utils": "4.1.11",
    // Sólo para los nombres y los tipos: el kit NO lleva React.
    react: "19.2.6",
    "react-dom": "19.2.6",
  },
  dependencias: [
    { especificador: "@testing-library/react", fichero: "testing-library-react.js", para: "render, screen, fireEvent, waitFor, within, act, renderHook." },
    { especificador: "@testing-library/dom", fichero: "testing-library-dom.js", para: "the DOM queries Testing Library is built on." },
    { especificador: "@testing-library/user-event", fichero: "user-event.js", para: "userEvent.setup(), then await user.click / type / keyboard." },
    { especificador: "@testing-library/jest-dom/matchers", fichero: "jest-dom-matchers.js", para: "toBeInTheDocument, toBeVisible, toHaveTextContent… (already registered).", hiddenFromManual: true },
    { especificador: "@vitest/expect", fichero: "vitest-expect.js", para: "vitest's expect.", hiddenFromManual: true },
    { especificador: "@vitest/spy", fichero: "vitest-spy.js", para: "vi.fn and vi.spyOn.", hiddenFromManual: true },
    { especificador: "@vitest/utils/diff", fichero: "vitest-diff.js", para: "the Expected/Received diff of a failure.", hiddenFromManual: true },
    { especificador: "@sinonjs/fake-timers", fichero: "fake-timers.js", para: "vi.useFakeTimers.", hiddenFromManual: true },
    { especificador: "react-dom/test-utils", fichero: "react-dom-test-utils.js", para: "act, for Testing Library on React 19.", hiddenFromManual: true },
  ],
  // Los trozos compartidos (una copia de @testing-library/dom para react y
  // user-event): los dice `apps:vendor` (falla si no coinciden).
  internos: ["chunk-B2SEWPIF.js", "chunk-FSRPMVAS.js", "chunk-IM6IBPRF.js", "chunk-QW36OOGN.js", "chunk-WOHGBMTX.js", "chunk-ZESWSGTP.js"],
  split: true,
};

/** Lo que una prueba importa por su nombre además del catálogo de su app.
 *  `vitest` es nuestro runtime (`vitest-runtime.js`), no un fichero del kit. */
export const TEST_SPECIFIERS: readonly string[] = [
  "vitest",
  "@testing-library/react",
  "@testing-library/dom",
  "@testing-library/user-event",
  "@testing-library/jest-dom",
  "@testing-library/jest-dom/vitest",
  "@testing-library/jest-dom/matchers",
];

/** Se importan por costumbre y aquí no hacen nada: los matchers de jest-dom
 *  ya están registrados en el `expect` del runtime. */
export const EMPTY_TEST_SPECIFIERS: readonly string[] = ["@testing-library/jest-dom", "@testing-library/jest-dom/vitest"];

/** El kit de un catálogo. Todos los de hoy llevan React 19.2.6: uno sirve a
 *  todos (`test-kit.test.ts` lo vigila). Un catálogo con otro React mayor
 *  necesitará su propio kit. */
export function testKitFor(_catalogo: string): string {
  return TEST_KIT_NAME;
}

/** Dónde están instalados sus paquetes (`scripts/app-test-kit/<versión>/`). */
export function testKitDir(raiz: string): string {
  return path.join(raiz, "scripts", "app-test-kit", TEST_KIT_NAME.replace(/^test-kit-/, ""));
}
