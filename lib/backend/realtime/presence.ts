// Presence de Supabase Realtime (supabase/realtime @ f86df8c3, Apache-2.0:
// lib/realtime_web/channels/realtime_channel/presence_handler.ex sobre
// `Phoenix.Presence`). Un proceso, un nodo: el estado de cada tema es un mapa
// en memoria (sin el CRDT de `Phoenix.Tracker`, que reparte entre nodos), con
// la forma que lee `realtime-js`:
//
//   presence_state  { <clave>: { metas: [{ phx_ref, …carga }] } }
//   presence_diff   { joins: { <clave>: { metas } }, leaves: { <clave>: { metas } } }
//
// Al cambiar la carga de un `track`, sale la vieja en `leaves` y la nueva en
// `joins` con `phx_ref_prev`, como `Phoenix.Presence.update`.

import { randomBytes } from "node:crypto";

export interface PresenceMeta {
  readonly ref: string;
  readonly payload: Record<string, unknown>;
}

type Entry = { readonly key: string; readonly meta: PresenceMeta };

export type PresenceDiff = {
  readonly joins: Record<string, { metas: Record<string, unknown>[] }>;
  readonly leaves: Record<string, { metas: Record<string, unknown>[] }>;
};

/** Un `phx_ref` (Phoenix usa una cadena aleatoria en base64). */
function newRef(): string {
  return randomBytes(9).toString("base64url");
}

const wire = (m: PresenceMeta, prev?: string): Record<string, unknown> => ({ ...m.payload, phx_ref: m.ref, ...(prev ? { phx_ref_prev: prev } : {}) });

/** El estado de presence de todos los temas. `owner` es quien hizo el `track`
 *  (un canal): uno por dueño y tema, como un proceso de canal en Phoenix. */
export class PresenceRegistry<Owner> {
  private readonly topics = new Map<string, Map<Owner, Entry>>();

  /** `track` (o su `update` si ya estaba): el diff que hay que repartir. */
  track(topic: string, owner: Owner, key: string, payload: Record<string, unknown>): PresenceDiff {
    let t = this.topics.get(topic);
    if (!t) this.topics.set(topic, (t = new Map()));
    const before = t.get(owner);
    const meta: PresenceMeta = { ref: newRef(), payload };
    t.set(owner, { key, meta });
    if (!before) return { joins: { [key]: { metas: [wire(meta)] } }, leaves: {} };
    const leaves = { [before.key]: { metas: [wire(before.meta)] } };
    return { joins: { [key]: { metas: [wire(meta, before.meta.ref)] } }, leaves };
  }

  /** `untrack`, o el dueño se fue: el diff, o null si no estaba. */
  untrack(topic: string, owner: Owner): PresenceDiff | null {
    const t = this.topics.get(topic);
    const before = t?.get(owner);
    if (!t || !before) return null;
    t.delete(owner);
    if (t.size === 0) this.topics.delete(topic);
    return { joins: {}, leaves: { [before.key]: { metas: [wire(before.meta)] } } };
  }

  /** Su `presence_dirty_list |> Phoenix.Presence.group()`. */
  state(topic: string): Record<string, { metas: Record<string, unknown>[] }> {
    const out: Record<string, { metas: Record<string, unknown>[] }> = {};
    for (const { key, meta } of this.topics.get(topic)?.values() ?? []) {
      (out[key] ??= { metas: [] }).metas.push(wire(meta));
    }
    return out;
  }

  payloadOf(topic: string, owner: Owner): Record<string, unknown> | null {
    return this.topics.get(topic)?.get(owner)?.meta.payload ?? null;
  }
}
