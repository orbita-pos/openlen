// Compara dos o más corridas de Len-Bench caso a caso: capacidad y regresión por
// separado, y la diferencia EMPAREJADA (mismo caso, mismos graders) con su ±.
//
// Uso: npx tsx --tsconfig tsconfig.eval.json scripts/len-bench-comparar.ts \
//        A=<resultados.json> B=<resultados.json> [C=<resultados.json>] [--menos=A]
// Cada brazo lleva un nombre (lo de antes del «=»). `--menos=A` resta ese brazo
// de todos los demás (por defecto, el primero).
//
// El ± es el intervalo del 95 % de la media de las diferencias por caso, con la
// t de Student para n−1 grados de libertad: los casos son la unidad (no las
// corridas), que es lo que se muestrea al escribir la vara. Con dos brazos del
// MISMO código (1.5 dos veces) la diferencia mide el ruido: el suelo.
import fs from "node:fs";
import { REGRESION } from "@/lib/len-bench/casos/dev/regresion";

interface Caso {
  id: string;
  passRate: number;
  corridas: { desenlace: string; usd: number; segundos: number; turnosDeLen: number }[];
}
interface Resultados {
  casos: Caso[];
  gastado: number;
}

// t de Student, dos colas al 95 %, por grados de libertad.
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.06, 30: 2.042,
};
const t95 = (gl: number) => T95[gl] ?? T95[Object.keys(T95).map(Number).filter((k) => k <= gl).pop() ?? 30] ?? 1.96;

function media(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}
function mediaConIntervalo(xs: number[]): { media: number; mas: number } {
  const m = media(xs);
  if (xs.length < 2) return { media: m, mas: NaN };
  const varianza = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return { media: m, mas: t95(xs.length - 1) * Math.sqrt(varianza / xs.length) };
}
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const pts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;

function main(): void {
  const brazos: { nombre: string; r: Resultados }[] = [];
  let menos: string | undefined;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--menos=")) menos = a.slice(8);
    else {
      const i = a.indexOf("=");
      brazos.push({ nombre: a.slice(0, i), r: JSON.parse(fs.readFileSync(a.slice(i + 1), "utf8")) as Resultados });
    }
  }
  if (brazos.length < 2) throw new Error("hacen falta dos brazos: A=<resultados.json> B=<resultados.json>");
  const base = brazos.find((b) => b.nombre === (menos ?? brazos[0]!.nombre))!;
  const reg = new Set(Object.keys(REGRESION));
  const ids = base.r.casos.map((c) => c.id).filter((id) => brazos.every((b) => b.r.casos.some((c) => c.id === id)));
  const pr = (b: (typeof brazos)[number], id: string) => b.r.casos.find((c) => c.id === id)!.passRate;

  for (const [via, filtro] of [
    ["CAPACIDAD", (id: string) => !reg.has(id)],
    ["REGRESIÓN", (id: string) => reg.has(id)],
  ] as const) {
    const casos = ids.filter(filtro);
    console.log(`\n## ${via} (${casos.length} casos)\n`);
    console.log(`| caso | ${brazos.map((b) => b.nombre).join(" | ")} |`);
    console.log(`|---|${brazos.map(() => "---").join("|")}|`);
    const fraccion = (b: (typeof brazos)[number], id: string) => {
      const n = b.r.casos.find((c) => c.id === id)!.corridas.length;
      return `${Math.round(pr(b, id) * n)}/${n}`;
    };
    for (const id of casos) console.log(`| ${id} | ${brazos.map((b) => fraccion(b, id)).join(" | ")} |`);
    console.log(`| **media** | ${brazos.map((b) => `**${pct(media(casos.map((id) => pr(b, id))))}**`).join(" | ")} |`);
    for (const b of brazos) {
      if (b === base) continue;
      const d = mediaConIntervalo(casos.map((id) => pr(b, id) - pr(base, id)));
      console.log(`\n${b.nombre} − ${base.nombre}: **${pts(d.media)} puntos** (± ${(d.mas * 100).toFixed(1)}, IC 95 % emparejado por caso)`);
    }
    if (via === "REGRESIÓN") {
      for (const b of brazos) {
        const caidos = casos.filter((id) => pr(b, id) < 1);
        console.log(`${b.nombre}: ${casos.length - caidos.length}/${casos.length} al 100 %${caidos.length ? ` · caídos: ${caidos.join(", ")}` : ""}`);
      }
    }
  }

  console.log("\n## COSTE Y TIEMPO\n");
  for (const b of brazos) {
    const corridas = b.r.casos.flatMap((c) => c.corridas);
    const delArnes = corridas.filter((c) => c.desenlace !== "completa" && c.desenlace !== "error_de_len").length;
    console.log(
      `${b.nombre}: ${corridas.length} corridas · $${b.r.gastado.toFixed(3)} grabados ($${(b.r.gastado / corridas.length).toFixed(4)}/corrida) · ` +
        `${media(corridas.map((c) => c.segundos)).toFixed(0)} s y ${media(corridas.map((c) => c.turnosDeLen)).toFixed(1)} turnos de media · ` +
        `desenlaces: ${JSON.stringify(Object.fromEntries([...new Set(corridas.map((c) => c.desenlace))].map((d) => [d, corridas.filter((c) => c.desenlace === d).length])))}` +
        (delArnes ? ` · ⚠ ${delArnes} no «completa»` : ""),
    );
  }
}

main();
export {};
