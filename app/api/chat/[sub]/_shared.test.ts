// @vitest-environment node
//
// The chat's site context (app/api/chat/[sub]/_shared.ts): the handoff to a person accepts the bubble's assistant as
// its caller — today's (`settings.assistant`) or the person's own on the page (spec local 2026-11-06-asistente-propio,
// §4.2: «pasar la conversación a una persona»; phase 2A).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), onPage: vi.fn(async (): Promise<unknown> => null) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", userId: "userId", title: "title", data: "data", subdomain: "subdomain" } },
}));
vi.mock("@/lib/assistants/visitor/store", () => ({ assistantOnPage: mocks.onPage }));
// The chat's own session and store: not what this file tests.
vi.mock("@/lib/chat/session", () => ({ readChatCookie: () => null }));
vi.mock("@/lib/chat/store", () => ({}));

const { loadChatSite } = await import("./_shared");

const row = (settings: Record<string, unknown>) => [{ id: "p1", userId: "u1", title: "Taller", data: { html: "<html lang=es>", settings } }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.onPage.mockResolvedValue(null);
});

describe("loadChatSite — the bubble's assistant", () => {
  it("today's assistant counts, as before", async () => {
    mocks.limit.mockResolvedValue(row({ chat: { enabled: true }, assistant: { enabled: true } }));
    expect((await loadChatSite("taller"))?.assistantEnabled).toBe(true);
  });

  it("🔴 the chat handoff accepts her as the caller", async () => {
    mocks.limit.mockResolvedValue(row({ chat: { enabled: true } }));
    mocks.onPage.mockResolvedValue({ assistant: { id: "a1" }, knowledge: "Martes a domingo." });
    expect((await loadChatSite("taller"))?.assistantEnabled).toBe(true);
  });

  it("🔴 her with public data only (an app): the handoff accepts her too", async () => {
    mocks.limit.mockResolvedValue(row({ chat: { enabled: true } }));
    mocks.onPage.mockResolvedValue({ assistant: { id: "a1" }, knowledge: "", publicData: [{ name: "huecos", columns: [] }] });
    expect((await loadChatSite("taller"))?.assistantEnabled).toBe(true);
  });

  it("neither of them: no assistant", async () => {
    mocks.limit.mockResolvedValue(row({ chat: { enabled: true } }));
    expect((await loadChatSite("taller"))?.assistantEnabled).toBe(false);
  });

  it("with OPENLEN_ASSISTANT=0 she is never looked up", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    mocks.limit.mockResolvedValue(row({ chat: { enabled: true } }));
    mocks.onPage.mockResolvedValue({ assistant: { id: "a1" }, knowledge: "x" });
    expect((await loadChatSite("taller"))?.assistantEnabled).toBe(false);
    expect(mocks.onPage).not.toHaveBeenCalled();
  });
});
