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

/**
 * La puerta real hace I/O nativo, pero el doble tiene que respetar su contrato:
 * llama a `beforeMeta`, que es donde corren los invariantes. Un doble que lo
 * ignore prueba una tubería que no existe.
 */
const gateOk = vi.fn(
  async (html: string, deps: { beforeMeta?: (h: string) => string }, _policy: unknown) => ({
    ok: true as const,
    html: deps.beforeMeta ? deps.beforeMeta(html) : html,
    removed: { scripts: 0, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
    warnings: [] as string[],
  }),
);

const deps = (over: Parameters<typeof preparePage>[2] = {}) => ({
  render: (async () => ({ mobileOverflow: false, invalidGeometry: false })) as never,
  gate: gateOk as never,
  ...over,
});

describe("el motor de la página", () => {
  it("entrega el documento y nombra cada etapa", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.report.stages.map((s) => s.stage)).toEqual([
      // "modules" salio de esta lista el 2026-08-29 con el puente IA->modulos.
      // La etapa devolvia siempre lista vacia: su unico modulo puenteado ya no
      // tiene horneado. Ver lib/page-data/sin-puente-ia-modulos.test.ts.
      // «imagery» y «legibility» se retiraron el 2026-09-04: eran las dos
      // últimas etapas que tocaban lo que escribió el modelo.
      "measure", "invariants", "gate",
      // La identidad de los formularios va la ULTIMA: sobre el documento que
      // de verdad se guarda, para que el saneo no anada un <form> despues del
      // estampado. Ver lib/publish/form-identity.ts.
      "form_identity",
    ]);
  });

  it("aplica los invariantes: la página sin <h1> sale con uno", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.ok && out.html).toContain("<h1>Hola</h1>");
  });

  // El motivo por el que existe: crear no tiene página que perder, editar sí.
  it.each([
    ["create", "warn"],
    ["edit", "block"],
  ] as const)("en %s la puerta corre con behaviors=%s", async (mode, behaviors) => {
    gateOk.mockClear();
    await preparePage(PAGE, { mode }, deps());
    expect(gateOk.mock.calls[0]?.[2]).toMatchObject({ behaviors });
  });

  describe("NEVER-THROW — ninguna etapa cosmética puede costar la página", () => {
    it("un Chrome caído no impide entregar", async () => {
      const out = await preparePage(PAGE, { mode: "create" }, deps({
        render: (async () => { throw new Error("chrome muerto"); }) as never,
      }));
      expect(out.ok).toBe(true);
      // Y NO se reporta como "sin roturas": no haber medido es su propio estado.
      expect(out.report.stages.find((s) => s.stage === "measure")?.status).toBe("unavailable");
    });

  });

  it("la rotura medida se informa, no se actúa — regenerar es del llamador", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps({
      render: (async () => ({ mobileOverflow: true, invalidGeometry: false })) as never,
    }));
    expect(out.ok).toBe(true);
    expect(out.report.breakage.length).toBeGreaterThan(0);
  });

  it("sólo la puerta puede refusar, y devuelve el motivo", async () => {
    const out = await preparePage(PAGE, { mode: "edit" }, deps({
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

describe("una edición no paga por lo que ya estaba roto", () => {
  // El caso real: la primera página que generó el motor traía botones de filtro
  // sin su rejilla. Crear la entrega (falla abierto); editar la rechazaba
  // (falla cerrado), así que esa página no se podía cambiar NUNCA.
  const conDefecto = `<!doctype html><html><head></head><body><div data-ol-filter-group="panes"><button data-ol-filter="a">A</button></div></body></html>`;

  it("sin priorHtml, el defecto heredado bloquea — la trampa que había", async () => {
    const out = await preparePage(conDefecto, { mode: "edit", renderChecks: false });
    expect(out.ok).toBe(false);
  });

  it("con priorHtml, el defecto heredado NO bloquea", async () => {
    const editada = conDefecto.replace("<button", "<p>texto nuevo</p><button");
    const out = await preparePage(editada, {
      mode: "edit",
      renderChecks: false,
      priorHtml: conDefecto,
    });
    expect(out.ok).toBe(true);
  });

  it("pero un defecto que ESTA edición introduce sí bloquea", async () => {
    const sano = `<!doctype html><html><head></head><body><p>hola</p></body></html>`;
    const out = await preparePage(conDefecto, {
      mode: "edit",
      renderChecks: false,
      priorHtml: sano,
    });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.report.behaviorIssues?.length).toBe(1);
  });
});

// L2 — la compilación de los cálculos vive DENTRO de `beforeMeta`, junto a los
// invariantes, y no en el llamador: así el documento que la puerta valida es el
// ya compilado, y las tres superficies (crear, Chat, Agente) lo heredan sin que
// ninguna lo cablee por su cuenta.
describe("los cálculos se compilan al ingerir", () => {
  const CALC = `<!doctype html><html><body><div data-ol-calc>` +
    `<input data-ol-val="recibo" type="number" value="1800">` +
    `<p data-ol-out="REDONDEA(recibo * 0.72, 0)">0</p>` +
    `</div></body></html>`;

  it("el gemelo compilado y el valor de nacimiento salen del motor", async () => {
    const out = await preparePage(CALC, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.ok && out.html).toContain("data-ol-out-c=");
    // Nace con el número visible: sin esto, una página sin JS mostraría un hueco.
    expect(out.ok && out.html).toContain(">1296<");
  });

  it("el informe dice cuántas regiones compiló", async () => {
    const out = await preparePage(CALC, { mode: "create" }, deps());
    const inv = out.report.stages.find((s) => s.stage === "invariants");
    expect(inv?.detail).toContain("calc=1/1");
  });

  it("una página sin cálculos no paga nada", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    const inv = out.report.stages.find((s) => s.stage === "invariants");
    expect(inv?.detail).toContain("calc=0/0");
    expect(out.ok && out.html).not.toContain("-c=");
  });
});

// Cerrar el bucle: lo que el motor detecta, el motor lo arregla — y lo que no
// puede arreglar, lo dice en vez de perderlo.
describe("los cálculos rotos se reparan o se reportan", () => {
  it("una región puesta sobre el botón se envuelve, y entonces compila", async () => {
    const html =
      `<!doctype html><html><body><section>` +
      `<button data-ol-calc data-ol-set="elegido = AZAR(nombres)">Girar</button>` +
      `<ul data-ol-val="nombres"><li data-ol-item>Ana</li></ul>` +
      `<p data-ol-out="elegido">—</p>` +
      `</section></body></html>`;
    const out = await preparePage(html, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.report.calcRepairs).toContain("wrapped_region");
    expect(out.report.calcIssues ?? []).toEqual([]);
    expect(out.ok && out.html).toContain("data-ol-set-c=");
  });

  it("un campo que nadie lee pierde el marcador — deja de prometer", async () => {
    const html =
      `<!doctype html><html><body><div data-ol-calc>` +
      `<input data-ol-val="recibo" type="number" value="1800">` +
      `<input data-ol-val="recibo-range" type="range" value="1800">` +
      `<p data-ol-out="recibo * 0.72">0</p></div></body></html>`;
    const out = await preparePage(html, { mode: "create" }, deps());
    expect(out.report.calcRepairs).toContain("dropped_orphan_value");
    expect(out.ok && out.html).not.toContain('data-ol-val="recibo-range"');
  });

  // Lo que NO se puede arreglar sin adivinar tiene que LLEGAR. Antes se perdía:
  // el informe sólo llevaba el conteo en el `detail` de la etapa.
  it("una fórmula que necesita criterio viaja en el informe", async () => {
    const html =
      `<!doctype html><html><body><div data-ol-calc>` +
      `<input data-ol-val="x" value="1"><p data-ol-out="x * ">0</p></div></body></html>`;
    const out = await preparePage(html, { mode: "create" }, deps());
    expect(out.report.calcIssues?.length).toBeGreaterThan(0);
    expect(out.report.calcIssues?.[0]?.attr).toBe("data-ol-out");
  });

  it("una página sin cálculos no reporta ni repara nada", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.report.calcIssues).toBeUndefined();
    expect(out.report.calcRepairs).toBeUndefined();
  });

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
      { mode: "create" },
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
      { mode: "create" },
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
    const out = await preparePage(PAGE_CON_JS, { mode: "create" }, deps());
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
    const out = await preparePage(CON_TOAST, { mode: "create" }, deps());
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
    const out = await preparePage(sinJs, { mode: "create" }, deps());
    expect(
      (out.report.deadRules ?? []).map((r) => r.selector).join(" "),
      "el detector de reglas muertas dejó de detectar",
    ).toContain(".show");
  });
  it("una página sin script se mide sin script", async () => {
    const vistos: string[] = [];
    await preparePage(
      PAGE,
      { mode: "create" },
      deps({ render: (async (h: string) => { vistos.push(h); return {}; }) as never }),
    );
    expect(vistos.every((h) => !h.includes("<script"))).toBe(true);
  });

  it("lo que la página grita al cargar entra como rotura", async () => {
    const out = await preparePage(
      PAGE_CON_JS,
      { mode: "create" },
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
  const PRUEBA = [
    { clic: "#empezar", veces: 1, entonces: [{ donde: "#reloj", que: "cambia" as const }] },
  ];

  it("el guion viaja al render y sus fallos llegan al informe", async () => {
    let recibido: { behaviorProgram?: string } | undefined;
    const out = await preparePage(
      PAGE,
      { mode: "create", prueba: PRUEBA },
      deps({
        render: (async (_h: string, _i: unknown, o: { behaviorProgram?: string }) => {
          recibido = o;
          return { behaviorResult: [[0, "#reloj no cambió"]] };
        }) as never,
      }),
    );
    // El programa lleva DENTRO los pasos declarados: si se compilara vacío, la
    // prueba correría sin comprobar nada y diría que pasó.
    expect(recibido?.behaviorProgram).toContain("#empezar");
    expect(out.report.specFailures).toEqual([{ paso: 1, mensaje: "#reloj no cambió" }]);
  });

  it("una prueba que PASA no deja nada en el informe", async () => {
    const out = await preparePage(
      PAGE,
      { mode: "create", prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: [] })) as never }),
    );
    expect(out.report.specFailures).toBeUndefined();
  });

  it("sin prueba no se manda guion — se pulsa a ciegas como siempre", async () => {
    let recibido: { behaviorProgram?: string } | undefined = { behaviorProgram: "sucio" };
    const out = await preparePage(
      PAGE,
      { mode: "create" },
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
      { mode: "create", prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: "vaya" })) as never }),
    );
    expect(out.report.specFailures).toBeUndefined();
  });

  it("los fallos de la prueba se nombran en la etapa `measure`", async () => {
    const out = await preparePage(
      PAGE,
      { mode: "create", prueba: PRUEBA },
      deps({ render: (async () => ({ behaviorResult: [[0, "#reloj no cambió"]] })) as never }),
    );
    const medir = out.report.stages.find((s) => s.stage === "measure");
    expect(medir?.status).toBe("changed");
    expect(medir?.detail).toContain("prueba paso 1");
  });
});

