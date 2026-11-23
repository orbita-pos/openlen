// A TOOL'S DOCUMENTS AS THEY TRAVEL (spec local 2026-11-22-artifacts-de-len, §3–§4): a document leaves the server
// as JSON — the date an ISO string — whether the tool's page asks for it (the bridge's route) or follows it (the stream), and
// a write becomes the one change every screen following the tool is told. One place, so they never drift apart.
import type { BridgeDataDoc } from "@/lib/tools/bridge/protocol";

import type { LenArtifactChange } from "./bus";
import type { LenArtifactDoc } from "./store";

/** The document as the tool's page reads it. A removed document (`data: null`) keeps that null: it is how a change says
 *  a document is gone. */
export function toBridgeDoc(doc: LenArtifactDoc): BridgeDataDoc {
  return { collection: doc.collection, docId: doc.docId, data: doc.data, updatedAt: doc.updatedAt.toISOString(), updatedBy: doc.updatedBy };
}

/** What a write left different, as the change the bus carries: the documents as they are now, and the ones that are gone. */
export function changeOfWrites(by: "agent" | "person", changes: readonly LenArtifactDoc[]): LenArtifactChange {
  return {
    by,
    docs: changes.filter((c) => c.data !== null),
    deleted: changes.filter((c) => c.data === null).map((c) => ({ collection: c.collection, docId: c.docId })),
  };
}
