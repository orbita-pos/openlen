// scripts/len-bench.ts — corre Len-Bench contra el servidor de Len-Bench.
//
//   npm run bench:len -- --juego=dev --runs=3 --budget-usd=5 --yes
//   npm run bench:len -- --juego=pendientes --solo=taqueria-menu-whatsapp --runs=1 --yes --conservar
//
// ⚠️ GASTA DINERO REAL. Mismas guardas que evals:agent: imprime el estimado,
// no arranca sin --yes, y hay TOPE DURO. El gasto REAL acumulado detiene la
// corrida a medias. El sellado sólo se abre con --abrir-sellado (fase 4).

import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveEvalUser } from "@/lib/len-bench/proyecto-de-eval";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits";
import { apagarEnEsteProceso, BASE_LEN_BENCH, DIR_CORRIDAS, DIR_GRABACIONES, exigirBaseLocal } from "@/lib/len-bench/entorno";
import { acunarCookie, comprobarSesion } from "@/lib/len-bench/sesion";
import { correrEncargo } from "@/lib/len-bench/conductor";
import { lanzarNavegador } from "@/lib/len-bench/navegador";
import { resumenPorVia, resumirCaso, salidaDeLaSuite } from "@/lib/len-bench/puntuar";
import { REGRESION } from "@/lib/len-bench/casos/dev/regresion";
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { avisosDelEncargo } from "@/lib/len-bench/avisos";
import { MAX_RESPUESTAS_POR_PASO } from "@/lib/len-bench/cliente-simulado";
import { centimosDelEstimado, estimadoExcedeTope } from "@/lib/len-bench/coste";
import type { ResultadoDeCaso, ResultadoDeCorrida } from "@/lib/len-bench/tipos";

// MEDIDO en el humo del 2026-09-23 (taqueria-menu-whatsapp, 1 corrida): $0,0125
// en 3 turnos = $0,0042 por turno, cliente simulado incluido. Pero aquella
// partida era una página de 1 KB, y las de verdad de OpenLen pesan decenas de
// KB: el turno que las lee y las edita paga esos tokens. Se deja en ~2,4× lo
// medido hasta medirlo con partidas reales. Mejor sobrar que drenar la cuenta.
const USD_POR_TURNO_ESTIMADO = 0.01;
// Las grabaciones sólo cuentan el papel `agent`; los ojos y el juez no pasan
// por ellas. El tope se aplica sobre la cifra grabada × este margen.
const MARGEN_NO_GRABADO = 1.5;
const TOPE_POR_DEFECTO_USD = 0.3;
const SALDO_MINIMO_CREDITOS = 5_000;
// El reloj de Len-Bench NO puede ser más estricto que producción: con 240 s se
// abortó un turno de 34 pasos que seguía trabajando (humo 2 de Len 2.0) y se
// culpó al tope, cuando la ruta le daba 6 min. Aquí queda sólo un tope de
// seguridad que un turno sano no toca —20 min, ~170 pasos a ~7 s—, y el plazo
// que manda es el de la ruta (V2 de plans/len-2/hipotesis/, en los dos brazos).
const TIMEOUT_TURNO_MS = 1_200_000;

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x === n || x.startsWith(`${n}=`));
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : a ? "" : undefined;
}

