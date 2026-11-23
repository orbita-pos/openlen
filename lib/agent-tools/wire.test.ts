// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AgentToolDoc } from "./store";
import { changeOfWrites, toBridgeDoc } from "./wire";

const at = new Date("2026-11-22T10:00:00.123Z");
const doc = (docId: string, data: unknown): AgentToolDoc => ({ collection: "c", docId, data, updatedAt: at, updatedBy: "person" });

describe("a tool's documents as they travel", () => {
  it("a document is JSON: its date an ISO string, everything else as it is", () => {
    expect(toBridgeDoc(doc("a", { n: 1 }))).toEqual({ collection: "c", docId: "a", data: { n: 1 }, updatedAt: "2026-11-22T10:00:00.123Z", updatedBy: "person" });
  });

  it("a removed document keeps its null data, which is how a change says it is gone", () => {
    expect(toBridgeDoc(doc("a", null)).data).toBeNull();
  });

  it("a write becomes one change: the documents as they are now, and the ones that are gone", () => {
    const written = doc("a", { n: 1 });
    expect(changeOfWrites("person", [written, doc("b", null)])).toEqual({ by: "person", docs: [written], deleted: [{ collection: "c", docId: "b" }] });
    expect(changeOfWrites("agent", [])).toEqual({ by: "agent", docs: [], deleted: [] });
  });
});
