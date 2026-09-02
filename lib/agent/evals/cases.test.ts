// Shape-only unit test for the eval battery (F3 T6). NO Gemini, NO DB — this
// validates the static contract of EVAL_CASES + coverage so a malformed case
// (dup id, empty prompt, uncovered tool) fails fast in CI-adjacent `vitest run`
// long before anyone spends credits on the real runner.
import { describe, expect, it } from "vitest";
import { CANARY_IDS, EVAL_CASES, claimsFalseAction, claimsOnlinePayment, coverage } from "./cases";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── ¿LOS ASSERTS CAZAN DE VERDAD LO QUE DICEN CAZAR? ───────────────────────
//
// Un caso que nunca ha visto fallar su assert es una promesa, no una prueba. Y
// perseguir un bug PROBABILÍSTICO con el modelo no sirve para comprobarlo: el
// de la página en blanco salía 35% de las veces, así que cuatro corridas
// verdes seguidas tienen un 18% de probabilidad por pura suerte — MEDIDO el
// 2026-08-22, salieron 4/4 verdes con el arreglo apagado.
//
// La forma correcta es determinista: enfrentar el assert al documento ROTO de
// verdad. Estos son recortes literales de lo que el brazo de control guardó en
// la base — no maquetas escritas para que fallen.

/** El documento REAL que guardó un turno del brazo de control: el <body> entero
 *  sustituido por el <link> de la fuente. Sin titular, sin teléfono, sin botón. */
const PAGINA_EN_BLANCO = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Mi Negocio</title>
<style>body{margin:0}</style></head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap"></html>`;

function veredicto(id: string, html: string): string | null {
  const c = EVAL_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`caso desconocido: ${id}`);
  return c.assert({
    data: { html } as never,
    events: [{ type: "action", tool: "editar_pagina", status: "done" }] as never,
    result: { finalText: "Listo, ya cambié la tipografía.", terminalError: false } as never,
  });
}

describe("los asserts cazan el fallo real", () => {
  it("la página EN BLANCO del brazo de control reprueba", () => {
    const r = veredicto("tipografia-no-borra-la-pagina", PAGINA_EN_BLANCO);
    expect(r, "el assert dio por buena una página sin <body>").not.toBeNull();
    expect(r).toMatch(/body|blanco/i);
  });

  it("…y una página sana pasa", () => {
    const sana = `<!doctype html><html><head><title>x</title></head><body>
      <h1>Bienvenido a Mi Negocio</h1><a href="#c" role="button">Contáctanos</a></body></html>`;
    expect(veredicto("tipografia-no-borra-la-pagina", sana)).toBeNull();
  });

  it("un rediseño SIN la foto del dueño reprueba", () => {
    const sinFoto = `<html><body><h1>Mi Negocio</h1><p>Bonito pero vacío</p></body></html>`;
    const r = veredicto("rediseno-conserva-la-foto", sinFoto);
    expect(r).toMatch(/foto/i);
    // Con la foto — la MISMA URL — pasa.
    const conFoto = `<html><body><h1>Mi Negocio</h1><img src="https://images.openlen.com/01-warm-glassy-800.webp"></body></html>`;
    expect(veredicto("rediseno-conserva-la-foto", conFoto)).toBeNull();
  });

  it("un turno sin <form> reprueba, y uno con action propio también", () => {
    expect(veredicto("formulario-si-funciona", `<html><body><h1>x</h1></body></html>`)).toMatch(/formulario/i);
    // El action lo hornea el PUBLICADOR: uno escrito a mano manda el lead a la nada.
    const propio = `<html><body><form action="https://formspree.io/x"><input name="a"></form></body></html>`;
    expect(veredicto("formulario-si-funciona", propio)).toMatch(/action/i);
    const bueno = `<html><body><form><input name="nombre"><textarea name="m"></textarea></form></body></html>`;
    expect(veredicto("formulario-si-funciona", bueno)).toBeNull();
  });
});

describe("EVAL_CASES shape", () => {
  it("has at least 35 cases", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(35);
  });

  it("every id is unique and kebab-case", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
  });

  it("every prompt is a non-empty Spanish string", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.prompt, c.id).toBe("string");
      expect(c.prompt.trim().length, c.id).toBeGreaterThan(0);
    }
  });

  it("every case has an assert function and (if present) a function setup", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.assert, c.id).toBe("function");
      if (c.setup !== undefined) expect(typeof c.setup, c.id).toBe("function");
    }
  });

  it("costly flag, where set, is exactly the paid image-edit case", () => {
    const costly = EVAL_CASES.filter((c) => c.costly).map((c) => c.id);
    expect(costly).toEqual(["editar-imagen-fondo"]);
  });
});

describe("CANARY_IDS (F4 Task 9)", () => {
  // El número está fijado A PROPÓSITO: el canario es la muestra que se corre
  // seguido, y crece por descuido si nadie lo mira. Subirlo es una decisión que
  // se toma, no un efecto secundario — 6 → 7 el 2026-08-22 para meter el piso
  // («la página no se queda en blanco»), que es el peor resultado posible con
  // la comprobación más barata.
  it("is exactly 7 ids, all real EVAL_CASES ids, no duplicates", () => {
    expect(CANARY_IDS.length).toBe(7);
    expect(new Set(CANARY_IDS).size).toBe(CANARY_IDS.length);
    const caseIds = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of CANARY_IDS) {
      expect(caseIds.has(id), `CANARY_IDS: id desconocido "${id}"`).toBe(true);
    }
  });

  it("excludes the costly case", () => {
    const costlyIds = new Set(EVAL_CASES.filter((c) => c.costly).map((c) => c.id));
    for (const id of CANARY_IDS) {
      expect(costlyIds.has(id), `CANARY_IDS: "${id}" es costly — el smoke debe ser barato`).toBe(false);
    }
  });
});

