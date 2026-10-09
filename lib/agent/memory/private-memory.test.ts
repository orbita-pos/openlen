import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import { PRIVATE_MEMORY_NOTE, touchesPersonalMemory, withoutPersonalMemory } from "./private-memory";

// El turno 5 del ensayo de caja (08/10): Eli, editor, pide que Len recuerde algo
// suyo. La conversación del proyecto es COMPARTIDA, y la fila guardaba el Read y
// el Edit de su ~/.len/LEN.md enteros: el próximo turno de Ana se lo reenviaba
// al modelo. En Claude Code y DeepSeek lo personal sólo vive en la sesión de
// quien lo escribe; aquí, en el contexto de SU turno, nunca en lo compartido.
const turnoDeEli = (): Message[] => [
  {
    role: "assistant",
    content: "",
    reasoning: "Su LEN.md dice «- (Eli) Prefiero frases cortas.»; añado lo de los emojis.",
    functionCalls: [{ name: "Read", args: { file_path: "~/.len/LEN.md" } }],
  },
  { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "1\t- (Eli) Prefiero frases cortas." } }] },
  {
    role: "assistant",
    content: "",
    functionCalls: [
      { name: "Edit", args: { file_path: "/home/user/.len/LEN.md", old_string: "- (Eli) Prefiero frases cortas.", new_string: "- (Eli) Prefiero frases cortas.\n- (Eli) Sin emojis." } },
      { name: "Read", args: { file_path: "/index.html" } },
    ],
  },
  {
    role: "user",
    content: "",
    functionResponses: [
      { name: "Edit", response: { ok: true, tool_result: "Saved. - (Eli) Sin emojis." } },
      { name: "Read", response: { ok: true, tool_result: "1\t<h1>El Farol</h1>" } },
    ],
  },
  { role: "assistant", content: "Hecho: lo recordaré en todos tus proyectos.", reasoning: "Listo." },
];

describe("la memoria personal no se queda en la conversación compartida", () => {
  it("qué rutas son la memoria de la persona (también la de antes del 08/10)", () => {
    expect(touchesPersonalMemory("~/.len/LEN.md")).toBe(true);
    expect(touchesPersonalMemory("/home/user/.len/LEN.md")).toBe(true);
    expect(touchesPersonalMemory("/memoria/dueno.md")).toBe(true);
    expect(touchesPersonalMemory("/LEN.md")).toBe(false);
    expect(touchesPersonalMemory("/.len/memory/verde.md")).toBe(false);
  });

  it("🔴 ni el texto leído ni el escrito quedan; la llamada y la ruta sí", () => {
    const out = JSON.stringify(withoutPersonalMemory(turnoDeEli()));
    expect(out).not.toMatch(/frases cortas|Sin emojis/);
    expect(out).toMatch(/\/home\/user\/\.len\/LEN\.md/);
    expect(out).toContain(PRIVATE_MEMORY_NOTE);
  });

  it("lo demás del turno queda igual: el Read de la página y la respuesta a la persona", () => {
    const out = withoutPersonalMemory(turnoDeEli());
    expect(out[3]!.functionResponses![1]!.response).toEqual({ ok: true, tool_result: "1\t<h1>El Farol</h1>" });
    expect(out[3]!.functionResponses![0]!.response.ok).toBe(true);
    expect(out[4]!.content).toBe("Hecho: lo recordaré en todos tus proyectos.");
  });

  it("como Claude Code con lo pensado en turnos anteriores: un turno que tocó la memoria personal no reenvía su razonamiento", () => {
    expect(withoutPersonalMemory(turnoDeEli()).some((m) => m.reasoning)).toBe(false);
  });

  it("un turno que no la tocó sale idéntico (lo pensado incluido, H15)", () => {
    const turno: Message[] = [
      { role: "assistant", content: "", reasoning: "miro la portada", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "<h1>x</h1>" } }] },
    ];
    expect(withoutPersonalMemory(turno)).toEqual(turno);
  });

  it("en la terminal: el comando y su salida sobre ~/.len/LEN.md tampoco", () => {
    const turno: Message[] = [
      { role: "assistant", content: "", functionCalls: [{ name: "bash", args: { command: "cat ~/.len/LEN.md && echo '- Sin emojis' >> ~/.len/LEN.md" } }] },
      { role: "user", content: "", functionResponses: [{ name: "bash", response: { tool_result: "- (Eli) Prefiero frases cortas.\n[Command finished with exit code 0]" } }] },
    ];
    const out = JSON.stringify(withoutPersonalMemory(turno));
    expect(out).not.toMatch(/frases cortas|Sin emojis/);
    expect(out).toContain(PRIVATE_MEMORY_NOTE);
  });

  it("es idempotente: pasarlo dos veces da lo mismo", () => {
    const una = withoutPersonalMemory(turnoDeEli());
    expect(withoutPersonalMemory(una)).toEqual(una);
  });
});
