// lib/apps/tests/test-files.ts — QUÉ ES UNA PRUEBA en una app (plan 04): el
// `include` por defecto de vitest, en cualquier carpeta (también /tests), y
// los ficheros de configuración que vitest corre antes (`setupFiles`). Ni unos
// ni otros son de la app: no se compilan con ella ni se publican.
//
// Puro y sin imports: lo usa el compilador.

export const TEST_INCLUDE = "**/*.{test,spec}.?(c|m)[jt]s?(x)";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(ruta: string): boolean {
  return TEST_FILE.test(ruta);
}

/** Los de costumbre, si el proyecto no dice otros: Create React App, la
 *  plantilla de Lovable y la de vitest. */
const DE_COSTUMBRE = [
  "/src/setupTests.ts", "/src/setupTests.js", "/src/setupTests.tsx", "/src/setupTests.jsx",
  "/src/test/setup.ts", "/src/test/setup.js", "/src/test/setup.tsx", "/src/test/setup.jsx",
  "/vitest.setup.ts", "/vitest.setup.js", "/src/vitest.setup.ts", "/src/vitest.setup.js",
];
const CONFIGS = ["/vite.config.ts", "/vite.config.js", "/vite.config.mjs", "/vitest.config.ts", "/vitest.config.js", "/vitest.config.mjs"];

/** El `setupFiles` del vite.config/vitest.config, LEÍDO como dato (no se
 *  ejecuta: como el tailwind.config), con las rutas relativas a la raíz; o los
 *  de costumbre que existan. Sólo los que hay en la carpeta. */
export function setupFilesOf(carpeta: Readonly<Record<string, string>>): string[] {
  for (const c of CONFIGS) {
    const texto = carpeta[c];
    if (texto === undefined) continue;
    const m = /setupFiles\s*:\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/.exec(texto);
    if (!m) continue;
    const rutas = [...m[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => "/" + x[1]!.replace(/^\.?\//, ""));
    return rutas.filter((r) => Object.hasOwn(carpeta, r));
  }
  return DE_COSTUMBRE.filter((r) => Object.hasOwn(carpeta, r));
}

export function isTestSupportFile(ruta: string, carpeta: Readonly<Record<string, string>>): boolean {
  return isTestFile(ruta) || setupFilesOf(carpeta).includes(ruta);
}
