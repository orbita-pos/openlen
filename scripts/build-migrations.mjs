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
const targets = [
  "billing-migrate",
  "models-migrate",
  "community-migrate",
  "chat-migrate",
  "inbox-migrate",
  "publish-hash-migrate",
  "versions-baseline-migrate",
  "template-visual-metadata-migrate",
  "visual-engine-pilot-migrate",
];

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
