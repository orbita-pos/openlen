import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// UN CORREO RECHAZADO NO PUEDE PASAR MUDO.
//
// El SDK de Resend NO lanza cuando la API dice que no: devuelve
// `{ data: null, error }`. Los siete envíos de `lib/email.ts` tiraban ese
// resultado, así que una cuota agotada o un dominio sin verificar dejaban CERO
// rastro — ni excepción, ni log, ni aviso al dueño.
//
// Importa más aquí que en ningún otro correo: el aviso de lead es la única
// forma que tiene el dueño de enterarse de que alguien le escribió. El dato se
// guarda igual en la base; lo que se pierde es que él lo sepa a tiempo.
// Medido el 2026-08-28: la cuenta contestaba `x-resend-monthly-quota: 17`.

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const LEAD = {
  to: "dueno@example.com",
  projectTitle: "Taller de bicicletas",
  fields: { nombre: "Ana Ruiz", email: "ana@example.com" },
  dashboardUrl: "https://openlen.com/new?project=x",
  meta: {},
};

async function cargar() {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  return import("./email");
}

describe("un correo que Resend RECHAZA se oye", () => {
  let gritos: string[];
  beforeEach(() => {
    gritos = [];
    send.mockReset();
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      gritos.push(a.map(String).join(" "));
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("grita cuando la API dice que no, nombrando el correo y el destino", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Monthly quota exceeded" },
    });
    const { sendLeadNotificationEmail } = await cargar();

    await sendLeadNotificationEmail(LEAD as never);

    const grito = gritos.join(" | ");
    expect(grito).toContain("lead notification email");
    expect(grito).toContain("dueno@example.com");
    expect(grito).toContain("Monthly quota exceeded");
    expect(grito).toMatch(/NO salió/);
  });

  // EL BRAZO DE CONTROL, dentro de la propia suite: si esto también gritara,
  // la prueba de arriba pasaría por el motivo que no es.
  it("y NO grita cuando el correo sale bien", async () => {
    send.mockResolvedValue({ data: { id: "abc" }, error: null });
    const { sendLeadNotificationEmail } = await cargar();

    await sendLeadNotificationEmail(LEAD as never);

    expect(gritos).toEqual([]);
  });

  // Un fallo de TRANSPORTE se oye Y SE RE-LANZA. Las dos mitades importan y por
  // motivos distintos: el log es para el operador, y la excepción es para el
  // trabajo de `lib/notifications`, que reintenta al fallar. Tragármela —que es
  // lo que hice en el primer intento— convertía un reintento en una pérdida
  // silenciosa; lo cazaron sus pruebas, no las mías.
  it("un fallo de red se oye Y se re-lanza, para que el reintento exista", async () => {
    send.mockRejectedValue(new Error("ECONNRESET"));
    const { sendLeadNotificationEmail } = await cargar();

    await expect(sendLeadNotificationEmail(LEAD as never)).rejects.toThrow("ECONNRESET");
    expect(gritos.join(" | ")).toContain("lead notification email");
  });
});

// AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos, §6.4, delivery 3): an agent's scheduled task is emailed
// in its name; Len's, in Len's. A name is cleaned of what would break the header.
describe("the sender of a scheduled task's email", () => {
  const TASK = {
    to: "ana@example.com",
    replyTo: null,
    idioma: "es" as const,
    attachments: [],
    projectTitle: "Space",
    title: "Palabras",
    occurrenceAt: "2026-11-02T15:03:00.000Z",
    timeZone: "UTC",
    texto: "Hoy: apple, bread…",
    waiting: [],
    canReply: false,
    chatUrl: "https://openlen.com/es/assistant/mr-smith",
    removeUrl: null,
  };
  beforeEach(() => send.mockReset().mockResolvedValue({ data: { id: "e1" }, error: null }));
  afterEach(() => vi.unstubAllEnvs());

  it("🔴 Len's task comes from Len; an agent's from the agent, its name cleaned", async () => {
    const { sendScheduledTaskEmail } = await cargar();
    await sendScheduledTaskEmail(TASK);
    expect(String(send.mock.calls[0]![0].from)).toMatch(/^Len </);
    await sendScheduledTaskEmail({ ...TASK, agentName: "Mr. Smith" });
    expect(String(send.mock.calls[1]![0].from)).toMatch(/^"Mr\. Smith" </);
    await sendScheduledTaskEmail({ ...TASK, agentName: 'Bad "Name" <evil@x.com>\r\nBcc: y' });
    const from = String(send.mock.calls[2]![0].from);
    expect(from).not.toContain("evil@x.com>");
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.match(/</g)).toHaveLength(1);
  });

  // Delivery 3's deferred minor M7: in development (no Resend key) the log is the only way to see who it comes from.
  it("🔴 without a Resend key, the development log says who it comes from", async () => {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "");
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendScheduledTaskEmail } = await import("./email");
    await sendScheduledTaskEmail({ ...TASK, agentName: "Mr. Smith" });
    expect(send).not.toHaveBeenCalled();
    expect(logged.mock.calls.flat().join(" ")).toContain('"Mr. Smith" <');
    logged.mockRestore();
    warned.mockRestore();
  });

  // Delivery 3's deferred minor M1: its agent was deleted, and Len didn't write it.
  it("🔴 the email of a task whose agent was deleted comes from OpenLen, not from Len", async () => {
    const { sendScheduledTaskEmail } = await cargar();
    await sendScheduledTaskEmail({ ...TASK, agentGone: true });
    expect(String(send.mock.calls[0]![0].from)).toMatch(/^OpenLen </);
  });
});

// Deferred minor M6-3 (spec local 2026-11-21-len-y-el-agente-conversan, decision 12): sendAgentNoteEmail sends in the
// agent's name (cleaned), with no Reply-To (replying would start a Len turn), and falls back to OpenLen without a name.
describe("the agent's note email (sendAgentNoteEmail)", () => {
  const NOTE = {
    to: "ana@example.com",
    idioma: "es" as const,
    agentName: "Finanzas",
    projectTitle: "Presupuesto",
    texto: "Len pregunta si el tope es 500 €.",
    url: "https://openlen.com/es/assistant/finanzas",
  };
  beforeEach(() => send.mockReset().mockResolvedValue({ data: { id: "e1" }, error: null }));
  afterEach(() => vi.unstubAllEnvs());

  it("🔴 sends in the agent's name (cleaned), with no Reply-To, and falls back to OpenLen when the name is blank", async () => {
    const { sendAgentNoteEmail } = await cargar();
    await sendAgentNoteEmail(NOTE);
    expect(send).toHaveBeenCalledTimes(1);
    const first = send.mock.calls[0]![0];
    expect(String(first.from)).toMatch(/^"Finanzas" </);
    expect(first.replyTo).toBeUndefined();
    expect(first.to).toBe("ana@example.com");
    expect(first.subject).toBe("Finanzas: sobre Presupuesto");

    await sendAgentNoteEmail({ ...NOTE, agentName: 'Finanzas "X" <bad@x.com>\r\n' });
    const cleaned = String(send.mock.calls[1]![0].from);
    expect(cleaned).not.toContain("bad@x.com>");
    expect(cleaned).not.toMatch(/[\r\n]/);

    await sendAgentNoteEmail({ ...NOTE, agentName: ' "<> ' });
    expect(String(send.mock.calls[2]![0].from)).toMatch(/^OpenLen </);
  });

  it("without a Resend key, logs the note in development with the sender", async () => {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "");
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendAgentNoteEmail } = await import("./email");
    await sendAgentNoteEmail(NOTE);
    expect(send).not.toHaveBeenCalled();
    const out = logged.mock.calls.flat().join(" ");
    expect(out).toContain("Finanzas: sobre Presupuesto");
    expect(out).toContain('"Finanzas" <');
    logged.mockRestore();
    warned.mockRestore();
  });
});