// ── EL CABLE, NO SÓLO LA FUNCIÓN ─────────────────────────────────────────────
//
// `ensure-scroll-padding.test.ts` prueba la reparación a solas y con un
// navegador. Esto prueba que la tubería LA LLAMA — que es lo que de verdad
// estaba en duda: escrita la reparación y cableada en `beforeMeta`, desconecté
// la línea a propósito y las 188 pruebas siguieron en verde. Una guarda que no
// se entera de que le quitan el cable no guarda nada, y este repo ya lo pagó
// una vez con la poda de documentos.
describe("la tubería repara las anclas tapadas por la barra", () => {
  const CON_BARRA = `<!doctype html><html><head><style>:root{--ol-fg:#111}</style></head><body>
<header class="sticky top-0"><a href="#precios">Precios</a></header>
<section id="precios"><h2>Precios</h2></section></body></html>`;

  it("🔴 una página con barra fija y anclas sale con la reserva puesta", async () => {
    const out = await preparePage(CON_BARRA, { mode: "create" }, deps());
    expect(out.ok).toBe(true);
    expect(out.ok && out.html).toContain("scroll-padding-top");
  });

  it("y la etapa de invariantes lo DICE, no lo hace en silencio", async () => {
    const out = await preparePage(CON_BARRA, { mode: "create" }, deps());
    const inv = out.report.stages.find((s) => s.stage === "invariants");
    expect(inv?.detail).toContain("anclas=fixed");
  });

  // BRAZO DE CONTROL: una página sin barra sale intacta. Sin esto, "inyecta
  // siempre" pasaría las dos de arriba.
  it("pero una página sin barra fija no gana una regla que no necesita", async () => {
    const out = await preparePage(PAGE, { mode: "create" }, deps());
    expect(out.ok && out.html).not.toContain("scroll-padding-top");
  });
});
