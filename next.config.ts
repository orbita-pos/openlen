import { withInariWatch } from "@inariwatch/capture/next";

// NextConfig is intentionally untyped here. `withInariWatch` accepts a
// loose `NextConfig` shape (`experimental?: Record<string, unknown>`) that
// conflicts with Next's own stricter `NextConfig['experimental']` interface;
// letting TS infer from the literal keeps both happy.
const nextConfig = {
  reactStrictMode: true,
};

export default withInariWatch(nextConfig);
