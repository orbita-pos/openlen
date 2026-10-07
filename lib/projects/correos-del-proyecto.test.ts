// @vitest-environment node
// EL CORREO DE LA INVITACIÓN, en el idioma de quien invita.
import { describe, expect, it } from "vitest";

import { correoDeInvitacion, correoDeMencion, idiomaDelCorreo } from "./correos-del-proyecto";

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

  it("«te mencionaron»: quién, dónde, lo que dijo (escapado) y el enlace al hilo", () => {
    const c = correoDeMencion(
      { projectTitle: "Café", quien: "Ana", ruta: "/src/App.jsx", linea: 12, texto: "@Jesús ¿esto <div> va así?", url: "https://openlen.com/new?project=p1&codigo=%2Fsrc%2FApp.jsx" },
      "es",
    );
    expect(c.subject).toBe("Ana te mencionó en Café");
    expect(c.html).toContain("En src/App.jsx, línea 12:");
    expect(c.html).toContain("¿esto &lt;div&gt; va así?");
    expect(c.html).toContain("Abrir el hilo");
    expect(c.text).toContain("https://openlen.com/new?project=p1&codigo=%2Fsrc%2FApp.jsx");
  });
});
