// One line of what a card proposes, for the notice's email and the old column (spec local 2026-11-04-hazlo, §7.2).
import { describe, expect, it } from "vitest";

import { actionsLine } from "./types";

describe("actionsLine", () => {
  it("names a chat reply by its visitor, with no subject", () => {
    expect(actionsLine([{ kind: "reply", channel: "chat", to: "conv1", toLabel: "Ana", body: "Hola" }])).toBe("→ Ana");
  });

  it("an old email card without toLabel still reads as before", () => {
    expect(actionsLine([{ kind: "reply", channel: "email", to: "luis@x.com", subject: "Tu reserva", body: "…" }])).toBe("→ luis@x.com: Tu reserva");
  });
});
