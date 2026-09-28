// scripts/len-bench-repartir.ts — de plans/len-2/pendientes a dev (repo) y sellado (privado).
//   npm run bench:len:repartir -- --semilla=2026-09-23
//   npm run bench:len:repartir -- --semilla=2026-09-24 --sumar   (una tanda más)
// 🔴 Una vez que un caso se ha corrido con Len, es DEV para siempre: este script
// sólo reparte lo que está en `pendientes`, que nunca se ha corrido salvo el humo.
// ⚠️ MUEVE ficheros de plans/ (fuera de git): se niega si ya hay un reparto,
// salvo con `--sumar`, que reparte SÓLO lo nuevo con su propia semilla y lo
// añade a los índices sin tocar lo ya repartido (decisión 9: los casos de
// capacidad de la tanda 2, 2026-09-24).
import fs from "node:fs";
import path from "node:path";
import { repartir } from "@/lib/len-bench/repartir";
import { cargarEncargos } from "@/lib/len-bench/casos/cargar";

const YA_CORRIDOS = ["taqueria-menu-whatsapp"]; // el humo de B11: va a dev sin sortear

const pend = path.resolve("plans/len-2/pendientes");
const dev = path.resolve("lib/len-bench/casos/dev");
const sell = path.resolve("plans/len-2/sellado");

function mover(id: string, destino: string): number {
  fs.mkdirSync(path.join(destino, "paginas"), { recursive: true });
  fs.renameSync(path.join(pend, `${id}.ts`), path.join(destino, `${id}.ts`));
  const paginas = fs.readdirSync(path.join(pend, "paginas")).filter((f) => f.startsWith(`${id}.`));
  for (const f of paginas) fs.renameSync(path.join(pend, "paginas", f), path.join(destino, "paginas", f));
  return paginas.length;
}

