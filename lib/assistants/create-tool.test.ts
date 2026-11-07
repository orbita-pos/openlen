import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import { childToolDeclarations } from "@/lib/agent/subagents/presets";

import { assistantTools } from "./agent";
import { CREATE_ASSISTANT, CREATE_ASSISTANT_DECLARATION, runCreateAssistant } from "./create-tool";

const LEN = { projectId: "p1", userId: "u1" } as unknown as AgentSession;
const LUCIA = { id: "a1", name: "Lucía", slug: "lucia" };

describe("create_assistant", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the card when the project has no assistant", async () => {
    const out = await runCreateAssistant(LEN, async () => null);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create" });
    expect(out.action).toMatchObject({ tool: CREATE_ASSISTANT, ok: true });
  });

  it("says which one it already has", async () => {
    const out = await runCreateAssistant(LEN, async () => LUCIA as never);
    expect(out.response).toMatchObject({ ok: false, error: "project_has_assistant", assistant: { name: "Lucía", slug: "lucia" } });
    expect(out.action).toBeUndefined();
  });

  it("is not the assistant's: an assistant doesn't make assistants", async () => {
    const session = { ...LEN, assistant: { id: "a1", name: "Lucía" } } as AgentSession;
    expect((await runCreateAssistant(session, async () => null)).response).toMatchObject({ ok: false, error: "not_available" });
    expect(assistantTools([CREATE_ASSISTANT_DECLARATION]).map((d) => d.name)).toEqual([]);
  });

  it("no subagent gets it", () => {
    expect(childToolDeclarations([CREATE_ASSISTANT_DECLARATION], "general-purpose", false).map((d) => d.name)).toEqual([]);
  });

  it("is off with the switch", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await runCreateAssistant(LEN, async () => null)).response).toMatchObject({ ok: false, error: "assistants_off" });
  });
});
