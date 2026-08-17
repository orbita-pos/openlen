import { describe, expect, it } from "vitest";

import { insertModulePlaceholders, modulesFromBrief } from "./module-placeholders";
import { detectModuleIntent } from "@/lib/projects/module-intent";

const PAGE = `<!doctype html><html lang="es"><head></head><body>
<header data-openlen-role="header">a</header>
<section data-openlen-role="hero">b</section>
<footer data-openlen-role="footer">c</footer>
</body></html>`;

describe("qué módulos pide el brief", () => {
  it.each([
    ["Clínica dental. Queremos que la gente agende su cita en línea.", ["bookings"]],
    ["Barbería en Roma Norte, reservas por internet.", ["bookings"]],
    ["A yoga studio — let people book a class online.", ["bookings"]],
    ["Tostador de café: vendemos grano fresco de origen.", ["collections"]],
    ["Quiero un catálogo de mis muebles restaurados.", ["collections"]],
    ["Estudio de tatuajes: catálogo de diseños y agendar sesión.", ["bookings", "collections"]],
  ])("lee %s", (brief, expected) => {
    expect(modulesFromBrief(brief).sort()).toEqual([...expected].sort());
  });

  it.each([
    ["Una plataforma infantil para colorear, jugar y crear historias."],
    ["Landing para nuestro producto: analítica de embudos y cohortes para equipos."],
    ["Una experiencia de terror inmersiva en una casa abandonada."],
  ])("no inventa módulos en %s", (brief) => {
    expect(modulesFromBrief(brief)).toEqual([]);
  });

  it("no enciende nada desde un brief vacío", () => {
    expect(modulesFromBrief("   ")).toEqual([]);
  });
});

describe("el hueco que el horneado de publicación busca", () => {
  it("deja el marcador que enciende el módulo", () => {
    const out = insertModulePlaceholders(PAGE, ["bookings"]);
    expect(detectModuleIntent(out).bookings).toBe(true);
    expect(detectModuleIntent(out).collections).toBe(false);
  });

  it("entra antes del pie, no después", () => {
    const out = insertModulePlaceholders(PAGE, ["bookings"]);
    expect(out.indexOf("data-ol-bookings-section")).toBeLessThan(out.indexOf("<footer"));
  });

  // La puerta de entrega cuenta los nodos [data-openlen-role] contra el
  // manifiesto: un hueco con ese atributo haría que refuse la página entera.
  it("no se hace pasar por una sección del manifiesto", () => {
    const before = (PAGE.match(/data-openlen-role/g) ?? []).length;
    const out = insertModulePlaceholders(PAGE, ["bookings", "collections"]);
    expect((out.match(/data-openlen-role/g) ?? []).length).toBe(before);
  });

  it("es idempotente: dos pasadas dejan un solo hueco", () => {
    const once = insertModulePlaceholders(PAGE, ["bookings"]);
    const twice = insertModulePlaceholders(once, ["bookings"]);
    expect(twice).toBe(once);
    expect((twice.match(/data-ol-bookings-section/g) ?? []).length).toBe(1);
  });

  it("respeta un hueco que el usuario ya tenía", () => {
    const existing = PAGE.replace("<footer", '<section><div data-ol-bookings-section></div></section><footer');
    expect(insertModulePlaceholders(existing, ["bookings"])).toBe(existing);
  });

  it("sin módulos no toca el documento", () => {
    expect(insertModulePlaceholders(PAGE, [])).toBe(PAGE);
  });

  it("cae de pie en un documento sin pie ni cuerpo", () => {
    expect(insertModulePlaceholders("<div>suelto</div>", ["bookings"])).toBe("<div>suelto</div>");
    const noFooter = "<!doctype html><html><body><section>a</section></body></html>";
    expect(detectModuleIntent(insertModulePlaceholders(noFooter, ["bookings"])).bookings).toBe(true);
  });
});
