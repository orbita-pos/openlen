// lib/functions/bundler/bundle-hash.ts — a functions bundle's identity: what the
// engine and the deployment store compare. Its own file so that what only needs
// the hash (live-core.ts, when Stripe's live ids go into the bundle) doesn't load
// the bundler.

import { createHash } from "node:crypto";

export function bundleHash(files: Readonly<Record<string, string>>): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
}
