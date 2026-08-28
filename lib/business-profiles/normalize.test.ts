import { describe, it, expect } from "vitest";
import { normalizeProfileData } from "./normalize";

describe("normalizeProfileData", () => {
  it("preserves an explicit showContactWidget:false", () => {
    expect(normalizeProfileData({ showContactWidget: false }).showContactWidget).toBe(false);
  });

  it("preserves an explicit showContactWidget:true", () => {
    expect(normalizeProfileData({ showContactWidget: true }).showContactWidget).toBe(true);
  });

  it("leaves showContactWidget undefined when absent (defaults ON downstream)", () => {
    expect(normalizeProfileData({}).showContactWidget).toBeUndefined();
  });

  it("ignores non-boolean showContactWidget", () => {
    expect(normalizeProfileData({ showContactWidget: "yes" }).showContactWidget).toBeUndefined();
  });

  it("preserves a valid contactWidgetSide and drops an invalid one", () => {
    expect(normalizeProfileData({ contactWidgetSide: "left" }).contactWidgetSide).toBe("left");
    expect(normalizeProfileData({ contactWidgetSide: "right" }).contactWidgetSide).toBe("right");
    expect(normalizeProfileData({ contactWidgetSide: "top" }).contactWidgetSide).toBeUndefined();
  });

  it("still normalizes brand/photos/links alongside the flag", () => {
    const out = normalizeProfileData({
      showContactWidget: false,
      brand: { accent: "#112233", logoUrl: "https://x/l.png" },
      photos: ["https://x/p.jpg", 7],
      links: [{ type: "website", url: "https://x.com" }, { url: "" }],
    });
    expect(out.showContactWidget).toBe(false);
    expect(out.brand).toEqual({ accent: "#112233", logoUrl: "https://x/l.png" });
    expect(out.photos).toEqual(["https://x/p.jpg"]);
    expect(out.links).toEqual([{ type: "website", url: "https://x.com" }]);
  });
});

// ─── el expediente sobrevive a un «Guardar» ──────────────────────────────────
//
// ESTA FUNCIÓN RECONSTRUYE EL PERFIL DESDE UNA LISTA BLANCA — no lo parchea. Un
// campo que no se nombre aquí desaparece la próxima vez que el dueño pulsa
// Guardar en «Mi negocio», y no se entera: guardar un formulario no avisa de lo
// que se llevó por delante. Con el expediente eso significaría que el Agente
// aprende durante semanas y un clic en un botón de otra pantalla lo borra.
describe("la memoria del negocio pasa por el guardado", () => {
  it("conserva lo que el Agente había apuntado", () => {
    const memoria = "— Sobre este negocio —\n• Hace blackwork, nada de color";
    expect(normalizeProfileData({ business_name: "Aguja", memoria }).memoria).toBe(memoria);
  });

  it("y el dueño puede vaciarlo desde su pantalla", () => {
    // Cadena vacía = «lo borré a mano», no «no me lo mandes». Se guarda como
    // null para que el lector no tenga dos formas de decir «no hay nada».
    expect(normalizeProfileData({ memoria: "   " }).memoria).toBeNull();
    expect(normalizeProfileData({ memoria: null }).memoria).toBeNull();
  });

  /** Ausente ≠ vacío. Un cliente viejo que mande el perfil sin la clave no debe
   *  borrar lo que hay; sólo un `null`/`""` explícito lo vacía. */
  it("pero una petición que no lo menciona no lo borra", () => {
    expect(normalizeProfileData({ business_name: "Aguja" }).memoria).toBeUndefined();
    expect(normalizeProfileData({ memoria: 42 }).memoria).toBeUndefined();
  });
});
