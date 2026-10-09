import { describe, expect, it } from "vitest";
import { buildAgentContext } from "./context";

// El formateador vive en context.ts (puro, sin base) — ver la nota en
// user-memory.ts. Esto cubre lo que el MODELO acaba leyendo.

const base = {
  now: new Date("2026-08-22T12:00:00Z"),
  state: { titulo: "x", publicado: false },
};

describe("la memoria de la persona en el contexto", () => {
  // Sin memoria, el contexto tiene que salir BYTE A BYTE como antes de que esto
  // existiera: nadie paga tokens por una capacidad que no usa, y la caché de
  // prefijo de quien nunca guardó nada no se invalida.
  it("sin memoria no añade ni un carácter", () => {
    const sin = buildAgentContext(base);
    expect(buildAgentContext({ ...base, userMemory: null })).toBe(sin);
    expect(buildAgentContext({ ...base, userMemory: "   " })).toBe(sin);
  });

  it("con memoria la pone delante del estado del proyecto", () => {
    const out = buildAgentContext({ ...base, userMemory: "• nunca uses amarillo" });
    expect(out).toContain("nunca uses amarillo");
    expect(out.indexOf("nunca uses amarillo")).toBeLessThan(out.indexOf("PROJECT STATE"));
  });

  it("dice que es de la PERSONA, no del proyecto", () => {
    // Si el modelo cree que es del proyecto, la aplicará sólo aquí — que es
    // exactamente el bug que esto cierra.
    const out = buildAgentContext({ ...base, userMemory: "• háblame de tú" });
    expect(out).toMatch(/ANY of their pages/);
  });

  // La memoria es un punto de partida, no una regla sobre el usuario: si hoy
  // pide lo contrario, manda hoy. Sin esta línea el modelo discute con él.
  it("le dice que lo de HOY gana sobre la memoria", () => {
    const out = buildAgentContext({ ...base, userMemory: "• nunca uses amarillo" });
    expect(out).toMatch(/today wins/);
  });

  // LEN.md (plans/len-md): lo general antes que lo particular sigue siendo
  // verdad, pero ahora por construcción: el /LEN.md del proyecto es el mensaje
  // duradero que va ANTES del contexto, y esta memoria va DENTRO del contexto,
  // con su ruta, porque es privada de quien habla.
  it("la memoria personal va con su ruta y dice que se edita ahí", () => {
    const out = buildAgentContext({ ...base, userMemory: "• háblame de tú" });
    expect(out).toContain("/home/user/.len/LEN.md");
    expect(out).toMatch(/edit this file to change them/);
  });
});
