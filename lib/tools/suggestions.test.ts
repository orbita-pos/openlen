// @vitest-environment node
//
// WHO GETS THE «CREAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.13, §4.15): the switches on,
// subagents on (the Creator is one), a paid plan, the person turned «Sugerencias de herramientas» on, and not inside
// a tool project — there Len builds the tool itself.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const users = vi.hoisted(() => ({ value: true as unknown, fail: false }));
vi.mock("@/lib/db", () => ({
  schema: { users: { id: "id", toolSuggestions: "toolSuggestions" } },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (users.fail) throw new Error("db down");
            return users.value === undefined ? [] : [{ on: users.value }];
          },
        }),
      }),
    }),
  },
}));

const { suggestionsOffered, suggestionsOn, toolSuggestionsEnabled } = await import("./suggestions");

const all = { env: {}, plan: "pro", on: true, toolProject: false };

describe("toolSuggestionsEnabled", () => {
  it("on by default; OPENLEN_TOOL_SUGGESTIONS=0 or OPENLEN_TOOLS=0 turn it off", () => {
    expect(toolSuggestionsEnabled({})).toBe(true);
    expect(toolSuggestionsEnabled({ OPENLEN_TOOL_SUGGESTIONS: "0" })).toBe(false);
    expect(toolSuggestionsEnabled({ OPENLEN_TOOLS: "0" })).toBe(false);
  });
});

describe("suggestionsOffered", () => {
  it("with everything in place", () => {
    expect(suggestionsOffered(all)).toBe(true);
  });

  it("not when any one condition is missing", () => {
    expect(suggestionsOffered({ ...all, env: { OPENLEN_TOOL_SUGGESTIONS: "0" } })).toBe(false);
    expect(suggestionsOffered({ ...all, env: { OPENLEN_SUBAGENTS: "0" } })).toBe(false);
    expect(suggestionsOffered({ ...all, plan: "free" })).toBe(false);
    expect(suggestionsOffered({ ...all, on: false })).toBe(false);
    expect(suggestionsOffered({ ...all, toolProject: true })).toBe(false);
  });
});

describe("suggestionsOn", () => {
  it("reads the person's setting; off when the row is missing or the read fails", async () => {
    users.value = true;
    expect(await suggestionsOn("u1")).toBe(true);
    users.value = false;
    expect(await suggestionsOn("u1")).toBe(false);
    users.value = undefined;
    expect(await suggestionsOn("u1")).toBe(false);
    users.fail = true;
    expect(await suggestionsOn("u1")).toBe(false);
  });
});
