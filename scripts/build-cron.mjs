// Bundles the tsx cron entrypoints into self-contained ESM files so the systemd
// timers can run them with plain `node` on the standalone box (which prunes
// node_modules and never ships scripts/ or lib/ source). Run by deploy.ps1
// AFTER the Next build, emitting into .next/standalone/cron/ so the tarball
// carries them to /opt/openlen-app/cron/. Env comes from systemd's
// EnvironmentFile at runtime (the bundle reads process.env directly).
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  tsconfig: "tsconfig.json",
  // Some bundled CJS deps call require() at runtime; ESM output has no require,
  // so shim it from import.meta.url.
  banner: {
    js: "import { createRequire as ___cr } from 'module'; const require = ___cr(import.meta.url);",
  },
  logLevel: "info",
};

const targets = [
  { entry: "scripts/bookings-remind.ts", out: ".next/standalone/cron/bookings-remind.mjs" },
  { entry: "scripts/analytics/rollup-daily.ts", out: ".next/standalone/cron/analytics-rollup.mjs" },
  { entry: "scripts/notifications-drain.ts", out: ".next/standalone/cron/notifications-drain.mjs" },
];

for (const t of targets) {
  await build({ ...common, entryPoints: [t.entry], outfile: t.out });
  console.log(`bundled ${t.entry} -> ${t.out}`);
}
