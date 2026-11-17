import { describe, expect, it } from "vitest";

import { lenRequestRefFrom } from "./len-request-ref";

describe("a request to Len, as her card keeps it", () => {
  it("takes a fila and a project, and nothing else", () => {
    expect(lenRequestRefFrom({ filaId: "f1", projectId: "p1" })).toEqual({ filaId: "f1", projectId: "p1" });
    for (const bad of [null, undefined, "f1", { filaId: "f1" }, { filaId: "", projectId: "p1" }, { filaId: 1, projectId: "p1" }, { filaId: "x".repeat(101), projectId: "p1" }, { filaId: "f1", projectId: "" }])
      expect(lenRequestRefFrom(bad)).toBeNull();
  });

  it("drops whatever else the object carries", () => {
    expect(lenRequestRefFrom({ filaId: "f1", projectId: "p1", extra: true })).toEqual({ filaId: "f1", projectId: "p1" });
  });
});
