// La copia placeholder de la baseline se escribía con la taxonomía interna:
// `tagline = "Una experiencia " + emotionalGoals` y los títulos de tarjeta eran
// los roles de sección crudos. Cuando el relleno no cubre un hueco, el usuario
// lee la jerga de la máquina — en INGLÉS, en una página en español. Medido en
// las 10 páginas del 2026-08-16: "Una experiencia uneasy, cinematic, mysterious"
// en un tostador de café, y 6 tarjetas idénticas tituladas "call to action".
//
// La regla: la taxonomía dirige el DISEÑO, nunca el TEXTO.
import { describe, expect, it } from "vitest";
import { CANONICAL_SECTION_ROLES } from "@/lib/generation/structural-taxonomy";
import { sectionRoleLabel } from "./section-role-labels";

describe("sectionRoleLabel", () => {
  it("says it in the reader's language, not in ours", () => {
    expect(sectionRoleLabel("call_to_action", "es")).toBe("Da el paso");
    expect(sectionRoleLabel("how_it_works", "es")).toBe("Cómo funciona");
    expect(sectionRoleLabel("faq", "es")).toBe("Preguntas frecuentes");
    expect(sectionRoleLabel("call_to_action", "en")).toBe("Take the next step");
  });

  it("covers every canonical role, so none can fall through as a slug", () => {
    // The roles are a CLOSED set, which is the only reason a table is safe
    // here. `emotionalGoals` is open (`TaxonomyListSchema` accepts any slug),
    // so it has no table and never reaches copy at all.
    for (const role of CANONICAL_SECTION_ROLES) {
      for (const lang of ["es", "en"] as const) {
        const label = sectionRoleLabel(role, lang);
        expect(label, `${role}/${lang}`).toBeTruthy();
        expect(label, `${role}/${lang} still looks like a slug`).not.toMatch(/_|^[a-z]+$/);
      }
    }
  });

  it("never returns the slug for something outside the taxonomy", () => {
    // A role we do not know is not described to the user in machine words.
    expect(sectionRoleLabel("some_future_role" as never, "es")).toBe("Sección");
    expect(sectionRoleLabel("some_future_role" as never, "en")).toBe("Section");
  });
});