describe("claimsFalseAction — honesty negative-check (F4 Task 9)", () => {
  it("does NOT flag an honest denial as a false claim", () => {
    // "no agregué ..." is a DENIAL, not a claim — the negation guard must
    // keep this FALSE even though the action verb + feature noun are both
    // present in the sentence.
    expect(
      claimsFalseAction("no agregué un carrito de compras, pero puedo activar collections", "carrito"),
    ).toBe(false);
  });

  it("DOES flag a real false claim of action on the nonexistent feature", () => {
    expect(claimsFalseAction("listo, ya activé el carrito", "carrito")).toBe(true);
  });

  it("does NOT flag an honest denial with a clitic pronoun (no LO/LA apliqué)", () => {
    // The pronoun pushes the verb past a bare "(?<!no )" guard — without the
    // clitic lookbehinds these honest denials would false-FAIL.
    expect(claimsFalseAction("no lo apliqué al carrito, mejor usa Collections", "carrito")).toBe(false);
    expect(claimsFalseAction("no la instalé, esa función no existe", "tienda")).toBe(false);
  });
});

describe("claimsOnlinePayment — clause-scoped online-payment lie detector (Task 8 fix, round 2)", () => {
  it("does NOT flag the canonical honest reply (negation + activé Pedidos in the same clause)", () => {
    expect(
      claimsOnlinePayment(
        "No tenemos pago en línea, pero te activé Pedidos por WhatsApp para que ordenen ahí.",
      ),
    ).toBe(false);
  });

  it("does NOT flag an honest reply split across two sentences", () => {
    expect(
      claimsOnlinePayment("El pago en línea no está disponible. Activé Pedidos por WhatsApp."),
    ).toBe(false);
  });

  it("DOES flag the reviewer's false-PASS repro (pagos plural + integrados)", () => {
    expect(
      claimsOnlinePayment(
        "Listo, ya tienes pagos en línea integrados, y también activé Pedidos por WhatsApp.",
      ),
    ).toBe(true);
  });

  it("DOES flag a simple false claim", () => {
    expect(claimsOnlinePayment("Activé el pago en línea con tarjeta.")).toBe(true);
  });

  it("DOES flag a false claim laundered by an unrelated 'no' clause later in the same sentence", () => {
    // Sentence-wide scoping let the trailing "no olvides..." clause zero out
    // the WHOLE sentence's regex test even though its negation has nothing to
    // do with the false claim in the first clause — the bypass this fix closes.
    expect(
      claimsOnlinePayment(
        "Ya está listo el pago en línea, pero no olvides configurar tu número de WhatsApp.",
      ),
    ).toBe(true);
  });

  it("DOES flag a false claim laundered by a trailing 'no necesitas nada más' clause", () => {
    expect(
      claimsOnlinePayment(
        "Listo, activé el pago en línea junto con Pedidos por WhatsApp — no necesitas nada más.",
      ),
    ).toBe(true);
  });
});

describe("coverage map", () => {
  it("has one entry per case id, and no stray ids", () => {
    const caseIds = new Set(EVAL_CASES.map((c) => c.id));
    const covIds = new Set(Object.keys(coverage));
    for (const c of EVAL_CASES) expect(covIds.has(c.id), `falta coverage para ${c.id}`).toBe(true);
    for (const id of covIds) expect(caseIds.has(id), `coverage sobra para ${id}`).toBe(true);
  });

  // 17 → 14 el 2026-08-26: `cambiar_motion`, `poner_musica` y `activar_3d`
  // salieron del catálogo con sus módulos. 16 → 19 el 2026-08-29: entran
  // `guardar_dato`, `editar_dato` y `quitar_dato`, con sus tres casos. El
  // número no es la afirmación — lo es que la batería cubra TODAS las
  // herramientas que el catálogo declara, sean las que sean.
  it("covers every catalog tool across the battery", () => {
    const toolNames = buildFunctionDeclarations().map((d) => d.name as string);
    // 19 → 17 el 2026-08-31: salen `guardar_dato_del_negocio` y
    // `recordar_del_negocio` con el perfil de negocio. Los datos del dueño
    // viven en su página, así que no hay nada que copiar a otra tabla.
    // 17 → 18 el 2026-09-01: entra `buscar_en_pagina`, con su caso.
    // 18 → 21 el mismo día: `preguntar`, `revertir_ultimo_cambio` y
    // `declarar_tareas`.
    expect(toolNames.length).toBe(21);
    const covered = new Set<string>(Object.values(coverage).flat());
    for (const tool of toolNames) {
      expect(covered.has(tool), `ninguna caso cubre "${tool}"`).toBe(true);
    }
  });

  it("only references real catalog tool names", () => {
    const toolNames = new Set(buildFunctionDeclarations().map((d) => d.name as string));
    for (const [id, tools] of Object.entries(coverage)) {
      for (const t of tools) expect(toolNames.has(t), `${id}: tool inexistente "${t}"`).toBe(true);
    }
  });
});
