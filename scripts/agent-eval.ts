// scripts/agent-eval.ts — the OpenLen Agent's credit-conscious eval runner.
//
//   npm run evals:agent -- --limit=3 --yes
//   npm run evals:agent -- --only=activar-reservas,honesto-carrito --yes
//   npm run evals:agent -- --all --yes --budget-usd=1.50   (la batería completa DECLARA su costo)
//   npm run evals:agent -- --all --yes --costly --budget-usd=2   (incluye la edición de imagen pagada)
//   npm run evals:agent -- --canary --yes         (the 6 CANARY_IDS — fast smoke, ~18¢)
//   npm run evals:agent -- --only=carrito-con-base-de-datos --repeat=5 --yes   (el mismo caso N veces)
//
// TOPE DURO: sin --budget-usd, nada cuyo estimado supere $0.30 arranca (ni
// con --yes), y el gasto REAL acumulado detiene la batería a media corrida si
// toca el techo. Ver DEFAULT_BUDGET_USD abajo.
//
// Each case spends real Gemini credits, so the runner PRINTS a cost estimate
// first and REFUSES to run without --yes. Concurrency is 1 (shared prod Neon +
// rate limits). Exit code is non-zero if any case fails, so it can gate a
// commit. Owner is resolved from EVAL_USER_EMAIL (no default).

import { CANARY_IDS, EVAL_CASES, type EvalCase } from "@/lib/agent/evals/cases";
import { resolveEvalUser, runEvalCase, type EvalRunResult } from "@/lib/agent/evals/harness";
import { rechazosPorMotivo } from "@/lib/agent/evals/promesas";
import { rateFor, VISION_RATE } from "@/lib/ai/tarifas-eval";
import { modelIdForRole } from "@/lib/generation/model-policy";

// P3 — eje visual: render local (gratis) + 1-2 llamadas de visión chicas por
// caso mutante. Sobreestimado a propósito (mejor sobrar que drenar).
const COST_PER_CASE_VISUAL_USD = 0.01;

// TOPE DURO DE GASTO (2026-07-14: una batería + re-runs vació el saldo
// prepagado de la cuenta — ~200 MXN — con un estimado citado de $0.42).
// Sin --budget-usd explícito, NADA cuyo estimado supere DEFAULT_BUDGET_USD
// arranca — ni con --yes: --yes confirma "esto gasta dinero", el budget es
// el TECHO de cuánto. Y durante la corrida, el gasto REAL acumulado
// (calculado de los tokens medidos, no del estimado) se comprueba tras cada
// caso: si toca el techo, la batería se detiene ahí mismo con los casos
// restantes sin correr. Preferimos una batería incompleta a una cuenta vacía.
const DEFAULT_BUDGET_USD = 0.3;
// Precios por millón de tokens. El razonador dejó de ser Gemini y estas cifras
// se quedaron: con las de Gemini, la salida de DeepSeek se contaba casi NUEVE
// veces cara y el tope frenaba una batería que apenas había gastado. Un tope
// que miente en cualquiera de las dos direcciones no protege nada.
//
// Las llamadas de VISIÓN siguen siendo Gemini pase lo que pase (los ojos del
// harness usan gemini-2.5-flash), así que se cobran aparte, a su tarifa.
//
// 🔴 LAS TARIFAS SALEN DE `lib/credits.ts`, NO DE AQUÍ. Estaban cableadas y
// desfasadas —0.14/0.28 contra los 0.22/0.66 reales— y sin entrada para Pro,
// que es el modelo que corre el Agente desde el 2026-08-28: caía al respaldo
// y se cobraba como Gemini. Un tope calculado sobre un precio que no es el
// real no es un tope, y esta batería SÓLO existe para poder confiar en él.
//
// Es la misma corrección que ya se le hizo a `scripts/evals-pages.ts`; este
// fichero se quedó atrás.
// Las tarifas viven en lib/ai/tarifas-eval.ts desde el 2026-09-04: un segundo
// runner (scripts/sobre-ab.ts) las necesita, y copiarlas es como se quedaron
// desfasadas la vez anterior.


