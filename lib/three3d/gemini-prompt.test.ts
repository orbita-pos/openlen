import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./gemini-prompt";

describe("buildSystemPrompt", () => {
  const sys = buildSystemPrompt();
  it("documents the vocabulary enums", () => {
    for (const token of ["sphere", "torusKnot", "iridescent", "chrome", "drift", "dramatic"]) {
      expect(sys).toContain(token);
    }
  });
  it("includes few-shot examples from GOLDEN", () => {
    expect(sys).toContain("anillo de oro");
    expect(sys).toMatch(/"geometry"/); // at least one example spec is shown as JSON
  });
  it("instructs JSON-only output", () => {
    expect(sys.toLowerCase()).toMatch(/only.*json|json.*only|solo.*json/);
  });
});

describe("buildUserPrompt", () => {
  it("includes the brief and the options", () => {
    const p = buildUserPrompt({ describe: "una esfera azul", look: "soft", behavior: "still", brandMatch: true, accent: "#0044FF" });
    expect(p).toContain("una esfera azul");
    expect(p).toContain("soft");
    expect(p).toContain("still");
    expect(p).toContain("#0044FF");
  });
});
