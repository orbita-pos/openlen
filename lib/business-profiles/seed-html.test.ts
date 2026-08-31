import { describe, it, expect } from "vitest";
import { seedBrandIntoHtml, profileMeta } from "./seed-html";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import { buildModuleSection } from "@/lib/publish/module-sections";
import { modulePlacements } from "@/lib/projects/module-placements";
import type { BusinessProfileData } from "./types";

const HTML =
  "<html><head><title>x</title></head><body><h1>Hi</h1></body></html>";

const BANDA = '<html lang="es"><body><section data-ol-platforms-section></section></body></html>';

function profile(over: Partial<BusinessProfileData> = {}): BusinessProfileData {
  return { ...coerceBusinessData({}), ...over };
}

describe("seedBrandIntoHtml", () => {
  it("is a no-op for an empty profile (Business seeds, never gates)", () => {
    expect(seedBrandIntoHtml(HTML, profile())).toBe(HTML);
  });

  it("applies the brand accent when set", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({ brand: { accent: "#1166EE", logoUrl: null } }),
    );
    expect(out).toContain("data-ol-accent-applied");
    expect(out).toContain("#1166ee");
  });

  // ⚰️ AQUÍ VIVÍAN DIEZ PRUEBAS DEL BOTÓN FLOTANTE DE CONTACTO. Se van con él
  // el 2026-08-31, y se sustituyen por su INVERSA — que es lo que este repo
  // hace al retirar algo: donde una prueba fijaba «el widget se pone», la
  // superviviente fija que YA NO SE PONE.
  //
  // El motivo, medido: no se podía quitar. Lo repintaba `seedBrandIntoHtml` en
  // CADA guardado, así que el usuario pedía «quítamelo», el Agente lo borraba
  // con editar_pagina, decía «listo», y volvía al siguiente guardado. Pasó dos
  // veces seguidas con el mismo usuario. Ahora, si alguien quiere un botón
  // flotante, el modelo se lo escribe DENTRO de la página — y entonces es suyo:
  // se mueve, se recolorea y se BORRA como cualquier otra cosa.
  it("🔴 ya NO inyecta un botón flotante de contacto", () => {
    const conContacto = {
      contact: { whatsapp: "+52 6699291922", phone: "980170" },
      social: { tiktok: "@orbitapos" },
    } as unknown as BusinessProfileData;
    const out = seedBrandIntoHtml("<html><body><h1>x</h1></body></html>", conContacto);
    expect(out).not.toContain("data-ol-contact-widget");
    expect(out).not.toContain("wa.me");
  });

  it("is idempotent — re-seeding never duplicates the accent", () => {
    const data = profile({
      brand: { accent: "#1166EE", logoUrl: null },
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    const once = seedBrandIntoHtml(HTML, data);
    const twice = seedBrandIntoHtml(once, data);
    expect(twice).toBe(once);
    // La mitad del widget se fue con él (2026-08-31). La idempotencia del
    // ACENTO sigue viva y es lo que esta prueba vigila ahora: `stripPriorSeed`
    // tiene que seguir quitando el <style> anterior antes de poner el nuevo, o
    // re-sembrar apilaría un bloque por guardado.
    expect(twice.match(/data-openlen-brand-accent/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(twice.match(/data-ol-accent-applied/g)?.length).toBe(1);
  });

  // ⚰️ Aquí había cuatro pruebas del sembrado de la BANDA de plataformas, y
  // debajo un `describe("fillPlatformsBand")` entero. La banda murió el
  // 2026-08-29: era un TECHO —el prompt le decía al modelo que las redes SON
  // una banda—, así que nunca le proponía a nadie una sección propia ni una
  // página por red.
  //
  // Lo que fijaban y ya no aplica: que sembrar la RELLENARA, que re-sembrar no
  // la duplicara, y que sembrar la PRESERVARA aunque quedara vacía (borrarla
  // era cosa de publicar, no de sembrar — porque sembrar corre en cada guardado
  // de Mi negocio y no podía destruir una sección que el creador insertó).
  //
  // Los ENLACES siguen en el perfil: sin ellos el modelo se inventaría los
  // @usuario, que es el peor dato falso posible.
});
