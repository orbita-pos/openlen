// scripts/voz-sembrar.ts — siembra UN proyecto de la base LOCAL para probar la
// llamada: visitas de los últimos 7 días (6 de cada 10 desde Instagram), un
// mensaje de Juan sin leer y dos encargos sin ver. Sólo la base local
// (`exigirBaseLocal`); el proyecto se nombra a mano, nunca se elige solo.
//
// ⚠️ BORRA las visitas del proyecto antes de sembrar: sólo sobre uno de PRUEBA.
//
//   npx tsx --tsconfig tsconfig.eval.json --env-file=<.env.local> \
//     --require ./scripts/test-node-server-only-shim.cjs scripts/voz-sembrar.ts --proyecto=<id>
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { plantarChat, plantarFormulario } from "@/lib/len-bench/casos/resultados/sembrar";

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a?.slice(n.length + 1);
}

async function main(): Promise<void> {
  const projectId = arg("--proyecto");
  if (!projectId) throw new Error("falta --proyecto=<id>");
  const zona = arg("--zona") ?? "America/Mexico_City";
  await exigirBaseLocal();

  const fila = (await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1))[0];
  if (!fila) throw new Error(`no existe el proyecto ${projectId} en la base local`);

  const ahora = new Date();
  const DIA = 24 * 60 * 60 * 1000;
  const porDia = [31, 38, 44, 71, 52, 48, 28];
  const filas = porDia.flatMap((n, i) => {
    const ts = new Date(ahora.getTime() - (6 - i) * DIA - 60 * 60 * 1000);
    return Array.from({ length: n }, (_, k) => ({
      projectId,
      type: "view",
      ts,
      uaHash: `voz-${i}-${k}`,
      device: k % 4 === 0 ? "desktop" : "mobile",
      referrer: k % 10 < 6 ? "https://www.instagram.com/" : null,
    }));
  });
  await db.delete(schema.pageEvents).where(and(eq(schema.pageEvents.projectId, projectId), eq(schema.pageEvents.type, "view")));
  await db.insert(schema.pageEvents).values(filas);

  await plantarChat({ projectId, ownerId: fila.userId, zona, ahora }, "Juan", ["¿Abren el domingo?"]);
  await plantarFormulario(projectId, `voz-${ahora.getTime()}-1`, { nombre: "María", mensaje: "Un pastel de chocolate para el sábado" }, new Date(ahora.getTime() - 3 * DIA), null);
  await plantarFormulario(projectId, `voz-${ahora.getTime()}-2`, { nombre: "Pedro", mensaje: "¿Tienen pan sin gluten?" }, new Date(ahora.getTime() - DIA), null);

  console.log(`[voz] sembrado ${projectId}: ${filas.length} visitas en 7 días, 1 mensaje de Juan, 2 encargos`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
