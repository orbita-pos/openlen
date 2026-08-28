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
