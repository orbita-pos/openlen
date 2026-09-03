// scripts/agent-multiturno.ts — el Agente a lo largo de UNA CONVERSACIÓN.
//
//   npm run agent:multiturno -- --escenario=aurora --yes
//   npm run agent:multiturno -- --escenario=aurora --yes --conservar
//
// POR QUÉ EXISTE, y por qué no vale la batería de evals.
//
// `lib/agent/evals/harness.ts` manda `history: []` — un turno por caso—, así
// que mide al Agente EMPEZANDO siempre de cero. Pero los fallos que de verdad
// se sufren no son de un turno: son de acumulación. MEDIDO el 2026-09-02, una
// landing de inmobiliaria: turno a turno el bucle iba a 6 → 10 → 9 vueltas,
// 720k tokens en tres mensajes, y la portada acabó peor que como empezó. Nada
// de eso se ve con `history: []`.
//
// Y hay dos cosas que el arnés directamente NO ENCHUFA, así que ni existían
// para él: `restaurarHtml` (el keep-best) y `observarPagina` (mirar_pagina).
// Aquí van conectadas, como en producción.
//
// ⚠️ GASTA DINERO REAL. Mismas guardas que el arnés de evals: se imprime el
// estimado, se niega a correr sin --yes, y hay un tope duro de gasto.

import { runAgentLoop, type AgentLoopArgs, type AgentStreamEvent } from "@/lib/agent/loop";
import { buildAgentMessages } from "@/lib/agent/context";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { createAgentBrain } from "@/lib/agent/brain";
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";
import { tagWithOpIds } from "@/lib/html-ops";
import { observarPagina, verifyEditedPage } from "@/lib/agent/verify";
import { persistPage } from "@/lib/page-engine/persist";
import {
  createThrowawayProject,
  deleteThrowawayProject,
  resolveEvalUser,
  restoreAgentMemory,
  snapshotAgentMemory,
} from "@/lib/agent/evals/harness";
import { ESCENARIOS, type Escenario } from "@/lib/agent/evals/escenarios";

const MAX_PROMPT_TOKENS = 240_000;

// Medido el 2026-09-02 sobre el escenario `aurora`: tres turnos con los ojos
// encendidos costaron $0.179 con el código arreglado y $0.288 con el anterior.
// 8¢ por turno sobreestima a propósito — mejor sobrar que drenar la cuenta.
const COSTE_ESTIMADO_POR_TURNO_USD = 0.08;

// El MISMO tope que el arnés de evals, y por la misma razón: el 2026-07-14 una
// batería con re-runs vació el saldo prepagado con un estimado citado de $0.42.
// --yes confirma «esto gasta»; el budget es el TECHO de cuánto.
const TOPE_POR_DEFECTO_USD = 0.3;

// Tarifa de deepseek-v4-pro-0813 por millón (entrada / caché / salida), la
// misma tabla que cita lib/generation/model-policy.ts.
const USD_ENTRADA = 1.32;
const USD_CACHE = 0.044;
const USD_SALIDA = 3.96;

function fallar(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`agent-multiturno: ${msg}`);
  process.exit(1);
}

function leerArgs(argv: string[]) {
  const flag = (n: string) => argv.find((a) => a === n || a.startsWith(`${n}=`));
  const valor = (n: string) => {
    const f = flag(n);
    return f && f.includes("=") ? f.slice(f.indexOf("=") + 1) : undefined;
  };
  return {
    escenario: valor("--escenario") ?? "aurora",
    yes: !!flag("--yes"),
    conservar: !!flag("--conservar"),
    budgetUsd: valor("--budget-usd"),
    forzarKeepbest: !!flag("--forzar-keepbest"),
  };
}

