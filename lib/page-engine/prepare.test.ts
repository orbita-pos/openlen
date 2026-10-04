import { describe, expect, it, vi } from "vitest";

import { preparePage } from "./prepare";

const PAGE = `<!doctype html><html><head><style>:root{--ol-fg:#111}</style></head><body><section><h2>Hola</h2></section></body></html>`;
/** El mismo documento CON su `<script>` dentro, que es como el modelo lo
 *  escribe desde el 2026-08-26. Antes el código viajaba por un canal aparte
 *  (`runtime`) y había que injertarlo para medir. */
const PAGE_CON_JS = PAGE.replace(
  "</body>",
  `<script>console.log('hola')</script></body>`,
);

/** La puerta real hace I/O nativo; el doble devuelve el documento tal cual,
 *  que es lo que hace la de verdad con lo que escribe el modelo. */
const gateOk = vi.fn(async (html: string, _deps: unknown, _policy: unknown) => ({
  ok: true as const,
  html,
  removed: { scripts: 0, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
}));

const deps = (over: Parameters<typeof preparePage>[2] = {}) => ({
  render: (async () => ({ mobileOverflow: false, invalidGeometry: false })) as never,
  gate: gateOk as never,
  ...over,
});

describe("el motor de la página", () => {
  it("entrega el documento y nombra cada etapa", async () => {
    const out = await preparePage(PAGE, {}, deps());
    expect(out.ok).toBe(true);
    expect(out.report.stages.map((s) => s.stage)).toEqual([
      // "modules" salio de esta lista el 2026-08-29 con el puente IA->modulos.
      // La etapa devolvia siempre lista vacia: su unico modulo puenteado ya no
      // tiene horneado. (Lo contaba lib/page-data/sin-puente-ia-modulos.test.ts,
      // retirado con los almacenes el 2026-10-04.)
      // «imagery» y «legibility» se retiraron el 2026-09-04: eran las dos
      // últimas etapas que tocaban lo que escribió el modelo.
      // «invariants» se retiró el 2026-10-04 con `data-ol-calc`, lo último que hacía.
      "measure", "gate",
      // La identidad de los formularios va la ULTIMA: sobre el documento que
      // de verdad se guarda, para que el saneo no anada un <form> despues del
      // estampado. Ver lib/publish/form-identity.ts.
      "form_identity",
    ]);
  });

  /**
   * ⚰️ «aplica los invariantes: la página sin <h1> sale con uno» — RETIRADA
   * el 2026-09-04 con la reparación que probaba. Era la única que metía
   * CONTENIDO VISIBLE que el modelo no escribió.
   *
   * La sustituye la de abajo, que vigila el sentido contrario: el documento
   * del modelo sale como entró.
   */
  it("el documento del modelo sale SIN correcciones nuestras", async () => {
    const SIN_H1 =
      "<!doctype html><html><head><style>nav{position:fixed}h2{color:#c0392b}</style></head>" +
      "<body><nav><a href=\"#s\">s</a></nav><h2>Aurora</h2><section id=\"s\">x</section></body></html>";

    const out = await preparePage(SIN_H1, {}, deps());

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Ni un titular que no escribió…
    expect(out.html, "le inyectamos un <h1>").not.toContain("<h1");
    // …ni CSS que no puso…
    expect(out.html, "le metimos scroll-padding").not.toContain("scroll-padding");
    // …ni su color reescrito a un token.
    expect(out.html, "le atamos el color a un token").toContain("#c0392b");
  });

  // ⚰️ «en create/edit la puerta corre con behaviors=warn/block»: la puerta de
  // las conductas `data-ol-*`, retiradas el 2026-10-04.

  describe("NEVER-THROW — ninguna etapa cosmética puede costar la página", () => {
    it("un Chrome caído no impide entregar", async () => {
      const out = await preparePage(PAGE, {}, deps({
        render: (async () => { throw new Error("chrome muerto"); }) as never,
      }));
      expect(out.ok).toBe(true);
      // Y NO se reporta como "sin roturas": no haber medido es su propio estado.
      expect(out.report.stages.find((s) => s.stage === "measure")?.status).toBe("unavailable");
    });

  });

  it("la rotura medida se informa, no se actúa — regenerar es del llamador", async () => {
    const out = await preparePage(PAGE, {}, deps({
      render: (async () => ({ mobileOverflow: true, invalidGeometry: false })) as never,
    }));
    expect(out.ok).toBe(true);
    expect(out.report.breakage.length).toBeGreaterThan(0);
  });

  it("sólo la puerta puede refusar, y devuelve el motivo", async () => {
    const out = await preparePage(PAGE, {}, deps({
      gate: (async () => ({ ok: false as const, code: "reserved_marker" })) as never,
    }));
    expect(out.ok).toBe(false);
    expect(!out.ok && out.code).toBe("reserved_marker");
    // El informe sobrevive al rechazo: sin él nadie sabe qué llegó a correr.
    expect(out.report.stages.length).toBeGreaterThan(1);
  });

  // ⚰️ «sin brief no se buscan fotos» y «la búsqueda de fotos caída no impide
  // entregar» se retiraron con la etapa que probaban. No se sustituyen por su
  // contraria: que el motor NO busque fotos ya no es una condición del brief,
  // es que no hay ninguna etapa que las busque. Lo vigila la lista de etapas
  // de arriba, que las nombra todas.
});

// ⚰️ «una edición no paga por lo que ya estaba roto» (`priorHtml`), «los
// cálculos se compilan al ingerir» y «los cálculos rotos se reparan o se
// reportan»: probaban las conductas `data-ol-*` y la calculadora de
// `data-ol-calc`, retiradas el 2026-10-04 (sus motores no se inyectaban desde
// agosto).

describe("el JavaScript en la medición", () => {

  // ── el JavaScript en la MEDICIÓN ──────────────────────────────────────────
  // Se mide LO QUE SE PUBLICA. Aquí había un injerto —el código llegaba por un
  // canal aparte y se pegaba al documento sólo para mirarlo— porque el script
  // vivía fuera del HTML. Ahora vive dentro, y volver a injertarlo lo pondría
  // DOS VECES: dos `addEventListener` sobre el mismo botón es un carrito que
  // suma de dos en dos.

  it("la medición ve la página CON su JavaScript", async () => {
    const vistos: string[] = [];
    await preparePage(
      PAGE_CON_JS,
      {},
      deps({ render: (async (h: string) => { vistos.push(h); return {}; }) as never }),
    );
    expect(vistos.some((h) => h.includes("console.log('hola')"))).toBe(true);
  });

  // Y UNA SOLA VEZ. El injerto ya no existe; si alguien lo devuelve, el script
  // queda duplicado y ésta es la única prueba que lo vería.
  it("y una SOLA vez — nadie vuelve a injertarlo", async () => {
    const vistos: string[] = [];
    await preparePage(
      PAGE_CON_JS,
      {},
      deps({ render: (async (h: string) => { vistos.push(h); return {}; }) as never }),
    );
    for (const h of vistos) {
      expect(h.split("console.log('hola')").length - 1).toBe(1);
    }
  });

  // EL INVARIANTE SE DIO LA VUELTA el 2026-08-26. Antes decía que el script NO
  // podía salir en el documento entregado: era un injerto para mirar, y colarse
  // en la salida lo habría persistido en `data.html`. Ahora el script ES parte
  // del documento del usuario, así que perderlo aquí es perder su carrito.
  it("y el script SIGUE en el documento entregado", async () => {
    const out = await preparePage(PAGE_CON_JS, {}, deps());
    expect(out.ok && out.html).toContain("console.log('hola')");
  });

  // ── EL CSS SE JUZGA CON EL JAVASCRIPT DE LA PÁGINA ────────────────────────
  //
  // `.toast.show` no está en el markup inicial: la clase la añade el script
  // al mostrar el aviso. El detector de reglas muertas mira el JavaScript
  // justo para no denunciarla — pero le llegaba por el canal de la cápsula,
  // que RECHAZABA los documentos con más de un `<script>`. Una página con dos
  // bloques (el CDN cuenta aparte, pero dos del modelo es lo normal) dejaba al
  // detector ciego.
  //
  // Medido el 2026-08-26 en una página real: `.toast.show` contó como defecto,
  // ayudó a que la reparación «no bajara el número de defectos», y con eso se
  // tiró una página buena, se reescribió entera y se cobró un crédito de más.

  const CON_TOAST =
    "<!doctype html><html><head><style>" +
    ".toast{opacity:0}.toast.show{opacity:1}" +
    "</style></head><body>" +
    '<div class="toast">Guardado</div>' +
    "<script>window.__A__=1</script>" +
    "<script>document.querySelector('.toast').classList.add('show')</script>" +
    "</body></html>";

  it("una clase que el script añade en caliente NO es una regla muerta", async () => {
    const out = await preparePage(CON_TOAST, {}, deps());
    expect(
      out.report.deadRules ?? [],
      "el detector no vio el JavaScript de la página y denunció una regla viva",
    ).toEqual([]);
  });

  // EL BRAZO DE CONTROL. Sin el script que añade la clase, la MISMA hoja de
  // estilos sí tiene una regla que no puede aplicar nunca. Si esto dejara de
  // detectarse, la prueba de arriba pasaría por no detectar nada.
  it("y sin ese script, la misma regla SÍ sale como muerta", async () => {
    const sinJs = CON_TOAST.replace(
      "<script>document.querySelector('.toast').classList.add('show')</script>",
      "",
    );
    const out = await preparePage(sinJs, {}, deps());
    expect(
      (out.report.deadRules ?? []).map((r) => r.selector).join(" "),
      "el detector de reglas muertas dejó de detectar",
    ).toContain(".show");
  });
  it("una página sin script se mide sin script", async () => {
    const vistos: string[] = [];
    await preparePage(
      PAGE,
      {},
      deps({ render: (async (h: string) => { vistos.push(h); return {}; }) as never }),
    );
    expect(vistos.every((h) => !h.includes("<script"))).toBe(true);
  });

  it("lo que la página grita al cargar entra como rotura", async () => {
    const out = await preparePage(
      PAGE_CON_JS,
      {},
      deps({
        render: (async () => ({
          runtimeErrors: ["ReferenceError: noExiste is not defined"],
        })) as never,
      }),
    );
    expect(out.report.breakage.join(" ")).toContain("noExiste is not defined");
  });
});

// ── LA PROMESA DEL MODELO ───────────────────────────────────────────────────
// Recoger errores responde «¿explotó?». Esto responde «¿hizo lo que prometió?»,
// que es donde viven los dos fallos que de verdad ocurren: el botón cableado a
// nada (consola limpia) y el bucle que no para.
describe("la prueba declarada, dentro de la medición", () => {
  const PRUEBA = {
    codigo: 'var antes = await ui.texto("#reloj"); await ui.clic("#empezar"); await ui.cambiaDe("#reloj", antes);',
  };

  it("el guion viaja al render y sus fallos llegan al informe", async () => {
    let recibido: { behaviorProgram?: string } | undefined;
    const out = await preparePage(
      PAGE,
      { prueba: PRUEBA },
      deps({
        render: (async (_h: string, _i: unknown, o: { behaviorProgram?: string }) => {
          recibido = o;
          return { behaviorResult: [[0, "#reloj no cambió"]] };
        }) as never,
      }),
    );
    // El programa lleva DENTRO la promesa declarada: si viajara vacío, la
    // prueba correría sin comprobar nada y diría que pasó.
    expect(recibido?.behaviorProgram).toContain("#empezar");
    expect(out.report.specFailures).toEqual([{ paso: 1, mensaje: "#reloj no cambió" }]);
  });

  it("una prueba que PASA no deja nada en el informe", async () => {
    const out = await preparePage(
      PAGE,
      { prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: [] })) as never }),
    );
    expect(out.report.specFailures).toBeUndefined();
  });

  it("sin prueba no se manda guion — se pulsa a ciegas como siempre", async () => {
    let recibido: { behaviorProgram?: string } | undefined = { behaviorProgram: "sucio" };
    const out = await preparePage(
      PAGE,
      {},
      deps({
        render: (async (_h: string, _i: unknown, o: { behaviorProgram?: string }) => {
          recibido = o;
          return {};
        }) as never,
      }),
    );
    expect(recibido?.behaviorProgram).toBeUndefined();
    expect(out.report.specFailures).toBeUndefined();
  });

  it("una respuesta con forma inesperada NO acusa a la página", async () => {
    // No medir no es medir mal. Lo mismo que hace el Agente con una spec que
    // no se pudo correr: se calla, no reprueba.
    const out = await preparePage(
      PAGE,
      { prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: "vaya" })) as never }),
    );
    expect(out.report.specFailures).toBeUndefined();
  });

  // 🔴 LO DEL INSTRUMENTO TAMBIÉN VIAJA, marcado (2026-09-22). Iba sólo al log,
  // y en el Chat el modelo seguía creyendo que su promesa se había comprobado.
  // No acusa a la página: la marca es la que deja a `notaSpec` decirlo aparte.
  it("🔴 un fallo DEL INSTRUMENTO llega al informe con su marca, para que se diga", async () => {
    const out = await preparePage(
      PAGE,
      { prueba: PRUEBA },
      deps({
        render: (async () => ({
          behaviorResult: [[0, "#empezar no tiene manejador de clic", "prueba", 0]],
        })) as never,
      }),
    );
    expect(out.report.specFailures).toEqual([
      { paso: 1, mensaje: "#empezar no tiene manejador de clic", deLaPrueba: true, programa: 0 },
    ]);
    const medir = out.report.stages.find((s) => s.stage === "measure");
    expect(medir?.detail).toContain("prueba INAPLICABLE paso 1");
  });

  it("los fallos de la prueba se nombran en la etapa `measure`", async () => {
    const out = await preparePage(
      PAGE,
      { prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: [[0, "#reloj no cambió"]] })) as never }),
    );
    const medir = out.report.stages.find((s) => s.stage === "measure");
    expect(medir?.status).toBe("changed");
    expect(medir?.detail).toContain("prueba paso 1");
  });
});

