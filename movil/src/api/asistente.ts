// THE PHONE'S CALLS FOR THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): what her
// tab reads and does, over the routes that take the phone's key (app/api/assistants/**) — the same answers her place
// on the web gets. Talking with her goes through `mandarALen` with her id (./chat.ts), as on the web.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { AssistantListItem } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

async function leer<T>(c: ClienteDeOpenLen, ruta: string, campo: string): Promise<T[]> {
  const res = await c.pedir(ruta);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new Error(String(res.status));
  const lista = body[campo];
  return Array.isArray(lista) ? (lista as T[]) : [];
}

const suya = (id: string, tras = "") => `/api/assistants/${encodeURIComponent(id)}${tras}`;

/** Her person's assistants, newest first; none (or assistants off on the server) is an empty list. Throws otherwise. */
export const listarAsistentes = (c: ClienteDeOpenLen) => leer<AssistantListItem>(c, "/api/assistants", "assistants");

/** The first page of her conversation with her owner, in the shape of a project's `chatHistory`. */
export const leerSuChat = (c: ClienteDeOpenLen, id: string) => leer<StoredChatTurn>(c, suya(id, "/chat"), "chatHistory");

/** Her visitors' conversations, as «Conversaciones» on the web shows them. */
export const leerSusVisitas = <V = Record<string, unknown>>(c: ClienteDeOpenLen, id: string) => leer<V>(c, suya(id, "/visits"), "visits");

/** Phase 4E: «Conversaciones» on screen marks what it shows as read, as on the web; false when the server refused. */
export async function marcarSusVisitasLeidas(c: ClienteDeOpenLen, id: string, ids: readonly string[]): Promise<boolean> {
  const res = await c
    .pedir(suya(id, "/visits/read"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) })
    .catch(() => null);
  return Boolean(res?.ok);
}

/** Her «Pedidos»: the cards of what visitors asked for and she couldn't do. */
export const leerSusPedidos = <P = Record<string, unknown>>(c: ClienteDeOpenLen, id: string) => leer<P>(c, suya(id, "/requests"), "cards");

/** «Que Len lo haga» / «Ahora no» on a request card, as on the web. */
export async function tocarPedido(c: ClienteDeOpenLen, id: string, cardId: string, accion: "accept" | "dismiss"): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await c
    .pedir(suya(id, `/requests/${encodeURIComponent(cardId)}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: accion, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
    .catch(() => null);
  if (res?.ok) return { ok: true };
  const body = (await res?.json().catch(() => null)) as { error?: unknown } | null;
  return { ok: false, error: typeof body?.error === "string" ? body.error : res ? String(res.status) : "network" };
}
