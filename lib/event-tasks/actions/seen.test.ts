// What a judging turn read (spec local 2026-11-04-hazlo, §7.6.4, §7.6.6): rows, addresses, and — for the sources whose
// channel is a conversation or an issue — the conversations and issues it may answer.
import { describe, expect, it } from "vitest";

import { collectSeen, emptySeen, seenOfCandidate } from "./seen";

describe("seen", () => {
  it("conversations and threads are collected only for the channels the source offers", () => {
    const row = { id: "r1", number: 12, title: "Factura", conversation_id: "conv1", visitor: "Ana" };
    const email = emptySeen();
    collectSeen({ items: [row] }, "id", email, ["email"]);
    expect(email.threads.size).toBe(0);
    expect(email.conversations.size).toBe(0);
    const github = emptySeen();
    collectSeen({ items: [row] }, null, github, ["github"]);
    expect([...github.threads]).toEqual([["12", "Factura"]]);
    expect(github.conversations.size).toBe(0);
  });

  it("a source_read row's conversation_id and visitor become a conversation", () => {
    const s = emptySeen();
    collectSeen({ items: [{ id: "m1", conversation_id: "conv1", visitor: "Ana" }], previous: [{ id: "m0", conversation_id: "conv0", visitor: "Eva" }] }, null, s, ["chat"]);
    expect([...s.conversations].sort()).toEqual([["conv0", "Eva"], ["conv1", "Ana"]]);
  });

  it("the candidate's changes bring their conversations and threads, and a check without an issue none", () => {
    const s = seenOfCandidate(
      { changes: [{ detail: { conversation_id: "conv2", visitor: "Luis" }, link: "m2" }, { detail: { number: 7, title: "CI rojo" }, link: "7" }, { detail: { number: null, title: "main" }, link: "c9" }] },
      null,
      ["chat", "github"],
    );
    expect([...s.conversations]).toEqual([["conv2", "Luis"]]);
    expect([...s.threads]).toEqual([["7", "CI rojo"]]);
  });
});
