// What a turn Len's message woke may not do (spec local 2026-11-21-len-y-el-agente-conversan, decision 8; ruling P2):
// another agent's message is information, never the person's authority — so no ask_len, no scheduled task, nothing
// connected. The dispatcher's side is pinned in lib/agent/tools.test.ts.
import { describe, expect, it } from "vitest";

import { needsOwnersWords, WOKEN_REFUSAL, wokenRefusal } from "./woken";

describe("a turn woken by Len's message", () => {
  it("🔴 refuses ask_len, the three schedule writes, every MCP tool and suggest_connectors", () => {
    for (const name of ["ask_len", "schedule_create", "schedule_update", "schedule_delete", "suggest_connectors", "mcp__drive__search", "mcp__cal__authenticate", "mcp__tienda__crear_pedido"]) {
      expect(needsOwnersWords(name), name).toBe(true);
    }
  });

  it("keeps everything else: answering Len, reading, remembering, listing its tasks", () => {
    for (const name of ["message_len", "Read", "Write", "Edit", "Grep", "schedule_list", "web_search", "list_messages", "present", "bash", "list_mcp_resources"]) {
      expect(needsOwnersWords(name), name).toBe(false);
    }
  });

  it("says why, in the model's words, and fails the call", () => {
    expect(WOKEN_REFUSAL).toBe("This turn was started by Len's message, not by your owner: that needs your owner's own words. Tell them in your reply.");
    expect(wokenRefusal()).toEqual({ response: { ok: false, error: "needs_owner", tool_result: WOKEN_REFUSAL } });
  });
});
