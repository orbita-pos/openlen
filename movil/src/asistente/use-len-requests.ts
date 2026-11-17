// HER LEN CARDS FOLLOW HIS TURNS (spec local 2026-11-16-movil-es-tu-asistente, §5.4): each request she passed to Len is
// a card in her chat, read on arrival and every 4 s while one is still queued or running — the cadence the phone
// already follows a running turn at (use-chat.ts). When one ends (done or failed) while watched, `onSettled` says so
// once: the page on screen reloads, and the delivery shows. An answer that arrives after switching assistant is dropped.
import { useCallback, useEffect, useRef, useState } from "react";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { LenRequestRef } from "@/lib/assistants/len-request-ref";
import type { LenRequestView } from "@/lib/assistants/len-requests";

import { readLenRequests } from "../api/asistente";
import type { ElementoDelHilo } from "../chat/hilo";
import { pausarEncargo } from "../gestion/api";

const EVERY_MS = 4000;
/** As many as the route reads at once (len-requests/route.ts): the newest, the ones still moving (final review, C1). */
const MAX_FILAS = 20;
const alive = (s: LenRequestView["status"] | undefined) => s === "queued" || s === "running";
const live = (v: LenRequestView) => alive(v.status);

export function useLenRequests(o: {
  cliente: ClienteDeOpenLen;
  assistantId: string | null;
  elementos: readonly ElementoDelHilo[];
  onSettled: (ref: LenRequestRef) => void;
}): { byFila: ReadonlyMap<string, LenRequestView>; stop: (turnoId: string) => Promise<void> } {
  const { cliente, assistantId } = o;
  const refs = o.elementos.flatMap((e) => (e.tipo === "lenPedidos" ? e.refs : []));
  const key = JSON.stringify(refs.map((r) => [r.filaId, r.projectId]));
  const [state, setState] = useState<{ assistantId: string | null; byFila: ReadonlyMap<string, LenRequestView> }>({ assistantId, byFila: new Map() });
  const [revision, setRevision] = useState(0);
  const onSettled = useRef(o.onSettled);
  useEffect(() => { onSettled.current = o.onSettled; });
  // What each row was last seen as: a row only settles once, and only if it was seen alive.
  const seen = useRef(new Map<string, LenRequestView["status"]>());
  // The cards already over, as they ended: never asked for again (deferred minor of the final review).
  const over = useRef(new Map<string, LenRequestView>());

  useEffect(() => {
    seen.current = new Map();
    over.current = new Map();
  }, [assistantId]);

  useEffect(() => {
    const list = (JSON.parse(key) as [string, string][]).map(([filaId, projectId]) => ({ filaId, projectId })).slice(-MAX_FILAS);
    if (!assistantId || list.length === 0) {
      setState({ assistantId, byFila: new Map() });
      return;
    }
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (fresh: readonly LenRequestView[]) => {
      const ended = list.flatMap((r) => {
        const v = over.current.get(r.filaId);
        return v ? [[r.filaId, v] as const] : [];
      });
      setState({ assistantId, byFila: new Map([...ended, ...fresh.map((v) => [v.filaId, v] as const)]) });
    };
    const read = async () => {
      const ask = list.filter((r) => !over.current.has(r.filaId)).map((r) => r.filaId);
      if (ask.length === 0) {
        show([]);
        return;
      }
      try {
        const views = await readLenRequests(cliente, assistantId, ask);
        if (gone) return;
        for (const v of views) {
          const before = seen.current.get(v.filaId);
          if (alive(before) && !live(v)) {
            const ref = list.find((r) => r.filaId === v.filaId);
            if (ref) onSettled.current(ref);
          }
          seen.current.set(v.filaId, v.status);
          if (!live(v)) over.current.set(v.filaId, v);
        }
        show(views);
        if (views.some(live)) timer = setTimeout(() => void read(), EVERY_MS);
      } catch {
        if (!gone) timer = setTimeout(() => void read(), EVERY_MS);
      }
    };
    void read();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [cliente, assistantId, key, revision]);

  const stop = useCallback(
    async (turnoId: string) => {
      try {
        await pausarEncargo(cliente, turnoId);
      } catch {
        /* read again either way: the card says what really happened */
      } finally {
        setRevision((r) => r + 1);
      }
    },
    [cliente],
  );

  return { byFila: state.assistantId === assistantId ? state.byFila : new Map(), stop };
}
