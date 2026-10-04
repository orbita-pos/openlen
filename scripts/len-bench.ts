// scripts/len-bench.ts — corre Len-Bench contra el servidor de Len-Bench.
//
//   npm run bench:len -- --juego=dev --runs=3 --budget-usd=5 --yes
//   npm run bench:len -- --juego=pendientes --solo=taqueria-menu-whatsapp --runs=1 --yes --conservar
//   npm run bench:len -- --juego=dev --solo=encargo-grande --mode=dynamis --runs=3 --budget-usd=… --yes
//
// ⚠️ GASTA DINERO REAL. Mismas guardas que evals:agent: imprime el estimado,
// no arranca sin --yes, y hay TOPE DURO. El gasto REAL acumulado detiene la
// corrida a medias. El sellado sólo se abre con --abrir-sellado (fase 4).

import fs from "node:fs";
import path from "node:path";
import { BASE_LEN_BENCH, DIR_CORRIDAS, DIR_GRABACIONES } from "@/lib/len-bench/entorno";
import { arrancarCorredor, TIMEOUT_TURNO_MS } from "@/lib/len-bench/arranque";
import { correrEncargo } from "@/lib/len-bench/conductor";
import { lanzarNavegador } from "@/lib/len-bench/navegador";
import { resumenPorVia, resumirCaso, salidaDeLaSuite } from "@/lib/len-bench/puntuar";
import { REGRESION } from "@/lib/len-bench/casos/dev/regresion";
import { cargarEncargos, type Juego } from "@/lib/len-bench/casos/cargar";
import { avisosDelEncargo } from "@/lib/len-bench/avisos";
import { MAX_RESPUESTAS_POR_PASO } from "@/lib/len-bench/cliente-simulado";
import {
  centimosDelEstimado,
  estimadoExcedeTope,
  MARGEN_NO_GRABADO,
  TOPE_POR_DEFECTO_USD,
  USD_POR_TURNO_ESTIMADO,
} from "@/lib/len-bench/coste";
import type { ResultadoDeCaso, ResultadoDeCorrida } from "@/lib/len-bench/tipos";

// El estimado (`USD_POR_TURNO_ESTIMADO`, `MARGEN_NO_GRABADO`) y el tope por
// defecto viven en lib/len-bench/coste.ts, y el arranque (identidad de eval,
// saldo, cookie, reloj del turno) en lib/len-bench/arranque.ts: los usa también
// scripts/len-bench-disparos.ts, y dos copias podían dejar de decir lo mismo.

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
  // Len Dynamis (lib/agent/dynamis.ts): cada turno lo manda en el cuerpo, como
  // el panel. Sólo existe con la terminal encendida en el servidor del banco.
  const modeArg = arg("--mode");
  if (modeArg !== undefined && modeArg !== "dynamis" && modeArg !== "len") {
    throw new Error(`--mode=${modeArg}: sólo «len» o «dynamis»`);
  }
  const mode = modeArg === "dynamis" ? ("dynamis" as const) : undefined;

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
  console.log(`Len-Bench · juego=${juego} · ${encargos.length} encargo(s) × ${runs} corrida(s)${mode ? " · Len Dynamis" : ""}`);
  console.log(`Estimado PESIMISTA: ~$${estimadoImpreso} (hasta ${turnos} turnos × $${USD_POR_TURNO_ESTIMADO} × margen ${MARGEN_NO_GRABADO})`);
  console.log(`Tope de gasto: $${tope.toFixed(2)}`);
  if (estimadoExcedeTope(estimado, tope)) throw new Error(`RECHAZADO: el estimado ($${estimadoImpreso}) excede el tope. Decláralo: --budget-usd=${estimadoImpreso}`);
  if (arg("--yes") === undefined) {
    console.log("Esto GASTA dinero real del proveedor. Vuelve a correr con --yes.");
    return 0;
  }

  const { owner, cookie } = await arrancarCorredor(base);
  // 🔴 Sin la terminal en el servidor, la ruta convierte Dynamis en Len SIN
  // DECIRLO, y el brazo mediría a Len con otro nombre. Se pregunta antes de gastar.
  if (mode) {
    const r = await fetch(`${base}/api/agent/esfuerzo`, { headers: { cookie } });
    const d = (r.ok ? await r.json().catch(() => null) : null) as { dynamis?: boolean } | null;
    if (d?.dynamis !== true) throw new Error("el servidor no ofrece Len Dynamis (aparcado): arráncalo con OPENLEN_TERMINAL=1 y OPENLEN_DYNAMIS=1");
  }

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
    // Len Dynamis piensa ×11 por llamada (sonda del 03/10: 14 min un solo turno
    // de `encargo-grande`). El reloj del banco es un tope de SEGURIDAD que un turno
    // sano no toca, y producción no corta a los 20 min: con Dynamis, el doble.
    timeoutTurnoMs: mode ? 2 * TIMEOUT_TURNO_MS : TIMEOUT_TURNO_MS,
    ...(capturasEn ? { capturasEn } : {}),
    ...(mode ? { mode } : {}),
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
          // Pasos y `Edit` fallidos: lo que se espera que baje con la terminal (plans/len-agente-2026, F1).
          `  ${e.id} #${i + 1}: score=${r.score.toFixed(2)} ${r.desenlace} turnos=${r.turnosDeLen} pasos=${r.pasos ?? "?"} edit✗=${r.editFallidos ?? "?"} ` +
            `$${r.usd.toFixed(3)}${r.usdJuez ? ` (juez $${r.usdJuez.toFixed(3)})` : ""} ` +
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
