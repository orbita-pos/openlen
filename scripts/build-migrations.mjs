// Bundles the DB migration entrypoints into self-contained ESM so they can run
// with plain `node` ON THE BOX, against the production database.
//
// Why this exists: deploy.ps1 used to run `npm run <x>:migrate` LOCALLY, and
// those npm scripts read `.env.local` — which has pointed at the dev database
// since dev/prod were split (2026-07-20). Every migration step in the deploy
// had been a no-op against production ever since; it only stayed invisible
// because the columns already existed there. The first genuinely new column
// (publishedHomeHash, 2026-07-30) took prod down: the shipped code selected a
// column the migration had "successfully" added to the wrong database.
//
// Running them on the box also fixes privileges: the app role (openlen_app)
// does NOT own the tables and cannot ALTER them. `DATABASE_URL_DIRECT` in
// /etc/openlen/openlen.env points at openlen_migrate, which does — that pair
// already existed; the deploy simply never used it.
//
// Same bundling trick as build-cron.mjs, for the same reason: the standalone
// box prunes node_modules and never ships scripts/ or lib/ source, so `tsx`
// isn't available there.
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

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
  logLevel: "warning",
};

// Order matters: they run in this sequence on the box. All are idempotent
// (ADD COLUMN / CREATE TABLE ... IF NOT EXISTS), so a re-deploy is a no-op.
// ⚰️ RETIRADAS el 2026-08-29, con los rasgos a los que servian:
//   models-migrate         el modulo 3D, retirado el 2026-08-26 con motion y musica
//   model-runtime-migrate  la capsula de `OPENLEN_MODEL_JS`, retirada el mismo dia
//
// Sus scripts ya no existen ni en `scripts/` ni en package.json, y este fichero
// seguia nombrandolos: el despliegue del 2026-08-29 se paro aqui, en local,
// antes de subir nada. La guarda de abajo hizo su trabajo — se conserva.
//
// NO se tocan las tablas que crearon en produccion. Retirar la migracion deja
// de re-ejecutar un no-op idempotente; borrar sus tablas es otra decision, con
// otro riesgo, y nadie la ha pedido.
const targets = [
  "billing-migrate",
  "community-migrate",
  "chat-migrate",
  "inbox-migrate",
  "publish-hash-migrate",
  "versions-baseline-migrate",
  "template-visual-metadata-migrate",
  "visual-engine-pilot-migrate",
  "user-memory-migrate",
  "page-data-migrate",
  // 🔴 SE ARMA EN EL SEGUNDO DESPLIEGUE, NO EN EL PRIMERO. Tira la tabla
  // `businessProfiles` y la columna `projects.profileId`.
  //
  // Las migraciones corren en el paso 6 y el código cambia en el 7, con la
  // reconstrucción de los crates (~5 min) EN MEDIO. Soltar la columna mientras
  // producción todavía sirve el código que la SELECCIONA son cinco minutos de
  // 500 en cada listado de proyectos. Por eso fueron dos despliegues.
  //
  // Se arma el 2026-08-31 tras COMPROBARLO en la caja, no por calendario:
  //   grep -rl profileId /opt/openlen-app/.next/       → 0 ficheros
  //   grep -rl businessProfiles /opt/openlen-app/.next/ → 0 ficheros
  // El código vivo ya no la nombra. Y las 16 filas están respaldadas fuera del
  // repo, verificadas fila por fila contra la base.
  "perfil-drop-migrate",
  // `projectChatMessages.toolResults` — el diario del turno. Aditiva e
  // idempotente, así que va al final sin orden que respetar.
  //
  // 🔴 Y ES OBLIGATORIA, no opcional: `getChatMessages` hace `select()` de la
  // tabla entera, así que el código nuevo SELECCIONA la columna. Sin esta línea
  // el deploy repetiría exactamente el fallo de `publishedHomeHash` que cuenta
  // la cabecera de este fichero — la migración "corriendo con éxito" contra la
  // base equivocada y prod tirada.
  "diario-turno-migrate",
  // `users.agentEffort` — la postura de esfuerzo del Agente que elige el
  // usuario. Aditiva e idempotente, así que su posición no impone orden.
  "agent-effort-migrate",
];

// LO SIMÉTRICO, y es el agujero que faltaba: un script de migración que EXISTE
// y que nadie listó aquí. La guarda de abajo caza lo listado-y-borrado; esto
// caza lo escrito-y-olvidado, que es peor porque no falla — el deploy sale
// verde y la columna nunca llega a producción. Es literalmente el fallo de
// `publishedHomeHash` que cuenta la cabecera, y volvió a pasar el 2026-09-10
// con `diario-turno-migrate`: se añadió el script y el `*:migrate` de npm, que
// sólo toca la base de DESARROLLO.
//
// Las de `YA_EN_PRODUCCION` se aplicaron a mano o antes del corte dev/prod
// (2026-07-20). VERIFICADO contra la base de producción el 2026-09-10: sus 12
// tablas y columnas existen todas. No se añaden a `targets` porque serían
// no-ops idempotentes, pero se NOMBRAN aquí para que la ausencia sea una
// decisión escrita y no un hueco. Una migración nueva tiene que ir a una de
// las dos listas, a propósito.
const YA_EN_PRODUCCION = [
  "analytics-migrate",
  "contract-migrate",
  "credits-centicreditos-migrate",
  "drift-migrate",
  "flight-migrate",
  "integrations-migrate",
  "localize-migrate",
  "notifications-migrate",
  "post-templates-migrate",
  "privatechat-migrate",
  "templates-pages-migrate",
  "versions-migrate",
];

