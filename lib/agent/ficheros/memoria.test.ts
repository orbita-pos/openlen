import { describe, expect, it } from "vitest";
import { memoriaSembrada } from "./memoria";

describe("la memoria como ficheros: lo que ya va en el contexto cuenta como leído", () => {
  it("siembra ~/.len/LEN.md y /LEN.md, y el índice sólo si existe", () => {
    const sin = memoriaSembrada({ personal: "Háblame de tú.", project: null, index: null });
    expect([...sin.keys()]).toEqual(["/home/user/.len/LEN.md", "/LEN.md"]);
    expect(sin.get("/home/user/.len/LEN.md")?.instantanea).toBe("Háblame de tú.");
    expect(sin.get("/LEN.md")?.instantanea).toBe("");
    const con = memoriaSembrada({ personal: null, project: "Tono formal.", index: "# Memory index\n- [a](a.md) (project) — b\n" });
    expect([...con.keys()]).toEqual(["/home/user/.len/LEN.md", "/LEN.md", "/.len/memory/MEMORY.md"]);
  });
});
