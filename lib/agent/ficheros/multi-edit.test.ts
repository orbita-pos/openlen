import { describe, expect, it } from "vitest";
import { CAMBIADO_DESDE_LA_LECTURA, NO_LEIDO, NOTA_CAMBIADO_EN_DISCO, NOTA_ESTADO_AL_DIA } from "./edit";
import { MANUAL_SOLO_LECTURA } from "./manual";
import { MAX_MULTI_EDITS, coercerEntradaMultiEdit, planearMultiEdit } from "./multi-edit";
import { normalizarFinales, type Leidos, type SitioLegible } from "./read";

function makeSite(files: Record<string, string>): SitioLegible {
  return {
    ficheros: Object.keys(files),
    contenido: (ruta) => (Object.hasOwn(files, ruta) ? files[ruta]! : null),
  };
}

function makeLeidos(files: Record<string, string>, partial = false): Leidos {
  return new Map(
    Object.entries(files).map(([ruta, contenido]) => [
      ruta,
      { instantanea: normalizarFinales(contenido), offset: partial ? 1 : undefined, limit: partial ? 5 : undefined, ...(partial ? { vistaParcial: true } : {}) },
    ]),
  );
}

describe("planearMultiEdit", () => {
  it("applies multiple sequential edits atomically in one call", () => {
    const initial = [
      'import { useState } from "react";',
      "export function App() {",
      '  const title = "Old Title";',
      '  const price = "$10";',
      "  return <main><h1>{title}</h1><p>{price}</p></main>;",
      "}",
    ].join("\n");
    const sitio = makeSite({ "/src/App.tsx": initial });
    const leidos = makeLeidos({ "/src/App.tsx": initial });

    const plan = planearMultiEdit(
      {
        file_path: "/src/App.tsx",
        edits: [
          { old_string: 'const title = "Old Title";', new_string: 'const title = "New Title";' },
          { old_string: 'const price = "$10";', new_string: 'const price = "$25";' },
          { old_string: "<main>", new_string: '<main className="p-6">' },
        ],
      },
      sitio,
      leidos,
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.crea).toBe(false);
    expect(plan.contenido).toContain('const title = "New Title";');
    expect(plan.contenido).toContain('const price = "$25";');
    expect(plan.contenido).toContain('<main className="p-6">');
    expect(plan.respuesta({ guardadoIgual: true })).toBe(
      `Edited /src/App.tsx (3 edits applied).${NOTA_ESTADO_AL_DIA}`,
    );
  });

  it("lets later edits see the result of earlier edits", () => {
    const initial = "const status = 'draft';\n";
    const plan = planearMultiEdit(
      {
        file_path: "/src/state.ts",
        edits: [
          { old_string: "'draft'", new_string: "'review'" },
          { old_string: "const status = 'review';", new_string: "export const status = 'published';" },
        ],
      },
      makeSite({ "/src/state.ts": initial }),
      makeLeidos({ "/src/state.ts": initial }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.contenido).toBe("export const status = 'published';\n");
  });

  it("is strictly atomic: failure on edit #2 returns ok:false naming edit #2 without partial output", () => {
    const initial = "const a = 1;\nconst b = 2;\n";
    const plan = planearMultiEdit(
      {
        file_path: "/src/nums.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 10;" },
          { old_string: "const c = 3;", new_string: "const c = 30;" },
        ],
      },
      makeSite({ "/src/nums.ts": initial }),
      makeLeidos({ "/src/nums.ts": initial }),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.resultado.error).toContain("edit #2 of 2");
    expect(plan.resultado.error).toContain("no changes were saved");
    expect(plan.resultado.error).toContain("old_string is not in the file");
  });

  it("enforces read-before-edit, platform manual guard, CRLF preservation, and replace_all", () => {
    const crlf = "line = foo;\r\nother = foo;\r\n";

    // Unread file refused
    const unread = planearMultiEdit(
      { file_path: "/src/x.ts", edits: [{ old_string: "foo", new_string: "bar", replace_all: true }] },
      makeSite({ "/src/x.ts": crlf }),
      new Map(),
    );
    expect(unread.ok).toBe(false);
    if (!unread.ok) expect(unread.resultado.error).toContain(NO_LEIDO);

    // Platform manual refused
    const manual = planearMultiEdit(
      { file_path: "/AGENTS.md", edits: [{ old_string: "a", new_string: "b" }] },
      makeSite({ "/AGENTS.md": "a" }),
      makeLeidos({ "/AGENTS.md": "a" }),
    );
    expect(manual.ok).toBe(false);
    if (!manual.ok) expect(manual.resultado.error).toContain(MANUAL_SOLO_LECTURA);

    // CRLF preserved + replace_all supported
    const ok = planearMultiEdit(
      {
        file_path: "/src/x.ts",
        edits: [
          { old_string: "foo", new_string: "bar", replace_all: true },
          { old_string: "other = bar;", new_string: "other = baz;" },
        ],
      },
      makeSite({ "/src/x.ts": crlf }),
      makeLeidos({ "/src/x.ts": crlf }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.contenido).toBe("line = bar;\r\nother = baz;\r\n");
  });

  it("handles disk drift since Read the same way as Edit", () => {
    const readContent = "const a = 1;\nconst b = 2;\n";
    const diskContent = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const ok = planearMultiEdit(
      {
        file_path: "/src/x.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 10;" },
          { old_string: "const b = 2;", new_string: "const b = 20;" },
        ],
      },
      makeSite({ "/src/x.ts": diskContent }),
      makeLeidos({ "/src/x.ts": readContent }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.respuesta({ guardadoIgual: true })).toContain(NOTA_CAMBIADO_EN_DISCO);

    const conflict = planearMultiEdit(
      { file_path: "/src/x.ts", edits: [{ old_string: "const a = 1;", new_string: "const a = 10;" }] },
      makeSite({ "/src/x.ts": "const a = 999;\n" }),
      makeLeidos({ "/src/x.ts": readContent }),
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.resultado.error).toContain(CAMBIADO_DESDE_LA_LECTURA);
  });

  it("rejects empty edits, invalid shapes, cancelling edits, and exceeding MAX_MULTI_EDITS", () => {
    const sitio = makeSite({ "/src/a.ts": "a\n" });
    const leidos = makeLeidos({ "/src/a.ts": "a\n" });

    expect(planearMultiEdit(coercerEntradaMultiEdit({ file_path: "/src/a.ts" }), sitio, leidos).ok).toBe(false);
    expect(planearMultiEdit({ file_path: "/src/a.ts", edits: [] }, sitio, leidos).ok).toBe(false);

    const tooMany = Array.from({ length: MAX_MULTI_EDITS + 1 }, () => ({ old_string: "a", new_string: "b" }));
    const over = planearMultiEdit({ file_path: "/src/a.ts", edits: tooMany }, sitio, leidos);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.resultado.error).toContain(String(MAX_MULTI_EDITS));

    const cancel = planearMultiEdit(
      {
        file_path: "/src/a.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "b", new_string: "a" },
        ],
      },
      sitio,
      leidos,
    );
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.resultado.error).toContain("cancel out");
  });

  it("coerces alias parameter names (path, old_str, new_str, replace_name)", () => {
    const coerced = coercerEntradaMultiEdit({
      path: "/src/a.ts",
      edits: [{ old_str: "x", new_str: "y", replace_name: "true" }],
    });
    expect(coerced).toEqual({
      file_path: "/src/a.ts",
      edits: [{ old_string: "x", new_string: "y", replace_all: true }],
    });
  });
});
