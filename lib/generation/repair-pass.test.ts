import { describe, expect, it, vi } from "vitest";

import { repairGeneratedPage } from "./repair-pass";
import { tagWithOpIds } from "@/lib/html-ops";

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reloj</title>
<style>.anillo .aro{stroke:#b3472f;fill:none}</style></head>
<body><h1>Reloj</h1><div class="caja"><svg viewBox="0 0 100 100"><circle class="aro" r="45"/></svg></div>
<p>texto que no se toca</p></body></html>`;

const DEFECTOS = ['el selector `.anillo .aro` no aplica NUNCA: falta class="anillo"'];

/** Un modelo de mentira que devuelve las ops que se le den. */
const responde = (raw: string) =>
  vi.fn(async () => ({ ok: true as const, raw, usage: { inputTokens: 10, outputTokens: 5 } }));

/** El `data-op-id` de un elemento del documento ya etiquetado. */
const opIdDe = (etiqueta: string) => {
  const { taggedHtml } = tagWithOpIds(PAGINA);
  return new RegExp(`<${etiqueta}[^>]*\\bdata-op-id="([^"]+)"`).exec(taggedHtml)?.[1] ?? "";
};

describe("repairGeneratedPage", () => {
  it("aplica una edición quirúrgica y NO toca el resto", async () => {
    const id = opIdDe("div");
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "un reloj" },
      { call: responde(`<edits><edit target="${id}" op="replace"><div class="caja anillo"><svg viewBox="0 0 100 100"><circle class="aro" r="45"/></svg></div></edit></edits>`) as never },
    );
    expect(out.ok).toBe(true);
    expect(out.html).toContain('class="caja anillo"');
    // Lo que no se nombró sigue ahí, byte a byte. Es la propiedad que una
    // reescritura completa NO puede garantizar.
    expect(out.html).toContain("<p>texto que no se toca</p>");
    expect(out.html).toContain("<title>Reloj</title>");
  });

  it("NUNCA deja data-op-id en el documento reparado", async () => {
    const id = opIdDe("h1");
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: responde(`<edits><edit target="${id}" op="replace"><h1>Otro</h1></edit></edits>`) as never },
    );
    expect(out.ok).toBe(true);
    expect(out.html).not.toContain("data-op-id");
  });

  it("un edit contra la RAÍZ no puede reemplazar la página", async () => {
    // La guarda que este módulo existe para no perder: apuntar al <body> es
    // exactamente la reescritura completa que estamos evitando.
    const id = opIdDe("body");
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: responde(`<edits><edit target="${id}" op="replace"><body><p>toda otra</p></body></edit></edits>`) as never },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("ops_no_aplicables");
  });

  it("repara el JavaScript por su objetivo reservado", async () => {
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: "var x = 1; null.y;", defectos: ["el JavaScript falla: null.y"], brief: "x" },
      { call: responde(`<edits><edit target="runtime" op="replace">var x = 1;</edit></edits>`) as never },
    );
    expect(out.ok).toBe(true);
    expect(out.runtime).toBe("var x = 1;");
  });

  it("añade CSS por `styles` sin tocar el markup", async () => {
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: responde(`<edits><edit target="styles" op="insert_after">.caja{background:#fff}</edit></edits>`) as never },
    );
    expect(out.ok).toBe(true);
    expect(out.html).toContain(".caja{background:#fff}");
    expect(out.html).toContain("<p>texto que no se toca</p>");
  });

  it("conserva el runtime que ya había cuando la reparación no lo toca", async () => {
    const id = opIdDe("h1");
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: "console.log(1);", defectos: DEFECTOS, brief: "x" },
      { call: responde(`<edits><edit target="${id}" op="replace"><h1>Otro</h1></edit></edits>`) as never },
    );
    expect(out.runtime).toBe("console.log(1);");
  });
});

describe("cuando no hay nada que aplicar, se cae a la reescritura", () => {
  // Todos estos devuelven ok:false, y la ruta interpreta eso como «reescribe»,
  // que es exactamente el comportamiento de antes de que esto existiera.
  it("sin defectos ni se llama al modelo", async () => {
    const call = responde("<edits></edits>");
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: [], brief: "x" },
      { call: call as never },
    );
    expect(out.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("una respuesta sin ops", async () => {
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: responde("lo siento, no sé arreglarlo") as never },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("sin_ops");
  });

  it("un fallo del proveedor", async () => {
    const out = await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: (async () => ({ ok: false as const, kind: "api" as const, message: "503" })) as never },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("503");
  });

  it("un documento sin elementos direccionables", async () => {
    const call = responde("<edits></edits>");
    const out = await repairGeneratedPage(
      { html: "", runtime: null, defectos: DEFECTOS, brief: "x" },
      { call: call as never },
    );
    expect(out.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("lo que se le enseña al modelo", () => {
  it("su propio JavaScript viaja FUERA del documento — sin verlo, lo re-inventa", async () => {
    let user = "";
    await repairGeneratedPage(
      { html: PAGINA, runtime: "const contador = 0;", defectos: DEFECTOS, brief: "un reloj de enfoque" },
      { call: (async (a: { user: string }) => { user = a.user; return { ok: true as const, raw: "<edits></edits>" }; }) as never },
    );
    expect(user).toContain("const contador = 0;");
    expect(user).toContain('target="runtime"');
    // Y los defectos MEDIDOS, que son la única instrucción real del turno.
    expect(user).toContain(".anillo .aro");
    expect(user).toContain("un reloj de enfoque");
  });
});
