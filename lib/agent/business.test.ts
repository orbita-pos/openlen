import { describe, expect, it } from "vitest";
import { summarizeBusinessForAgent } from "./business";
import { recordarDelNegocio } from "@/lib/business-profiles/documento";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

const EMPTY: BusinessProfileData = {
  business_name: null, industry: null, tagline_es: null, tagline_en: null,
  pitch: null, hero_keyword: null, features: [], pricing: [], testimonials: [],
  cta_primary: null, cta_secondary: null, faq_questions: [], language_detected: null,
};

describe("summarizeBusinessForAgent", () => {
  it("null/perfil vacío → null (el ESTADO queda como antes de P2)", () => {
    expect(summarizeBusinessForAgent(null)).toBeNull();
    expect(summarizeBusinessForAgent(undefined)).toBeNull();
    expect(summarizeBusinessForAgent(EMPTY)).toBeNull();
    // strings de puros espacios tampoco cuentan como dato real
    expect(summarizeBusinessForAgent({ ...EMPTY, business_name: "   " })).toBeNull();
  });

  it("resume identidad + contacto + redes con claves en español", () => {
    const out = summarizeBusinessForAgent({
      ...EMPTY,
      business_name: "Tacos El Güero",
      industry: "taquería",
      tagline_es: "Al pastor desde 1998",
      pitch: "Tacos al carbón en el centro de Culiacán.",
      contact: {
        whatsapp: "6671234567", phone: null, email: "hola@elguero.mx", address: "Av. Obregón 123",
        socials: { instagram: "https://instagram.com/elguero", facebook: null, tiktok: null, website: null },
      },
    });
    expect(out).toEqual({
      nombre: "Tacos El Güero",
      rubro: "taquería",
      tagline: "Al pastor desde 1998",
      pitch: "Tacos al carbón en el centro de Culiacán.",
      contacto: { whatsapp: "6671234567", email: "hola@elguero.mx", direccion: "Av. Obregón 123" },
      redes: { instagram: "https://instagram.com/elguero" },
    });
  });

  it("tagline_es gana; sin es cae a tagline_en", () => {
    expect(
      summarizeBusinessForAgent({ ...EMPTY, tagline_es: "Hola", tagline_en: "Hi" })?.tagline,
    ).toBe("Hola");
    expect(summarizeBusinessForAgent({ ...EMPTY, tagline_en: "Hi" })?.tagline).toBe("Hi");
  });

  it("los campos vacíos NO viajan — nada de nulls que gasten contexto", () => {
    const out = summarizeBusinessForAgent({ ...EMPTY, business_name: "X" });
    expect(out).toEqual({ nombre: "X" });
  });

  it("links: se recortan a 6 y los sin url se tiran", () => {
    const out = summarizeBusinessForAgent({
      ...EMPTY,
      business_name: "X",
      links: [
        { type: "menu", url: "https://elguero.mx/menu" },
        { type: "vacio", url: "  " },
        ...Array.from({ length: 8 }, (_, i) => ({ type: "otro", url: `https://x.mx/${i}` })),
      ],
    });
    const links = out?.links as { tipo: string; url: string }[];
    expect(links).toHaveLength(6);
    expect(links[0]).toEqual({ tipo: "menu", url: "https://elguero.mx/menu" });
    expect(links.some((l) => l.tipo === "vacio")).toBe(false);
  });

  it("features/pricing/testimonials NO viajan (compacto a propósito)", () => {
    const out = summarizeBusinessForAgent({
      ...EMPTY,
      business_name: "X",
      features: [{ title: "F", desc: "D" }],
      pricing: [{ name: "P", price: "$1", period: null, features: [] }],
      testimonials: [{ name: "T", role: null, company: null, quote: "Q" }],
    });
    expect(Object.keys(out ?? {})).toEqual(["nombre"]);
  });
});

// ─── el expediente, de vuelta al Agente ──────────────────────────────────────
//
// LA MITAD QUE FALTABA. El Agente ESCRIBE en el expediente desde el 2026-08-27;
// sin esto no lo LEE — apunta «hace blackwork, nada de color» y al turno
// siguiente lo vuelve a preguntar. Es la misma media tubería que tenía el Chat
// con los datos duros: el perfil recogido y nadie mirándolo.
describe("lo que el dueño contó llega al ESTADO", () => {
  it("las notas viajan como sobre_el_negocio", () => {
    const r = recordarDelNegocio(
      { business_name: "Aguja Negra" } as BusinessProfileData,
      "El estudio hace blackwork, nada de color",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = summarizeBusinessForAgent(r.data);
    expect(out?.sobre_el_negocio).toEqual(["El estudio hace blackwork, nada de color"]);
  });

  /** Sin viñetas ni encabezado: el ESTADO es JSON, y colar ahí el formato del
   *  almacén le enseñaría al modelo un «•» que ya ha copiado a una página. */
  it("sin el formato del almacén", () => {
    const r = recordarDelNegocio({} as BusinessProfileData, "Atiende con cita");
    if (!r.ok) return;
    expect(JSON.stringify(summarizeBusinessForAgent(r.data))).not.toContain("•");
  });

  /** Un perfil sin expediente tiene que dar un ESTADO byte-idéntico al de
   *  antes: una clave vacía le dice al modelo que hay algo y no hay nada. */
  it("y un negocio sin notas no añade la clave", () => {
    const out = summarizeBusinessForAgent({ business_name: "Aguja" } as BusinessProfileData);
    expect(out).not.toHaveProperty("sobre_el_negocio");
  });
});
