// @vitest-environment node
import { describe, expect, it } from "vitest";

import { lenTurnPush } from "./len-turn-push";

const evento = { type: "len_turno", projectId: "p1", recipientUserId: "u1", preview: "Listo", pregunta: false } as const;

describe("the web push of a turn that ended with nobody watching", () => {
  it("Len's: titled with the project, opens the project", () => {
    expect(lenTurnPush(evento, "Panadería")).toEqual({ title: "Len · Panadería", body: "Listo", url: "/new?project=p1" });
    expect(lenTurnPush({ ...evento, pregunta: true }, null)).toEqual({ title: "Len", body: "❓ Listo", url: "/new?project=p1" });
  });

  it("🔴 the person's own assistant's: titled with its name, opens its place", () => {
    expect(lenTurnPush({ ...evento, asistente: { name: "Lucía", slug: "lucía" } }, "Panadería")).toEqual({
      title: "Lucía · Panadería",
      body: "Listo",
      url: `/assistant/${encodeURIComponent("lucía")}`,
    });
  });
});