// ─── --forzar-keepbest ───────────────────────────────────────────────────────
//
// 🔴 POR QUÉ EXISTE, y por qué el veredicto va FALSEADO aquí y sólo aquí.
//
// El keep-best sólo entra cuando un ciclo de arreglo NO baja el número de
// problemas. Eso, con un modelo de verdad, es un suceso raro y ALEATORIO: no se
// puede pedir «fállame esta reparación», y cada intento de provocarlo cuesta
// dinero sin garantía de salir. Medido: tres corridas completas del escenario
// de Aurora y `reverts=0` en las tres.
//
// Así que se falsea LO MÍNIMO —el veredicto, que devuelve siempre el mismo
// número de problemas— y se deja REAL todo lo demás: el modelo, sus
// herramientas, la escritura en la base, el ciclo de arreglo del bucle y el
// revert por `persistPage`. Lo que se comprueba es el CABLE, que es lo que no
// podían comprobar los dobles: que el documento vuelve de verdad a la base y
// deja su fila en Versiones.
//
// No es un modo de medición. Es un modo de PRUEBA, y por eso lo dice en voz
// alta en la salida: un número salido de aquí no vale como medida de nada.
const PROBLEMAS_FORZADOS = 2;

interface ResumenTurno {
  readonly vueltas: number;
  readonly llamadas: number;
  readonly segundos: number;
  readonly entrada: number;
  readonly cache: number;
  readonly salida: number;
  readonly roturas: number;
  readonly reverts: number;
  readonly herramientas: string[];
}

