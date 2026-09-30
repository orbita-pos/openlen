import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { CONTESTA_YA, MAX_VUELTAS_DEL_SUBAGENTE, correrSubagente } from "./subagente";

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (o: number): StreamEvent => ({ type: "usage", inputTokens: 100, outputTokens: o, cachedTokens: 40, thinkingTokens: 0 });
const llama = (name: string, args: Record<string, unknown> = {}): StreamEvent[] => [
  { type: "function_call", name, args },
  usage(5),
  done,
];
const dice = (text: string): StreamEvent[] => [{ type: "text_delta", text }, usage(7), done];

/** Un guion por vuelta; el último se repite. */
function guion(...vueltas: StreamEvent[][]) {
  const vistos: Message[][] = [];
  let i = 0;
  const abrir = (messages: Message[]) => {
    vistos.push([...messages]);
    const v = vueltas[Math.min(i++, vueltas.length - 1)];
    return (async function* () {
      for (const ev of v) yield ev;
    })();
  };
  return { abrir, vistos, get llamadas() {
    return i;
  } };
}

const declaraciones = ["Read", "Edit", "Write", "Grep", "Glob", "publicar"].map((name) => ({ name }));

describe("el subagente de solo lectura", () => {
  it("lee, contesta, y devuelve su texto final con el uso", async () => {
    const g = guion(llama("Read", { file_path: "/index.html" }), dice("[]"));
    const leidas: string[] = [];
    const r = await correrSubagente({
      sistema: "You review.",
      mensajes: ["<diff>…</diff>", "Review it."],
      declaraciones,
      openStream: g.abrir,
      closeOut: () => {
        throw new Error("no hace falta");
      },
      leer: async (name, args) => {
        leidas.push(`${name} ${String(args.file_path)}`);
        return { response: { ok: true, tool_result: "1\t<h1>x</h1>" } };
      },
    });
    expect(r).toEqual({ ok: true, texto: "[]", uso: { inputTokens: 200, outputTokens: 12, cachedTokens: 80, thinkingTokens: 0 }, vueltas: 2 });
    expect(leidas).toEqual(["Read /index.html"]);
    // Contexto limpio: su prompt y sus mensajes, en orden, y nada más.
    expect(g.vistos[0]).toEqual([
      { role: "system", content: "You review." },
      { role: "user", content: "<diff>…</diff>" },
      { role: "user", content: "Review it." },
    ]);
  });

  it("🔴 a quien sólo puede leer NO se le insiste en «aplicar el cambio»", async () => {
    // Sin la guarda de `puedeActuar`, el bucle vería «cerró sin que nada
    // cambiara» y le pediría aplicar un cambio que no puede hacer: una vuelta
    // de más, pagada, en cada revisor.
    const g = guion(llama("Grep", { pattern: "precio" }), dice("[]"));
    await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones,
      openStream: g.abrir,
      closeOut: g.abrir,
      leer: async () => ({ response: { ok: true } }),
    });
    expect(g.llamadas).toBe(2);
    expect(JSON.stringify(g.vistos)).not.toContain("SISTEMA");
  });

  it("🔴 sólo se le OFRECEN Read, Grep y Glob, y lo demás no se ejecuta", async () => {
    const g = guion(llama("Edit", { file_path: "/index.html", old_string: "a", new_string: "b" }), dice("[]"));
    const ejecutadas: string[] = [];
    const r = await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones,
      openStream: g.abrir,
      closeOut: g.abrir,
      leer: async (name) => {
        ejecutadas.push(name);
        return { response: { ok: true } };
      },
    });
    expect(r.ok).toBe(true);
    expect(ejecutadas).toEqual([]);
    // La respuesta que recibió dice que esa herramienta no existe.
    expect(JSON.stringify(g.vistos[1])).toContain("Edit");
  });

  it("sin las declaraciones de lectura, la segunda puerta sigue sin dejar escribir", async () => {
    // Con la lista vacía el bucle no limita los nombres: la de `runTool` es la
    // que queda.
    const g = guion(llama("Write", { file_path: "/x/index.html", content: "x" }), dice("[]"));
    const ejecutadas: string[] = [];
    await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones: [],
      openStream: g.abrir,
      closeOut: g.abrir,
      leer: async (name) => {
        ejecutadas.push(name);
        return { response: { ok: true } };
      },
    });
    expect(ejecutadas).toEqual([]);
    expect(JSON.stringify(g.vistos[1])).toContain("read-only");
  });

  it(`al pasar de ${MAX_VUELTAS_DEL_SUBAGENTE} vueltas, la siguiente va sin herramientas y se le pide contestar`, async () => {
    const g = guion(llama("Grep", { pattern: "x" }));
    const cierres: Message[][] = [];
    const r = await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones,
      openStream: g.abrir,
      closeOut: (m) => {
        cierres.push([...m]);
        return (async function* () {
          yield* dice('[{"file": "/index.html", "line": 3, "summary": "s", "failure_scenario": "f"}]');
        })();
      },
      leer: async () => ({ response: { ok: true } }),
    });
    expect(g.llamadas).toBe(MAX_VUELTAS_DEL_SUBAGENTE);
    expect(cierres).toHaveLength(1);
    expect(cierres[0].at(-1)).toEqual({ role: "user", content: CONTESTA_YA });
    expect(r.ok && r.texto).toContain('"line": 3');
  });

  it("quien lo lanza puede toparlo antes (`maxVueltas`), y la respuesta dice cuántas vueltas dio", async () => {
    const g = guion(llama("Grep", { pattern: "x" }));
    const r = await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones,
      openStream: g.abrir,
      closeOut: () =>
        (async function* () {
          yield* dice("[]");
        })(),
      leer: async () => ({ response: { ok: true } }),
      maxVueltas: 2,
    });
    expect(g.llamadas).toBe(2);
    // Las 2 con herramientas y la de contestar.
    expect(r).toMatchObject({ ok: true, texto: "[]", vueltas: 3 });
  });

  it("si el modelo se cae, no es una respuesta: `ok: false` con el motivo, y el uso que hubo", async () => {
    const g = guion([usage(4), { type: "done", stopReason: { kind: "error", error: "503" } }]);
    const r = await correrSubagente({
      sistema: "s",
      mensajes: ["t"],
      declaraciones,
      openStream: g.abrir,
      closeOut: g.abrir,
      leer: async () => ({ response: { ok: true } }),
    });
    expect(r).toMatchObject({ ok: false, motivo: "upstream" });
    expect(r.uso.outputTokens).toBe(4);
  });
});
