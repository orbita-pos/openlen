// @vitest-environment node
// HER CONVERSATION FOR THE PHONE (spec local 2026-11-06-asistente-propio, phase 5): and, for an agent whose conversation
// hasn't started, her file's first message — what her place on the web sends by itself (spec local
// 2026-11-19-agentes-para-todos, §6.4). Delivery 1 deferred it: opened first on the phone, her chat stayed empty.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  person: "u1" as string | null,
  assistant: null as Record<string, unknown> | null,
  chat: [] as unknown[],
  firstMessageOf: vi.fn(async (_p: string, _t: string | null, _n: number, _o: Date | null): Promise<string | null> => null),
}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => m.person }));
vi.mock("@/lib/movil/cors", () => ({ paraLaApp: (h: unknown) => h, respuestaPrevia: () => new Response(null) }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => true }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: async () => m.assistant }));
vi.mock("@/lib/projects/chat", () => ({ getChatMessages: async () => m.chat }));
vi.mock("@/lib/assistants/agent-file", () => ({ firstMessageOf: m.firstMessageOf }));

const { GET } = await import("./route");

const ANA = { id: "a4", personId: "u1", homeProjectId: "space", agentType: "english-teacher", openedAt: null };
const get = async () => {
  const res = await (GET as unknown as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>)(new Request("http://x/api/assistants/a4/chat"), { params: Promise.resolve({ id: "a4" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  m.person = "u1";
  m.assistant = ANA;
  m.chat = [];
  m.firstMessageOf.mockReset().mockResolvedValue(null);
});

describe("GET /api/assistants/[id]/chat", () => {
  it("🔴 an agent whose conversation hasn't started brings her first message for the phone to send", async () => {
    m.firstMessageOf.mockResolvedValue("¡Hola! Empecemos: averigua mi nivel.");
    expect(await get()).toEqual({ status: 200, body: { chatHistory: [], startsWith: "¡Hola! Empecemos: averigua mi nivel." } });
    expect(m.firstMessageOf).toHaveBeenCalledWith("u1", "english-teacher", 0, null);
  });

  it("with nothing to start with, only her conversation, as before", async () => {
    m.chat = [{ id: "t1" }];
    expect(await get()).toEqual({ status: 200, body: { chatHistory: [{ id: "t1" }] } });
  });

  it("someone else's assistant: not found", async () => {
    m.assistant = { ...ANA, personId: "u2" };
    expect((await get()).status).toBe(404);
  });
});
