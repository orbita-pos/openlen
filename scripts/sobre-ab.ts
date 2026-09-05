// EL EXPERIMENTO DE LOS DOS SOBRES — ¿le estorba OpenLen a DeepSeek al programar?
//
//   npm run sobre:ab -- --yes
//   npm run sobre:ab -- --yes --solo=movil
//   npm run sobre:ab -- --yes --repeticiones=2 --budget-usd=0.5
//
// LA PREGUNTA, en las palabras de Jesús: «cuando uso la API de DeepSeek en la
// terminal me trabaja a un nivel altísimo; en OpenLen fallaba hasta para poner
// un móvil». Esto lo MIDE en vez de opinarlo.
//
// EL DISEÑO está en lib/agent/evals/sobres.ts: mismo modelo, mismo protocolo de
// ops, misma página, misma instrucción — sólo cambia el SOBRE.
//
// 🔴 EL JUEZ NO ES UN MODELO. Las tres tareas se puntúan con la pasada
// DETERMINISTA (`renderVisualQualityViewports`): Chromium mide el desborde en
// móvil, el texto ilegible y lo que el JavaScript grita. Un juez con opinión
// sobre un experimento de prompts mediría el prompt del juez.
//
// 🔴 LO QUE ESTO NO PUEDE CONCLUIR. Tres tareas por brazo y un modelo
// estocástico dan una SEÑAL, no una sentencia. Con `--repeticiones` se paga más
// muestra; sin ellas, un resultado apretado no significa nada y hay que decirlo.
import { writeFileSync, mkdirSync } from "node:fs";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { rateFor, usdDeTurno } from "@/lib/ai/tarifas-eval";
import { modelIdForRole } from "@/lib/generation/model-policy";
import type { EvalCase } from "@/lib/agent/evals/cases";
import {
  resolveEvalUser,
  runEvalCase,
  type EvalRunResult,
  type RunEvalOptions,
} from "@/lib/agent/evals/harness";
import type { Sobre } from "@/lib/agent/evals/sobres";

