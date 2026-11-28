// Whether a person started the turn (ruling R24): `set_theme` refuses where nobody did. `ask_len` from the owner's own
// assistant, with the owner's typed words, is the owner asking — attended.
import { describe, expect, it } from "vitest";

import type { TurnOrigin } from "@/lib/projects/types";

import { isUnattendedTurn } from "./unattended";

const scheduled = (origin: TurnOrigin) => ({ scheduled: { origin } });
const assistant = (over: Record<string, unknown> = {}) => ({ kind: "assistant", assistantId: "a1", assistantName: "Lucía", ...over }) as TurnOrigin;

describe("isUnattendedTurn", () => {
  it("a turn a person started in a chat is attended", () => {
    expect(isUnattendedTurn({})).toBe(false);
  });

  it("a goal round, and every turn the server starts, is unattended", () => {
    expect(isUnattendedTurn({ round: {} })).toBe(true);
    for (const origin of [
      { kind: "scheduled", taskId: "t1" },
      { kind: "event_task", taskId: "t1", cardId: "c1", title: "x" },
      { kind: "subagents", ids: [] },
      { kind: "len-message" },
    ] as unknown as TurnOrigin[]) {
      expect(isUnattendedTurn(scheduled(origin)), JSON.stringify(origin)).toBe(true);
    }
  });

  it("ask_len with the owner's typed words is the owner asking: attended", () => {
    expect(isUnattendedTurn(scheduled(assistant({ ownerAsked: true })))).toBe(false);
  });

  it("the same road without the owner's words — her scheduled task, a visitors' card, a message — is not", () => {
    expect(isUnattendedTurn(scheduled(assistant()))).toBe(true);
    expect(isUnattendedTurn(scheduled(assistant({ message: true })))).toBe(true);
    expect(isUnattendedTurn(scheduled(assistant({ message: true, ownerAsked: true })))).toBe(true);
    // A goal round never counts as attended, whatever rides with it.
    expect(isUnattendedTurn({ ...scheduled(assistant({ ownerAsked: true })), round: {} })).toBe(true);
  });
});
