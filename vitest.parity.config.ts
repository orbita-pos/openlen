import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// La puerta de paridad Fable corre sus cuatro archivos SIN la exclusión de la
// suite por defecto: `fable-parity-review-session` revalida el paquete ciego
// completo en cada decisión y se queda sin CPU compitiendo con los otros 350
// archivos, no porque falle.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["lib/generation/fable-parity-*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