// ─────────────────────────────────────────────────────────────────────────────
// LA PÁGINA DE PARTIDA. De escritorio a propósito: 1.100 px fijos, una tabla que
// no cabe y un correo largo sin puntos de corte. Con el `<meta viewport>` PUESTO
// —una página real lo lleva— así que el desborde es de maquetación, no el caso
// trivial de una página sin viewport que el navegador escala sola.
//
// Y con contenido de verdad (una carta con categorías) para que la tarea del
// JavaScript tenga sobre qué filtrar sin inventarse el contenido primero.
// ─────────────────────────────────────────────────────────────────────────────
const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cantina La Bufa</title>
<meta name="description" content="Cantina La Bufa — cocina zacatecana en el centro.">
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root { --tinta: #1c1917; --papel: #faf7f2; --acento: #9a3412; }
  body { margin: 0; background: var(--papel); color: var(--tinta); font-family: Georgia, serif; }
  .marco { width: 1100px; margin: 0 auto; padding: 40px; }
  .barra { display: flex; gap: 40px; align-items: center; padding: 24px 40px; border-bottom: 2px solid var(--tinta); }
  .barra a { color: var(--tinta); text-decoration: none; font-size: 18px; }
  .portada { display: flex; gap: 60px; align-items: center; margin: 60px 0; }
  .portada h1 { font-size: 68px; line-height: 1; margin: 0; }
  .retrato { width: 460px; height: 320px; background: linear-gradient(135deg, #d6d3d1, #a8a29e); flex: none; }
  table.carta { width: 100%; min-width: 900px; border-collapse: collapse; }
  table.carta th, table.carta td { border-bottom: 1px solid #d6d3d1; padding: 14px 18px; text-align: left; font-size: 17px; }
  .pie { border-top: 2px solid var(--tinta); padding: 32px 40px; }
</style>
</head>
<body>
<header class="barra">
  <strong style="font-size:22px">Cantina La Bufa</strong>
  <a href="#carta">Carta</a>
  <a href="#historia">Historia</a>
  <a href="#contacto">Contacto</a>
  <a href="#contacto" style="margin-left:auto;background:var(--acento);color:#fff;padding:12px 22px">Reservar</a>
</header>
<div class="marco">
  <section class="portada" id="inicio">
    <div>
      <h1>Cocina zacatecana desde 1978</h1>
      <p style="font-size:20px;max-width:520px">Asado de boda, enchiladas mineras y birria de olla, en el mismo local de la calle Tacuba donde empezó mi abuela.</p>
    </div>
    <div class="retrato" role="img" aria-label="Interior de la cantina"></div>
  </section>
  <section id="carta">
    <h2 style="font-size:38px">La carta</h2>
    <table class="carta">
      <thead><tr><th>Platillo</th><th>Categoría</th><th>Descripción</th><th>Precio</th></tr></thead>
      <tbody>
        <tr data-plato><td>Sopa de médula</td><td>Entrante</td><td>Caldo claro con médula de res, cilantro y limón</td><td>$95</td></tr>
        <tr data-plato><td>Queso fundido con chorizo</td><td>Entrante</td><td>Queso menonita con chorizo de la sierra</td><td>$120</td></tr>
        <tr data-plato><td>Asado de boda</td><td>Principal</td><td>Cerdo en adobo de chile colorado, la receta de la casa</td><td>$210</td></tr>
        <tr data-plato><td>Enchiladas mineras</td><td>Principal</td><td>Tortilla pasada por guajillo, papa y zanahoria</td><td>$175</td></tr>
        <tr data-plato><td>Birria de olla</td><td>Principal</td><td>Chivo de la región, cocido ocho horas</td><td>$240</td></tr>
        <tr data-plato><td>Jericalla</td><td>Postre</td><td>Natilla quemada con canela</td><td>$85</td></tr>
        <tr data-plato><td>Ate con queso</td><td>Postre</td><td>Ate de membrillo y queso fresco de rancho</td><td>$70</td></tr>
      </tbody>
    </table>
  </section>
  <section id="historia">
    <h2 style="font-size:38px">Historia</h2>
    <p style="font-size:19px">Abrimos en 1978 con seis mesas. Hoy somos las mismas seis mesas, la misma cocina de carbón y la tercera generación de la familia atendiendo.</p>
  </section>
  <section id="contacto">
    <h2 style="font-size:38px">Contacto</h2>
    <p style="font-size:19px">Calle Tacuba 214, Centro, Zacatecas · reservaciones.cantinalabufa.zacatecas@correodelacantina.com.mx</p>
  </section>
</div>
<footer class="pie"><p>© 1978–2026 Cantina La Bufa</p></footer>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// LAS TAREAS. Tres, y las tres se resuelven SÓLO con los cuatro verbos de
// edición: si una necesitara una herramienta que el brazo mínimo no lleva,
// fallaría por eso y no por su sobre.
// ─────────────────────────────────────────────────────────────────────────────
interface Tarea {
  id: string;
  prompt: string;
  /** Qué se mide, dicho para el informe. */
  mide: string;
}

const TAREAS: readonly Tarea[] = [
  {
    id: "movil",
    // El fallo que Jesús cita textualmente.
    prompt:
      "En el celular la página se sale de la pantalla y no se puede leer nada. Arréglalo para que se vea bien en un teléfono.",
    mide: "desborde en móvil a 390px (Chromium)",
  },
  {
    id: "filtro",
    prompt:
      "Ponme unos botones arriba de la carta para filtrar por entrantes, principales y postres, y uno de ver todo.",
    mide: "el filtro existe, cablea con addEventListener y no lanza",
  },
  {
    id: "faq",
    prompt:
      "Agrégame una sección de preguntas frecuentes con 4 preguntas, justo antes del pie de página.",
    mide: "la sección existe con 4 preguntas y no rompe lo demás",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LA MEDIDA. Determinista, de Chromium: ni un modelo opina sobre esto.
// ─────────────────────────────────────────────────────────────────────────────
interface Medida {
  /** 🔴 «NO PUDE MIRAR» NO ES «ESTÁ BIEN». Si Chromium no arranca, el render
   *  falla ABIERTO y devuelve null; contar eso como página sana convertiría una
   *  avería del navegador en una victoria del sobre. */
  medido: boolean;
  desbordeMovil: boolean;
  culpable: string;
  ilegibles: number;
  erroresJs: string[];
  bytes: number;
}

async function medir(html: string): Promise<Medida> {
  const v = await renderVisualQualityViewports(html, {});
  if (!v) {
    return { medido: false, desbordeMovil: false, culpable: "", ilegibles: 0, erroresJs: [], bytes: html.length };
  }
  return {
    medido: true,
    desbordeMovil: v.mobileOverflow === true,
    culpable: v.overflowCulprit ?? "",
    ilegibles: v.unreadableText?.length ?? 0,
    erroresJs: [...(v.runtimeErrors ?? [])],
    bytes: html.length,
  };
}

/** Señales de la tarea, leídas del documento — hechos, no juicios. */
function señales(id: string, html: string): Record<string, boolean | number> {
  const bajo = html.toLowerCase();
  if (id === "filtro") {
    return {
      hay_script: /<script(?![^>]*\bsrc=)/i.test(html),
      usa_addEventListener: html.includes("addEventListener"),
      // Un `on*` en el marcado nace MUERTO: el saneado se lo lleva.
      escribio_on_inline: /\son[a-z]+\s*=\s*["']/i.test(html),
      botones_nuevos: (html.match(/<button/gi) ?? []).length,
    };
  }
  if (id === "faq") {
    const preguntas = (html.match(/<(summary|h3|dt)\b/gi) ?? []).length;
    return {
      menciona_faq: /preguntas frecuentes|faq/i.test(bajo),
      posibles_preguntas: preguntas,
      usa_details: /<details\b/i.test(html),
    };
  }
  return {
    // Móvil: lo que de verdad arregla un ancho fijo.
    quedan_anchos_fijos_grandes: /width:\s*(9\d\d|1[0-9]{3})px/i.test(html),
    hay_media_query: /@media[^{]*\(max-width/i.test(html),
    hay_clases_responsivas: /\b(sm|md|lg):/.test(html),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const get = (f: string) => argv.find((a) => a === f || a.startsWith(`${f}=`));
  const val = (f: string) => {
    const hit = get(f);
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? "" : hit.slice(eq + 1);
  };
  return {
    yes: !!get("--yes"),
    medirBase: !!get("--medir-base"),
    solo: val("--solo"),
    repeticiones: Number(val("--repeticiones") ?? "1"),
    budgetUsd: val("--budget-usd"),
  };
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// Mismo cálculo que scripts/agent-eval.ts, con los tokens típicos de un turno.
// El brazo MÍNIMO gasta menos entrada, así que esto es el techo, no la media.
const TOKENS_TIPICOS = { entrada: 67_118, cacheada: 41_168, salida: 922 } as const;
const tarifa = rateFor(modelIdForRole("agent"));
const COSTE_POR_TURNO_USD =
  ((TOKENS_TIPICOS.entrada - TOKENS_TIPICOS.cacheada) * tarifa.input +
    TOKENS_TIPICOS.cacheada * tarifa.cached +
    TOKENS_TIPICOS.salida * tarifa.output) / 1e6;
const DEFAULT_BUDGET_USD = 0.3;

interface Corrida {
  tarea: string;
  sobre: Sobre;
  intento: number;
  html: string;
  medida: Medida;
  señales: Record<string, boolean | number>;
  tokens: { entrada: number; cacheada: number; salida: number };
  segundos: number;
  llamadas: number;
  cambio: boolean;
  error: string | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tareas = args.solo
    ? TAREAS.filter((t) => t.id === args.solo)
    : [...TAREAS];
  if (tareas.length === 0) fail(`--solo=${args.solo}: no existe esa tarea`);
  if (!Number.isInteger(args.repeticiones) || args.repeticiones < 1) {
    fail("--repeticiones tiene que ser un entero >= 1");
  }

  // GRATIS y antes de nada: ¿la página de partida tiene de verdad el defecto?
  // Una tarea "arregla el móvil" sobre una página que ya se ve bien no mide al
  // modelo, mide al FIXTURE — y saldría empate en los dos brazos con toda
  // naturalidad. Esto se corre sin gastar un céntimo.
  if (args.medirBase) {
    const m = await medir(PAGINA);
    console.log("\nLA PÁGINA DE PARTIDA (sin gastar nada):");
    console.log(`  medido        : ${m.medido ? "sí" : "NO — Chromium no arrancó"}`);
    console.log(`  desborde móvil: ${m.desbordeMovil ? "SÍ" : "no"}${m.culpable ? " (culpable: " + m.culpable + ")" : ""}`);
    console.log(`  ilegibles     : ${m.ilegibles}`);
    console.log(`  errores JS    : ${m.erroresJs.length}`);
    console.log(
      m.desbordeMovil
        ? "\n✓ hay defecto que arreglar: la tarea `movil` mide algo.\n"
        : "\n✗ NO desborda: la tarea `movil` no mediría nada. Arregla el fixture antes de pagar.\n",
    );
    return;
  }

  const turnos = tareas.length * 2 * args.repeticiones;
  const estimado = turnos * COSTE_POR_TURNO_USD;
  const presupuesto = args.budgetUsd !== undefined ? Number(args.budgetUsd) : DEFAULT_BUDGET_USD;

  console.log("\nEL EXPERIMENTO DE LOS DOS SOBRES");
  console.log(`  modelo      : ${modelIdForRole("agent")}`);
  console.log(`  tareas      : ${tareas.map((t) => t.id).join(", ")}`);
  console.log(`  brazos      : openlen · minimo`);
  console.log(`  repeticiones: ${args.repeticiones}`);
  console.log(`  turnos      : ${turnos}`);
  console.log(`  ESTIMADO    : $${estimado.toFixed(3)} USD (techo; el brazo mínimo gasta menos)`);
  console.log(`  presupuesto : $${presupuesto.toFixed(2)}\n`);

  if (!Number.isFinite(presupuesto) || presupuesto <= 0) fail("--budget-usd inválido");
  if (estimado > presupuesto) {
    fail(
      `el estimado ($${estimado.toFixed(3)}) supera el presupuesto ($${presupuesto.toFixed(2)}). ` +
        "Sube --budget-usd a conciencia o baja --repeticiones.",
    );
  }
  if (!args.yes) fail("esto GASTA DINERO. Añade --yes cuando quieras correrlo de verdad.");

  const { id: userId, email: ownerEmail } = await resolveEvalUser();

  console.log("midiendo la página de partida…");
  const base = await medir(PAGINA);
  console.log(
    `  desborde móvil: ${base.desbordeMovil ? "SÍ" : "no"}` +
      (base.culpable ? ` (culpable: ${base.culpable})` : "") +
      ` · ilegibles: ${base.ilegibles} · errores JS: ${base.erroresJs.length}\n`,
  );
  if (!base.desbordeMovil) {
    console.warn(
      "⚠️  La página de partida NO desborda en móvil: la tarea `movil` no tiene nada que arreglar\n" +
        "    y su resultado no significaría nada. Revisa el fixture antes de creerte el número.\n",
    );
  }

  const corridas: Corrida[] = [];
  for (let intento = 1; intento <= args.repeticiones; intento++) {
    for (const tarea of tareas) {
      for (const sobre of ["openlen", "minimo"] as const) {
        let html = "";
        let llamadas = 0;
        const caso: EvalCase = {
          id: `sobre-${tarea.id}-${sobre}-${intento}`,
          prompt: tarea.prompt,
          setup: () => ({ html: PAGINA }),
          // El `assert` es el gancho de captura: este experimento no tiene
          // veredicto de aprobado/suspenso — mide, y quien juzga es Chromium.
          assert: ({ data, events }) => {
            html = data.html ?? "";
            llamadas = events.filter((e) => e.type === "action").length;
            return null;
          },
        };
        const opts: RunEvalOptions = { userId, ownerEmail, sobre };
        process.stdout.write(`  ${tarea.id.padEnd(7)} · ${sobre.padEnd(7)} · intento ${intento} … `);
        let r: EvalRunResult | null = null;
        let error: string | null = null;
        try {
          r = await runEvalCase(caso, opts);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const cambio = html !== "" && html !== PAGINA;
        const medida = cambio ? await medir(html) : base;
        corridas.push({
          tarea: tarea.id,
          sobre,
          intento,
          html,
          medida,
          señales: cambio ? señales(tarea.id, html) : {},
          tokens: {
            entrada: r?.inputTokens ?? 0,
            cacheada: r?.cachedTokens ?? 0,
            salida: r?.outputTokens ?? 0,
          },
          segundos: r?.seconds ?? 0,
          llamadas,
          cambio,
          error,
        });
        console.log(
          error
            ? `ERROR (${error.slice(0, 60)})`
            : `${cambio ? "cambió" : "NO cambió"} · desborde ${medida.desbordeMovil ? "SÍ" : "no"} · ${llamadas} llamadas · ${(r?.seconds ?? 0).toFixed(0)}s`,
        );
      }
    }
  }

  // ── El informe ────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(78));
  console.log("RESULTADO — el juez es Chromium, no un modelo\n");
  console.log(
    `partida: desborde ${base.desbordeMovil ? "SÍ" : "no"} · ilegibles ${base.ilegibles} · errores JS ${base.erroresJs.length}\n`,
  );
  const cab = "tarea    sobre    cambió  desborde  ilegibles  errJS  llamadas  tok.sal  seg";
  console.log(cab);
  console.log("─".repeat(cab.length));
  for (const c of corridas) {
    console.log(
      [
        c.tarea.padEnd(8),
        c.sobre.padEnd(8),
        (c.cambio ? "sí" : "NO").padEnd(7),
        (c.medida.medido ? (c.medida.desbordeMovil ? "SÍ" : "no") : "¿?").padEnd(9),
        String(c.medida.ilegibles).padEnd(10),
        String(c.medida.erroresJs.length).padEnd(6),
        String(c.llamadas).padEnd(9),
        String(c.tokens.salida).padEnd(8),
        c.segundos.toFixed(0),
      ].join(""),
    );
  }

  console.log("\nSEÑALES POR TAREA");
  for (const c of corridas) {
    const s = Object.entries(c.señales).map(([k, v]) => `${k}=${v}`).join(" · ");
    console.log(`  ${c.tarea}/${c.sobre}#${c.intento}: ${s || "(sin cambio)"}`);
    for (const e of c.medida.erroresJs.slice(0, 2)) console.log(`      ↳ JS: ${e.slice(0, 110)}`);
  }

  const usdReal = corridas.reduce((s, c) => {
    const t = c.tokens;
    return (
      usdDeTurno(t, tarifa)
    );
  }, 0);
  console.log(`\nCOSTE REAL: $${usdReal.toFixed(4)} USD (estimado era $${estimado.toFixed(3)})`);

  mkdirSync(".claude/qa/sobres", { recursive: true });
  const salida = `.claude/qa/sobres/corrida-${Date.now()}.json`;
  writeFileSync(salida, JSON.stringify({ base, corridas }, null, 2), "utf8");
  for (const c of corridas) {
    if (c.html) writeFileSync(`.claude/qa/sobres/${c.tarea}-${c.sobre}-${c.intento}.html`, c.html, "utf8");
  }
  console.log(`páginas y datos crudos en .claude/qa/sobres/ (${salida})`);
  console.log(
    `\n⚠️  ${args.repeticiones === 1 ? "UNA sola muestra por celda" : `${args.repeticiones} muestras por celda`}: ` +
      "un resultado apretado NO es una conclusión. Sube --repeticiones antes de decidir nada.\n",
  );
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
