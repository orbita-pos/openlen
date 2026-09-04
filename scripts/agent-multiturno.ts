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

  };
}

// ⚰️ AQUI VIVIA --forzar-keepbest, y con el PROBLEMAS_FORZADOS.
//
// Falseaba el veredicto para que el ciclo de arreglo no bajase el numero de
// problemas y entrara el keep-best, y asi poder probar EL CABLE del revert:
// que el documento volvia de verdad a la base y dejaba su fila en Versiones.
//
// Ni hay ciclo ni hay revert desde el 2026-09-04 (`12f6a11e`): el turno cierra
// con lo que hizo el modelo y quien deshace es el usuario, con su Undo. Un
// modo de prueba para un cable que ya no existe solo puede enseñar a medir mal.
interface ResumenTurno {
  readonly vueltas: number;
  readonly llamadas: number;
  readonly segundos: number;
  readonly entrada: number;
  readonly cache: number;
  readonly salida: number;
  readonly roturas: number;
  readonly herramientas: string[];
  /** Cuantas ops de cada tipo emitio el turno. Sin esto no se puede saber si un
   *  verbo nuevo SE USA — y un verbo que no se usa no ha arreglado nada. */
  readonly ops: Record<string, number>;
  /** QUE TOPE agoto el turno, si agoto alguno. `null` = no toco ninguno.
   *
   *  El bucle ya lo devolvia (`AgentLoopResult.topeAlcanzado`) y el arnes lo
   *  tiraba, y `error=` NO lo delata: cuando hay `closeOut`, agotar un tope
   *  produce un cierre elegante y deja `terminalError=false`. Una corrida
   *  contra el techo se leia exactamente igual que una que termino sola.
   *
   *  MEDIDO el 2026-09-04: la pregunta que decidia si subir los topes era
   *  «cuantos turnos los TOCAN», y no habia forma de contestarla desde la
   *  salida. Con esto la respuesta salio 0 de 36 y la subida se descarto. */
  readonly tope: string | null;
}

async function correrEscenario(esc: Escenario, conservar: boolean): Promise<void> {
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

  const turnos = esc.turnos;

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
      const verifyTurn: AgentLoopArgs["verifyTurn"] = async ({ html }) => {
        const v = await verifyEditedPage({
          html,
          userPrompt: prompt,
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

      const result = await runAgentLoop({
        messages: built.messages,
        tools,
        openStream: (m) => brain.openStream(m),
        closeOut: (m) => brain.closeOut(m),
        runTool: (name, args) => runAgentTool(session, deps, name, args),
        verifyTurn,
        emit: (e) => eventos.push(e),
      });

      const segundos = (Date.now() - t0) / 1000;
      const despues = await deps.loadProject(projectId, owner.id);
      const herramientas = eventos
        .filter((e) => e.type === "action" && e.status === "done")
        .map((e) => (e as { tool: string }).tool);
      // QUE OPS EMITIO, por tipo. La leccion del 03/09: se anadio `op="text"`,
      // se corrio el escenario, y no habia forma de saber si el modelo lo habia
      // usado ni una vez — asi que la corrida no podia decir nada del verbo.
      const ops: Record<string, number> = {};
      for (const e of eventos) {
        if (e.type !== "action") continue;
        const lista = (e as { ops?: { tipo?: string }[] }).ops;
        if (!Array.isArray(lista)) continue;
        for (const o of lista) {
          if (typeof o?.tipo === "string") ops[o.tipo] = (ops[o.tipo] ?? 0) + 1;
        }
      }
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
        herramientas,
        ops,
        tope: result.topeAlcanzado ?? null,
      });

      /* eslint-disable no-console */
      console.log(`\n───── TURNO ${i + 1}/${turnos.length} ─────`);
      console.log(`  «${prompt.slice(0, 78).replace(/\s+/g, " ")}…»`);
      console.log(`  vueltas=${result.turns} llamadas=${result.toolCalls} seg=${segundos.toFixed(1)}`);
      console.log(
        `  tokens in=${result.usage.inputTokens} cached=${result.usage.cachedTokens ?? 0} out=${result.usage.outputTokens}`,
      );
      console.log(`  herramientas: ${herramientas.join(" → ") || "(ninguna)"}`);
      const opsTurno = Object.entries(ops).map(([t, n]) => `${t}×${n}`).join(" ");
      console.log(`  ops: ${opsTurno || "(ninguna)"}`);
      console.log(`  ojos: ${roturas} rotura(s) · error=${result.terminalError} · TOPE=${result.topeAlcanzado ?? "no"} · errorCode=${result.errorCode ?? "-"}`);
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
      }),
      { vueltas: 0, llamadas: 0, segundos: 0, entrada: 0, cache: 0, salida: 0, roturas: 0 },
    );
    const frescos = Math.max(0, tot.entrada - tot.cache);
    const usd =
      (frescos / 1e6) * USD_ENTRADA + (tot.cache / 1e6) * USD_CACHE + (tot.salida / 1e6) * USD_SALIDA;

    /* eslint-disable no-console */
    console.log(`\n═════ TOTAL (${esc.id}) ═════`);
    const conTope = resumenes.filter((r) => r.tope !== null);
    console.log(
      `  TURNOS QUE TOCARON TOPE: ${conTope.length}/${resumenes.length}` +
        (conTope.length ? ` -> ${conTope.map((r) => r.tope).join(", ")}` : ""),
    );
    console.log(
      `  vueltas=${tot.vueltas} llamadas=${tot.llamadas} seg=${tot.segundos.toFixed(1)} roturas=${tot.roturas}`,
    );
    console.log(`  tokens in=${tot.entrada} (cached=${tot.cache}) out=${tot.salida}`);
    console.log(`  COSTE REAL ~$${usd.toFixed(3)} USD (tokens medidos × tarifa del modelo)`);
    // LA CURVA es el hallazgo, no el total: un hilo sano se desahoga turno a
    // turno; uno que se atasca SUBE. Medido en Aurora: el código roto iba
    // 6 → 10 → 9. Con el medidor por píxel, 6 → 3 → 3 dos veces seguidas. Con
    // la guarda de la foto y los ejemplos, 7 → 3 → 2. Con op="text", 9 → 3 → 3
    // — el turno 1 ha ido creciendo (6, 6, 7, 9) y eso ya no parece ruido.
    console.log(`  curva de vueltas: ${resumenes.map((r) => r.vueltas).join(" → ")}`);
    // LAS OPS DEL HILO, por tipo. Un verbo que se anade y no se usa no ha
    // arreglado nada, y hasta el 03/09 no habia forma de verlo desde aqui.
    const opsTotal: Record<string, number> = {};
    for (const r of resumenes) {
      for (const [t, n] of Object.entries(r.ops)) opsTotal[t] = (opsTotal[t] ?? 0) + n;
    }
    const opsLinea = Object.entries(opsTotal)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(" ");
    console.log(`  ops emitidas: ${opsLinea || "(ninguna)"}`);
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

  await correrEscenario(esc, args.conservar);
}

void main().catch((err: unknown) => {
  fallar(err instanceof Error ? err.message : String(err));
});
