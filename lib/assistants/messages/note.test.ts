// The agent's note to its person (spec local 2026-11-21-len-y-el-agente-conversan, decision 12, «Sí, por correo»): when
// a turn Len's message woke ends with something for the person, it goes by email in the agent's name, linking to its
// place — as its scheduled tasks' email does (lib/scheduled-tasks/deliver.ts).
import { describe, expect, it, vi } from "vitest";

import { emailAgentNote, type AgentNoteDeps } from "./note";

function deps(email: string | null = "ana@example.com"): AgentNoteDeps & { send: ReturnType<typeof vi.fn>; recipientEmail: ReturnType<typeof vi.fn> } {
  return {
    recipientEmail: vi.fn(async () => email),
    agentUrl: (locale, slug) => `https://openlen.com/${locale}/assistant/${encodeURIComponent(slug)}`,
    send: vi.fn(async () => {}),
  };
}

const NOTE = { personId: "u1", agent: { name: "Finanzas", slug: "finanzas" }, projectTitle: "Presupuesto", text: "  Len pregunta si el tope es 500 €. ¿Se lo confirmo?  ", locale: "es" };

describe("emailAgentNote", () => {
  it("🔴 emails the agent's person, in its name, with the text and a link to its place", async () => {
    const d = deps();
    expect(await emailAgentNote(NOTE, d)).toBe(true);
    expect(d.recipientEmail).toHaveBeenCalledWith("u1");
    expect(d.send).toHaveBeenCalledWith({
      to: "ana@example.com",
      idioma: "es",
      agentName: "Finanzas",
      projectTitle: "Presupuesto",
      texto: "Len pregunta si el tope es 500 €. ¿Se lo confirmo?",
      url: "https://openlen.com/es/assistant/finanzas",
    });
  });

  it("a language we don't have is English, for the email and the link", async () => {
    const d = deps();
    await emailAgentNote({ ...NOTE, locale: "xx" }, d);
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ idioma: "en", url: "https://openlen.com/en/assistant/finanzas" }));
  });

  it("nothing to say, or nobody to say it to: no email", async () => {
    const empty = deps();
    expect(await emailAgentNote({ ...NOTE, text: "  \n " }, empty)).toBe(false);
    expect(empty.recipientEmail).not.toHaveBeenCalled();
    expect(empty.send).not.toHaveBeenCalled();
    const nobody = deps(null);
    expect(await emailAgentNote(NOTE, nobody)).toBe(false);
    expect(nobody.send).not.toHaveBeenCalled();
  });
});
