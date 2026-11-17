import { describe, expect, it } from "vitest";

import { viewingLine } from "./viewing";

describe("the project on her owner's phone, in her turn's context", () => {
  it("one she serves: a request that names no project goes to it", () => {
    expect(viewingLine({ id: "p2", title: "Café", served: true })).toBe("Your owner is looking at «Café» (p2) on their phone. A request that names no project goes to it.");
  });

  it("one she doesn't serve: she can't pass requests for it, and their phone has the way", () => {
    expect(viewingLine({ id: "p9", title: "Tienda", served: false })).toBe(
      "Your owner is looking at «Tienda» on their phone, a project you don't serve: you can't pass requests for it to Len. Their phone shows them a button to let you serve it.",
    );
  });
});
