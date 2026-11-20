// THE SPACE'S ADDRESS (spec local 2026-11-19-agentes-para-todos, §6.3): `/space`, with what arrives from the home
// (`brief`, sent once with its ticket) or a draft to fill without sending («Cambiar a…»).
import { describe, expect, it } from "vitest";

import { spaceHref } from "./href";

describe("spaceHref", () => {
  it("bare, with a brief, and with a draft", () => {
    expect(spaceHref()).toBe("/space");
    expect(spaceHref({ brief: "Quiero un profe" })).toBe("/space?brief=Quiero+un+profe");
    expect(spaceHref({ draft: "Cambiar a Toña" })).toBe("/space?draft=Cambiar+a+To%C3%B1a");
  });

  it("encodes what would break the query", () => {
    expect(spaceHref({ brief: "pan & café?" })).toBe("/space?brief=pan+%26+caf%C3%A9%3F");
  });

  it("the brief wins over a draft, and empty values are left out", () => {
    expect(spaceHref({ brief: "a", draft: "b" })).toBe("/space?brief=a");
    expect(spaceHref({ brief: "", draft: "" })).toBe("/space");
  });
});
