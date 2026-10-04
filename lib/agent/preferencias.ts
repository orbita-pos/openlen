/**
 * GUARDAR UNA PREFERENCIA DURABLE — la mecánica de `recordar_preferencia`,
 * mudada aquí tal cual (H3 de Len 2.x). La herramienta se retira: la memoria
 * pasa a ser FICHEROS (`/memoria/dueno.md`, `/memoria/proyecto.md`), como el
 * `CLAUDE.md` de Claude Code, y cada línea nueva que Len escribe en ellos se
 * guarda por aquí, con los mismos límites, la misma deduplicación y el mismo
 * bloque al final del brief.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { AGENT_MEMORY_MAX } from "@/lib/agent/user-memory";
import { USER_BRIEF_MAX } from "@/lib/projects";

export const PREFERENCIA_MIN = 5;
export const PREFERENCIA_MAX = 200;
// The block always lives at the END of the brief (spec) — the em-dash line is
// the stable anchor: search/insert against it, never against leading/trailing
// whitespace, so re-formatting elsewhere in the brief can't break detection.
export const PREFERENCIA_MARKER_LINE = "— Preferencias guardadas por el agente —";

function normalizePreferencia(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ⚰️ AQUÍ VIVÍAN `toolGuardarDatoDelNegocio` y `toolRecordarDelNegocio`.
// Retiradas el 2026-08-31 con el perfil de negocio (ver la lápida de
// `catalog.ts`). Copiaban a otra tabla lo que el usuario acababa de decir, y
// eso creaba dos verdades para el mismo dato.
//
// Lo de aquí abajo NO es su hermana: escribe en `users.agentMemory` y
// `projects.userBrief` — cómo quiere el usuario que le hablen, que no está
// escrito en ninguna página y por eso sí necesita un sitio.

// The ONLY writer of the project's userBrief from the agent (never data.html),
// reached through an Edit/Write of /memoria. Spec rule (prompt knowledge, not
// enforced here): only DURABLE user preferences ("always speak informally",
// "never use yellow") belong here, never a one-off ask for this turn — the
// model is trusted to make that call; this only owns storage mechanics:
// marker placement, dedup, and the USER_BRIEF_MAX cap.
export async function guardarPreferencia(
  session: Pick<AgentSession, "projectId" | "userId">,
  deps: Pick<AgentDeps, "rememberAboutUser" | "loadProject" | "setUserBrief">,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  // Collapse embedded newlines — the block is line-based, so a "\n• " inside
  // the text would inject pseudo-bullets that later dedup/parse as real ones.
  const preferencia =
    typeof args.preferencia === "string"
      ? args.preferencia.trim().replace(/\s*\n+\s*/g, " ")
      : "";
  if (preferencia.length < PREFERENCIA_MIN || preferencia.length > PREFERENCIA_MAX) {
    return {
      response: {
        ok: false,
        error: `preferencia debe tener entre ${PREFERENCIA_MIN} y ${PREFERENCIA_MAX} caracteres`,
      },
    };
  }

  // ALCANCE. Por defecto «siempre» — a la PERSONA, no al proyecto.
  //
  // No es un capricho: MEDIDO el 2026-08-22, el usuario dijo «una cosa
  // importante para TODAS mis páginas…» y el modelo confirmó «aplica a todas
  // tus páginas de aquí en adelante» mientras lo guardaba en una columna del
  // proyecto. La promesa que el modelo hace por su cuenta es la global, así
  // que el default debe ser la global.
  //
  // Los dos fallos no son simétricos: una preferencia global que debió ser
  // local el usuario la poda; una local que debió ser global es justo el bug
  // que esto cierra — la repite en cada proyecto nuevo y nunca se entera.
  const alcance = args.alcance === "esta_pagina" ? "esta_pagina" : "siempre";
  if (alcance === "siempre") {
    const res = await deps.rememberAboutUser(session.userId, preferencia);
    if (!res.ok) {
      return {
        response: {
          ok: false,
          error:
            res.reason === "llena"
              ? `your preference memory is full (max ${AGENT_MEMORY_MAX} characters) — tell the user you already saved several and ask them which one to remove before adding another`
              : "the preference couldn't be saved",
        },
        // N41: al dueño, en su idioma, que la memoria está llena.
        ...(res.reason === "llena" ? { ownerReason: { code: "memory_full" as const } } : {}),
      };
    }
    if (res.yaExistia) return { response: { ok: true, ya_existia: true, alcance } };
    return { response: { ok: true, alcance, nota: "saved for ALL their pages, not just this one" } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };

  const currentBrief = row.userBrief ?? "";
  const markerIdx = currentBrief.indexOf(PREFERENCIA_MARKER_LINE);
  const existingBlock = markerIdx >= 0 ? currentBrief.slice(markerIdx) : "";

  // Dedup, case/whitespace-insensitive, one direction only (spec: an EXISTING
  // line "ya contiene el texto" nuevo). Never the reverse — a longer refinement
  // of an existing bullet ("Sé formal, excepto con proveedores VIP" over
  // "Sé formal") must still be saved, not silently dropped as a duplicate.
  const normalizedNew = normalizePreferencia(preferencia);
  const yaExistia = existingBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("• "))
    .some((line) => normalizePreferencia(line.slice(2)).includes(normalizedNew));
  if (yaExistia) {
    return { response: { ok: true, ya_existia: true } };
  }

  const trimmedBase = currentBrief.replace(/\s+$/, "");
  const nextBrief =
    markerIdx >= 0
      ? `${trimmedBase}\n• ${preferencia}`
      : trimmedBase.length > 0
        ? `${trimmedBase}\n\n${PREFERENCIA_MARKER_LINE}\n• ${preferencia}`
        : `${PREFERENCIA_MARKER_LINE}\n• ${preferencia}`;

  if (nextBrief.length > USER_BRIEF_MAX) {
    return {
      response: {
        ok: false,
        error:
          `the project brief is already full (max ${USER_BRIEF_MAX} characters) — tell the user and offer to save it with alcance="siempre", which uses another space`,
      },
      ownerReason: { code: "memory_full" },
    };
  }

  const saved = await deps.setUserBrief(session.projectId, session.userId, nextBrief);
  if (!saved) return { response: { ok: false, error: "the preference couldn't be saved" } };

  // Sin tarjeta propia: la pone el Edit de /memoria que llamó (H3).
  return { response: { ok: true } };
}