// COSTO POR CASO, DERIVADO DEL MODELO QUE VA A CORRER — no una constante.
//
// Era 0.03 fijo, calibrado cuando el Agente corría en Flash. Desde el
// 2026-08-28 corre en Pro, que cuesta 6x, así que ese número subestimaba por
// seis y la puerta del presupuesto dejaba pasar una corrida que gasta seis
// veces lo declarado. El tope duro de mitad de corrida sí usaba tarifas
// reales, o sea que el freno funcionaba y el AVISO mentía: te enterabas
// cuando la batería se paraba a medias, no antes de arrancar.
//
// El perfil de tokens sale de la corrida completa del 2026-08-28: ~45k de
// entrada y ~3.5k de salida por caso, medidos. Multiplicado por la tarifa del
// papel `agent` para que cambiar de modelo mueva el estimado solo.
// 🔴 RECALIBRADO el 2026-08-30 sobre 64 turnos reales, y con la CACHÉ dentro.
// El perfil anterior (45k entrada, 3.5k salida) ignoraba que la mayor parte de
// la entrada llega cacheada — y cacheado cuesta 30x menos. Medido: 67.118 de
// entrada por turno de los que 41.168 vienen de caché (61%), y 922 de salida,
// no 3.500. El estimado decía 7,3¢ por caso y el real es ~4¢.
//
// Un estimado que ignora la caché no es conservador, es una puerta que cierra
// corridas que sí se podían pagar.
const TOKENS_TIPICOS = { entrada: 67_118, cacheada: 41_168, salida: 922 } as const;
const tarifaAgente = rateFor(modelIdForRole("agent"));
const COST_PER_CASE_USD =
  ((TOKENS_TIPICOS.entrada - TOKENS_TIPICOS.cacheada) * tarifaAgente.input
    + TOKENS_TIPICOS.cacheada * tarifaAgente.cached
    + TOKENS_TIPICOS.salida * tarifaAgente.output) / 1e6;

function realCostUsd(rs: EvalRunResult[]): number {
  let usd = 0;
  for (const r of rs) {
    const rate = rateFor(r.modelId);
    // 🔴 LOS CACHEADOS SON UN SUBCONJUNTO DE LA ENTRADA, NO UN EXTRA.
    //
    // Esto cobraba `inputTokens` ENTERO a precio sin cachear y encima sumaba
    // `cachedTokens` aparte — o sea la parte cacheada dos veces, y la cara las
    // dos. `lib/credits.ts` lo advierte en mayúsculas justo encima de
    // `creditsForUsage`, que sí resta; el que cobra de verdad estaba bien y el
    // que MIDE estaba mal.
    //
    // MEDIDO el 2026-08-30 cuadrando contra la factura: 4,35M tokens nuestros
    // contra 4,7M que reporta Fireworks (1,08x, la diferencia son las llamadas
    // de visión) y $2,54 reales — mientras este cálculo decía $5,90. Con 74%
    // de acierto de caché el error es de más del doble.
    //
    // No era sólo un número feo en pantalla: LA PUERTA DEL PRESUPUESTO se
    // calcula con esto. Una batería que había gastado ~$1,6 se paraba sola
    // creyendo que iba por $3,65, y el tope que existe para no gastar de más
    // acababa impidiendo correr lo que sí se podía pagar.
    const sinCachear = Math.max(0, r.inputTokens - r.cachedTokens);
    usd += (sinCachear * rate.input
      + r.cachedTokens * rate.cached
      + r.outputTokens * rate.output) / 1e6;
    usd += ((r.visual?.visionInputTokens ?? 0) * VISION_RATE.input
      + (r.visual?.visionOutputTokens ?? 0) * VISION_RATE.output) / 1e6;
  }
  return usd;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  const val = (flag: string) => {
    const hit = get(flag);
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? "" : hit.slice(eq + 1);
  };
  return {
    all: !!get("--all"),
    canary: !!get("--canary"),
    limit: val("--limit"),
    only: val("--only"),
    yes: !!get("--yes"),
    costly: !!get("--costly"),
    visual: !!get("--visual"),
    // LO MEDIDO DE VUELTA AL MODELO, para TODA la batería.
    //
    // ⚰️ `RunEvalOptions.aviso` existía desde el 2026-09-06 sin un solo emisor:
    // ni este runner ni `sobre-ab.ts` la pasaban nunca. Una opción que nadie
    // puede accionar no es una capacidad, es una nota — y encima ésta hacía
    // creer que el aviso estaba medido cuando no lo había estado jamás.
    //
    // Los casos que lo necesitan lo declaran ellos (`EvalCase.aviso`), que es
    // como se enciende sin mover la batería histórica. Esta bandera es para el
    // experimento contrario: encenderlo en TODOS a la vez y ver qué cambia.
    // Cuesta un render por tanda que edita — segundos, cero créditos.
    aviso: !!get("--aviso"),
    // El brazo de control de la línea base, para TODA la batería. Misma
    // historia que `--aviso`: la opción existía en `RunEvalOptions` y ningún
    // runner la pasaba. Apagar la base hace que los defectos PREEXISTENTES del
    // fixture lleguen al modelo — es un brazo, no una alternativa.
    sinLineaBase: !!get("--sin-linea-base"),
    budgetUsd: val("--budget-usd"),
    // El MISMO caso N veces. Una muestra de un modelo no dice qué hace, dice
    // qué hizo una vez; `--only` deduplica y no servía para esto.
    repeat: val("--repeat"),
  };
}

