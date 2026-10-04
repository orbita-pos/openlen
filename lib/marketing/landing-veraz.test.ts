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
    // SIN EXCEPCIÓN desde el 04/10. El plan self-host la tenía porque nombraba
    // las claves que hacían falta («Bring your own Fireworks and OpenAI keys»):
    // ahí el proveedor era la instrucción. El rediseño de la portada lo bajó a
    // una tira que dice «tus propias claves» sin nombrar a nadie, así que ya
    // no queda ninguna cadena que tenga derecho a decirlo.
    for (const p of PROVEEDORES) {
      expect(crudo, `${locale}: la landing nombra «${p}»`).not.toContain(p);
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
    // `multilingual` no es un módulo del Agente pero sí una capacidad real:
    // Speak Every Language, que se elige al publicar.
    //
    // `platforms` SALIÓ de esta lista el 2026-08-29, y con ella la pastilla.
    // Estuvo aquí justificada como «la banda de plataformas del perfil», una
    // razón que caducó cuando esa banda se retiró — y una justificación caduca
    // es cómo una guarda deja de guardar sin ponerse roja nunca. La capacidad
    // sigue existiendo; lo que se retiró es DARLE UNA FORMA FIJA, que era el
    // techo. Volver a anunciarla como pastilla vuelve a montarlo.
    const REALES = [...AGENT_MODULES, "multilingual"];
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

describe("las cifras de los planes no se contradicen con el cobro", () => {
  // HASTA EL 04/10 aquí se pedía que el plan Pro dijera «25» (los sitios que
  // daban 150 créditos). La portada nueva vende Pro 200 y Max 500, y su texto ya
  // no cuenta sitios: lo que tiene que cuadrar ahora es el NÚMERO DE CRÉDITOS.
  // La portada lo pinta desde lib/marketing/plan-price.ts y el cobro lo saca de
  // ahí mismo (CREDITS_BY_PLAN, comprobado en lib/credits.test.ts). Lo que
  // queda por vigilar es que ninguna traducción escriba la cifra A MANO: una
  // cifra escrita en la cadena no se entera cuando cambia el precio.
  it.each(LOCALES)("%s — los créditos de Pro y de Max salen del precio, no del texto", (locale) => {
    const pricing = (marketing(locale) as unknown as {
      pricing: Record<string, { blurb?: string; features?: Record<string, string> }>;
    }).pricing;
    expect(pricing.pro.features?.["1"], `${locale}: Pro`).toContain("{credits");
    expect(pricing.max.features?.["1"], `${locale}: Max`).toContain("{credits");
    const todo = JSON.stringify(pricing);
    for (const viejo of ["150", "3.99", "3,99"]) {
      expect(todo, `${locale}: los precios dicen «${viejo}»`).not.toContain(viejo);
    }
  });
});
