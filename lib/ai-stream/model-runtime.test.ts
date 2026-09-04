import { describe, expect, it } from "vitest";


import {
  extractModelRuntime,
  MAX_RUNTIME_BYTES,
  MODEL_RUNTIME_ATTR,
  modelRuntimePromptBlock,
  RUNTIME_OP_TARGET,
  splitRuntimeOps,
  runtimeCodeFromOpPayload,
  validateRuntimeCode,
} from "./model-runtime";
import type { Op } from "@/lib/html-ops";

// ⚠️ ESTO NO ES UNA PÁGINA, y no debe serlo: `extractModelRuntime` lee el
// PAYLOAD de una op, un `<script>` suelto envuelto en lo mínimo. Una página de
// verdad lleva SIEMPRE el `<script>` de Tailwind por CDN que el contrato exige,
// y contra ella este extractor devuelve «varios» — ver la prueba del final.
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
  // INVERTIDA el 2026-08-26. Exigía el marcador `data-openlen-model-runtime`
  // para distinguir el script del modelo del resto del documento cuando había
  // que EXTRAERLO. Aquí el payload ES el script —llega en una op contra el
  // target `runtime`—, no hay nada de lo que distinguirlo, y el prompt ya no
  // se lo pide. Rechazarlo dejaba mudo un `<script>` perfectamente válido.
  it("un <script> suelto SÍ cuenta — ya no hace falta marcador", () => {
    const r = extractModelRuntime(doc(`<script>alert(1)</script>`));
    expect(r).toEqual({ ok: true, code: "alert(1)" });
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

// RETIRADO con el interruptor `OPENLEN_MODEL_JS`. Fijaba el opt-in exacto —
// sólo el literal "1" enciende, para que un valor raro no pudiera encender el
// piloto por parecerse a un sí. Ya no hay piloto que encender.
describe("el bloque de prompt", () => {
  const env = {} as unknown as NodeJS.ProcessEnv;

  // RETIRADAS con el interruptor y con el marcador: «apagado no añade ni un
  // carácter» y «encendido enseña el marcador exacto que el extractor busca».
  // Ya no hay apagado, y el extractor no busca marcador — el prompt le pide un
  // `<script>` normal, como el de cualquier página.

  it("siempre le dice que puede escribir el JavaScript de la página", () => {
    const b = modelRuntimePromptBlock();
    expect(b).toContain("INTERACCIÓN CON JAVASCRIPT");
    expect(b).toContain("<script>");
  });

  // Lo único del contrato viejo que sobrevive, y es lo que de verdad importa:
  // una página que sólo existe si su JavaScript corre está rota para quien
  // llega con el script bloqueado, y es invisible para un buscador.
  it("le dice que la página debe funcionar SIN el script", () => {
    expect(modelRuntimePromptBlock()).toMatch(/COMPLETA y legible sin el script/);
  });

  // RETIRADAS: «le prohíbe la red» y «el tope que anuncia es el que se aplica».
  // La prohibición de `fetch` la sostenía la CSP, que se va en el paso 3; el
  // tope de 32 KiB era del tamaño de una columna que ya no existe.
});
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

// ── LA TRAMPA, FIJADA ────────────────────────────────────────────────────────
//
// 🔴 POR QUÉ EXISTE ESTA PRUEBA. Hasta el 2026-09-04 TRES sitios llamaban a
// `extractModelRuntime` con la PÁGINA ENTERA —crear, el rediseño y la
// reescritura del Chat— y los tres capturaban `null` siempre, en silencio. El
// motivo es la primera aserción de aquí abajo, y ninguna prueba lo cazó porque
// los tres fixtures construían documentos SIN el `<script>` de Tailwind, o sea
// documentos que no existen: el contrato lo obliga en todas las páginas.
//
// Lo que fija esto no es un comportamiento que queramos, es un LÍMITE que hay
// que conocer antes de volver a cablearlo. Si alguien le añade el filtro que le
// falta, esta prueba cae y le manda a leer el porqué: repararlo activaría la
// rama `reemplazar`, que arranca los scripts del modelo y re-pega uno al final
// del body. Hoy nadie le mueve su script de sitio.
describe("el límite: esto lee un PAYLOAD, no una página", () => {
  const paginaDeVerdad = (js: string) =>
    `<!doctype html><html><head><title>x</title>` +
    `<script src="https://cdn.tailwindcss.com"></script>` +
    `</head><body><h1>hola</h1><script>${js}</script></body></html>`;

  it("contra una página real DESCARTA el código, porque cuenta el script de Tailwind", () => {
    const r = extractModelRuntime(paginaDeVerdad("var a = 1;"));
    expect(r).toEqual({ ok: false, reason: "varios" });
  });

  it("y quien SÍ sabe leer una página entera es `todoElJsDelDocumento`", async () => {
    // La función que excluye la infraestructura (el `<script src>` del CDN y
    // los carriers `data-ol-*`). Existía ya; el extractor no la usaba.
    const { todoElJsDelDocumento } = await import("@/lib/page-engine/conservar-scripts");
    expect(todoElJsDelDocumento(paginaDeVerdad("var a = 1;")).trim()).toBe("var a = 1;");
  });
});
