import { describe, expect, it } from "vitest";
import { resolveChatUniverse, type ChatUniverseDeps } from "./universe";

function deps(over: Partial<ChatUniverseDeps>): ChatUniverseDeps {
  return {
    ownedProjects: async () => [],
    agentProjectIds: async () => [],
    projectChatEnabled: async () => null,
    ...over,
  };
}

describe("resolveChatUniverse", () => {
  it("keeps only chat-enabled owned projects", async () => {
    const ids = await resolveChatUniverse(
      "u1",
      deps({
        ownedProjects: async () => [
          { id: "a", chatEnabled: true },
          { id: "b", chatEnabled: false },
        ],
      }),
    );
    expect(ids).toEqual(["a"]);
  });

  it("adds agent projects that exist and have chat enabled", async () => {
    const ids = await resolveChatUniverse(
      "u1",
      deps({
        agentProjectIds: async () => ["x", "y", "gone"],
        projectChatEnabled: async (id) =>
          id === "x" ? true : id === "y" ? false : null,
      }),
    );
    expect(ids).toEqual(["x"]);
  });

  it("dedupes projects owned AND agented (owned wins, no re-lookup)", async () => {
    const ids = await resolveChatUniverse(
      "u1",
      deps({
        ownedProjects: async () => [{ id: "a", chatEnabled: true }],
        agentProjectIds: async () => ["a"],
        projectChatEnabled: async () => {
          throw new Error("must not be called for owned ids");
        },
      }),
    );
    expect(ids).toEqual(["a"]);
  });

  it("a chat-disabled owned project is not re-added via the agent path", async () => {
    const ids = await resolveChatUniverse(
      "u1",
      deps({
        ownedProjects: async () => [{ id: "a", chatEnabled: false }],
        agentProjectIds: async () => ["a"],
      }),
    );
    expect(ids).toEqual([]);
  });
});
