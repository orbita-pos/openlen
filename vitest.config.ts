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
  // jsx: "automatic" — the repo's tsconfig.json has "jsx": "preserve" (Next's
  // SWC owns the real transform at build time), so esbuild has no signal to
  // use the react-jsx runtime by default and falls back to classic
  // React.createElement, which needs `React` in scope. None of the app's own
  // .tsx files import a default `React` (they rely on Next's automatic
  // runtime) — this makes vitest's esbuild transform match that, first
  // needed here by scan-overlay.test.tsx.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // lib/behaviors/validate.ts (and any future server-only module) imports
      // "server-only" as a marker. Next resolves it to empty.js in production
      // via the `react-server` exports condition; vitest doesn't set that
      // condition, so it falls through to index.js, which throws "This module
      // cannot be imported from a Client Component module". Point the bare
      // specifier straight at the same empty.js Next would pick — this is an
      // alias for ONE package, not `resolve.conditions: ["react-server"]`,
      // which would repoint conditional exports for the entire dependency
      // tree (React itself included) and is a much bigger blast radius.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    environment: "jsdom",
    include: [
      "components/workspace-v2/**/*.test.ts",
      "components/workspace-v2/**/*.test.tsx",
      "components/community/**/*.test.ts",
      "lib/three3d/**/*.test.ts",
      "lib/workspace-v2/**/*.test.ts",
      "lib/sections/**/*.test.ts",
      "lib/analytics/**/*.test.ts",
      "lib/assemble/**/*.test.ts",
      "lib/behaviors/**/*.test.ts",
      // Arreglo 3 seam guard — imports app/api/**/system-prompt.ts (plain
      // modules, no native/DB/auth) + lib/agent/catalog.ts (already vitest-
      // safe, see the NB below). Lives at lib/ root, not under
      // lib/behaviors/, so it needs its own entry.
      "lib/design-guidance-seam.test.ts",
      "lib/curate/**/*.test.ts",
      "lib/generation/**/*.test.ts",
      "lib/templates/visual-metadata.test.ts",
      "lib/templates/store-visual-metadata.test.ts",
      "lib/templates/suggest-visual-metadata.test.ts",
      "lib/templates/visual-metadata-review-workflow.test.ts",
      "lib/fs/**/*.test.ts",
      // lib/ai mixes runners — vision-critique.test.ts is node:test (in
      // test:node), so list the vitest ai tests individually.
      "lib/ai/image-edit-core.test.ts",
      "lib/business-profiles/**/*.test.ts",
      "lib/billing/**/*.test.ts",
      "lib/auth/**/*.test.ts",
      // NB: lib/agent mixes runners — tools.test.ts exercises the native
      // html-engine binding and runs under node:test (`tsx --test`), so list
      // the vitest agent tests individually (same reason as lib/projects).
      "lib/agent/catalog.test.ts",
      "lib/agent/loop.test.ts",
      "lib/agent/retry.test.ts",
      "lib/agent/context.test.ts",
      "lib/agent/photo-search.test.ts",
      // P2 — pure summarizer (no native/DB); verify.test.ts is NOT here (it
      // value-imports the ai-gateway binding → node:test, in test:node).
      "lib/agent/business.test.ts",
      // Shape-only eval-battery test — no Gemini, no DB (the harness/runner are
      // what spend credits and are NEVER in the test suite / CI).
      "lib/agent/evals/cases.test.ts",
      "lib/theme-derive.test.ts",
      "lib/palette-gen-look.test.ts",
      "lib/theme-presets.test.ts",
      "lib/gradients.test.ts",
      "lib/tematicas/**/*.test.ts",
      "lib/site-assistant/**/*.test.ts",
      "lib/publish/assistant-widget.test.ts",
      "lib/publish/comments-widget.test.ts",
      "lib/publish/bookings-widget.test.ts",
      "lib/publish/collections-block.test.ts",
      "lib/publish/llms-txt.test.ts",
      "lib/publish/video-embed.test.ts",
      "lib/publish/signin-link.test.ts",
      "lib/publish/module-sections.test.ts",
      // DB-integration test (real Postgres via .env.local, same pattern as
      // lib/chat/identity-bridge.test.ts) — preview-bake.test.ts itself stays
      // on node:test (no DB env there), so this lives as its own file.
      "lib/publish/preview-bake-platforms-resolver.test.ts",
      "lib/publish/whatsapp-button.test.ts",
      "lib/publish/module-markup-tailwind.test.ts",
      "lib/publish/embed-sandbox.test.ts",
      "lib/publish/kill-switches.test.ts",
      "lib/publish/tw-config.test.ts",
      "lib/publish/design-stash-strip.test.ts",
      "lib/transform/**/*.test.ts",
      // Datos vivos (spec 2026-07-14) — el directorio aún no existe (Task 1
      // solo prepara el terreno). Listado por adelantado porque el include
      // de este repo es per-file: sin esta entrada, los tests que Task 2+
      // agreguen bajo lib/live/ correrían silenciosamente en ningún lado.
      "lib/live/**/*.test.ts",
      "lib/publish/chat-widget.test.ts",
      "lib/publish/orders-price.test.ts",
      "lib/publish/orders-cart.test.ts",
      "lib/members/**/*.test.ts",
      "lib/chat/**/*.test.ts",
      "lib/broadcast/**/*.test.ts",
      "lib/comments/**/*.test.ts",
      "lib/bookings/**/*.test.ts",
      "lib/collections/**/*.test.ts",
      "lib/models/**/*.test.ts",
      "lib/community/**/*.test.ts",
      "lib/marketing/**/*.test.ts",
      // Inbox badge (Results loop P2) — prevents silent skip on new test files
      "lib/inbox/**/*.test.ts",
      "components/inbox/**/*.test.ts",
      "infra/status-worker/**/*.test.ts",
      // Route guard for the one-time Explore seed trigger. Mocks the seed core,
      // so it never loads the native html-engine binding.
      "app/api/admin/explore-seed/route.test.ts",
      "app/api/admin/templates/[id]/route.test.ts",
      // Route guard for the internal live-republish trigger (Task 12). Mocks
      // lib/live/deps for the same reason — its import chain reaches the
      // native html-engine binding via lib/projects.ts.
      "app/api/internal/live-republish/route.test.ts",
      "app/api/internal/republish/route.test.ts",
      // NB: lib/projects/site-pages.test.ts is a node:test file (run via
      // `tsx --test`), so include the vitest project tests explicitly.
      "lib/projects/module-settings.test.ts",
      "lib/projects/module-intent.test.ts",
      "lib/projects/page-edge-paths.test.ts",
      "lib/projects/preview.test.ts",
      "lib/projects/settings-patch.test.ts",
      "lib/projects/create-page.test.ts",
      "lib/projects/drift-pill.test.ts",
      "lib/notifications/**/*.test.ts",
      "lib/publish/scene-host.test.ts",
      "lib/publish/procedural-3d.test.ts",
    ],
    exclude: [
      "node_modules/**",
      "tests/e2e/**",
      ".next/**",
      // node:test file (run via `tsx --test`, part of test:node) — would
      // otherwise get swept up by the lib/tematicas/**/*.test.ts wildcard
      // above and fail with "No test suite found" under vitest.
      "lib/tematicas/apply-server.test.ts",
    ],
  },
});