async function correrEscenario(
  esc: Escenario,
  conservar: boolean,
  forzarKeepbest: boolean,
): Promise<void> {
  const owner = await resolveEvalUser();
  const memoriaPrevia = await snapshotAgentMemory(owner.id);
  const projectId = await createThrowawayProject(owner.id, `multiturno-${esc.id}`, {
    html: esc.html,
  });
  // `observarPagina` se enchufa aquí igual que en app/api/agent/route.ts — sin
  // ella `mirar_pagina` contestaría «no disponible» y estaríamos midiendo un
  // Agente distinto del que corre en producción.
  const deps = { ...realDeps(), observarPagina };
  const tools = buildFunctionDeclarations(process.env);

  const historia: { role: "user" | "assistant"; content: string }[] = [];
  const resumenes: ResumenTurno[] = [];

  // eslint-disable-next-line no-console
  console.log(`Owner: ${owner.email} · proyecto ${projectId}`);

  // En modo forzado basta UN turno: lo que se prueba es el cable del revert,
  // no la acumulación. Tres turnos costarían el triple para enseñar lo mismo.
  const turnos = forzarKeepbest ? esc.turnos.slice(0, 1) : esc.turnos;

  try {
    for (const [i, prompt] of turnos.entries()) {
      const t0 = Date.now();
      const row = await deps.loadProject(projectId, owner.id);
      if (!row) throw new Error("la fila del proyecto desapareció a media corrida");
      const htmlAntes = row.data.html ?? "";
      const { taggedHtml } = tagWithOpIds(htmlAntes);
      const built = buildAgentMessages({
        state: summarizeProjectState(row),
        taggedHtml,
        userBrief: row.userBrief,
        prompt,
        // LA DIFERENCIA CON EL ARNÉS, en una línea.
        history: [...historia],
        maxPromptTokens: MAX_PROMPT_TOKENS,
      });
      if (!built.ok) throw new Error(`el turno ${i + 1} no cabe en el contexto`);

      const session: AgentSession = {
        projectId,
        userId: owner.id,
        taggedHtml,
        page: null,
        ownerEmail: owner.email,
        imageEditsThisTurn: 0,
        photoSearchesThisTurn: 0,
        busquedasVaciasSeguidas: 0,
        mensajeDelUsuario: prompt,
      };

      const eventos: AgentStreamEvent[] = [];
      const brain = createAgentBrain({ tools, requestId: `${projectId}-t${i}` });

      // Los ojos, mapeados COMO LA RUTA: los hechos del navegador mandan, la
      // observación informa y no abre ciclo. Si esto divergiera de
      // app/api/agent/route.ts estaríamos midiendo otro producto.
      const verifyTurn: AgentLoopArgs["verifyTurn"] = async ({ html, soloDeterminista }) => {
        // Ver el comentario de PROBLEMAS_FORZADOS: mismo número las dos veces ⇒
        // «no bajó» ⇒ el bucle deshace. Todo lo demás sigue siendo real.
        if (forzarKeepbest) {
          return {
            estado: "roto",
            critique: "- [forzado] la revisión reporta un problema que no baja",
            problemas: PROBLEMAS_FORZADOS,
          };
        }
        const v = await verifyEditedPage({
          html,
          userPrompt: prompt,
          ...(soloDeterminista ? { soloDeterminista: true } : {}),
        });
        if (v.fallback) return { estado: "no_mirado", motivo: "la verificación no pudo correr" };
        if (v.broken) {
          return {
            estado: "roto",
            critique: v.issues.map((x) => `- ${x}`).join("\n"),
            problemas: v.issues.length,
          };
        }
        if (v.observaciones.length > 0) return { estado: "observado", notas: v.observaciones };
        return { estado: "bien" };
      };

      let reverts = 0;
      let htmlRestaurado: string | null = null;
      const result = await runAgentLoop({
        messages: built.messages,
        tools,
        openStream: (m) => brain.openStream(m),
        closeOut: (m) => brain.closeOut(m),
        runTool: (name, args) => runAgentTool(session, deps, name, args),
        verifyTurn,
        // KEEP-BEST. El arnés no lo pasa, así que hasta hoy no corría NUNCA
        // fuera de los dobles de prueba.
        restaurarHtml: async ({ html, page }) => {
          reverts += 1;
          htmlRestaurado = html;
          await persistPage(
            { projectId, userId: owner.id, page, html, label: "Deshecho (multiturno)" },
            deps,
          );
        },
        emit: (e) => eventos.push(e),
      });

      const segundos = (Date.now() - t0) / 1000;
      const despues = await deps.loadProject(projectId, owner.id);
      const herramientas = eventos
        .filter((e) => e.type === "action" && e.status === "done")
        .map((e) => (e as { tool: string }).tool);
      const roturas = eventos.filter(
        (e) =>
          e.type === "action" &&
          (e as { tool: string }).tool === "verificar_diseno" &&
          (e as { summary?: string }).summary === "issues",
      ).length;

      resumenes.push({
        vueltas: result.turns,
        llamadas: result.toolCalls,
        segundos,
        entrada: result.usage.inputTokens,
        cache: result.usage.cachedTokens ?? 0,
        salida: result.usage.outputTokens,
        roturas,
        reverts,
        herramientas,
      });

      /* eslint-disable no-console */
      console.log(`\n───── TURNO ${i + 1}/${turnos.length} ─────`);
      console.log(`  «${prompt.slice(0, 78).replace(/\s+/g, " ")}…»`);
      console.log(`  vueltas=${result.turns} llamadas=${result.toolCalls} seg=${segundos.toFixed(1)}`);
      console.log(
        `  tokens in=${result.usage.inputTokens} cached=${result.usage.cachedTokens ?? 0} out=${result.usage.outputTokens}`,
      );
      console.log(`  herramientas: ${herramientas.join(" → ") || "(ninguna)"}`);
      console.log(`  ojos: ${roturas} rotura(s) · reverts=${reverts} · error=${result.terminalError}`);
      if (reverts > 0) {
        // EL CABLE ENTERO: no basta con que `restaurarHtml` se llamara — hay que
        // ver que la BASE quedó en esa foto. Un revert que no persiste es un
        // revert que no existe.
        const enLaBase = despues?.data.html ?? "";
        console.log(
          `  keep-best: la base quedó en el documento restaurado → ${enLaBase === htmlRestaurado ? "SÍ" : "NO"}`,
        );
      }
      console.log(`  html ${htmlAntes.length} → ${(despues?.data.html ?? "").length} bytes`);
      console.log(`  respuesta: ${(result.finalText ?? "").replace(/\s+/g, " ").slice(0, 180)}`);
      /* eslint-enable no-console */

      historia.push({ role: "user", content: prompt });
      historia.push({ role: "assistant", content: result.finalText ?? "" });
    }

    const fin = await deps.loadProject(projectId, owner.id);
    const html = fin?.data.html ?? "";
    const tot = resumenes.reduce(
      (a, r) => ({
        vueltas: a.vueltas + r.vueltas,
        llamadas: a.llamadas + r.llamadas,
        segundos: a.segundos + r.segundos,
        entrada: a.entrada + r.entrada,
        cache: a.cache + r.cache,
        salida: a.salida + r.salida,
        roturas: a.roturas + r.roturas,
        reverts: a.reverts + r.reverts,
      }),
      { vueltas: 0, llamadas: 0, segundos: 0, entrada: 0, cache: 0, salida: 0, roturas: 0, reverts: 0 },
    );
    const frescos = Math.max(0, tot.entrada - tot.cache);
    const usd =
      (frescos / 1e6) * USD_ENTRADA + (tot.cache / 1e6) * USD_CACHE + (tot.salida / 1e6) * USD_SALIDA;

    /* eslint-disable no-console */
    console.log(`\n═════ TOTAL (${esc.id}) ═════`);
    console.log(
      `  vueltas=${tot.vueltas} llamadas=${tot.llamadas} seg=${tot.segundos.toFixed(1)} roturas=${tot.roturas} reverts=${tot.reverts}`,
    );
    console.log(`  tokens in=${tot.entrada} (cached=${tot.cache}) out=${tot.salida}`);
    console.log(`  COSTE REAL ~$${usd.toFixed(3)} USD (tokens medidos × tarifa del modelo)`);
    // LA CURVA es el hallazgo, no el total: un hilo sano se desahoga turno a
    // turno; uno que se atasca sube. En el caso de Aurora, el código anterior
    // iba 6 → 10 → 9 y el arreglado 9 → 3 → 3.
    console.log(`  curva de vueltas: ${resumenes.map((r) => r.vueltas).join(" → ")}`);
    for (const [clave, re] of Object.entries(esc.invariantes)) {
      console.log(`  ${clave}: ${re.test(html) ? "SÍ" : "no"}`);
    }
    /* eslint-enable no-console */
  } finally {
    await restoreAgentMemory(owner.id, memoriaPrevia);
    if (conservar) {
      // eslint-disable-next-line no-console
      console.log(`\n(proyecto CONSERVADO para inspección: ${projectId})`);
    } else {
      await deleteThrowawayProject(projectId);
      // eslint-disable-next-line no-console
      console.log(`\n(proyecto de usar y tirar borrado · memoria del agente restaurada)`);
    }
  }
}

