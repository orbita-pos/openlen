// Bundles the tsx cron entrypoints into self-contained ESM files so the systemd
// timers can run them with plain `node` on the standalone box (which prunes
// node_modules and never ships scripts/ or lib/ source). Run by deploy.ps1
// AFTER the Next build, emitting into .next/standalone/cron/ so the tarball
// carries them to /opt/openlen-app/cron/. Env comes from systemd's
// EnvironmentFile at runtime (the bundle reads process.env directly).
import { build } from "esbuild";

// LAS EDGE FUNCTIONS: lib/backend/files.ts redespliega el borrador al guardar
// con un import perezoso de lib/functions/deploy, que esbuild empaqueta igual, y
// con él el registro, lib/projects y los crates nativos (.node), que aquí no se
// pueden empaquetar (el drenaje de avisos llega a files.ts por el chat del
// equipo → deshacer un turno). Los trabajos del cron no guardan ficheros de un
// proyecto: para ellos ese módulo no hace nada. Un import con otro nombre de
// él falla al empaquetar, no en silencio.
const noFunctionsDeploy = {
  name: "no-functions-deploy",
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/functions\/deploy$/ }, () => ({ path: "functions-deploy", namespace: "cron-stub" }));
    b.onLoad({ filter: /.*/, namespace: "cron-stub" }, () => ({ contents: "export function scheduleDraftDeployIfEnabled() {}", loader: "js" }));
  },
};

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
  // `import "server-only"` lanza fuera de Next: aquí es el módulo vacío, como en
  // vitest y en el servidor de Realtime. Sin esto, el aviso de una mención del
  // chat (lib/projects/chat-equipo → hilos.ts) tumbaba el drenaje entero de
  // avisos (ensayo de caja, 08/10; lib/notifications/cron-bundle.test.ts).
  alias: { "server-only": "./node_modules/server-only/empty.js" },
  plugins: [noFunctionsDeploy],
};

const targets = [
  { entry: "scripts/analytics/rollup-daily.ts", out: ".next/standalone/cron/analytics-rollup.mjs" },
  { entry: "scripts/notifications-drain.ts", out: ".next/standalone/cron/notifications-drain.mjs" },
  { entry: "scripts/renewal-reminders.ts", out: ".next/standalone/cron/renewal-reminders.mjs" },
  // NB: lo que llama a publishProject NO se bundlea aquí — arrastra los crates
  // nativos (.node), cuyo `require` relativo esbuild no puede empaquetar en un
  // .mjs standalone. Esas tareas corren EN PROCESO con la app, detrás de una
  // ruta interna (app/api/internal/republish*), con los crates ya cargados.
  // (Así se hacía el refresco horario de datos vivos, retirado en Len 2.1.)
];

for (const t of targets) {
  await build({ ...common, entryPoints: [t.entry], outfile: t.out });
  console.log(`bundled ${t.entry} -> ${t.out}`);
}

// carril D (Len 2.5, pieza 15): el servicio de Realtime de las páginas, un
// proceso aparte (infra/app/openlen-realtime.service). Lo que importa de
// lib/backend lleva `import "server-only"`, que fuera de Next lanza: aquí es el
// módulo vacío, como en vitest. No toca nada de publicar (sin crates nativos):
// lib/backend/realtime/project-lookup.ts existe para eso.
await build({
  ...common,
  entryPoints: ["scripts/realtime-server.ts"],
  outfile: ".next/standalone/realtime/server.mjs",
});
console.log("bundled scripts/realtime-server.ts -> .next/standalone/realtime/server.mjs");
