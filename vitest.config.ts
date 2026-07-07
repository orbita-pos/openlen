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
    globalSetup: ["./vitest.global-setup.ts"],
    environment: "jsdom",
    include: [
      "components/workspace-v2/**/*.test.ts",
      "components/community/**/*.test.ts",
      "lib/three3d/**/*.test.ts",
      "lib/workspace-v2/**/*.test.ts",
      "lib/sections/**/*.test.ts",
      "lib/analytics/**/*.test.ts",
      "lib/assemble/**/*.test.ts",
      "lib/curate/**/*.test.ts",
      "lib/business-profiles/**/*.test.ts",
      "lib/billing/**/*.test.ts",
      "lib/auth/**/*.test.ts",
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
      "lib/publish/video-embed.test.ts",
      "lib/publish/signin-link.test.ts",
      "lib/publish/module-sections.test.ts",
      "lib/publish/whatsapp-button.test.ts",
      "lib/publish/chat-widget.test.ts",
      "lib/members/**/*.test.ts",
      "lib/chat/**/*.test.ts",
      "lib/broadcast/**/*.test.ts",
      "lib/comments/**/*.test.ts",
      "lib/bookings/**/*.test.ts",
      "lib/collections/**/*.test.ts",
      "lib/models/**/*.test.ts",
      "lib/community/**/*.test.ts",
      "lib/marketing/**/*.test.ts",
      // Route guard for the one-time Explore seed trigger. Mocks the seed core,
      // so it never loads the native html-engine binding.
      "app/api/admin/explore-seed/route.test.ts",
      // NB: lib/projects/site-pages.test.ts is a node:test file (run via
      // `tsx --test`), so include the vitest project tests explicitly.
      "lib/projects/module-settings.test.ts",
      "lib/projects/module-intent.test.ts",
      "lib/projects/page-edge-paths.test.ts",
      "lib/projects/preview.test.ts",
      "lib/projects/settings-patch.test.ts",
      "lib/notifications/**/*.test.ts",
      "lib/publish/scene-host.test.ts",
      "lib/publish/procedural-3d.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
});