// ── EL CABLE, NO SÓLO LA FUNCIÓN ─────────────────────────────────────────────
//
// LA LECCIÓN, que sobrevive a la reparación que la enseñó: probar la función a
// solas no prueba que la tubería LA LLAME. Escrita la reparación y cableada en
// `beforeMeta`, se desconectó la línea a propósito y las 188 pruebas siguieron
// en verde. Una guarda que no se entera de que le quitan el cable no guarda
// nada, y este repo ya lo pagó una vez con la poda de documentos.
//
// ⚰️ El ejemplo era `ensure-scroll-padding.test.ts`. Ese módulo se borró el
// 2026-09-05: llevaba desde el 04/09 sin ningún importador de producción y lo
// mantenían vivo su propia prueba y una puerta de despliegue — que es
// exactamente el mismo defecto que este párrafo describe, un piso más arriba.
// ⚰️ «la tubería repara las anclas tapadas por la barra» — RETIRADO el
// 2026-09-04 con `ensureScrollPadding`. Que un ancla aterrice debajo de una
// barra fija es un defecto real y medido, pero es SUYO: se mide y se dice,
// no se le arregla por detrás. Misma decisión que el desborde en móvil.

/**
 * 🔴 EL MODELO DECIDE SUS COLORES. (Jesús, 2026-09-04)
 *
 * Lo que este motor tiene que garantizar es UNA cosa: que le PIDE a la puerta
 * que no normalice. Que la puerta obedezca se prueba en su propio fichero,
 * con la puerta de verdad.
 *
 * La primera versión de esta prueba miraba el HTML de salida y pasaba con la
 * cadena reactivada: el doble `gateOk` ignora la política entera, así que la
 * normalización no corría nunca. Verde sin probar nada.
 */
