// THE MORNING SUMMARY'S PUSH ON THE WEB (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): it opens her place.
import { describe, expect, it } from "vitest";

import { summaryPush } from "./notice";

describe("summaryPush", () => {
  it("🔴 assistant_summary's push opens her place, in the language it was turned on in", () => {
    expect(
      summaryPush({ type: "assistant_summary", projectId: "p1", recipientUserId: "u1", assistantId: "a1", assistantName: "Lucía", assistantSlug: "lucía", locale: "es", title: "Lucía", push: "Ayer hablé con 3 personas.", emailSubject: "s", emailText: "t" }),
    ).toEqual({ title: "Lucía", body: "Ayer hablé con 3 personas.", url: "/es/assistant/luc%C3%ADa" });
  });
});
