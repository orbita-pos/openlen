// ¿PRIORITY VA MÁS RÁPIDO DE VERDAD?
//
// Fireworks cobra 1.25× exacto por la vía `priority` y promete "higher
// reliability during peak traffic". Eso NO cambia el modelo ni la salida:
// cambia la cola. Y fuera de punta las dos vías son la misma cosa.
//
// Antes de poner un selector en la portada hay que saber si compra algo. Un
// interruptor que no compra nada es exactamente la clase de mentira que este
// repo lleva el día entero borrando.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json \
//     scripts/medir-service-tier.ts [--pares=10] [--si]
//
// SIN `--si` no gasta un céntimo: imprime el coste estimado y se para.
//
// ALTERNA las vías (A/B/A/B) en vez de correr diez de una y luego diez de la
// otra. La carga de Fireworks cambia con los minutos, así que en bloques la
// diferencia que midieras podría ser la hora del día y no la vía.

import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { PUBLISH_CONTRACT_MIN } from "@/lib/publish-contract-min";

type Via = "standard" | "priority";

// Un brief realista y CORTO: se mide la cola, no la creatividad. El contrato
// mínimo sí va entero porque es lo que hace grande la entrada de verdad, y el
// tamaño de la entrada es parte de lo que se encola.
const BRIEF = "Una landing para un estudio de cerámica en Oaxaca que vende piezas hechas a mano y da talleres los sábados.";
const MAX_SALIDA = 6_000;

// $/M tokens. Los de Standard salen de lib/credits.ts; Priority es 1.25×.
const TARIFA = {
  standard: { entrada: 0.22, salida: 0.66 },
  priority: { entrada: 0.275, salida: 0.825 },
} as const;

interface Corrida {
  via: Via;
  primerByteMs: number;
  totalMs: number;
  entrada: number;
  salida: number;
  error?: string;
}

async function unaCorrida(via: Via, n: number): Promise<Corrida> {
  const cliente = createFireworksStreamClient();
  const t0 = Date.now();
  let primerByteMs = -1;
  let entrada = 0;
  let salida = 0;
  let error: string | undefined;

  const eventos = cliente.stream(
    {
      messages: [
        { role: "system", content: PUBLISH_CONTRACT_MIN },
        { role: "user", content: BRIEF },
      ],
      maxOutputTokens: MAX_SALIDA,
      temperature: 0.8,
      // `requestId` DISTINTO por corrida y por vía. Con el mismo, la afinidad de
      // caché de Fireworks manda las dos a la misma réplica y ya no se está
      // midiendo la cola: se está midiendo un acierto de caché.
      requestId: `medir.${via}.${n}.${Date.now()}`,
      operation: "page_edit",
      ...(via === "priority" ? { serviceTier: "priority" as const } : {}),
    },
    {},
  );

  for await (const ev of eventos) {
    if (ev.type === "text_delta" && primerByteMs < 0) primerByteMs = Date.now() - t0;
    else if (ev.type === "usage") {
      entrada = ev.inputTokens;
      salida = ev.outputTokens;
    } else if (ev.type === "done" && ev.stopReason.kind === "error") {
      error = ev.stopReason.error;
    }
  }
  return { via, primerByteMs, totalMs: Date.now() - t0, entrada, salida, ...(error ? { error } : {}) };
}

