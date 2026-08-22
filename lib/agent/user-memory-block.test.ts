import { describe, expect, it } from "vitest";
import { buildAgentContext } from "./context";

// El formateador vive en context.ts (puro, sin base) — ver la nota en
// user-memory.ts. Esto cubre lo que el MODELO acaba leyendo.

const base = {
  now: new Date("2026-08-22T12:00:00Z"),
  state: { titulo: "x", publicado: false },
  taggedHtml: "<h1 data-op-id=\"a\">hola</h1>",
  userBrief: null,
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
    expect(out.indexOf("nunca uses amarillo")).toBeLessThan(out.indexOf("ESTADO DEL PROYECTO"));
  });

  it("dice que es de la PERSONA, no del proyecto", () => {
    // Si el modelo cree que es del proyecto, la aplicará sólo aquí — que es
    // exactamente el bug que esto cierra.
    const out = buildAgentContext({ ...base, userMemory: "• háblame de tú" });
    expect(out).toMatch(/CUALQUIERA de sus páginas/);
  });

  // La memoria es un punto de partida, no una regla sobre el usuario: si hoy
  // pide lo contrario, manda hoy. Sin esta línea el modelo discute con él.
  it("le dice que lo de HOY gana sobre la memoria", () => {
    const out = buildAgentContext({ ...base, userMemory: "• nunca uses amarillo" });
    expect(out).toMatch(/manda lo de hoy/);
  });

  it("la memoria va ANTES que el brief del proyecto", () => {
    // Lo general antes de lo particular: así un brief que contradiga la
    // memoria gana por cercanía al prompt.
    const out = buildAgentContext({
      ...base,
      userMemory: "• háblame de tú",
      userBrief: "Esta página es para un despacho de abogados",
    });
    expect(out.indexOf("háblame de tú")).toBeLessThan(out.indexOf("despacho de abogados"));
  });
});