async function main(): Promise<number> {
  const juego = (arg("--juego") ?? "dev") as Juego;
  if (juego === "sellado" && arg("--abrir-sellado") === undefined) {
    throw new Error("el sellado sólo se abre en la fase 4, con --abrir-sellado (plans/len-2/diseno.md §3.5 regla 4)");
  }
  const runs = Number(arg("--runs") ?? "3");
  const solo = arg("--solo")?.split(",").filter(Boolean);
  const tope = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : TOPE_POR_DEFECTO_USD;
  const base = arg("--base") ?? BASE_LEN_BENCH;
  const etiqueta = arg("--etiqueta") ?? juego;
  const conservar = arg("--conservar") !== undefined;

  let encargos = await cargarEncargos(juego);
  if (solo) encargos = encargos.filter((e) => solo.includes(e.id));
  if (encargos.length === 0) throw new Error(`no hay encargos que correr en «${juego}»${solo ? ` con --solo=${solo.join(",")}` : ""}`);
  // Como el corredor de Claude Code al cargar: avisa, no para.
  for (const e of encargos) for (const a of avisosDelEncargo(e)) console.log(`⚠ encargo «${e.id}»: ${a}`);

  const turnos = encargos.reduce((s, e) => s + e.guion.length * (1 + MAX_RESPUESTAS_POR_PASO), 0) * runs;
  const estimado = turnos * USD_POR_TURNO_ESTIMADO * MARGEN_NO_GRABADO;
  // En céntimos y hacia arriba: ver `estimadoExcedeTope`. Se imprime la MISMA
  // cifra que se compara, así que declarar lo que se lee siempre pasa.
  const estimadoImpreso = (centimosDelEstimado(estimado) / 100).toFixed(2);
  console.log(`Len-Bench · juego=${juego} · ${encargos.length} encargo(s) × ${runs} corrida(s)`);
  console.log(`Estimado PESIMISTA: ~$${estimadoImpreso} (hasta ${turnos} turnos × $${USD_POR_TURNO_ESTIMADO} × margen ${MARGEN_NO_GRABADO})`);
  console.log(`Tope de gasto: $${tope.toFixed(2)}`);
  if (estimadoExcedeTope(estimado, tope)) throw new Error(`RECHAZADO: el estimado ($${estimadoImpreso}) excede el tope. Decláralo: --budget-usd=${estimadoImpreso}`);
  if (arg("--yes") === undefined) {
    console.log("Esto GASTA dinero real del proveedor. Vuelve a correr con --yes.");
    return 0;
  }

  apagarEnEsteProceso(process.cwd());
  await exigirBaseLocal();
  const owner = await resolveEvalUser();
  // El saldo de la identidad de eval, repuesto: sin créditos la ruta rechaza el
  // turno y la corrida mediría un 402, no a Len.
  await db
    .update(schema.users)
    .set({ credits: sql`GREATEST(${schema.users.credits}, ${SALDO_MINIMO_CREDITOS * CENTICREDITOS_POR_CREDITO})` })
    .where(eq(schema.users.id, owner.id));
  const cookie = await acunarCookie({ userId: owner.id, email: owner.email, entorno: process.env });
  await comprobarSesion(base, cookie, owner.id);

  const navegador = await lanzarNavegador();
  const dirGrabaciones = path.resolve(DIR_GRABACIONES);
  const dir = path.join(DIR_CORRIDAS, `${new Date().toISOString().slice(0, 10)}-${etiqueta}`);
  // La página final de cada corrida, en escritorio y en móvil, junto a sus
  // resultados (lib/len-bench/capturas.ts). `--sin-capturas` para no hacerlas.
  const capturasEn = arg("--sin-capturas") === undefined ? path.join(dir, "capturas") : undefined;
  const opciones = {
    base,
    cookie,
    owner,
    navegador,
    dirGrabaciones,
    conservar,
    timeoutTurnoMs: TIMEOUT_TURNO_MS,
    ...(capturasEn ? { capturasEn } : {}),
  };
  let gastado = 0;
  // Como el corredor de Claude Code: el tope se mira ANTES de cada corrida, las
  // que salta no se corren ni se apuntan, y la suite queda «a medias». Y sin
  // reintentos: lo que el arnés no pudo medir cuenta como 0 y deja la suite en
  // error (`salidaDeLaSuite`), en vez de repetirse y quitarse en silencio.
  let parcial = false;
  const casos: ResultadoDeCaso[] = [];
  const subs: string[] = [];
  try {
    for (const e of encargos) {
      const corridas: ResultadoDeCorrida[] = [];
      for (let i = 0; i < runs; i++) {
        if (gastado * MARGEN_NO_GRABADO >= tope) {
          if (!parcial) console.log(`⚠ tope de gasto $${tope.toFixed(2)} alcanzado: se saltan las corridas que quedan`);
          parcial = true;
          break;
        }
        const r = await correrEncargo(e, opciones);
        gastado += r.usd;
        corridas.push(r);
        if (conservar && r.sub) subs.push(r.sub);
        console.log(
          // El juez, dentro del total y dicho aparte (su `judge_cost_usd`).
          `  ${e.id} #${i + 1}: score=${r.score.toFixed(2)} ${r.desenlace} turnos=${r.turnosDeLen} $${r.usd.toFixed(3)}${r.usdJuez ? ` (juez $${r.usdJuez.toFixed(3)})` : ""} ` +
            `${r.creditos.toFixed(2)} cr ${r.segundos.toFixed(0)} s${conservar && r.sub ? ` sub=${r.sub}` : ""}${r.error ? `\n      error: ${r.error}` : ""}`,
        );
      }
      casos.push(resumirCaso(e.id, e.nivel, corridas));
    }
  } finally {
    await navegador.close();
  }

  console.log(`\n${"CASO".padEnd(36)} NIVEL SCORE  PASS%  RUNS  COSTE    NOTAS`);
  for (const c of casos) {
    const coste = c.corridas.reduce((s, r) => s + r.usd, 0);
    console.log(
      `${c.id.padEnd(36)} ${c.nivel}    ${c.score.toFixed(2)}  ${(c.passRate * 100).toFixed(0).padStart(4)}%  ${String(c.corridas.length).padStart(4)}  $${coste.toFixed(3)}  ${c.notas}`,
    );
  }
  const media = casos.reduce((s, c) => s + c.passRate, 0) / casos.length;
  console.log(
    `\nPASS medio: ${(media * 100).toFixed(1)}% · gasto grabado $${gastado.toFixed(3)} (× ${MARGEN_NO_GRABADO} con lo no grabado ≈ $${(gastado * MARGEN_NO_GRABADO).toFixed(3)})`,
  );
  // Decisión 9: la vara del 20–40 % es la media de CAPACIDAD; la regresión se
  // cuenta aparte. Sólo dev tiene vía de regresión (el sellado no se ha corrido).
  const vias = resumenPorVia(casos, new Set(juego === "dev" ? Object.keys(REGRESION) : []));
  console.log(`PASS medio de CAPACIDAD (${vias.capacidad.casos} casos): ${(vias.capacidad.passMedio * 100).toFixed(1)}% — la vara de la fase 0 (20–40 %)`);
  if (vias.regresion.casos > 0) {
    const caidos = vias.regresion.caidos.length > 0 ? ` · caídos: ${vias.regresion.caidos.join(", ")}` : "";
    console.log(`REGRESIÓN: ${vias.regresion.alCien} de ${vias.regresion.casos} al 100 %${caidos}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "resultados.json"), JSON.stringify({ comando: process.argv.slice(2), casos, vias, gastado, parcial }, null, 2));
  console.log(`Resultados: ${dir}/resultados.json`);
  if (capturasEn && fs.existsSync(capturasEn)) {
    console.log(`Capturas: ${fs.readdirSync(capturasEn).length} en ${capturasEn} (el nombre lleva el sub de cada corrida)`);
  }
  // Antes de leer ningún número, se mira la página (memoria `show-the-page-before-measuring`).
  for (const s of subs) console.log(`Ver la página: npm run bench:len:ver -- --sub=${s}`);
  const salida = salidaDeLaSuite(casos, parcial);
  if (salida.aviso) console.log(`\n${salida.aviso}`);
  return salida.codigo;
}

void main().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(`len-bench: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
