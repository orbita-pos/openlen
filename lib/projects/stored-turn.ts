// Una fila de la charla (`projectChatMessages`) como la pinta el panel, SIN
// base: lo usan `lib/projects/chat.ts` y las escenas reales de Len 3.1
// (`components/workspace-v2/chat/chat-scenes.test.tsx`, `/dev/chat?scene=`), que
// tienen que pintar un turno igual que el panel.
import type { projectChatMessages } from "@/lib/db/schema";
import { photosOf } from "@/lib/projects/chat-photos";
import type { AgentErrorCode } from "@/lib/agent/loop";
import type { StoredChatTurn } from "@/lib/projects/types";

/** LEN 2.1 · el turno sigue trabajando en el servidor. Es texto en la base, como
 *  `cortado`: no hace falta migración. Lo escribe y lo cierra SÓLO el servidor. */
export const ESTADO_EN_CURSO = "en_curso";

type ChatRow = typeof projectChatMessages.$inferSelect;
/** Lo que hace falta de la fila; las columnas de después pueden faltar (una escena descargada no las trae). */
export type ChatRowForTurn = Pick<ChatRow, "id" | "userText" | "assistantReasoning" | "status" | "createdAt" | "attachedImage" | "actions"> &
  Partial<Pick<ChatRow, "page" | "noDocChange" | "centicredits" | "durationMs" | "origen" | "tipo" | "menciones" | "endReason" | "attachedFiles">> & {
    /** A11 · la marca de compactación de la fila: cuántos tokens se resumieron (`compaction.preTokens`). */
    compactedTokens?: number | null;
  };

/** Los motivos de parada que se leen de la fila; otro texto se ignora. */
const END_REASONS = {
  turn_limit: true,
  tool_limit: true,
  budget_limit: true,
  cancelled: true,
  truncated: true,
  upstream: true,
  no_credits: true,
  agent_off: true,
  context_too_long: true,
  compact_failed: true,
  interrupted: true,
} satisfies Record<AgentErrorCode, true>;
const isEndReason = (v: unknown): v is AgentErrorCode => typeof v === "string" && Object.hasOwn(END_REASONS, v);

export function storedTurnFromRow(row: ChatRowForTurn): StoredChatTurn {
  const turn: StoredChatTurn = {
    id: row.id,
    userText: row.userText,
    assistantReasoning: row.assistantReasoning,
    status: row.status === "reverted" ? "reverted" : "applied",
    // The row's createdAt doubles as the turn's applied-at timestamp.
    appliedAt: row.createdAt.getTime(),
  };
  // Una foto, como siempre; dos o más (Crear es Len), la primera en
  // `attachedImage` y todas en `attachedImages`.
  const fotos = photosOf(row.attachedImage);
  if (fotos.length > 0) turn.attachedImage = fotos[0]!;
  if (fotos.length > 1) turn.attachedImages = fotos;
  // Los PDF del turno (26/10), para la burbuja.
  if (row.attachedFiles?.length) turn.attachedFiles = [...row.attachedFiles];
  if (row.page) turn.page = row.page; // NULL stays undefined = home
  // F2-T11: NULL/absent stays undefined on both — restoreTurn (chat-panel.tsx)
  // treats undefined exactly like a pre-F2 row (no cards, "Applied" verb ok).
  if (row.actions && row.actions.length > 0) turn.actions = row.actions;
  if (row.noDocChange) turn.noDocChange = true;
  // Un turno que se CORTÓ a medias se lee como aplicado —lo que hizo, hecho
  // está— con la marca que lo distingue. Ver `corteDelTurno`.
  if (row.status === "cortado") turn.cortado = true;
  // Len 2.1: el turno sigue trabajando en el servidor. Ver `ESTADO_EN_CURSO`.
  if (row.status === ESTADO_EN_CURSO) turn.enCurso = true;
  // Lo que cobró y tardó, si el servidor lo apuntó (plans/new-chat/).
  if (typeof row.centicredits === "number") turn.centicredits = row.centicredits;
  if (typeof row.durationMs === "number") turn.durationMs = row.durationMs;
  // A5 · por qué paró, si no terminó: el aviso al recargar sale de aquí.
  if (isEndReason(row.endReason)) turn.endReason = row.endReason;
  // A11 · en este turno se resumió la conversación: la línea «Conversación resumida».
  if (typeof row.compactedTokens === "number" && Number.isFinite(row.compactedTokens)) turn.compactedTokens = row.compactedTokens;
  // Pedido con `@Len` desde un hilo del código: la etiqueta «desde el hilo».
  if (row.origen) turn.origen = row.origen;
  // El chat del equipo: un mensaje entre personas y a quién menciona.
  if (row.tipo === "persona") turn.tipo = "persona";
  if (row.menciones && row.menciones.length > 0) turn.menciones = row.menciones;
  return turn;
}
