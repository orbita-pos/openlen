// @vitest-environment node
//
// Los correos de las cuentas de una página (F2, plans/page-accounts/design.md):
// confirmar el registro, recuperar la contraseña y la invitación del dueño. Los
// textos son puros; el envío se sustituye.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  vivo: false,
  enviados: [] as { to: string; subject: string; html: string; text: string }[],
}));

vi.mock("@/lib/email", () => ({
  emailIsLive: () => estado.vivo,
  sendPageAccountEmail: async (m: { to: string; subject: string; html: string; text: string }) => {
    estado.enviados.push(m);
  },
}));

import { accountEmailAvailable, accountEmailContent, sendAccountEmail } from "@/lib/page-accounts/mail";

const IDIOMAS = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;
const TIPOS = ["confirm", "recovery", "invite"] as const;
const HOST = "tienda.openlen.app";
const ENLACE = "https://tienda.openlen.app/api/a/verify?token=abc_DEF-123";

beforeEach(() => {
  estado.vivo = false;
  estado.enviados = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("los textos, en los 10 idiomas", () => {
  it("cada idioma y cada tipo lleva el sitio en el asunto y el enlace en el html y en el texto", () => {
    for (const lang of IDIOMAS) {
      for (const kind of TIPOS) {
        const c = accountEmailContent({ kind, link: ENLACE, host: HOST, lang });
        expect(c.subject, `${lang}/${kind}`).toContain(HOST);
        expect(c.html, `${lang}/${kind}`).toContain(`href="${ENLACE}"`);
        expect(c.text, `${lang}/${kind}`).toContain(ENLACE);
        expect(c.html, `${lang}/${kind}`).toContain(`lang="${lang}"`);
      }
    }
  });

  it("cada idioma tiene SUS textos, no los del inglés", () => {
    const en = Object.fromEntries(TIPOS.map((kind) => [kind, accountEmailContent({ kind, link: ENLACE, host: HOST, lang: "en" })]));
    for (const lang of IDIOMAS.filter((l) => l !== "en")) {
      for (const kind of TIPOS) {
        const c = accountEmailContent({ kind, link: ENLACE, host: HOST, lang });
        expect(c.subject, `${lang}/${kind}`).not.toBe(en[kind]!.subject);
        expect(c.text, `${lang}/${kind}`).not.toBe(en[kind]!.text);
      }
    }
  });

  it("los tres tipos dicen cosas distintas", () => {
    const asuntos = TIPOS.map((kind) => accountEmailContent({ kind, link: ENLACE, host: HOST, lang: "es" }).subject);
    expect(new Set(asuntos).size).toBe(3);
  });

  it("el idioma sale de la etiqueta («es-MX» → es); sin idioma o uno que no tenemos, inglés", () => {
    const es = accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "es" });
    expect(accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "es-MX" }).subject).toBe(es.subject);
    expect(accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "PT_br" }).subject).toBe(
      accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "pt" }).subject,
    );
    const en = accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "en" });
    for (const lang of [undefined, "", "xx", "sw"]) {
      expect(accountEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang }).subject).toBe(en.subject);
    }
  });

  it("la invitación nombra el papel; sin papel, no deja un hueco", () => {
    for (const lang of IDIOMAS) {
      const con = accountEmailContent({ kind: "invite", link: ENLACE, host: HOST, lang, role: "cajera" });
      expect(con.text, lang).toContain("cajera");
      const sin = accountEmailContent({ kind: "invite", link: ENLACE, host: HOST, lang });
      expect(sin.text, lang).not.toMatch(/\{role\}|undefined|null/);
    }
  });

  // El papel lo escribe la página y el sitio sale del Host: los dos llegan al
  // html del correo y ninguno puede abrir una etiqueta.
  it("el papel y el sitio van escapados en el html", () => {
    const c = accountEmailContent({ kind: "invite", link: ENLACE, host: HOST, lang: "es", role: '<img src=x onerror="a()">' });
    expect(c.html).not.toContain("<img");
    expect(c.html).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
  });
});

describe("¿hay correo?", () => {
  it("en producción, sólo si hay cliente de Resend", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(accountEmailAvailable()).toBe(false);
    estado.vivo = true;
    expect(accountEmailAvailable()).toBe(true);
  });

  it("en desarrollo, siempre: el correo se apunta en la consola con su enlace", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(accountEmailAvailable()).toBe(true);
  });
});

describe("mandarlo", () => {
  it("manda el asunto, el html y el texto de su idioma al destinatario", async () => {
    await sendAccountEmail({ to: "ana@correo.mx", kind: "recovery", link: ENLACE, host: HOST, lang: "fr" });
    const esperado = accountEmailContent({ kind: "recovery", link: ENLACE, host: HOST, lang: "fr" });
    expect(estado.enviados).toEqual([{ to: "ana@correo.mx", ...esperado }]);
  });
});
