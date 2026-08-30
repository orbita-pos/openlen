// @vitest-environment node
//
// LA LANDING NO PROMETE LO QUE EL PRODUCTO NO TIENE.
//
// Auditada entera el 2026-08-28 tras 19 commits que movieron el producto debajo
// de ella. Lo que se encontró:
//
//  · Vendía CINCO módulos —Reservas, Pedidos WhatsApp, Miembros, Comentarios,
//    Chat— de los que sólo existe Chat. Los otros cuatro se retiraron el
//    2026-08-21. Alguien se registraba por Reservas y no las encontraba.
//  · Un indicador EN VIVO en el héroe decía «Gemini 3.1 Pro», y Gemini no corre
//    por defecto en ninguna superficie.
//  · El plan self-host pedía «tu propia clave de API de Gemini».
//  · Y se vendía BARATA: «≈10 generaciones» cuando son 25 sitios completos.
//
// Estas guardas no revisan redacción — revisan las promesas que un cambio de
// producto puede dejar mintiendo sin que nadie mire la landing.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_MODULES } from "@/lib/agent/catalog";

const LOCALES = readdirSync(resolve(process.cwd(), "messages")).filter((d) =>
  /^[a-z]{2}$/.test(d),
);

const marketing = (locale: string) =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `messages/${locale}/marketing.json`), "utf8"),
  ) as Record<string, never>;

describe("la landing no nombra proveedores de modelo", () => {
  // NUNCA EL NOMBRE DEL PROVEEDOR — es el patrón que cumplen todos los
  // productos de consumo: v0 no dice «Sonnet», dice Max. Y además caduca: la
  // landing sobrevivió a dos migraciones de proveedor con el nombre puesto.
  const PROVEEDORES = ["Gemini", "DeepSeek", "Fireworks", "Qwen", "GPT-", "Claude"];

  it.each(LOCALES)("%s — ninguna cadena de marketing nombra un modelo", (locale) => {
    const crudo = readFileSync(
      resolve(process.cwd(), `messages/${locale}/marketing.json`),
      "utf8",
    );
    for (const p of PROVEEDORES) {
      // EXCEPCIÓN: el plan self-host SÍ debe nombrar las claves que hacen falta
      // — ahí el nombre del proveedor es la instrucción, no el escaparate.
      const sinSelfHost = JSON.parse(crudo) as {
        pricing: { selfHost: { features: Record<string, string> } };
      };
      const selfHost = Object.values(sinSelfHost.pricing.selfHost.features).join(" ");
      const resto = crudo.replace(
        JSON.stringify(sinSelfHost.pricing.selfHost.features).slice(1, -1),
        "",
      );
      if (selfHost.includes(p)) continue;
      expect(resto, `${locale}: la landing nombra «${p}»`).not.toContain(p);
    }
  });
});

