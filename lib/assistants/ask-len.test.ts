import { describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";

import { ASK_LEN, ASK_LEN_DECLARATION, runAskLen } from "./ask-len";

const ASSISTANT_SESSION = { projectId: "p1", userId: "u1", zonaHoraria: "America/Mexico_City", uiLocale: "es", assistant: { id: "a1", name: "Lucía" } } as unknown as AgentSession;
const LEN_SESSION = { projectId: "p1", userId: "u1" } as unknown as AgentSession;

describe("ask_len", () => {
  it("queues a Len turn as the owner, in Len's chat, with the owner's words", async () => {
    const launch = vi.fn();
    const out = await runAskLen(ASSISTANT_SESSION, { request: "que el botón de pedir se vea más grande" }, launch);
    expect(out.response).toMatchObject({ ok: true, queued: true });
    expect(launch).toHaveBeenCalledTimes(1);
    const p = launch.mock.calls[0]![0];
    expect(p).toMatchObject({
      userId: "u1",
      projectId: "p1",
      texto: "que el botón de pedir se vea más grande",
      origin: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" },
      timeZone: "America/Mexico_City",
      locale: "es",
    });
    expect(p.framing).toContain("Lucía");
    expect(p.framing).toContain("que el botón de pedir se vea más grande");
    expect(typeof p.filaId).toBe("string");
  });

  it("is not Len's tool", async () => {
    const launch = vi.fn();
    expect((await runAskLen(LEN_SESSION, { request: "x" }, launch)).response).toMatchObject({ ok: false, error: "not_available" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("refuses an empty or missing request", async () => {
    const launch = vi.fn();
    expect((await runAskLen(ASSISTANT_SESSION, { request: "  " }, launch)).response).toMatchObject({ ok: false });
    expect((await runAskLen(ASSISTANT_SESSION, {}, launch)).response).toMatchObject({ ok: false });
    expect(launch).not.toHaveBeenCalled();
  });

  it("declares one required parameter, the request", () => {
    expect(ASK_LEN_DECLARATION.name).toBe(ASK_LEN);
    expect(ASK_LEN_DECLARATION.parameters.required).toEqual(["request"]);
  });
});
