// De un evento de GPT-Live (canal `oai-events`) al manejador que le toca. Lo que
// no se conoce se ignora: la API añade eventos y no deben romper la llamada.
export interface ManejadoresDeVoz {
  empezo(): void;
  oyo(delta: string, inicioMs: number): void;
  dijo(delta: string, inicioMs: number): void;
  delego(id: string): void;
  uso(segundos: number): void;
  cerro(motivo: string | null, segundos: number | null): void;
  error(mensaje: string): void;
}

interface EventoCrudo {
  type?: unknown;
  delta?: unknown;
  start_ms?: unknown;
  delegation?: { id?: unknown };
  usage?: { seconds?: unknown };
  reason?: unknown;
  error?: { message?: unknown };
}

export function despacharEventoDeVoz(e: unknown, m: ManejadoresDeVoz): void {
  if (!e || typeof e !== "object") return;
  const ev = e as EventoCrudo;
  const segundos = typeof ev.usage?.seconds === "number" ? ev.usage.seconds : null;
  switch (ev.type) {
    case "session.started":
      return m.empezo();
    case "session.input_transcript.delta":
      if (typeof ev.delta === "string") m.oyo(ev.delta, Number(ev.start_ms) || 0);
      return;
    case "session.output_transcript.delta":
      if (typeof ev.delta === "string") m.dijo(ev.delta, Number(ev.start_ms) || 0);
      return;
    case "session.delegation.created":
      if (typeof ev.delegation?.id === "string") m.delego(ev.delegation.id);
      return;
    case "session.usage.updated":
      if (segundos !== null) m.uso(segundos);
      return;
    case "session.closed":
      return m.cerro(typeof ev.reason === "string" ? ev.reason : null, segundos);
    case "error":
      return m.error(typeof ev.error?.message === "string" ? ev.error.message : "error");
  }
}
