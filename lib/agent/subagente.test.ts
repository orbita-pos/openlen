import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { CONTESTA_YA, MAX_VUELTAS_DEL_SUBAGENTE, correrSubagente, runSubagent } from "./subagente";

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

const declaraciones = ["Read", "Edit", "Write", "Grep", "Glob", "publish"].map((name) => ({ name }));

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

  it("🔴 quien sólo puede leer cierra en cuanto contesta: ninguna vuelta de más", async () => {
    // Hasta el 2026-10-17 lo sujetaba la guarda `puedeActuar` de la insistencia
    // «aplica el cambio»; con la insistencia retirada, una vuelta sin llamadas
    // cierra el turno para todos. Sigue siendo lo que cada revisor no debe
    // pagar: una vuelta de más.
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

// Len's subagents (spec local 2026-11-01-subagentes-de-len, §4.5): the same loop, with no turn cap —
// like a Claude Code agent without `maxTurns`, DeepSeek's children and Len's own turn since H1.
describe("runSubagent, Len's loop for a delegated child", () => {
  const tools = ["Read", "Grep"].map((name) => ({ name }));

  it("has no turn cap: twelve reads, then its text", async () => {
    const g = guion(...Array.from({ length: 12 }, (_, i) => llama("Read", { file_path: `/p${i}/index.html` })), dice("Found it."));
    const ran: string[] = [];
    const r = await runSubagent({
      messages: [{ role: "system", content: "S" }, { role: "user", content: "Find it." }],
      tools,
      openStream: g.abrir,
      runTool: async (name, args) => {
        ran.push(`${name} ${String(args.file_path)}`);
        return { response: { ok: true, tool_result: "1\tx" } };
      },
      emit: () => {},
    });
    expect(ran).toHaveLength(12);
    expect(r.finalText).toBe("Found it.");
    expect(r.terminalError).toBeFalsy();
  });

  it("🔴 a tool it was not given never reaches the caller's runTool", async () => {
    const g = guion(llama("Write", { file_path: "/index.html", content: "x" }), dice("Done."));
    const ran: string[] = [];
    await runSubagent({
      messages: [{ role: "system", content: "S" }, { role: "user", content: "Go." }],
      tools,
      openStream: g.abrir,
      runTool: async (name) => {
        ran.push(name);
        return { response: { ok: true } };
      },
      emit: () => {},
    });
    expect(ran).not.toContain("Write");
  });

  it("the spending limit closes it with what it has", async () => {
    const g = guion(llama("Read", { file_path: "/a" }), llama("Read", { file_path: "/b" }), dice("never"));
    let calls = 0;
    const r = await runSubagent({
      messages: [{ role: "system", content: "S" }, { role: "user", content: "Go." }],
      tools,
      openStream: g.abrir,
      closeOut: () => (async function* () {
        for (const ev of dice("Partial: read /a.")) yield ev;
      })(),
      runTool: async () => ({ response: { ok: true, tool_result: "1\tx" } }),
      emit: () => {},
      excedePresupuesto: () => ++calls >= 2,
    });
    expect(r.topeAlcanzado).toBe("budget_limit");
    expect(r.finalText).toBe("Partial: read /a.");
  });
});
