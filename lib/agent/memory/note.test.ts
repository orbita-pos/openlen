import { describe, expect, it } from "vitest";
import { buildMemoryIndex, parseNote, serializeNote, type MemoryNote } from "./note";

const NOTA: MemoryNote = {
  name: "hero-oscuro-rechazado",
  description: "El dueño rechazó el hero oscuro (2026-10-08)",
  type: "feedback",
  body: "No uses fondo oscuro en el hero.\n\n**Why:** dice que su marca es clara.\n**How to apply:** heros claros.",
};

describe("la nota de memoria", () => {
  it("ida y vuelta", () => {
    expect(parseNote(serializeNote(NOTA), NOTA.name)).toEqual({ ok: true, note: NOTA });
  });

  it("acepta CRLF", () => {
    expect(parseNote(serializeNote(NOTA).replace(/\n/g, "\r\n"), NOTA.name)).toEqual({ ok: true, note: NOTA });
  });

  it("rechaza lo que no es una nota, diciendo la plantilla", () => {
    const r = parseNote("sólo texto", NOTA.name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/---\nname: hero-oscuro-rechazado\ndescription:/);
  });

  it("el name tiene que ser el del fichero", () => {
    expect(parseNote(serializeNote({ ...NOTA, name: "otro" }), NOTA.name).ok).toBe(false);
  });

  it("tipo user no: eso va en ~/.len/LEN.md", () => {
    const r = parseNote(serializeNote(NOTA).replace("type: feedback", "type: user"), NOTA.name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/~\/\.len\/LEN\.md/);
  });

  it("topes y credenciales", () => {
    expect(parseNote(serializeNote({ ...NOTA, description: "x".repeat(151) }), NOTA.name).ok).toBe(false);
    expect(parseNote(serializeNote({ ...NOTA, body: "x".repeat(2_001) }), NOTA.name).ok).toBe(false);
    expect(parseNote(serializeNote({ ...NOTA, body: "token sk-proj-abcdefghijklmnopqrstuv123" }), NOTA.name).ok).toBe(false);
  });
});

describe("MEMORY.md, generado", () => {
  it("una línea por nota, en el orden dado", () => {
    const i = buildMemoryIndex([NOTA, { name: "form-a-correo", description: "El formulario manda a su correo", type: "project" }], 4_000);
    expect(i).toBe(
      "# Memory index — generated from the notes in /.len/memory/, read-only\n" +
        "- [hero-oscuro-rechazado](hero-oscuro-rechazado.md) (feedback) — El dueño rechazó el hero oscuro (2026-10-08)\n" +
        "- [form-a-correo](form-a-correo.md) (project) — El formulario manda a su correo\n",
    );
  });
  it("sin notas, vacío", () => {
    expect(buildMemoryIndex([], 4_000)).toBe("");
  });
  it("si no cabe, corta y dice cuántas faltan", () => {
    const muchas = Array.from({ length: 50 }, (_, n) => ({ name: `nota-${n}`, description: "d".repeat(100), type: "project" as const }));
    const i = buildMemoryIndex(muchas, 1_000);
    expect(i.length).toBeLessThanOrEqual(1_000);
    expect(i).toMatch(/…and \d+ more: ls -a \/\.len\/memory/);
  });
});