function selectCases(args: ReturnType<typeof parseArgs>): EvalCase[] {
  const modes = [args.all, args.canary, args.limit !== undefined, args.only !== undefined].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    fail("Elige EXACTAMENTE un modo de selección: --all | --canary | --limit=N | --only=id1,id2");
  }

  let selected: EvalCase[];
  if (args.all) {
    selected = [...EVAL_CASES];
  } else if (args.canary) {
    const known = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of CANARY_IDS) {
      if (!known.has(id)) fail(`--canary: CANARY_IDS desincronizado — id desconocido "${id}"`);
    }
    const canarySet = new Set<string>(CANARY_IDS);
    selected = EVAL_CASES.filter((c) => canarySet.has(c.id));
  } else if (args.only !== undefined) {
    const ids = new Set(
      args.only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const known = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of ids) if (!known.has(id)) fail(`--only: id desconocido "${id}"`);
    selected = EVAL_CASES.filter((c) => ids.has(c.id));
  } else {
    const n = Number(args.limit);
    if (!Number.isInteger(n) || n < 1) fail(`--limit debe ser un entero ≥ 1 (recibí "${args.limit}")`);
    selected = EVAL_CASES.slice(0, n);
  }

  if (!args.costly) {
    const before = selected.length;
    selected = selected.filter((c) => !c.costly);
    const skipped = before - selected.length;
    if (skipped > 0) {
      console.log(`(omitiendo ${skipped} caso(s) costly — usa --costly para incluirlos)`);
    }
  }
  if (args.repeat === undefined) return selected;
  const veces = Number(args.repeat);
  if (!Number.isInteger(veces) || veces < 1) fail(`--repeat debe ser un entero ≥ 1 (recibí "${args.repeat}")`);
  // Se multiplica ANTES del estimado, así que el tope de gasto lo ve entero.
  return selected.flatMap((c) => Array.from({ length: veces }, () => c));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** La celda del eje visual: "-" no mutó, "ok" limpio, "fix→ok" los ojos
 *  arreglaron, "ROTA" el estado final quedó con rotura, "s/j" sin juicio
 *  (fallback del crítico). */
function visualCell(r: EvalRunResult): string {
  if (!r.visual) return "-";
  if (r.visual.fallback && !r.visual.broken) return "s/j";
  if (r.visual.broken) return "ROTA";
  return r.visual.fixedBySelf ? "fix→ok" : "ok";
}

