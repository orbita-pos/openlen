// WHAT LEN LEARNS ABOUT ITS CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's action-cards
// status notice — the cards the person or the background work changed since Len last heard, as facts, read at the
// start of Len's next request in that chat; never a turn of its own.
import { describe, expect, it } from "vitest";

import type { ToolCardRow } from "./store";
import { toolCardStatusNotice } from "./notice";

const card = (over: Partial<ToolCardRow>): ToolCardRow => ({
  id: "card-1",
  projectId: "p1",
  chatRowId: "row-1",
  personId: "u1",
  title: "Reservas de hoy",
  brief: "Ver las reservas del día.",
  initialContent: null,
  placement: "rail",
  customLocation: null,
  phase: "installed",
  toolProjectId: "tool-1",
  hostRowId: null,
  creatorRunId: null,
  cancelRequested: false,
  installationId: "inst-1",
  error: null,
  review: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  statusDeliveredAt: null,
  ...over,
});

describe("toolCardStatusNotice", () => {
  it("nothing changed: no notice", () => {
    expect(toolCardStatusNotice([])).toBeNull();
  });

  it("DeepSeek's status facts, the guidance for the kind, and one JSON receipt per card", () => {
    const text = toolCardStatusNotice([
      card({}),
      card({ id: "card-2", title: "Turnos", phase: "failed", placement: "project", customLocation: "Junto al chat", error: "TypeError: x is undefined" }),
    ])!;
    const [facts, guidance, cont, json] = text.split("\n\n");
    expect(facts).toBe(
      "Latest status of action cards from user actions and background work. These are status facts, not a request to start or retry work. Use these receipts instead of the earlier proposal when describing progress.",
    );
    expect(guidance).toBe(
      "Cancelled means a started background build was stopped before installation. Cancelled, failed or interrupted builds can be retried from their existing card; no new proposal is needed. A removed tool can be restored from its card while its version remains; if it is gone, a new proposal is needed.",
    );
    expect(cont).toBe("Continue with the user's current request.");
    expect(JSON.parse(json!)).toEqual([
      { action: "create_tool", id: "card-1", title: "Reservas de hoy", phase: "installed", data: { placement: "rail" } },
      { action: "create_tool", id: "card-2", title: "Turnos", phase: "failed", data: { placement: "project", customLocation: "Junto al chat", error: "TypeError: x is undefined" } },
    ]);
  });
});