describe("el modelo decide sus colores", () => {
  it("el motor le pide a la puerta que NO normalice", async () => {
    let politica: { normalize?: boolean } | null = null;
    const espia = (async (html: string, _d: unknown, policy: { normalize?: boolean }) => {
      politica = policy;
      return {
        ok: true as const,
        html,
        removed: { scripts: 0, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
        warnings: [] as string[],
      };
    }) as never;

    await preparePage(PAGE, {}, deps({ gate: espia }));

    expect(politica, "el motor no llamó a la puerta").not.toBeNull();
    expect(
      politica!.normalize,
      "dejó que la cadena born-canonical reescribiera el diseño del modelo",
    ).toBe(false);
  });
});

describe("la etapa de medición mira el documento de vista", () => {
  const VISTA = {
    projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
    title: "Mi negocio",
    sub: null,
    pagina: null,
    settings: { chat: { enabled: true } } as never,
    logoUrl: null,
  };

  it("🔴 mide con el chat horneado, y GUARDA el documento sin él", async () => {
    let medido = "";
    const out = await preparePage(
      PAGE,
      { vista: VISTA },
      deps({
        render: (async (html: string) => {
          medido = html;
          return { mobileOverflow: false, invalidGeometry: false };
        }) as never,
      }),
    );
    // Lo que se MIDE lleva la burbuja, que es lo que el visitante va a ver…
    expect(medido).toContain("data-ol-chat-widget");
    // …y lo que se GUARDA no la lleva: el horneado es una vista de usar y
    // tirar. Si esto se rompe, el widget acabaría dentro de `data.html` y se
    // hornearía dos veces al publicar.
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.html).not.toContain("data-ol-chat-widget");
  });

  it("sin vista se mide lo de siempre, byte a byte", async () => {
    let medido = "";
    await preparePage(
      PAGE,
      {},
      deps({
        render: (async (html: string) => {
          medido = html;
          return { mobileOverflow: false, invalidGeometry: false };
        }) as never,
      }),
    );
    expect(medido).toBe(PAGE);
  });
});
