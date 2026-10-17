import { describe, expect, it } from "vitest";

import { reviewerBrainOptions } from "./reviewer-brain";

describe("the reviewer's brain", () => {
  // Jesús, 17/10: la revisión la paga OpenLen y en DeepInfra cuesta ~60 % menos.
  // Sin `providers`, el cerebro usa la lista de Len: DeepInfra, y Fireworks de respaldo.
  it("is Len's, with Len's providers (DeepInfra first, Fireworks as fallback)", () => {
    const signal = new AbortController().signal;
    const tools = [{ name: "Read" }];
    expect(reviewerBrainOptions({ tools, projectId: "p1", signal })).toEqual({
      tools,
      requestId: "security-review:p1",
      signal,
      esfuerzoDelTurno: "high",
    });
  });
});
