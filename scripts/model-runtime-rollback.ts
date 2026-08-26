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

import { and, isNotNull, or } from "drizzle-orm";

// SE FUERZA APAGADO EN ESTE PROCESO, antes de importar nada que lo lea.
// La herramienta de rollback no puede depender de que quien la ejecuta se haya
// acordado de exportar la variable: si corriera con el piloto encendido,
// "republicar para quitar el JavaScript" volvería a meterlo.
process.env.OPENLEN_MODEL_JS = "0";

const APPLY = process.argv.includes("--apply");

const raizPublicacion = () => process.env.PUBLISH_ROOT ?? "/var/www/openlen";

/** Lee el documento que está VIVO ahora mismo. `page` nulo = la Home. */
async function documentoVivo(sub: string, page: string | null = null): Promise<string | null> {
  const hoja = page ? path.join(page, "index.html") : "index.html";
  for (const p of [
    path.join(raizPublicacion(), sub, "current", hoja),
    path.join(raizPublicacion(), sub, hoja),
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
  const { runtimeMapDe } = await import("../lib/projects/page-runtimes");
  const filas = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      subdomain: schema.projects.subdomain,
      sha: schema.projects.publishedReleaseSha,
      runtime: schema.projects.generatedRuntime,
      // LAS SUBPÁGINAS TAMBIÉN. Sin esto el apagado de emergencia era parcial de
      // dos maneras: un proyecto cuyo JavaScript vive SÓLO en subpáginas
      // (`generatedRuntime` en NULL) ni siquiera aparecía en la lista, y de los
      // que sí aparecían nadie miraba sus subpáginas al comprobar. Un rollback
      // que deja código vivo y dice OK es peor que uno que falla.
      pageRuntimes: schema.projects.pageRuntimes,
    })
    .from(schema.projects)
    .where(
      and(
        or(
          isNotNull(schema.projects.generatedRuntime),
          isNotNull(schema.projects.pageRuntimes),
        ),
        isNotNull(schema.projects.publishedAt),
      ),
    );

  if (filas.length === 0) {
    console.log("Ningún proyecto publicado lleva runtime del modelo. Nada que hacer.");
    process.exit(0);
  }

  /**
   * Qué documentos de este proyecto tienen SU código dentro del fichero vivo.
   *
   * La pregunta no es si la fila tiene cápsula, sino si el código está EN LA
   * PÁGINA QUE SE SIRVE: se puede tener cápsula y haberse publicado sin ella.
   * Devuelve las etiquetas de los que siguen vivos («/», «/menu»…), o `null`
   * si no se pudo leer ni un documento del disco.
   */
  async function documentosConJsVivo(f: (typeof filas)[number]): Promise<string[] | null> {
    if (!f.subdomain) return null;
    const vivos: string[] = [];
    let algoLeido = false;
    const candidatos: Array<{ etiqueta: string; page: string | null; codigo: string }> = [
      ...(f.runtime?.code ? [{ etiqueta: "/", page: null, codigo: f.runtime.code }] : []),
      ...Object.entries(runtimeMapDe(f.pageRuntimes)).map(([slug, c]) => ({
        etiqueta: `/${slug}`,
        page: slug,
        codigo: c?.code ?? "",
      })),
    ];
    for (const c of candidatos) {
      const vivo = await documentoVivo(f.subdomain, c.page);
      if (vivo === null) continue;
      algoLeido = true;
      if (c.codigo !== "" && vivo.includes(c.codigo)) vivos.push(c.etiqueta);
    }
    return algoLeido ? vivos : null;
  }

  console.log(`${filas.length} proyecto(s) publicados con cápsula:\n`);
  for (const f of filas) {
    const vivos = await documentosConJsVivo(f);
    console.log(
      `  ${f.id}  ${(f.subdomain ?? "-").padEnd(24)} release ${f.sha ?? "?"}  ` +
        `${vivos === null ? "(no se pudo leer el disco)" : vivos.length > 0 ? `CON js vivo en ${vivos.join(", ")}` : "sin js"}`,
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
      // …Y EN TODOS SUS DOCUMENTOS, no sólo la Home.
      const vivos = await documentosConJsVivo(f);
      if (vivos !== null && vivos.length > 0) {
        sinLimpiar.push(f.id);
        console.log(`  ✖ ${f.id} — republicado y el código SIGUE en ${vivos.join(", ")}`);
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
