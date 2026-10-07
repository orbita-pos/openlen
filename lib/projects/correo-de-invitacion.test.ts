// @vitest-environment node
// EL CORREO DE LA INVITACIÓN, en el idioma de quien invita.
import { describe, expect, it } from "vitest";

import { correoDeInvitacion, idiomaDelCorreo } from "./correo-de-invitacion";

const DATOS = { projectTitle: "Café <Sol>", inviterName: "Jesús", rol: "editor" as const, acceptUrl: "https://openlen.com/api/miembros/aceptar?token=abc&x=1" };

describe("el correo de la invitación", () => {
  it("🔴 en el idioma de quien invita, con el rol, y escapado", () => {
    const es = correoDeInvitacion(DATOS, "es");
    expect(es.subject).toBe("Jesús te invitó a trabajar en Café <Sol> en OpenLen");
    expect(es.html).toContain("Aceptar la invitación");
    expect(es.html).toContain("Café &lt;Sol&gt;");
    expect(es.html).not.toContain("<Sol>");
    expect(es.html).toContain('href="https://openlen.com/api/miembros/aceptar?token=abc&amp;x=1"');
    expect(es.text).toContain(DATOS.acceptUrl);
    const ja = correoDeInvitacion({ ...DATOS, rol: "lector", inviterName: null }, "ja");
    expect(ja.subject).toBe("誰か さんが OpenLen の Café <Sol> の閲覧にあなたを招待しました");
    expect(ja.html).toContain('lang="ja"');
  });

  it("un idioma que no tenemos cae al inglés", () => {
    expect(idiomaDelCorreo("es")).toBe("es");
    expect(idiomaDelCorreo("xx")).toBe("en");
    expect(idiomaDelCorreo("__proto__")).toBe("en");
    expect(idiomaDelCorreo(undefined)).toBe("en");
    expect(correoDeInvitacion(DATOS, idiomaDelCorreo("xx")).subject).toBe("Jesús invited you to work on Café <Sol> on OpenLen");
  });
});
