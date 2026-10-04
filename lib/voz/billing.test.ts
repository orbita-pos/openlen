// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SESSION_OPEN_SECONDS,
  VOICE_CENTICREDITS_PER_MINUTE,
  voiceCenticredits,
  watchVoiceCall,
  type VoiceCallSocket,
} from "./billing";

/** Un WebSocket de mentira: la prueba le hace llegar los eventos de OpenAI. */
function fakeSocket() {
  const sent: string[] = [];
  let closed = false;
  const s: VoiceCallSocket & { receive(ev: unknown): void; drop(): void; sent: string[]; readonly closed: boolean } = {
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (d: string) => {
      sent.push(d);
    },
    close: () => {
      if (closed) return;
      closed = true;
      s.onclose?.();
    },
    receive: (ev) => s.onmessage?.({ data: JSON.stringify(ev) }),
    drop: () => s.close(),
    sent,
    get closed() {
      return closed;
    },
  };
  return s;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const total = (charges: number[]) => charges.reduce((a, b) => a + b, 0);

function setup(balance = 10_000) {
  const socket = fakeSocket();
  const charges: number[] = [];
  let left = balance;
  const opened: { url: string; apiKey: string }[] = [];
  const call = watchVoiceCall({
    sessionId: "sess_123",
    apiKey: "sk-x",
    userId: "u1",
    open: (url, apiKey) => {
      opened.push({ url, apiKey });
      return socket;
    },
    charge: async (_u, c) => {
      charges.push(c);
      left = Math.max(0, left - c);
    },
    balance: async () => left,
  });
  return { socket, charges, opened, call };
}

describe("el precio de la voz (Jesús, 03/10: 5 créditos por minuto)", () => {
  it("5 créditos por minuto, por segundo y redondeando hacia arriba", () => {
    expect(VOICE_CENTICREDITS_PER_MINUTE).toBe(500);
    expect(voiceCenticredits(60)).toBe(500);
    expect(voiceCenticredits(1)).toBe(9);
    expect(voiceCenticredits(0)).toBe(0);
  });

  // OpenAI cobra 15 s al abrir cada sesión, aparte de `usage.seconds` (medido el
  // 30/09: 48 s + 75 s salieron a ~$0,13 = 123 s + 2 × 15 s).
  it("los 15 s que OpenAI cobra al abrir la sesión también se pagan", () => {
    expect(SESSION_OPEN_SECONDS).toBe(15);
  });
});

describe("watchVoiceCall — los segundos los dice OpenAI al servidor, no el teléfono", () => {
  it("se engancha a la sesión con nuestra clave, por el `attach` de OpenAI", () => {
    const { opened } = setup();
    expect(opened).toEqual([{ url: "wss://api.openai.com/v1/live/sessions/sess_123/attach", apiKey: "sk-x" }]);
  });

  it("🔴 cobra lo que va diciendo OpenAI y, al cerrar, lo que falte: en total, segundos + 15", async () => {
    const { socket, charges, call } = setup();
    socket.receive({ type: "session.usage.updated", usage: { seconds: 60 } });
    await tick();
    socket.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 128 } });
    const end = await call.ended;
    expect(total(charges)).toBe(voiceCenticredits(128 + 15));
    expect(end).toEqual({ seconds: 128, charged: voiceCenticredits(143), reason: "close_requested" });
    expect(socket.closed).toBe(true);
  });

  it("los segundos de OpenAI son acumulados: dos avisos no se suman", async () => {
    const { socket, charges, call } = setup();
    socket.receive({ type: "session.usage.updated", usage: { seconds: 60 } });
    socket.receive({ type: "session.usage.updated", usage: { seconds: 60 } });
    socket.receive({ type: "session.closed", reason: "remote_hangup", usage: { seconds: 60 } });
    await call.ended;
    expect(total(charges)).toBe(voiceCenticredits(75));
  });

  it("si el enganche se corta sin `session.closed`, se cobra lo último que dijo OpenAI", async () => {
    const { socket, charges, call } = setup();
    socket.receive({ type: "session.usage.updated", usage: { seconds: 90 } });
    await tick();
    socket.drop();
    const end = await call.ended;
    expect(total(charges)).toBe(voiceCenticredits(105));
    expect(end.reason).toBe("sideband_lost");
  });

  it("🔴 sin saldo, el servidor cuelga la llamada", async () => {
    const { socket, call } = setup(voiceCenticredits(15 + 60));
    socket.receive({ type: "session.usage.updated", usage: { seconds: 60 } });
    await tick();
    await tick();
    expect(socket.sent.map((d) => JSON.parse(d))).toContainEqual({ type: "session.close" });
    socket.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 61 } });
    await call.ended;
  });

  it("BRAZO DE CONTROL: con saldo, la llamada sigue", async () => {
    const { socket, call } = setup();
    socket.receive({ type: "session.usage.updated", usage: { seconds: 60 } });
    await tick();
    await tick();
    expect(socket.sent).toEqual([]);
    socket.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 61 } });
    await call.ended;
  });

  it("lo que no es un evento de OpenAI se ignora, sin tumbar nada", async () => {
    const { socket, charges, call } = setup();
    socket.onmessage?.({ data: "no es json" });
    socket.receive({ type: "session.usage.updated", usage: { seconds: "mucho" } });
    socket.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 10 } });
    await call.ended;
    expect(total(charges)).toBe(voiceCenticredits(25));
  });
});
