// @vitest-environment node
import { describe, expect, it } from "vitest";

import { correoDeLen, fraseDeFalloPorCorreo } from "@/lib/projects/correos-del-proyecto";

describe("lo que Len contesta por correo", () => {
  const datos = { projectTitle: "Café Luna", asunto: "Precios", texto: "Listo: <b>$499</b>\n\nYa está publicado.", url: "https://openlen.com/new?project=p1&chat=1" };

  it("🔴 sigue el hilo del asunto, escapa lo que dijo Len y dice cómo seguir", () => {
    const c = correoDeLen(datos, "es");
    expect(c.subject).toBe("Re: Precios");
    expect(correoDeLen({ ...datos, asunto: "RE: Precios" }, "es").subject).toBe("RE: Precios");
    expect(c.html).toContain("Listo: &lt;b&gt;$499&lt;/b&gt;");
    expect(c.html).not.toContain("<b>$499</b>");
    expect(c.text).toContain("Contesta a este correo para seguir con Len en Café Luna.");
    expect(c.text).toContain(datos.url);
  });

  it("si el turno no contestó, el motivo en el idioma de quien escribió", () => {
    expect(fraseDeFalloPorCorreo("es", null)).toMatch(/Contesta a este correo/);
    expect(fraseDeFalloPorCorreo("es", { motivo: "x", code: "no_credits" })).toMatch(/créditos/);
  });
});