describe("los módulos que anuncia la landing existen", () => {
  // La lista de chips vive en el componente; el catálogo del Agente es la
  // fuente. Si se retira un módulo y nadie toca la landing, esto se pone rojo.
  const CHIPS = readFileSync(
    resolve(process.cwd(), "components/marketing/analytics-leads.tsx"),
    "utf8",
  );

  it("no anuncia ningún módulo retirado el 2026-08-21", () => {
    for (const muerto of ["bookings", "orders", "members", "comments"]) {
      expect(
        CHIPS,
        `la landing vuelve a vender el módulo «${muerto}», retirado el 2026-08-21`,
      ).not.toContain(`modules.items.${muerto}`);
    }
  });

  it("los que anuncia salen del catálogo real del Agente", () => {
    // `platforms` y `multilingual` no son módulos del Agente pero sí
    // capacidades reales. OJO, el porqué de `platforms` CAMBIÓ el 2026-08-29:
    // ya no es «la banda de plataformas del perfil» —esa banda se retiró—,
    // sino que los enlaces viven en el perfil del negocio y es EL MODELO quien
    // los escribe dentro de la página. La pastilla sigue siendo cierta; lo que
    // dejó de ser cierto es que hubiera un interruptor detrás.
    // `multilingual` es Speak Every Language, que se elige al publicar.
    const REALES = [...AGENT_MODULES, "platforms", "multilingual"];
    const anunciados = [...CHIPS.matchAll(/modules\.items\.(\w+)/g)].map((m) => m[1]);
    expect(anunciados.length).toBeGreaterThan(0);
    for (const a of anunciados) {
      expect(REALES, `la landing anuncia «${a}», que no existe`).toContain(a);
    }
  });

  // ESTA GUARDA FALTABA Y POR ESO NO SALTÓ. El 2026-08-29 el cuerpo de esa
  // tarjeta seguía diciendo «Chat, catalog and platforms — switch one on and it
  // becomes a section of your page» con Colecciones y la banda de Plataformas
  // ya retiradas, y las pruebas de arriba pasaban: sólo miraban las CLAVES de
  // los chips, y la mentira estaba en la prosa de al lado.
  //
  // Lo que se comprueba es el nombre de un módulo RETIRADO, que es
  // inequívoco. NO se puede comprobar «catalog»: el texto nuevo dice «tu
  // catálogo» a propósito, como algo que PIDES y el modelo escribe en la
  // página. La palabra es legítima; lo que no lo era es prometer un
  // interruptor detrás. Asertar sobre la palabra suelta obligaría a mutilar un
  // texto correcto para ponerse verde.
  it.each(LOCALES)("%s — ni el titular ni el cuerpo venden un módulo retirado", (locale) => {
    const mod = (marketing(locale) as unknown as {
      analyticsLeads: { extras: { modules: { title: string; body: string } } };
    }).analyticsLeads.extras.modules;
    const texto = `${mod.title} ${mod.body}`.toLowerCase();
    for (const muerto of ["bookings", "reservas", "pedidos", "members", "miembros"]) {
      expect(texto, `${locale}: la tarjeta nombra «${muerto}»`).not.toContain(muerto);
    }
    // BRAZO DE CONTROL: que el texto EXISTA. Una tarjeta vacía pasaría todo lo
    // de arriba sin decir nada.
    expect(mod.title.length, locale).toBeGreaterThan(8);
    expect(mod.body.length, locale).toBeGreaterThan(40);
  });

  it("y las 10 traducciones tienen exactamente esos chips", () => {
    const anunciados = [...new Set([...CHIPS.matchAll(/modules\.items\.(\w+)/g)].map((m) => m[1]))];
    for (const locale of LOCALES) {
      const items = (marketing(locale) as unknown as {
        analyticsLeads: { extras: { modules: { items: Record<string, string> } } };
      }).analyticsLeads.extras.modules.items;
      expect(Object.keys(items).sort(), locale).toEqual([...anunciados].sort());
    }
  });
});

describe("las cifras del plan Pro no se contradicen con el cobro", () => {
  // «≈10 generaciones» era el número viejo, de antes de corregir la tarifa de
  // deepseek-flash. Con 2 créditos por portada y 1 por subpágina, 150 créditos
  // son ~25 sitios de cinco páginas. Vendíamos 2,5x menos de lo que damos.
  it.each(LOCALES)("%s — el plan Pro dice 25, no 10", (locale) => {
    const pro = (marketing(locale) as unknown as {
      pricing: { pro: { blurb: string; features: Record<string, string> } };
    }).pricing.pro;
    // LAS DOS PIEZAS, POR SEPARADO. La primera versión concatenaba blurb +
    // features y pedía que el resultado contuviera "25" — así que bastaba con
    // que UNA lo dijera. Su propio brazo de control lo enseñó: cambiando sólo
    // el blurb al «10» viejo, la guarda seguía en verde.
    expect(pro.blurb, `${locale}: el blurb no dice cuántos sitios`).toContain("25");
    expect(pro.features["1"], `${locale}: la viñeta no dice cuántos sitios`).toContain("25");
  });
});
