import { describe, expect, it } from "vitest";

import {
  extractModelRuntime,
  modelJsEnabled,
  pageAllowsRuntime,
  MAX_RUNTIME_BYTES,
  MODEL_RUNTIME_ATTR,
  modelRuntimePromptBlock,
} from "./model-runtime";

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

describe("qué página puede llevarlo", () => {
  it("una de presentación, sí", () => {
    expect(pageAllowsRuntime(doc("<p>texto</p>"))).toBe(true);
  });

  // Las superficies con datos de un visitante quedan fuera del piloto: mientras
  // el runtime no esté contenido, el script comparte origen con esas APIs y la
  // cookie del miembro viaja sola en cada fetch.
  it("con formulario, no", () => {
    expect(pageAllowsRuntime(doc(`<form><input name="email"></form>`))).toBe(false);
  });

  it.each(["bookings", "collection", "members", "orders", "chat", "comments"])(
    "con módulo de %s, tampoco",
    (m) => {
      expect(pageAllowsRuntime(doc(`<section data-ol-${m}-section></section>`))).toBe(false);
    },
  );
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
    expect(b).toMatch(/COMPLETA y legible sin él/);
  });

  it("le prohíbe la red, que es justo lo que la CSP bloquea", () => {
    const b = modelRuntimePromptBlock(on);
    for (const p of ["fetch", "WebSocket", "Worker"]) expect(b).toContain(p);
  });

  it("el tope que anuncia es el que se aplica", () => {
    expect(modelRuntimePromptBlock(on)).toContain(`${MAX_RUNTIME_BYTES / 1024} KiB`);
  });
});