function printTable(results: EvalRunResult[], visual: boolean): void {
  const rows = results.map((r) => ({
    id: r.id,
    verdict: r.pass ? "PASS" : "FAIL",
    vis: visual ? visualCell(r) : "",
    reason: r.reason ? truncate(r.reason, 52) : "",
    // entrada/cacheada/salida — y de la salida, CUÁNTO fue pensar.
    //
    // 🔴 `thinkingTokens` llegaba hasta aquí y moría en el formateador: el
    // arnés lo arrastra desde el 2026-09-11 y esta función no lo imprimía, así
    // que la corrida lo medía y lo tiraba. Sin él no se puede comprobar que el
    // dial de esfuerzo entrega lo que promete — que es la razón entera por la
    // que se cableó. Va entre paréntesis y sólo cuando hay algo que contar,
    // para que un caso sin razonamiento deje la celda como estaba.
    tokens:
      `${r.inputTokens}/${r.cachedTokens}/${r.outputTokens}`
      + (r.thinkingTokens > 0 ? ` (p${r.thinkingTokens})` : ""),
    s: r.seconds.toFixed(1),
  }));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    verdict: 4,
    vis: visual ? Math.max(6, ...rows.map((r) => r.vis.length)) : 0,
    reason: Math.max(6, ...rows.map((r) => r.reason.length)),
    tokens: Math.max(14, ...rows.map((r) => r.tokens.length)),
    s: Math.max(4, ...rows.map((r) => r.s.length)),
  };
  const pad = (s: string, w: number) => s.padEnd(w);
  const line = (r: (typeof rows)[number]) =>
    `${pad(r.id, widths.id)}  ${pad(r.verdict, widths.verdict)}  ${
      visual ? `${pad(r.vis, widths.vis)}  ` : ""
    }${pad(r.reason, widths.reason)}  ${pad(r.tokens, widths.tokens)}  ${pad(r.s, widths.s)}`;

  console.log("");
  console.log(
    line({
      id: "id",
      verdict: "res.",
      vis: visual ? "visual" : "",
      reason: "razón",
      tokens: "in/cached/out",
      s: "seg",
    }),
  );
  console.log(
    "-".repeat(
      widths.id + widths.verdict + (visual ? widths.vis + 2 : 0) + widths.reason + widths.tokens + widths.s + 8,
    ),
  );
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<void> {
  // Aqui se exigia `GEMINI_API_KEY`. Es la MISMA guarda falsa que mataba
  // `redisenar_pagina`: el Agente corre en Fireworks y esta clave no la toca
  // nadie, asi que una caja sin ella no podia correr sus propios evals.
  if (!process.env.FIREWORKS_API_KEY?.trim()) {
    fail("FIREWORKS_API_KEY missing — pasa --env-file=.env.local a tsx (npm run evals:agent lo hace).");
  }

  const args = parseArgs(process.argv.slice(2));
  const cases = selectCases(args);
  if (cases.length === 0) fail("No quedó ningún caso por correr.");

  const est = cases.length * (COST_PER_CASE_USD + (args.visual ? COST_PER_CASE_VISUAL_USD : 0));
  const budget = args.budgetUsd !== undefined ? Number(args.budgetUsd) : DEFAULT_BUDGET_USD;
  if (!Number.isFinite(budget) || budget <= 0) {
    fail(`--budget-usd debe ser un número > 0 (recibí "${args.budgetUsd}")`);
  }
  console.log(`\nCasos seleccionados: ${cases.length}`);
  // ⚠️ EL ESTIMADO ES UNA MEDIA, NO UNA COTA. `COST_PER_CASE_USD` sale del
  // perfil TÍPICO, y los casos de la batería varían 6x entre sí: los dos
  // atascos (hero-terror, honesto-navidena) mueven ~250k tokens contra los 45k
  // de la media. Medido el 2026-08-28 con `--only` sobre esos dos: estimado
  // $0.15, gasto real $0.307 — el doble.
  //
  // Quien protege es el tope de gasto REAL de mitad de corrida (más abajo),
  // que sí usa tokens medidos y paró la corrida en $0.31. Esto sólo orienta.
  // Se deja como media a propósito: un perfil por caso sería maquinaria para
  // ganar poco, y el freno de verdad ya está puesto.
  console.log(
    `Costo estimado: ~$${est.toFixed(2)} USD (${cases.length} × ~${(COST_PER_CASE_USD * 100).toFixed(1)}¢/caso` +
      ` en ${modelIdForRole("agent").split("/").pop()})`,
  );
  console.log(`Tope de gasto: $${budget.toFixed(2)} USD${args.budgetUsd === undefined ? " (default — sube el techo con --budget-usd=N)" : ""}`);
  if (args.costly) console.log("⚠ --costly: incluye ediciones de imagen pagadas (~4 créditos cada una).");

  // El techo se aplica ANTES que --yes y no se puede saltar con él: --yes
  // confirma que esto gasta dinero; --budget-usd dice CUÁNTO como máximo.
  if (est > budget) {
    fail(
      `RECHAZADO: el estimado ($${est.toFixed(2)}) excede el tope ($${budget.toFixed(2)}).\n` +
        // REDONDEADO HACIA ARRIBA al céntimo, no `toFixed`. Con un estimado de
        // $0.5617 el mensaje decía «--budget-usd=0.56» y esa orden VOLVÍA A SER
        // RECHAZADA: su propio consejo no funcionaba, y el usuario descubre eso
        // gastando un intento.
        `Si de verdad quieres gastar eso, decláralo explícito: --budget-usd=${(Math.ceil(est * 100) / 100).toFixed(2)}`,
    );
  }

  if (!args.yes) {
    console.log("\nEsto GASTA dinero real del proveedor que corra el turno. Vuelve a correr con --yes para confirmar.");
    process.exit(2);
  }

  const owner = await resolveEvalUser();
  console.log(`Owner: ${owner.email} (${owner.id})\n`);

  const results: EvalRunResult[] = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} … `);
    const started = Date.now();
    let r: EvalRunResult;
    try {
      r = await runEvalCase(c, {
        userId: owner.id,
        ownerEmail: owner.email,
        visual: args.visual,
        aviso: args.aviso,
        sinLineaBase: args.sinLineaBase,
      });
    } catch (err) {
      // runEvalCase's internal try/catch (harness.ts) wraps the loop run +
      // re-read, but the fixture `setup` mutator and createThrowawayProject
      // run BEFORE that try opens — a throw there (a bad fixture, a DB
      // hiccup) escapes runEvalCase uncaught. Never let one case's exception
      // abort the rest of the battery — register it as a FAIL and continue.
      r = {
        id: c.id,
        pass: false,
        reason: `excepción no capturada: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        modelId: "",
        seconds: (Date.now() - started) / 1000,
      };
    }
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"} (${r.seconds.toFixed(1)}s)${r.pass ? "" : ` — ${r.reason}`}`);
    // Cómo acabó el objetivo, y CUÁNTAS vueltas costó: un verde que no dice lo
    // que gastó obliga a pagar otra corrida para saberlo.
    if (r.objetivo) {
      console.log(
        `     objetivo: ${r.objetivo.veredicto} · ${r.objetivo.vueltasExtra} vuelta(s) extra · ${r.objetivo.razon}`,
      );
    }
    // El cierre del modelo, VERBATIM, para los casos que existen para leerse.
    // No puntúa: lo juzga quien lo lee.
    if (r.cierre) {
      console.log("     ┌ cierre del modelo ─────────────────────────────");
      for (const linea of r.cierre.trim().split(String.fromCharCode(10))) console.log(`     │ ${linea}`);
      console.log("     └───────────────────────────────────────────────");
    }

    // Vigilancia del gasto REAL (tokens medidos, no el estimado): al tocar el
    // techo, la batería se detiene aquí — casos restantes SIN correr. Una
    // batería incompleta se re-corre; una cuenta vaciada se paga.
    const spent = realCostUsd(results);
    if (spent >= budget) {
      const remaining = cases.length - results.length;
      console.log(
        `\n⛔ TOPE ALCANZADO: gasto real acumulado $${spent.toFixed(2)} ≥ tope $${budget.toFixed(2)} — ` +
          `deteniendo la batería (${remaining} caso(s) sin correr).`,
      );
      break;
    }
  }

  printTable(results, args.visual);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} PASS (de ${cases.length} seleccionados)`);

  /**
   * 🔴 LOS HECHOS MECÁNICOS — SE DICEN, NO PUNTÚAN. Ver `EvalHechos`.
   *
   * Se imprime SIEMPRE (no sólo con `--visual`): sale de un render sin visión,
   * cero créditos, y es la mitad que no depende de que nadie opine. La línea
   * dice «NO puntúan» en voz alta a propósito — un número junto a un marcador
   * se lee como parte del marcador si nadie avisa.
   *
   * Y se imprime AUNQUE SALGA CERO. Retirar el voto no puede significar apagar
   * la medición, o la corrida siguiente no tiene con qué desmentirte; un
   * «0 rotos de 12» es justo el dato que decide si esto se promueve a puerta.
   */

  /**
   * 🔴 LA PROMESA DECLARADA — SE DICE, TAMPOCO PUNTÚA.
   *
   * ⚠️ Esto faltaba en la primera corrida (21/09) y el hueco era el de siempre:
   * `cumplimiento` se calculaba, se le pasaba al `assert` —que todavía no la
   * mira, porque no hay afirmaciones escritas— y se tiraba SIN IMPRIMIRSE. Una
   * medición que nadie ve no existe, que es justo lo que este fichero lleva
   * arreglando en otros. Cazado en la corrida, no en la revisión.
   *
   * ⚠️ `deLaPrueba` se cuenta APARTE y no acusa a la página: medido 0 de 5
   * aciertos acusando, así que mezclarlos volvería a culpar al modelo de
   * nuestro propio instrumento.
   */
  const conPromesa = results.filter((r) => r.cumplimiento);
  if (conPromesa.length > 0) {
    const corrieron = conPromesa.filter((r) => r.cumplimiento?.corrio);
    const dePagina = corrieron.filter((r) =>
      (r.cumplimiento?.fallos ?? []).some((f) => f.deLaPrueba !== true),
    );
    const deLaPrueba = corrieron.filter((r) =>
      (r.cumplimiento?.fallos ?? []).some((f) => f.deLaPrueba === true),
    );
    console.log(
      // Desde el 2026-09-22 la promesa es puerta en TODOS los casos (ver la
      // línea de «Promesa del turno», más abajo); antes sólo puntuaba donde el
      // assert del caso llamaba a `prometioYSeComprobo`.
      `Promesa declarada (puntúa en todos): ${conPromesa.length} caso(s) la declararon, ${corrieron.length} se ejecutaron — ` +
        `${dePagina.length} incumplida(s) por LA PÁGINA, ${deLaPrueba.length} fallida(s) por EL INSTRUMENTO.`,
    );
    // ⚰️ AQUÍ SE IMPRIMÍAN LA FORMA Y LOS PASOS de la prueba del DSL, para poder
    // leer SOBRE QUÉ pulsaba. Retirado el DSL (2026-09-22), la promesa es un
    // programa y sale entero en la sección de `prueba_js`, más abajo.
    // 🔴 LAS QUE NO SE PUDIERON COMPROBAR, CON SU MOTIVO. Su grader lo mete
    // dentro del resultado, en vez de dejar un hueco fuera de él.
    // Aquí el recuento ya salía arriba («N declararon, M se ejecutaron») pero
    // la diferencia era MUDA: no se sabía qué le había pasado a las otras.
    // ⚠️ Sigue sin puntuar, a diferencia del suyo, que es fail-closed. Flipar
    // eso sin saber cuántos casos sanos se pondrían rojos es el error que
    // `scored:false` existe para evitar — primero el número.
    const noMedidas = conPromesa.filter((r) => r.cumplimiento && !r.cumplimiento.corrio);
    for (const r of noMedidas) {
      console.log(`  · ${r.id}: NO SE PUDO COMPROBAR — ${r.cumplimiento?.motivo ?? "sin motivo anotado"}`);
    }
    // 🔴 EL BRAZO SIN ACCIONES — se mide y NO puntúa (todavía).
    //
    // La misma promesa, sobre la misma página, con sus acciones anuladas: lo
    // que se cumple igual no dice nada de lo que hizo el modelo. Salió a la luz
    // el 21/09 con `contador-se-construye` en PASS esperando un «5,000» que el
    // contador alcanza solo. Tres recuentos distintos, porque son tres hechos:
    // se midió y discrimina, se midió y no, o no se pudo medir.
    const medidas = corrieron.filter((r) => r.cumplimiento?.vacuas !== undefined);
    const noDiscriminan = medidas.filter((r) => (r.cumplimiento?.vacuas ?? []).length > 0);
    if (corrieron.length > 0) {
      console.log(
        `Brazo sin acciones (NO puntúa): ${medidas.length} de ${corrieron.length} promesa(s) medidas — ` +
          `${noDiscriminan.length} se cumplen en parte también sin actuar.`,
      );
      for (const r of noDiscriminan.slice(0, 6)) {
        const v = (r.cumplimiento?.vacuas ?? [])[0];
        console.log(`  · ${r.id}: paso ${v?.paso} ${String(v?.mensaje).slice(0, 140)}`);
      }
    }
    for (const r of [...dePagina, ...deLaPrueba].slice(0, 6)) {
      const f = (r.cumplimiento?.fallos ?? [])[0];
      console.log(`  · ${r.id}: paso ${f?.paso} ${f?.deLaPrueba ? "[de la prueba]" : "[de la página]"} ${String(f?.mensaje).slice(0, 120)}`);
    }
  } else {
    console.log("Promesa declarada: ningún caso declaró prueba en esta corrida.");
  }
  // 🔴 LA RANURA JS, FUERA DE ESE `if` — y ahí estaba el bug (2026-09-21 noche).
  //
  // Esto vivía DENTRO de `if (conPromesa.length > 0)`, o sea colgado de que
  // ALGÚN caso tuviera `cumplimiento`, que sólo se construye con una spec del
  // DSL aceptada. Un turno que promete SÓLO por JavaScript no tiene
  // `cumplimiento`, así que la corrida caía al `else` y anunciaba «ningún caso
  // declaró prueba» — con la promesa JS delante, sin imprimirla. Medido ese día:
  // `carrito-se-construye` pasó así, y desde el informe era indistinguible de un
  // turno que no prometió nada. Dos preguntas opuestas, la misma línea.
  const conJs = results.filter((r) => r.pruebasJs);
  if (conJs.length > 0) {
    // 🔴 Y SI SE CUMPLIÓ, no sólo si se mandó. Hasta hoy esta línea decía quién
    // la USÓ y ahí se acababa: el programa ni siquiera se ejecutaba en la
    // batería —el arnés no le pasaba `pruebaJs` a los ojos— así que un caso
    // podía pasar con una promesa JS que nadie corrió.
    //
    // ⚠️ PUNTÚA: viaja por `cumplimiento`, así que una promesa incumplida
    // SUSPENDE el caso. Esta línea es el detalle —el código que mandó—, no un
    // canal aparte. (Desde el 2026-09-22 es la única forma de prometer.)
    const corridas = conJs.filter((r) => r.pruebaJsFallos !== undefined);
    const rotas = corridas.filter((r) => (r.pruebaJsFallos ?? []).length > 0);
    console.log(
      `El programa de cada promesa (\`prueba_js\`): ${conJs.length} caso(s) la mandaron, ` +
        `${corridas.length} se ejecutaron — ${rotas.length} incumplida(s).`,
    );
    for (const r of conJs) {
      const f = r.pruebaJsFallos;
      const estado =
        f === undefined ? "no se midió" : f.length === 0 ? "cumplida" : `INCUMPLIDA: ${f[0]?.mensaje ?? ""}`;
      console.log(`  · ${r.id}: [${estado}] ${String(r.pruebasJs).slice(0, 180)}`);
    }
  }
  // 🔴 EL INSTRUMENTO, SIEMPRE — se imprima o no una promesa. «Ningún caso
  // declaró prueba» tiene DOS causas que desde fuera se leen igual: que el
  // modelo no prometiera, o que el arnés no anotara. Esta línea las separa:
  // dice cuántas veces llamó a una puerta que PODÍA llevar prueba y con qué
  // salió cada una. Sin ella, el 2026-09-21 se persiguió un hueco inexistente.
  const conPuertas = results.filter((r) => (r.declaradas ?? []).length > 0);
  if (conPuertas.length > 0) {
    console.log(`Puertas de edición llamadas (el instrumento, NO puntúa):`);
    for (const r of conPuertas) {
      const detalle = (r.declaradas ?? [])
        .map((d) => {
          const estado = d.js ? "js" : d.rechazo ? `✗${d.rechazo}` : "sin prueba";
          return `${d.tool}:${estado}`;
        })
        .join(" · ");
      console.log(`  · ${r.id}: ${detalle}`);
    }
    // LOS RECHAZOS, SUMADOS POR MOTIVO. Aquí se contaba `sin_accion` por clase
    // de forma para decidir qué reparación del DSL escribir; con el DSL
    // retirado, la pregunta que queda es la misma con otro objeto: ¿llega tanto
    // el `prueba` retirado como para convertirlo en vez de rechazarlo?
    const motivos = rechazosPorMotivo(conPuertas);
    if (motivos.size > 0) {
      console.log(
        `  Llamadas rechazadas por su prueba: ${[...motivos].map(([m, n]) => `${m}=${n}`).join(" · ")}`,
      );
    }
  }
  // 🔴 LA PROMESA DEL TURNO, PUERTA DE TODA LA BATERÍA (desde el 2026-09-22).
  //
  // Nació midiendo sin puntuar —sólo tres `assert` la llamaban— y se promovió
  // con el número de una corrida limpia: 64/64 y 0 casos que la habrían
  // suspendido. Ya está dentro del `pass`; esta línea dice cuántos cayeron por
  // ella y por qué, para que un rojo nuevo se lea sin abrir cada caso.
  const conMedida = results.filter((r) => r.promesaMedida);
  if (conMedida.length > 0) {
    console.log(
      `Promesa del turno (puerta en los ${results.length}): ${conMedida.length} caso(s) no la cumplen.`,
    );
    for (const r of conMedida.slice(0, 8)) {
      console.log(`  · ${r.id}: ${String(r.promesaMedida).slice(0, 150)}`);
    }
  }
  const conHechos = results.filter((r) => r.hechos);
  if (conHechos.length > 0) {
    const rotos = conHechos.filter((r) => r.hechos?.roto);
    console.log(
      `Hechos del navegador (NO puntúan): ${rotos.length} de ${conHechos.length} caso(s) medidos quedaron con rotura objetiva.`,
    );
    for (const r of rotos.slice(0, 6)) {
      console.log(`  · ${r.id}: ${(r.hechos?.issues ?? []).slice(0, 2).join(" · ").slice(0, 160)}`);
    }
    if (rotos.length > 0) {
      console.log(
        "  (promoverlo a puerta necesita este número en una corrida limpia, no ganas — ver EvalHechos)",
      );
    }
  }
  if (args.visual) {
    const judged = results.filter((r) => r.visual);
    const clean = judged.filter((r) => r.visual && !r.visual.broken && !r.visual.fallback).length;
    const fixed = judged.filter((r) => r.visual?.fixedBySelf).length;
    const broken = judged.filter((r) => r.visual?.broken).length;
    const noJudge = judged.filter((r) => r.visual?.fallback && !r.visual.broken).length;
    console.log(
      `Eje visual: ${judged.length} caso(s) mutaron el documento — ${clean} limpios (${fixed} auto-arreglados por los ojos), ${broken} ROTOS, ${noJudge} sin juicio (fallback).`,
    );
  }
  /**
   * 🔴 EL AVISO, DICHO — porque sin esto un PASS es MUDO.
   *
   * Medido el 2026-09-08 con `color-desde-una-clase`: PASS, y no había forma de
   * saber si el modelo lo escribió bien a la primera o si lo escribió mal y lo
   * arregló porque el navegador se lo dijo. Son resultados OPUESTOS —uno dice
   * que el aviso no hizo falta, el otro que funcionó— y salían idénticos.
   *
   * `medidas` estaba en el resultado desde el 2026-09-06 y este runner no la
   * miraba nunca; `avisos` es lo que de verdad contesta la pregunta, porque es
   * el texto LITERAL que recibió el modelo, capturado de sus mensajes.
   *
   * Se imprime entero y no resumido: son cuatro líneas como mucho (el sobre
   * tiene tope de 900 caracteres) y el motivo de correr esto es LEERLO.
   */
  const conAviso = results.filter((r) => r.avisos && r.avisos.length > 0);
  const pidieronAviso = cases.filter((c) => c.aviso).length;
  if (pidieronAviso > 0 || args.aviso) {
    console.log("");
    if (conAviso.length === 0) {
      // 🔴 CUÁNTAS VECES MIDIÓ, que es lo que parte el «nunca se emitió» en dos
      // causas distintas. Sin este número la línea de abajo enumeraba tres
      // sospechosos y no descartaba ninguno — y perseguirlos a ciegas cuesta una
      // corrida pagada por hipótesis. `medidas` lleva en el resultado desde el
      // 2026-09-06 sin que nadie la imprimiera.
      const midieron = results.filter((r) => (r.medidas?.length ?? 0) > 0);
      const total = midieron.reduce((n, r) => n + (r.medidas?.length ?? 0), 0);
      console.log(
        `Aviso: ${pidieronAviso || results.length} caso(s) lo pidieron y NUNCA se emitió. ` +
          (total === 0
            ? "Y el medidor NO corrió ni una vez: el turno no llegó a pedirlo (¿editó el caso? ¿llegó el gemelo?). " +
              "El fallo está ANTES del aviso, no en él."
            : `El medidor SÍ corrió ${total} vez/veces en ${midieron.length} caso(s), así que midió y no tuvo nada que decir — ` +
              "o la página salió limpia y algo se lo calla, o la línea base se lo restó todo.") +
          " Un PASS aquí NO es evidencia de que el aviso funcione.",
      );
    } else {
      console.log(`Aviso: se le dijo algo al modelo en ${conAviso.length} caso(s).`);
      for (const r of conAviso) {
        for (const [i, texto] of (r.avisos ?? []).entries()) {
          console.log(`\n  ── ${r.id} · aviso ${i + 1}/${r.avisos!.length} ──`);
          for (const linea of texto.split("\n")) console.log(`  ${linea}`);
        }
      }
    }
  }

  // 🔴 QUE HIZO, cuando FALLA. Un veredicto dice que salio mal; la secuencia
  // dice donde. Solo en los fallos: en los verdes es ruido.
  for (const r of results.filter((x) => !x.pass && x.llamadas && x.llamadas.length > 0)) {
    console.log(`
  ── ${r.id} · lo que hizo (${r.llamadas!.length} llamadas) ──`);
    r.llamadas!.forEach((l, i) => console.log(`  ${String(i + 1).padStart(2)}. ${l}`));
  }

  // 🔴 LOS RECHAZOS, en TODOS los casos y con su motivo. Un PASS también
  // puede haber gastado pasos en una llamada rechazada, y el `!` de arriba no
  // dice por qué. Numerados por corrida: con --repeat el id se repite.
  results.forEach((r, i) => {
    if (!r.tropiezos || r.tropiezos.length === 0) return;
    console.log(`
  ── #${i + 1} ${r.id} · ${r.tropiezos.length} llamada(s) rechazada(s) ──`);
    r.tropiezos.forEach((t, j) => console.log(`  ${String(j + 1).padStart(2)}. ${t}`));
  });

  // 🔴 LO MEDIDO USANDO LA PÁGINA, en todas las corridas: es lo que se cuenta
  // para comparar antes y después, pase o no el caso.
  results.forEach((r, i) => {
    if (r.enNavegador === undefined) return;
    console.log(`  #${i + 1} ${r.id} · navegador: ${r.enNavegador}`);
  });

  // 🔴 ¿PROPUSO OBJETIVO? El PASS no lo dice —`propone-objetivo` acepta
  // «propone O termina»— y es la pregunta entera: en este producto la UNICA
  // puerta al objetivo es que el modelo lo proponga. No hay `/goal`.
  const propusieron = results.filter((r) => r.propuso !== undefined);
  if (propusieron.length > 0) {
    console.log(`
Objetivo PROPUESTO en ${propusieron.length}/${results.length} caso(s):`);
    for (const r of propusieron) console.log(`  ${r.id}: «${r.propuso}»`);
  } else if (results.length > 0) {
    console.log(`
Objetivo propuesto en 0/${results.length} caso(s).`);
  }

  console.log(
    `Costo real de esta corrida: ~$${realCostUsd(results).toFixed(3)} USD (tokens medidos × la tarifa del modelo que corrió cada caso)`,
  );
  if (passed < results.length || results.length < cases.length) process.exit(1);
}

main().catch((err: unknown) => {
  // A clean, single fatal-error print + non-zero exit — never a raw
  // unhandledRejection stack dump that leaves the process hanging.
  console.error("agent-eval: fatal error");
  console.error(err);
  process.exit(1);
});
