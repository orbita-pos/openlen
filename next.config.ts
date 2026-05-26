import { withInariWatch } from "@inariwatch/capture/next";
import path from "node:path";

// NextConfig is intentionally untyped here. `withInariWatch` accepts a
// loose `NextConfig` shape (`experimental?: Record<string, unknown>`) that
// conflicts with Next's own stricter `NextConfig['experimental']` interface;
// letting TS infer from the literal keeps both happy.
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname),
  // Force the standalone tracer to copy tailwindcss's package-relative CSS
  // assets (preflight.css, stubs) into the standalone tree alongside the
  // JS — they're loaded at runtime via `fs.readFileSync` and the tracer
  // doesn't follow that.
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/tailwindcss/lib/css/*.css",
      "./node_modules/tailwindcss/stubs/*",
    ],
  },
  // Without external-ing tailwindcss + postcss, webpack inlines them into
  // .next/server/chunks/*.js and the bundled code's __dirname resolves to
  // chunks/, where it then looks for `chunks/css/preflight.css` (doesn't
  // exist). Marking them external preserves the original node_modules
  // layout at runtime so `require.resolve` / __dirname-based asset
  // lookups in publish-time Tailwind baking find their CSS files.
  serverExternalPackages: ["tailwindcss", "postcss"],
  // Standalone build emits `.next/standalone/server.js` plus the minimum
  // `node_modules/` tree the runtime actually needs. `.next/static/` and
  // `public/` stay outside `standalone/` and must be copied in by the
  // deploy script before launching the server — see `infra/scripts/deploy.sh`.
  output: "standalone" as const,
};

export default withInariWatch(nextConfig);
