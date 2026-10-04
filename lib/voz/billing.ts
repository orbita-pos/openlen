// lib/voz/billing.ts — COBRAR LA VOZ con los segundos que OpenAI le dice al
// SERVIDOR, no los que diga el teléfono.
//
// Jesús, 03/10: 5 créditos por minuto (cuesta ~$0,05/min a OpenAI; 1 crédito ≈
// $0,01 de coste, el mismo criterio que la búsqueda) y «como DeepSeek»: paga lo
// que usa. OpenAI cobra además 15 s al abrir cada sesión (medido el 30/09: 48 s
// + 75 s salieron a ~$0,13 = 123 s + 2 × 15 s), así que también se pagan.
//
// CÓMO SE ENTERA EL SERVIDOR. La llamada va del teléfono a OpenAI por WebRTC; el
// servidor se engancha a la MISMA sesión por un WebSocket aparte
// (`wss://api.openai.com/v1/live/sessions/{id}/attach`, con nuestra clave: la
// «sideband» de la guía de OpenAI «Server-side controls») y recibe
// `session.usage.updated` (≈ cada minuto, ACUMULADO, no incrementos) y
// `session.closed` con los segundos finales. Lo que el teléfono manda a
// `/api/voz/uso` se sigue apuntando, y nada más: se puede falsear.
//
// Se cobra POR TRAMOS, a cada aviso, y no al final: así, si el saldo se acaba a
// media llamada, el servidor la cuelga (`session.close`) en vez de regalar
// minutos que `debitCredits` ya no puede cobrar (recorta en 0).
//
// Si el enganche se cae sin `session.closed` (un reinicio del servidor, la red),
// se cobra lo último que dijo OpenAI; lo que pase después lo paga la casa.

/** 5 créditos por minuto (Jesús, 03/10), en centicréditos. */
export const VOICE_CENTICREDITS_PER_MINUTE = 500;

/** Lo que OpenAI cobra al abrir cada sesión, aparte de `usage.seconds`. */
export const SESSION_OPEN_SECONDS = 15;

/** Centicréditos de `seconds` de voz, por segundo y hacia arriba. */
export function voiceCenticredits(seconds: number): number {
  return seconds > 0 ? Math.ceil((seconds * VOICE_CENTICREDITS_PER_MINUTE) / 60) : 0;
}

/** Lo mínimo de un WebSocket que hace falta aquí (el nativo de Node lo cumple). */
export interface VoiceCallSocket {
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface VoiceCallEnd {
  /** Los segundos de voz que dijo OpenAI (sin los 15 de abrir). */
  seconds: number;
  /** Lo cobrado en total, en centicréditos. */
  charged: number;
  /** El `reason` de `session.closed`, o `sideband_lost` si no llegó. */
  reason: string;
}

export function attachUrl(sessionId: string): string {
  return `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`;
}

/** El WebSocket nativo de Node (22+) acepta cabeceras: es undici, no el del
 *  navegador. Se le pasa la clave como al crear la sesión. */
export function openSideband(url: string, apiKey: string): VoiceCallSocket {
  const Ctor = WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => VoiceCallSocket;
  return new Ctor(url, { headers: { Authorization: `Bearer ${apiKey}` } });
}

/**
 * Engancha el servidor a una llamada de voz y la cobra mientras dura. Devuelve
 * `ended`, que se resuelve cuando la llamada termina (o se pierde el enganche)
 * con lo cobrado. No lanza: un fallo al cobrar se apunta y la llamada sigue.
 */
export function watchVoiceCall(o: {
  sessionId: string;
  apiKey: string;
  userId: string;
  charge: (userId: string, centicredits: number) => Promise<unknown>;
  balance: (userId: string) => Promise<number>;
  open?: (url: string, apiKey: string) => VoiceCallSocket;
  log?: (line: string) => void;
}): { ended: Promise<VoiceCallEnd> } {
  const log = o.log ?? ((l: string) => console.log(l));
  let seconds = 0;
  let charged = 0;
  let finished = false;
  let hungUp = false;
  // Los cobros van EN FILA: dos avisos seguidos no pueden cobrar el mismo tramo.
  let queue: Promise<void> = Promise.resolve();
  let resolveEnded!: (end: VoiceCallEnd) => void;
  const ended = new Promise<VoiceCallEnd>((r) => {
    resolveEnded = r;
  });

  const settle = () => {
    queue = queue.then(async () => {
      const due = voiceCenticredits(seconds + SESSION_OPEN_SECONDS);
      const delta = due - charged;
      if (delta <= 0) return;
      try {
        await o.charge(o.userId, delta);
        charged = due;
      } catch (e) {
        log(`[voz] no se pudo cobrar ${delta} centicredits sesión=${o.sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return queue;
  };

  const finish = (reason: string) => {
    if (finished) return;
    finished = true;
    void settle().then(() => {
      log(`[voz] cobrada ${o.sessionId} usuario=${o.userId} segundos=${seconds} centicredits=${charged} motivo=${reason}`);
      resolveEnded({ seconds, charged, reason });
    });
  };

  let socket: VoiceCallSocket;
  try {
    socket = (o.open ?? openSideband)(attachUrl(o.sessionId), o.apiKey);
  } catch (e) {
    log(`[voz] no se pudo enganchar ${o.sessionId}: ${e instanceof Error ? e.message : String(e)}`);
    finish("sideband_lost");
    return { ended };
  }

  socket.onmessage = (ev) => {
    let msg: { type?: unknown; usage?: { seconds?: unknown }; reason?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return;
    }
    const s = msg.usage?.seconds;
    // ACUMULADOS: el mayor visto, nunca la suma.
    if (typeof s === "number" && Number.isFinite(s) && s > seconds) seconds = s;
    if (msg.type === "session.usage.updated") {
      void settle().then(async () => {
        if (hungUp || finished) return;
        if ((await o.balance(o.userId).catch(() => 1)) > 0) return;
        hungUp = true;
        log(`[voz] sin saldo: se cuelga ${o.sessionId} usuario=${o.userId}`);
        socket.send(JSON.stringify({ type: "session.close" }));
      });
    } else if (msg.type === "session.closed") {
      finish(typeof msg.reason === "string" ? msg.reason : "closed");
      socket.close();
    }
  };
  socket.onclose = () => finish("sideband_lost");
  socket.onerror = () => {
    // El `close` llega detrás; aquí sólo queda constancia.
    log(`[voz] error en el enganche de ${o.sessionId}`);
  };
  return { ended };
}