{
  const { readdirSync } = await import("node:fs");
  const enDisco = readdirSync("scripts")
    .filter((f) => f.endsWith("-migrate.ts"))
    .map((f) => f.slice(0, -3));
  const sinClasificar = enDisco.filter(
    (n) => !targets.includes(n) && !YA_EN_PRODUCCION.includes(n),
  );
  if (sinClasificar.length > 0) {
    console.error(
      `\n  Migraciones SIN CLASIFICAR: ${sinClasificar.join(", ")}\n` +
        `  Un script de migración que no está en \`targets\` NO corre nunca contra\n` +
        `  producción: \`npm run <x>:migrate\` lee .env.local, o sea la base de\n` +
        `  DESARROLLO. Si el código nuevo selecciona su columna, el deploy tira prod.\n` +
        `  Añádela a \`targets\` (scripts/build-migrations.mjs), o a YA_EN_PRODUCCION\n` +
        `  si compruebas contra la base que su DDL ya está allí.\n`,
    );
    process.exit(1);
  }
}

// Una entrada que apunta a un script BORRADO tumba el deploy en el paso 3,
// después de los gates y del build — o sea, tras varios minutos de trabajo ya
// hecho. Pasó de verdad (2026-08-20) con `sections-derived-migrate`, que murió
// con el catálogo de secciones y siguió listado aquí: el mismo descuido que
// dejó a los gates nombrando 216 tests eliminados.
//
// Comprobarlo cuesta microsegundos y falla ANTES de empezar, diciendo cuál.
{
  const { existsSync } = await import("node:fs");
  const huerfanas = targets.filter((n) => !existsSync(`scripts/${n}.ts`));
  if (huerfanas.length > 0) {
    console.error(
      `
  Migraciones listadas que YA NO EXISTEN: ${huerfanas.join(", ")}
` +
      `  Bórralas de la lista de arriba (scripts/build-migrations.mjs) — si el
` +
      `  script se borró, su migración ya no tiene tabla que migrar.
`,
    );
    process.exit(1);
  }
}

for (const [i, name] of targets.entries()) {
  const entry = `scripts/${name}.ts`;
  // Numeric prefix so the runner's glob keeps order.
  const out = `.next/standalone/migrations/${String(i + 1).padStart(2, "0")}-${name}.mjs`;
  await build({ ...common, entryPoints: [entry], outfile: out });
  console.log(`bundled ${entry} -> ${out}`);
}

// El runner viaja EN EL TARBALL en vez de ir como argumento de ssh. Aprendido a
// golpes: pasar el script por `& ssh $host $string` desde PowerShell le come las
// comillas y le mete CRLF, y bash muere con "set: -: invalid option". Aquí se
// escribe con \n explícitos, así que llega intacto y el deploy solo tiene que
// invocar `bash .../run.sh` — un comando corto y sin nada que escapar.
//
// Lee DATABASE_URL_DIRECT (rol dueño de las tablas) con grep en vez de sourcear
// /etc/openlen/openlen.env: ese archivo lo parsea systemd, que tolera valores
// sin comillas como EMAIL_FROM="Nombre <correo>"; bash los lee como redirección
// y aborta. `cut -d= -f2-` conserva los `=` del querystring de la URL.
const runner = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "ENV_FILE=${OPENLEN_ENV_FILE:-/etc/openlen/openlen.env}",
  "DIR=$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)",
  "U=$(grep -m1 '^DATABASE_URL_DIRECT=' \"$ENV_FILE\" | cut -d= -f2- | tr -d '\\042\\047')",
  "if [ -z \"$U\" ]; then",
  "  echo \"FATAL: DATABASE_URL_DIRECT missing from $ENV_FILE\" >&2",
  "  echo \"       (owner-role URL; without it migrations cannot ALTER)\" >&2",
  "  exit 1",
  "fi",
  "echo \"    role: $(echo \"$U\" | sed -E 's#postgresql://([^:]+):.*#\\1#')\"",
  "for m in \"$DIR\"/*.mjs; do",
  "  echo \"    -> $(basename \"$m\")\"",
  "  DATABASE_URL=\"$U\" node \"$m\"",
  "done",
  "",
].join("\n");

await writeFile(".next/standalone/migrations/run.sh", runner, { encoding: "utf8" });
console.log("wrote .next/standalone/migrations/run.sh (LF, self-contained)");