async function main(): Promise<void> {
  const args = leerArgs(process.argv.slice(2));
  const esc = ESCENARIOS.find((e) => e.id === args.escenario);
  if (!esc) {
    fallar(
      `escenario desconocido "${args.escenario}". Los que hay: ${ESCENARIOS.map((e) => e.id).join(", ")}`,
    );
  }

  const estimado = esc.turnos.length * COSTE_ESTIMADO_POR_TURNO_USD;
  const tope = args.budgetUsd ? Number(args.budgetUsd) : TOPE_POR_DEFECTO_USD;
  if (!Number.isFinite(tope) || tope <= 0) fallar(`--budget-usd inválido: "${args.budgetUsd}"`);

  /* eslint-disable no-console */
  console.log(`\nEscenario: ${esc.id} — ${esc.descripcion}`);
  console.log(`Turnos: ${esc.turnos.length}`);
  console.log(
    `Costo estimado: ~$${estimado.toFixed(2)} USD (${esc.turnos.length} × ~${(COSTE_ESTIMADO_POR_TURNO_USD * 100).toFixed(0)}¢/turno, con los ojos encendidos)`,
  );
  console.log(`Tope de gasto: $${tope.toFixed(2)} USD`);
  if (args.forzarKeepbest) {
    console.log(
      [
        "",
        "⚠️  --forzar-keepbest: el VEREDICTO va falseado (siempre el mismo número de",
        "    problemas) para que el ciclo no baje y el keep-best entre. El modelo, las",
        "    herramientas y la escritura son REALES. Los números de esta corrida NO",
        "    valen como medida de nada — es una prueba de CABLE.",
      ].join("\n"),
    );
  }
  /* eslint-enable no-console */

  if (estimado > tope) {
    fallar(
      `RECHAZADO: el estimado ($${estimado.toFixed(2)}) excede el tope ($${tope.toFixed(2)}).\n` +
        `Si de verdad quieres gastar eso, decláralo explícito: --budget-usd=${(estimado + 0.01).toFixed(2)}`,
    );
  }
  if (!args.yes) {
    // eslint-disable-next-line no-console
    console.log("\nEsto GASTA dinero real del proveedor. Vuelve a correr con --yes para confirmar.");
    return;
  }

  await correrEscenario(esc, args.conservar, args.forzarKeepbest);
}

void main().catch((err: unknown) => {
  fallar(err instanceof Error ? err.message : String(err));
});
