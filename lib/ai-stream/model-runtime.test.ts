import { describe, expect, it } from "vitest";

import {
  extractModelRuntime,
  modelJsEnabled,
  MAX_RUNTIME_BYTES,
  MODEL_RUNTIME_ATTR,
  currentRuntimePromptBlock,
  modelRuntimePromptBlock,
  RUNTIME_OP_TARGET,
  splitRuntimeOps,
  runtimeCodeFromOpPayload,
  validateRuntimeCode,
} from "./model-runtime";
import type { Op } from "@/lib/html-ops";

const doc = (cuerpo: string) =>
  `<!doctype html><html><head><title>x</title></head><body><h1>hola</h1>${cuerpo}</body></html>`;

const runtime = (code: string, attrs = "") =>
  `<script ${MODEL_RUNTIME_ATTR}${attrs}>${code}</script>`;

describe("lo que se acepta", () => {
  it("un script marcado, inline y clásico", () => {
    const r = extractModelRuntime(doc(runtime(`document.title = "vivo";`)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toBe(`document.title = "vivo";`);
  });

  // El hash de la Etapa 2 se calcula sobre estos bytes. Un trim, una
  // normalización o una reserialización aquí lo romperían sin que nadie lo vea.
  it("devuelve los bytes EXACTOS, sin recortar ni normalizar", () => {
    const code = `\n  const x = 1;\n  \n  console.log(x);\n`;
    const r = extractModelRuntime(doc(runtime(code)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toBe(code);
  });

  it("un `type` clásico explícito no molesta", () => {
    const r = extractModelRuntime(doc(runtime("var a=1;", ' type="text/javascript"')));
    expect(r.ok).toBe(true);
  });
});

describe("lo que se rechaza, y por qué", () => {
  it("sin marcador no hay runtime — un script suelto NO cuenta", () => {
    const r = extractModelRuntime(doc(`<script>alert(1)</script>`));
    expect(r).toEqual({ ok: false, reason: "ausente" });
  });

  // No se fusionan: no sabríamos en qué orden los quiso el modelo, y adivinarlo
  // es inventar código que nadie escribió.
  it("varios runtimes no se fusionan", () => {
    const r = extractModelRuntime(doc(runtime("var a=1;") + runtime("var b=2;")));
    expect(r).toEqual({ ok: false, reason: "varios" });
  });

  it("con src apunta a otra petición: fuera", () => {
    const r = extractModelRuntime(doc(runtime("", ' src="https://cdn.example.com/x.js"')));
    expect(r).toEqual({ ok: false, reason: "con_src" });
  });

  it("un módulo trae imports, y eso es red", () => {
    const r = extractModelRuntime(doc(runtime("var a=1;", ' type="module"')));
    expect(r).toEqual({ ok: false, reason: "modulo" });
  });

  it("vacío no es un runtime", () => {
    const r = extractModelRuntime(doc(runtime("   \n  ")));
    expect(r).toEqual({ ok: false, reason: "vacio" });
  });

  it("pasado de tamaño se corta en seco, no se recorta", () => {
    const r = extractModelRuntime(doc(runtime("//" + "x".repeat(MAX_RUNTIME_BYTES))));
    expect(r).toEqual({ ok: false, reason: "demasiado_grande" });
  });

  // `publishToDir` rechaza el documento entero si ve `data-slot-path`. Dentro de
  // un string de JavaScript es como se colaría sin que el sanitizador lo viera.
  it("un marcador de editor escondido en el código", () => {
    const r = extractModelRuntime(doc(runtime(`el.setAttribute("data-slot-path", "x");`)));
    expect(r).toEqual({ ok: false, reason: "marcador_de_editor" });
  });

  // Compila SIN ejecutar. Descubrir esto en la página del visitante en vez de
  // aquí es la diferencia entre un rechazo y una página rota.
  it("un código que no compila no se guarda", () => {
    const r = extractModelRuntime(doc(runtime("function ( {{{ ")));
    expect(r).toEqual({ ok: false, reason: "sintaxis" });
  });

  it("y comprobar la sintaxis NO ejecuta nada", () => {
    const centinela = { tocado: false };
    (globalThis as unknown as { __centinela: typeof centinela }).__centinela = centinela;
    const r = extractModelRuntime(doc(runtime(`globalThis.__centinela.tocado = true;`)));
    expect(r.ok).toBe(true);
    expect(centinela.tocado, "el código se EJECUTÓ al validarlo").toBe(false);
  });
});

/**
 * `pageAllowsRuntime` SE QUITÓ el 2026-08-21 y aquí vivían sus pruebas.
 *
 * Descalificaba la página entera si el HTML traía un `<form>` o el marcador de
 * un módulo. Medido: 1 de cada 6 páginas corrientes perdía su JavaScript EN
 * SILENCIO por llevar un formulario de contacto. Jesús: «no debe tirar el JS si
 * hay módulos, prefiero que los módulos los hagamos diferente a eso».
 *
 * NO se re-introduce sin quitar antes la puerta de producción que la sustituye
 * (memoria `model-js-production-gate`). Esta prueba existe para que reinstalarla
 * sea una decisión visible y no un parche silencioso.
 */
describe("ninguna forma del documento descalifica ya a la página", () => {
  it("el módulo de ingestión ya no exporta una puerta de elegibilidad", async () => {
    const mod = await import("./model-runtime");
    expect(Object.keys(mod)).not.toContain("pageAllowsRuntime");
  });
});

/** Una variable mal escrita no puede encender esto por accidente. */
describe("el interruptor es exacto", () => {
  it("sólo 1 lo enciende", () => {
    expect(modelJsEnabled({ OPENLEN_MODEL_JS: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it.each(["0", "", "true", "yes", "on", " 1", undefined])("%s NO lo enciende", (v) => {
    expect(modelJsEnabled({ ...(v === undefined ? {} : { OPENLEN_MODEL_JS: v }) } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("el bloque de prompt", () => {
  const on = { OPENLEN_MODEL_JS: "1" } as unknown as NodeJS.ProcessEnv;
  const off = {} as unknown as NodeJS.ProcessEnv;

  // Apagado tiene que costar CERO tokens: si no, cada generación normal pagaría
  // por una capacidad que no puede usar.
  it("apagado no añade ni un carácter", () => {
    expect(modelRuntimePromptBlock(off)).toBe("");
  });

  it("encendido enseña el marcador exacto que el extractor busca", () => {
    const b = modelRuntimePromptBlock(on);
    expect(b).toContain(MODEL_RUNTIME_ATTR);
    // Si el prompt dijera un marcador y el extractor buscara otro, el modelo
    // haría su trabajo bien y nosotros tiraríamos el resultado en silencio.
    const r = extractModelRuntime(`<body><script ${MODEL_RUNTIME_ATTR}>var a=1;</script></body>`);
    expect(r.ok).toBe(true);
  });

  it("le dice que la página debe funcionar SIN el script", () => {
    const b = modelRuntimePromptBlock(on);
    expect(b).toMatch(/COMPLETA y legible sin el script/);
    // Y el corolario que faltaba: esconder contenido en CSS para revelarlo desde
    // el script convierte "se descartó el runtime" en "la página llegó vacía".
    expect(b).toMatch(/escondas contenido con CSS/);
  });

  it("le prohíbe la red, que es justo lo que la CSP bloquea", () => {
    const b = modelRuntimePromptBlock(on);
    for (const p of ["fetch", "WebSocket", "Worker"]) expect(b).toContain(p);
  });

  it("el tope que anuncia es el que se aplica", () => {
    expect(modelRuntimePromptBlock(on)).toContain(`${MAX_RUNTIME_BYTES / 1024} KiB`);
  });
});

/**
 * EL CÓDIGO QUE LA PÁGINA YA TIENE.
 *
 * El fallo que esto cierra: `data.html` se guarda saneado, así que el documento
 * que viajaba al modelo NO llevaba el script. Pedirle «arregla el bug del juego»
 * era pedirle reparar algo invisible, y RE-CREABA la funcionalidad desde cero.
 */
describe("currentRuntimePromptBlock", () => {
  const codigo = "document.getElementById('x').addEventListener('click', () => {});";

  it("sin código no gasta ni un token", () => {
    expect(currentRuntimePromptBlock("")).toBe("");
    expect(currentRuntimePromptBlock("   \n  ")).toBe("");
  });

  it("lleva el código TAL CUAL — reparar exige ver los bytes exactos", () => {
    expect(currentRuntimePromptBlock(codigo)).toContain(codigo);
  });

  it("explica por qué no está en el documento de arriba", () => {
    expect(currentRuntimePromptBlock(codigo)).toMatch(/does NOT appear in the document/);
  });

  // Antes esto decía «Mode A ops cannot reach it», y era verdad: `script` está
  // en SKIP_TAGS y no tiene `data-op-id`. MEDIDO el 22/08: el modelo leyó el
  // aviso, lo parafraseó bien y emitió Modo A igual — el usuario vio «ya lo
  // arreglé» sobre una página intacta. Ahora el camino barato SÍ llega, por un
  // objetivo reservado, y lo que se le enseña es cómo usarlo.
  it("le da el objetivo reservado para cambiar el comportamiento", () => {
    const b = currentRuntimePromptBlock(codigo);
    expect(b).toMatch(/TO CHANGE THE BEHAVIOUR/);
    expect(b).toContain(RUNTIME_OP_TARGET);
    expect(b).toMatch(/<edit op="replace" target="runtime">/);
  });

  // El Agente no habla el sobre XML: llama a `editar_pagina` con un array JSON.
  // Enseñarle el ejemplo en XML le haría copiar una sintaxis que su superficie
  // no acepta.
  it("adapta el ejemplo al sobre de cada superficie", () => {
    const tool = currentRuntimePromptBlock(codigo, "tool");
    expect(tool).toContain('"target": "runtime"');
    expect(tool).not.toMatch(/<edits>/);

    // El rediseño siempre emite un documento entero: no tiene camino barato,
    // así que no debe ofrecerle un objetivo de op que su superficie no acepta.
    // (No se puede aserir `not.toContain("runtime")` a secas: el marcador
    // `data-openlen-model-runtime` lleva la palabra dentro.)
    const doc = currentRuntimePromptBlock(codigo, "documento");
    expect(doc).not.toMatch(/target="runtime"/);
    expect(doc).not.toMatch(/reserved target/);
    expect(doc).toMatch(/your rewrite must include/);
  });

  // HALLAZGO 3. De nada sirve aceptar `op="delete"` si el modelo no sabe que
  // existe: sería una capacidad a oscuras. «Quita el carrito» tiene que tener
  // una forma que el modelo pueda escribir.
  it("le enseña CÓMO retirar el comportamiento, no sólo cómo cambiarlo", () => {
    const xml = currentRuntimePromptBlock(codigo);
    expect(xml).toMatch(/TO REMOVE THE BEHAVIOUR ALTOGETHER/);
    expect(xml).toMatch(/<edit op="delete" target="runtime"\/>/);

    const tool = currentRuntimePromptBlock(codigo, "tool");
    expect(tool).toContain('"op": "delete"');
    expect(tool).not.toMatch(/<edits>/);
  });

  // Y NO se lo promete a quien no puede hacerlo. El rediseño emite un documento
  // entero, sin ops: enseñarle una tecla que su superficie no tiene le haría
  // decirle al usuario que lo quitó.
  it("al rediseño le dice que ahí NO se puede retirar, en vez de ofrecérselo", () => {
    const doc = currentRuntimePromptBlock(codigo, "documento");
    expect(doc).not.toMatch(/op="delete"/);
    expect(doc).toMatch(/not something this surface can do/);
  });

  // La prosa del modelo es lo único que el usuario lee. Que no pueda decir
  // «arreglado» sin haber tocado el código es la mitad barata del arreglo.
  it("le prohíbe cantar victoria sin tocar el código", () => {
    expect(currentRuntimePromptBlock(codigo)).toMatch(/NEVER tell the user you fixed the behaviour/);
  });

  // `resealRuntime` re-ata el código VIEJO a cualquier html nuevo. Una
  // reescritura sin script no borra la conducta: la deja apuntando a elementos
  // que la reescritura pudo haber eliminado.
  it("avisa de que omitir el script NO lo borra", () => {
    expect(currentRuntimePromptBlock(codigo)).toMatch(/Omitting it does NOT clear/);
  });

  it("marca el bloque para que el modelo lo devuelva reconocible", () => {
    expect(currentRuntimePromptBlock(codigo)).toContain(MODEL_RUNTIME_ATTR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El runtime como objetivo de op. Nace de un fallo MEDIDO: el modelo
// diagnosticó un bug de comportamiento, dijo «I'll fix the runtime script», y
// emitió ops de Modo A — que no podían tocar el script. Cero cambios, y el
// usuario leyendo «ya lo arreglé».

const op = (o: Partial<Op>): Op =>
  ({ type: "replace", target: "a1", newHtml: "<p>x</p>", ...o }) as Op;

describe("splitRuntimeOps", () => {
  it("deja pasar intactas las ops de maquetación", () => {
    const ops = [op({ target: "a1" }), op({ target: "b2" })];
    const r = splitRuntimeOps(ops);
    expect(r.domOps).toHaveLength(2);
    expect(r.runtime.kind).toBe("ninguna");
  });

  it("aparta la op del runtime y saca su código", () => {
    const ops = [
      op({ target: "a1" }),
      op({ target: RUNTIME_OP_TARGET, newHtml: `<script ${MODEL_RUNTIME_ATTR}>const x = 1;</script>` }),
    ];
    const r = splitRuntimeOps(ops);
    // Lo importante: el aplicador NUNCA la ve. `runtime` no es un data-op-id y
    // haría fallar la tanda entera.
    expect(r.domOps).toHaveLength(1);
    expect(r.domOps[0]!.target).toBe("a1");
    expect(r.runtime).toEqual({ kind: "codigo", code: "const x = 1;" });
  });

  it("acepta el código pelado, sin <script> alrededor", () => {
    const r = splitRuntimeOps([op({ target: RUNTIME_OP_TARGET, newHtml: "document.title = 'ok';" })]);
    expect(r.runtime).toEqual({ kind: "codigo", code: "document.title = 'ok';" });
  });

  it("rechaza dos ops de runtime en vez de adivinar el orden", () => {
    const dos = [
      op({ target: RUNTIME_OP_TARGET, newHtml: "const a = 1;" }),
      op({ target: RUNTIME_OP_TARGET, newHtml: "const b = 2;" }),
    ];
    expect(splitRuntimeOps(dos).runtime).toEqual({ kind: "error", reason: "varias" });
  });

  // Esta prueba PEDÍA que `delete` fuera un error. Describía una verdad que
  // caducó el 25/08: era el hueco del hallazgo 3 —«HOY NO HAY NINGUNA FORMA de
  // quitarle el JavaScript a una página»— convertido en requisito.
  it("insertar un blob de código no significa nada; borrarlo SÍ", () => {
    for (const t of ["insert_before", "insert_after"] as const) {
      const r = splitRuntimeOps([op({ type: t, target: RUNTIME_OP_TARGET, newHtml: "const a = 1;" })]);
      expect(r.runtime).toEqual({ kind: "error", reason: "op_no_soportada" });
    }
  });

  it("un `delete` contra el runtime QUITA el JavaScript de la página", () => {
    const r = splitRuntimeOps([
      op({ type: "delete", target: RUNTIME_OP_TARGET, newHtml: "" }),
      op({ target: "a1", newHtml: "<p>hola</p>" }),
    ]);
    expect(r.runtime).toEqual({ kind: "borrar" });
    // Y la op de maquetación del mismo turno sigue su camino.
    expect(r.domOps).toHaveLength(1);
    expect(r.domOps[0]!.target).toBe("a1");
  });

  // CONTRA-PRUEBA: aceptar `delete` no puede convertir un payload truncado en
  // un borrado. Un `replace` vacío es muchísimo más probable que sea una
  // respuesta cortada que una intención de quitar el script.
  it("CONTRA-PRUEBA: un replace VACÍO sigue siendo error, no un borrado", () => {
    const r = splitRuntimeOps([op({ target: RUNTIME_OP_TARGET, newHtml: "" })]);
    expect(r.runtime).toEqual({ kind: "error", reason: "vacio" });
  });

  // CONTRA-PRUEBA: el objetivo reservado es el ÚNICO que se aparta. Un `delete`
  // contra un elemento de verdad sigue siendo una op de maquetación normal.
  it("CONTRA-PRUEBA: un delete contra un elemento normal no se aparta", () => {
    const r = splitRuntimeOps([op({ type: "delete", target: "a7", newHtml: "" })]);
    expect(r.runtime).toEqual({ kind: "ninguna" });
    expect(r.domOps).toHaveLength(1);
  });

  it("rechaza código que no compila — el mismo listón que al crear", () => {
    const r = splitRuntimeOps([op({ target: RUNTIME_OP_TARGET, newHtml: "const x = ;" })]);
    expect(r.runtime).toEqual({ kind: "error", reason: "sintaxis" });
  });

  it("rechaza el marcador de modo editor escondido en un string", () => {
    const r = splitRuntimeOps([
      op({ target: RUNTIME_OP_TARGET, newHtml: `const s = "data-slot-path";` }),
    ]);
    expect(r.runtime).toEqual({ kind: "error", reason: "marcador_de_editor" });
  });

  it("con el runtime roto NO se lleva por delante el resto de la edición", () => {
    const ops = [op({ target: "a1" }), op({ target: RUNTIME_OP_TARGET, newHtml: "const x = ;" })];
    const r = splitRuntimeOps(ops);
    expect(r.runtime.kind).toBe("error");
    expect(r.domOps).toHaveLength(1);
  });

  it("un turno de SOLO comportamiento es válido: cero ops de maquetación", () => {
    const r = splitRuntimeOps([op({ target: RUNTIME_OP_TARGET, newHtml: "const x = 1;" })]);
    expect(r.domOps).toHaveLength(0);
    expect(r.runtime.kind).toBe("codigo");
  });
});

describe("validateRuntimeCode / runtimeCodeFromOpPayload", () => {
  it("las dos vías aplican EXACTAMENTE las mismas reglas", () => {
    // Un código que se rechaza al crear y se acepta al editar sería una puerta
    // trasera con dos llaves.
    const malo = "a".repeat(MAX_RUNTIME_BYTES + 1);
    expect(validateRuntimeCode(malo).ok).toBe(false);
    expect(runtimeCodeFromOpPayload(malo).ok).toBe(false);
    expect(runtimeCodeFromOpPayload(`<script ${MODEL_RUNTIME_ATTR}>${malo}</script>`).ok).toBe(false);
  });

  it("un script con src no cuela por la vía de las ops", () => {
    const r = runtimeCodeFromOpPayload(`<script ${MODEL_RUNTIME_ATTR} src="https://x.com/a.js"></script>`);
    expect(r).toEqual({ ok: false, reason: "con_src" });
  });

  it("el JavaScript con < > && sobrevive entero (el parser de ops es regex, no XML)", () => {
    const js = "for (let i = 0; i < 10 && i > -1; i++) { console.log(i & 1); }";
    expect(runtimeCodeFromOpPayload(js)).toEqual({ ok: true, code: js });
  });
});
