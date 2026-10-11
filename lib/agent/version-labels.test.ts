// @vitest-environment node
// Lo que escribe una persona lleva SU nombre en Versiones, y desde dónde.
import { describe, expect, it } from "vitest";
import { userEditLabels } from "./version-labels";

describe("las etiquetas de lo que escribe la persona", () => {
  it("la terminal, el editor de la lente Código y un agente de fuera (MCP)", () => {
    expect(userEditLabels(undefined)).toEqual({ name: "Terminal", before: "Before terminal edit" });
    expect(userEditLabels("editor")).toEqual({ name: "Code editor", before: "Before code edit" });
    expect(userEditLabels("mcp")).toEqual({ name: "External agent", before: "Before external agent edit" });
  });
});
