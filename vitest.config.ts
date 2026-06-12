import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the Editor V5 overlay-editor core (jsdom). Playwright owns the
// browser-level e2e/visual suite (tests/e2e/**, run via `npm run test:e2e`).
//
// SCOPE: `include` is intentionally limited to the workspace editor tests. The
// repo also ships 9 pre-existing lib/**/*.test.ts files that were committed
// before any runner existed; they import the native @/lib/html-engine Rust
// binding, which vite can't load (.node) — wiring those (a crate mock or a
// node-env + built binary) is a separate task, not part of Editor V5. The `@`
// alias below is set so they CAN be run explicitly later (`vitest run lib/...`).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "components/workspace-v2/**/*.test.ts",
      "lib/workspace-v2/**/*.test.ts",
      "lib/sections/**/*.test.ts",
      "lib/assemble/**/*.test.ts",
      "lib/curate/**/*.test.ts",
      "lib/business-profiles/**/*.test.ts",
      "lib/billing/**/*.test.ts",
      "lib/theme-derive.test.ts",
      "lib/palette-gen-look.test.ts",
      "lib/theme-presets.test.ts",
      "lib/gradients.test.ts",
      "lib/tematicas/**/*.test.ts",
      "lib/site-assistant/**/*.test.ts",
      "lib/publish/assistant-widget.test.ts",
      "lib/members/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
});