function indice(ids: readonly string[], dirRel: string, cabecera: string): string {
  const nombre = (id: string) => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return [
    cabecera,
    'import path from "node:path";',
    'import type { Encargo } from "@/lib/len-bench/tipos";',
    ...ids.map((id) => `import { crear as ${nombre(id)} } from "./${id}";`),
    "",
    `const DIR = path.resolve(${JSON.stringify(dirRel)});`,
    "",
    "export const ENCARGOS: Encargo[] = [",
    ...ids.map((id) => `  ${nombre(id)}(DIR),`),
    "];",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const semilla = process.argv.find((a) => a.startsWith("--semilla="))?.slice("--semilla=".length);
  if (!semilla) throw new Error("falta --semilla=<texto> (se apunta en plans/len-2/reparto.md)");
  const sumar = process.argv.includes("--sumar");
  const hayReparto = (await cargarEncargos("dev")).length > 0 || fs.existsSync(path.join(sell, "index.ts"));
  if (hayReparto && !sumar) {
    throw new Error("ya hay un reparto (dev tiene casos o existe plans/len-2/sellado/index.ts): no se reparte dos veces (una tanda nueva va con --sumar)");
  }
  if (sumar) return sumarTanda(semilla);
  const todos = await cargarEncargos("pendientes");
  const faltan = YA_CORRIDOS.filter((id) => !todos.some((e) => e.id === id));
  if (faltan.length > 0) throw new Error(`los ya corridos tienen que estar en pendientes: falta ${faltan.join(", ")}`);
  const r = repartir(
    todos.filter((e) => !YA_CORRIDOS.includes(e.id)),
    semilla,
  );
  const aDev = [...YA_CORRIDOS, ...r.dev];

  let paginas = 0;
  for (const id of aDev) paginas += mover(id, dev);
  for (const id of r.sellado) paginas += mover(id, sell);
  const hecho = `// Generado por scripts/len-bench-repartir.ts (semilla «${semilla}»): el reparto está en plans/len-2/reparto.md.`;
  fs.writeFileSync(path.join(dev, "index.ts"), indice(aDev, "lib/len-bench/casos/dev/paginas", `// lib/len-bench/casos/dev/index.ts — el juego DEV.\n${hecho}`));
  fs.writeFileSync(path.join(sell, "index.ts"), indice(r.sellado, "plans/len-2/sellado/paginas", `// plans/len-2/sellado/index.ts — el juego SELLADO: no se corre hasta la fase 4.\n${hecho}`));
  fs.writeFileSync(path.join(pend, "index.ts"), indice([], "plans/len-2/pendientes/paginas", "// plans/len-2/pendientes/index.ts — los casos escritos y aún sin repartir."));
  const nivel = new Map(todos.map((e) => [e.id, e.nivel]));
  const lista = (ids: readonly string[]) => ids.map((id) => `${id} (${nivel.get(id)})`).join(", ");
  fs.writeFileSync(
    path.resolve("plans/len-2/reparto.md"),
    `# Reparto de Len-Bench\n\nFecha: ${new Date().toISOString()}\nSemilla: \`${semilla}\`\nAl azar, por nivel, 2/3 a dev (\`lib/len-bench/repartir.ts\`). Ya corridos, a dev sin sortear: ${YA_CORRIDOS.join(", ")}.\n\n- dev (${aDev.length}): ${lista(aDev)}\n- sellado (${r.sellado.length}): ${lista(r.sellado)}\n`,
  );
  const quedan = [...fs.readdirSync(pend).filter((f) => f !== "index.ts" && f !== "paginas"), ...fs.readdirSync(path.join(pend, "paginas"))];
  console.log(`dev ${aDev.length} · sellado ${r.sellado.length} · ${paginas} páginas movidas · anotado en plans/len-2/reparto.md`);
  if (quedan.length > 0) console.log(`⚠️ quedan en pendientes sin repartir: ${quedan.join(", ")}`);
}

/** Una tanda más: lo de `pendientes` se reparte con su semilla y se AÑADE a lo
 *  repartido, que no se mueve ni se vuelve a sortear. */
async function sumarTanda(semilla: string): Promise<void> {
  const previosDev = (await cargarEncargos("dev")).map((e) => e.id);
  const previosSellado = (await cargarEncargos("sellado")).map((e) => e.id);
  const nuevos = await cargarEncargos("pendientes");
  if (nuevos.length === 0) throw new Error("no hay nada en pendientes que sumar");
  const repetidos = nuevos.filter((e) => previosDev.includes(e.id) || previosSellado.includes(e.id)).map((e) => e.id);
  if (repetidos.length > 0) throw new Error(`ya están repartidos: ${repetidos.join(", ")}`);
  const r = repartir(nuevos, semilla);
  let paginas = 0;
  for (const id of r.dev) paginas += mover(id, dev);
  for (const id of r.sellado) paginas += mover(id, sell);
  const hecho = "// Generado por scripts/len-bench-repartir.ts: las tandas y sus semillas están en plans/len-2/reparto.md.";
  fs.writeFileSync(path.join(dev, "index.ts"), indice([...previosDev, ...r.dev], "lib/len-bench/casos/dev/paginas", `// lib/len-bench/casos/dev/index.ts — el juego DEV.\n${hecho}`));
  fs.writeFileSync(
    path.join(sell, "index.ts"),
    indice([...previosSellado, ...r.sellado], "plans/len-2/sellado/paginas", `// plans/len-2/sellado/index.ts — el juego SELLADO: no se corre hasta la fase 4.\n${hecho}`),
  );
  fs.writeFileSync(path.join(pend, "index.ts"), indice([], "plans/len-2/pendientes/paginas", "// plans/len-2/pendientes/index.ts — los casos escritos y aún sin repartir."));
  const nivel = new Map(nuevos.map((e) => [e.id, e.nivel]));
  const lista = (ids: readonly string[]) => ids.map((id) => `${id} (${nivel.get(id)})`).join(", ");
  fs.appendFileSync(
    path.resolve("plans/len-2/reparto.md"),
    `\n## Tanda sumada el ${new Date().toISOString()}\n\nSemilla: \`${semilla}\`. Sólo lo nuevo, al azar y por nivel; lo ya repartido no se toca.\n\n- dev (+${r.dev.length}): ${lista(r.dev)}\n- sellado (+${r.sellado.length}): ${lista(r.sellado)}\n`,
  );
  console.log(`tanda: dev +${r.dev.length} · sellado +${r.sellado.length} · ${paginas} páginas movidas · anotado en plans/len-2/reparto.md`);
}

void main().catch((e: unknown) => {
  console.error(`len-bench-repartir: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
