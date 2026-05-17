import { withInariWatch } from "@inariwatch/capture/next";
import path from "node:path";

// NextConfig is intentionally untyped here. `withInariWatch` accepts a
// loose `NextConfig` shape (`experimental?: Record<string, unknown>`) that
// conflicts with Next's own stricter `NextConfig['experimental']` interface;
// letting TS infer from the literal keeps both happy.
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname),
  // Standalone build emits `.next/standalone/server.js` plus the minimum
  // `node_modules/` tree the runtime actually needs. `.next/static/` and
  // `public/` stay outside `standalone/` and must be copied in by the
  // deploy script before launching the server — see `infra/scripts/deploy.sh`.
  output: "standalone" as const,
};

export default withInariWatch(nextConfig);
