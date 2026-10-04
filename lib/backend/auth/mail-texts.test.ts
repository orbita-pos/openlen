// @vitest-environment node
//
// Los textos de los correos de /auth/v1, en los 10 idiomas (mail-texts.ts).
import { describe, expect, it } from "vitest";

import { authEmailContent } from "./mail-texts";

const IDIOMAS = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;
const TIPOS = ["confirm", "recovery", "invite"] as const;
const HOST = "tienda.openlen.app";
const ENLACE = "https://abcdefghijklmnopqrst.openlen.app/auth/v1/verify?token=abc_DEF-123&type=signup";


describe("los textos, en los 10 idiomas", () => {
  it("cada idioma y cada tipo lleva el sitio en el asunto y el enlace en el html y en el texto", () => {
    for (const lang of IDIOMAS) {
      for (const kind of TIPOS) {
        const c = authEmailContent({ kind, link: ENLACE, host: HOST, lang });
        expect(c.subject, `${lang}/${kind}`).toContain(HOST);
        // En el html el `&` del enlace va escapado, como debe ir en un atributo.
        expect(c.html, `${lang}/${kind}`).toContain(`href="${ENLACE.replace(/&/g, "&amp;")}"`);
        expect(c.text, `${lang}/${kind}`).toContain(ENLACE);
        expect(c.html, `${lang}/${kind}`).toContain(`lang="${lang}"`);
      }
    }
  });

  it("cada idioma tiene SUS textos, no los del inglés", () => {
    const en = Object.fromEntries(TIPOS.map((kind) => [kind, authEmailContent({ kind, link: ENLACE, host: HOST, lang: "en" })]));
    for (const lang of IDIOMAS.filter((l) => l !== "en")) {
      for (const kind of TIPOS) {
        const c = authEmailContent({ kind, link: ENLACE, host: HOST, lang });
        expect(c.subject, `${lang}/${kind}`).not.toBe(en[kind]!.subject);
        expect(c.text, `${lang}/${kind}`).not.toBe(en[kind]!.text);
      }
    }
  });

  it("los tres tipos dicen cosas distintas", () => {
    const asuntos = TIPOS.map((kind) => authEmailContent({ kind, link: ENLACE, host: HOST, lang: "es" }).subject);
    expect(new Set(asuntos).size).toBe(3);
  });

  it("el idioma sale de la etiqueta («es-MX» → es); sin idioma o uno que no tenemos, inglés", () => {
    const es = authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "es" });
    expect(authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "es-MX" }).subject).toBe(es.subject);
    expect(authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "PT_br" }).subject).toBe(
      authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "pt" }).subject,
    );
    const en = authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang: "en" });
    for (const lang of [undefined, "", "xx", "sw"]) {
      expect(authEmailContent({ kind: "confirm", link: ENLACE, host: HOST, lang }).subject).toBe(en.subject);
    }
  });

  it("ningún hueco sin rellenar", () => {
    for (const lang of IDIOMAS) {
      for (const kind of TIPOS) {
        const c = authEmailContent({ kind, link: ENLACE, host: HOST, lang });
        expect(c.text + c.subject, `${lang}/${kind}`).not.toMatch(/\{[a-z]+\}|undefined|null/);
      }
    }
  });

  // El sitio sale del Host de la petición: llega al html del correo y no puede
  // abrir una etiqueta.
  it("el sitio va escapado en el html", () => {
    const c = authEmailContent({ kind: "invite", link: ENLACE, host: '<img src=x onerror="a()">', lang: "es" });
    expect(c.html).not.toContain("<img");
    expect(c.html).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
  });
});
