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
  { entry: "scripts/analytics/rollup-daily.ts", out: ".next/standalone/cron/analytics-rollup.mjs" },
  { entry: "scripts/notifications-drain.ts", out: ".next/standalone/cron/notifications-drain.mjs" },
  // NB (datos vivos, Task 12): scripts/live-republish.ts NO se bundlea aquí a
  // propósito — importa publishProject, que arrastra los crates nativos
  // (.node) cuyo `require` relativo esbuild no puede empaquetar en un .mjs
  // standalone. La entrega en prod usa la opción (a): systemd
  // (infra/app/openlen-live-republish.timer) hace curl a
  // POST /api/internal/live-republish (app/api/internal/live-republish/route.ts),
  // que corre EN PROCESO con la app — los crates nativos ya están cargados, sin
  // bundling. El núcleo (lib/live/republish.ts) está probado; el script
  // (scripts/live-republish.ts) corre vía `npm run live:republish` (tsx) solo
  // para dev/prueba manual, nunca en prod.
];

for (const t of targets) {
  await build({ ...common, entryPoints: [t.entry], outfile: t.out });
  console.log(`bundled ${t.entry} -> ${t.out}`);
}
