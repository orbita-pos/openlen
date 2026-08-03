import { describe, expect, it } from "vitest";
import { SELECTOR_CASES } from "./selector-cases";

describe("SELECTOR_CASES", () => {
  it("contains 20 unique, bilingual safety cases", () => {
    expect(SELECTOR_CASES).toHaveLength(20);
    expect(new Set(SELECTOR_CASES.map((c) => c.id)).size).toBe(20);
    expect(new Set(SELECTOR_CASES.map((c) => c.language))).toEqual(new Set(["es", "en"]));
  });

  it("contains at least five adversarial identity cases", () => {
    expect(SELECTOR_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(5);
  });

  it("defines expected domains, audiences and forbidden signals for every case", () => {
    for (const c of SELECTOR_CASES) {
      expect(c.expectedDomains.length).toBeGreaterThan(0);
      expect(c.expectedAudience).toMatch(/^[a-z0-9_]+$/);
      expect(c.forbiddenSignals.length).toBeGreaterThan(0);
    }
  });

  it("preserves the prescribed UTF-8 Spanish briefs", () => {
    const spanishBriefs = Object.fromEntries(
      SELECTOR_CASES.filter((c) => c.language === "es").map((c) => [c.id, c.brief]),
    );

    expect(spanishBriefs).toEqual({
      "kids-coloring-es": "Plataforma infantil de coloreo con páginas para colorear, minijuegos, cuentos y actividades creativas.",
      "language-school-es": "Academia online para adultos que aprenden inglés con clases, progreso, certificados y tutores.",
      "preschool-es": "Preescolar para familias con aprendizaje mediante juego, horarios, maestras, admisiones y recorridos del campus.",
      "coffee-es": "Tostador independiente de café de especialidad con suscripción, notas de cata, orígenes y visitas al taller.",
      "wellness-es": "Estudio de yoga y respiración para mujeres, con clases, retiros, instructoras y reserva de sesión.",
      "dentist-es": "Clínica dental familiar con tratamientos, doctores, testimonios, urgencias y reserva por WhatsApp.",
      "artist-portfolio-es": "Portafolio de una ilustradora editorial con proyectos seleccionados, biografía, exposiciones y contacto.",
      "indie-game-es": "Videojuego indie cooperativo de fantasía con tráiler, personajes, mundo, novedades y lista de deseos.",
      "wedding-es": "Sitio de boda íntima con historia de la pareja, itinerario, ubicación, hospedaje y confirmación de asistencia.",
      "fashion-es": "Marca de moda sostenible con colección editorial, materiales, lookbook, tallas y tienda online.",
      "hardware-es": "Dispositivo doméstico para medir la calidad del aire con sensores, aplicación, especificaciones y preventa.",
    });
  });
});
