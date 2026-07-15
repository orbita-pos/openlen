// Runner LOCAL de dev/prueba manual para "datos vivos" (spec §6) — `npm run
// live:republish` (tsx). PROD NO usa este script: systemd dispara
// POST /api/internal/live-republish (app/api/internal/live-republish/route.ts)
// en su lugar, porque ese endpoint corre EN PROCESO con la app y ya tiene los
// crates nativos (.node) cargados — scripts/build-cron.mjs bundlea otros
// crons a .mjs con esbuild, pero ese bundler no puede empaquetar esos crates,
// así que este script se queda sin bundlear (Task 12).
//
// Toda la lógica real vive en módulos compartidos con la ruta:
//   - lib/live/republish.ts     el núcleo testeado (selección, tope, dedup)
//   - lib/live/collect-targets.ts  la query de proyectos con datos vivos
//   - lib/live/deps.ts          el cableado de dependencias reales
import { runLiveRepublish } from "@/lib/live/republish";
import { liveRepublishDeps } from "@/lib/live/deps";

async function main() {
  const summary = await runLiveRepublish(liveRepublishDeps());
  // eslint-disable-next-line no-console
  console.log("[live-republish] " + JSON.stringify(summary));
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[live-republish] fatal", err);
  process.exit(1);
});
