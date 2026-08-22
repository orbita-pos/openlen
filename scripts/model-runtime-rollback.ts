// Inventario y apagado operativo del piloto de JavaScript del modelo.
//
// EL HUECO QUE ESTE SCRIPT TAPA. `OPENLEN_MODEL_JS=0` impide que se inyecte
// runtime en las publicaciones FUTURAS. No toca una sola de las páginas ya
// servidas: viven en disco, en su release, con su script dentro. Apagar el
// interruptor y creer que el JavaScript desapareció es exactamente la clase de
// error que sólo se descubre mirando la página.
//
//   npm run model-runtime:rollback            → sólo lista (no toca nada)
//   npm run model-runtime:rollback -- --apply → republica sin runtime y COMPRUEBA
//
// Run: npm run model-runtime:rollback

import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, isNotNull } from "drizzle-orm";

// SE FUERZA APAGADO EN ESTE PROCESO, antes de importar nada que lo lea.
// La herramienta de rollback no puede depender de que quien la ejecuta se haya
// acordado de exportar la variable: si corriera con el piloto encendido,
// "republicar para quitar el JavaScript" volvería a meterlo.
process.env.OPENLEN_MODEL_JS = "0";

const APPLY = process.argv.includes("--apply");

const raizPublicacion = () => process.env.PUBLISH_ROOT ?? "/var/www/openlen";

/** Lee el index.html que está VIVO ahora mismo para ese subdominio. */
async function documentoVivo(sub: string): Promise<string | null> {
  for (const p of [
    path.join(raizPublicacion(), sub, "current", "index.html"),
    path.join(raizPublicacion(), sub, "index.html"),
  ]) {
    try {
      return await readFile(p, "utf8");
    } catch {
      /* siguiente */
    }
  }
  return null;
}

async function main() {
  // Importados AQUÍ, no arriba: el `process.env` de más arriba ya corrió, así
  // que cualquier módulo que lea el interruptor al cargarse lo ve apagado. Y un
  // `await import` a nivel de módulo no compila bajo el arnés CJS de tsx.
  const { db, schema } = await import("../lib/db");
  const { publishProject } = await import("../lib/projects");
  const filas = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      subdomain: schema.projects.subdomain,
      sha: schema.projects.publishedReleaseSha,
      runtime: schema.projects.generatedRuntime,
    })
    .from(schema.projects)
    .where(and(isNotNull(schema.projects.generatedRuntime), isNotNull(schema.projects.publishedAt)));

  if (filas.length === 0) {
    console.log("Ningún proyecto publicado lleva runtime del modelo. Nada que hacer.");
    process.exit(0);
  }

  console.log(`${filas.length} proyecto(s) publicados con cápsula:\n`);
  for (const f of filas) {
    const vivo = f.subdomain ? await documentoVivo(f.subdomain) : null;
    const codigo = f.runtime?.code ?? "";
    // La pregunta no es si la fila tiene cápsula, sino si el código está EN LA
    // PÁGINA QUE SE SIRVE. Puede tener cápsula y haberse publicado sin ella.
    const inyectado = vivo !== null && codigo !== "" && vivo.includes(codigo);
    console.log(
      `  ${f.id}  ${(f.subdomain ?? "-").padEnd(24)} release ${f.sha ?? "?"}  ` +
        `${vivo === null ? "(no se pudo leer el disco)" : inyectado ? "CON js vivo" : "sin js"}`,
    );
  }

  if (!APPLY) {
    console.log("\nSólo lectura. Añade --apply para republicar sin runtime.");
    process.exit(0);
  }

  console.log("\nRepublicando sin runtime…\n");
  let ok = 0;
  const fallidos: { id: string; motivo: string }[] = [];
  const sinLimpiar: string[] = [];

  for (const f of filas) {
    if (!f.subdomain) continue;
    try {
      await publishProject({
        projectId: f.id,
        userId: f.userId,
        subdomain: f.subdomain,
        skipFlightCheck: true,
      });
      // COMPROBAR, no suponer. Una republicación que devuelve sin error pero
      // deja el script dentro es peor que un fallo: parece un rollback hecho.
      const vivo = await documentoVivo(f.subdomain);
      const codigo = f.runtime?.code ?? "";
      if (vivo !== null && codigo !== "" && vivo.includes(codigo)) {
        sinLimpiar.push(f.id);
        console.log(`  ✖ ${f.id} — republicado y el código SIGUE en la página`);
      } else {
        ok += 1;
        console.log(`  ✔ ${f.id} (${f.subdomain})`);
      }
    } catch (err) {
      const motivo = String((err as Error)?.message ?? err).slice(0, 140);
      fallidos.push({ id: f.id, motivo });
      console.log(`  ✖ ${f.id} — ${motivo}`);
    }
  }

  console.log(`\n${ok} limpios · ${fallidos.length} fallidos · ${sinLimpiar.length} sin limpiar`);
  if (fallidos.length > 0 || sinLimpiar.length > 0) {
    console.log(
      "\nLos que no quedaron limpios necesitan rollback manual al release estático\n" +
        "anterior (TopBar → despliegues anteriores, o el symlink `current` en la caja).",
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