function mediana(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(): Promise<void> {
  const arg = (n: string, d: number) => {
    const a = process.argv.find((x) => x.startsWith(`--${n}=`));
    return a ? Number(a.split("=")[1]) : d;
  };
  const pares = arg("pares", 10);
  const adelante = process.argv.includes("--si");

  // El coste ANTES del gasto, no después. Estimado con la entrada real del
  // contrato mínimo y el techo de salida — el techo, no la media, para que el
  // número que se enseña sea el PEOR caso y no una media optimista.
  const entradaEstim = Math.ceil(PUBLISH_CONTRACT_MIN.length / 4) + 40;
  const coste = (v: Via) =>
    (entradaEstim * TARIFA[v].entrada + MAX_SALIDA * TARIFA[v].salida) / 1_000_000;
  const techo = pares * (coste("standard") + coste("priority"));

  console.log(`MEDICIÓN: standard vs priority — ${pares} pares (${pares * 2} llamadas)`);
  console.log(`  entrada ≈ ${entradaEstim} tokens · techo de salida ${MAX_SALIDA}`);
  console.log(`  COSTE MÁXIMO: $${techo.toFixed(3)}  (si TODAS agotan la salida)`);
  console.log(`  real esperado: la mitad o menos — una página suele quedarse en 2-4k\n`);
  if (!adelante) {
    console.log("Sin --si no se gasta nada. Añade --si para lanzarlo.");
    return;
  }
  if (!process.env.FIREWORKS_API_KEY?.trim()) {
    console.error("FIREWORKS_API_KEY missing — pasa --env-file=.env.local");
    process.exit(2);
  }

  const corridas: Corrida[] = [];
  for (let i = 0; i < pares; i += 1) {
    // A/B/A/B, y el orden se invierte en los pares impares para que ninguna vía
    // vaya siempre primero (la primera de cada par paga el arranque en frío).
    const orden: Via[] = i % 2 === 0 ? ["standard", "priority"] : ["priority", "standard"];
    for (const via of orden) {
      const r = await unaCorrida(via, i);
      corridas.push(r);
      const marca = r.error ? `ERROR ${r.error}` : `1er byte ${r.primerByteMs}ms · total ${r.totalMs}ms · ${r.salida} tok`;
      console.log(`  ${String(i + 1).padStart(2)} ${via.padEnd(9)} ${marca}`);
    }
  }

  console.log("");
  const gasto = corridas.reduce(
    (a, r) => a + (r.entrada * TARIFA[r.via].entrada + r.salida * TARIFA[r.via].salida) / 1_000_000,
    0,
  );
  for (const via of ["standard", "priority"] as const) {
    const xs = corridas.filter((r) => r.via === via && !r.error);
    if (xs.length === 0) {
      console.log(`${via}: TODAS fallaron`);
      continue;
    }
    console.log(
      `${via.padEnd(9)} n=${xs.length}  1er byte mediana ${mediana(xs.map((x) => x.primerByteMs))}ms` +
        `  ·  total mediana ${mediana(xs.map((x) => x.totalMs))}ms`,
    );
  }
  const s = corridas.filter((r) => r.via === "standard" && !r.error);
  const p = corridas.filter((r) => r.via === "priority" && !r.error);
  if (s.length && p.length) {
    // 🔴 EL TOTAL CRUDO MIENTE, y la primera version de este script se lo creyo:
    // dijo "Priority ahorra 1.4s" cuando lo unico que pasaba es que en esa tanda
    // Priority habia escrito MAS tokens. Comparar dos vias por el tiempo total
    // sin normalizar por la salida es comparar dos paginas distintas.
    //
    // El ritmo (tokens/segundo) SI es comparable. Y el otro numero que importa
    // no es la mediana sino la COLA: lo que Fireworks vende no es velocidad, es
    // fiabilidad, y eso vive en los picos.
    const ritmo = (xs: readonly Corrida[]) =>
      xs.reduce((a, x) => a + x.salida, 0) / (xs.reduce((a, x) => a + x.totalMs, 0) / 1000);
    const picos = (xs: readonly Corrida[]) => xs.filter((x) => x.primerByteMs > 2000).length;
    const rs = ritmo(s);
    const rp = ritmo(p);
    console.log(`
RITMO      standard ${rs.toFixed(1)} tok/s  ·  priority ${rp.toFixed(1)} tok/s` +
      `  →  ${(((rp / rs) - 1) * 100).toFixed(1)}%`);
    console.log(`PICOS >2s  standard ${picos(s)}/${s.length}  ·  priority ${picos(p)}/${p.length}` +
      `   (peor: ${Math.max(...s.map((x) => x.primerByteMs))}ms vs ${Math.max(...p.map((x) => x.primerByteMs))}ms)`);
    console.log(
      Math.abs(rp / rs - 1) < 0.1
        ? "→ El RITMO es el mismo (menos del 10%). Si Priority compra algo, esta en los picos."
        : "→ Diferencia de ritmo real.",
    );
  }
  console.log(`\nGASTADO DE VERDAD: $${gasto.toFixed(4)}`);
}

void main();
