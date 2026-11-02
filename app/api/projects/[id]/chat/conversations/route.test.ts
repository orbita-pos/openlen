// @vitest-environment node
//
// «Empezar de cero» and reopening a conversation stop the children of the one that goes and drop what they had
// queued for Len: they belonged to it (spec local 2026-11-01-subagentes-de-len, phase 2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isProjectOwner: vi.fn(),
  startNewConversation: vi.fn(),
  reopenConversation: vi.fn(),
  listArchivedConversations: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/chat", () => ({
  isProjectOwner: mocks.isProjectOwner,
  startNewConversation: mocks.startNewConversation,
  reopenConversation: mocks.reopenConversation,
  listArchivedConversations: mocks.listArchivedConversations,
}));

const { POST } = await import("./route");
const registry = await import("@/lib/agent/subagents/registry");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/projects/p1/chat/conversations", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.isProjectOwner.mockResolvedValue(true);
});
afterEach(() => {
  registry.forgetAllSubagents();
  vi.clearAllMocks();
});

describe("changing the project's conversation", () => {
  it("«Empezar de cero» stops the children of the conversation that goes and drops what they queued for Len", async () => {
    const mine = new AbortController();
    const other = new AbortController();
    registry.reserve("p1", "r1", mine);
    registry.reserve("p2", "r2", other);
    registry.queueNotice("p1", { id: "r0", text: "Background subagent r0 finished." });
    mocks.startNewConversation.mockResolvedValue({ ok: true, archived: "c1" });
    expect((await post({ action: "new" })).status).toBe(200);
    expect(mine.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(registry.takeNotices("p1")).toEqual([]);
  });

  it("reopening one does the same; a refused change (a turn is working) touches nothing", async () => {
    const mine = new AbortController();
    registry.reserve("p1", "r1", mine);
    registry.queueNotice("p1", { id: "r0", text: "Background subagent r0 finished." });
    mocks.reopenConversation.mockResolvedValue({ ok: false, reason: "busy" });
    expect((await post({ action: "reopen", conversation: "c1" })).status).toBe(409);
    expect(mine.signal.aborted).toBe(false);
    expect(registry.takeNotices("p1")).toHaveLength(1);
    registry.queueNotice("p1", { id: "r0", text: "Background subagent r0 finished." });
    mocks.reopenConversation.mockResolvedValue({ ok: true, archived: "c2" });
    expect((await post({ action: "reopen", conversation: "c1" })).status).toBe(200);
    expect(mine.signal.aborted).toBe(true);
    expect(registry.takeNotices("p1")).toEqual([]);
  });
});
