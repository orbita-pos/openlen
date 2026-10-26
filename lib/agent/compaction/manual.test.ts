// A11 · C16: `/compact`, el de Claude Code («Free up context by summarizing the
// conversation so far», con `<optional custom summarization instructions>`).
import { describe, expect, it } from "vitest";

import { parseCompactCommand } from "./manual";

describe("parseCompactCommand", () => {
  it("🔴 «/compact» solo: sin instrucciones", () => {
    expect(parseCompactCommand("/compact")).toEqual({ instructions: null });
    expect(parseCompactCommand("  /compact  ")).toEqual({ instructions: null });
  });

  it("🔴 «/compact <instrucciones>»: lo que sigue, tal cual", () => {
    expect(parseCompactCommand("/compact céntrate en los precios")).toEqual({ instructions: "céntrate en los precios" });
    expect(parseCompactCommand("/compact\ncéntrate\nen los precios")).toEqual({ instructions: "céntrate\nen los precios" });
  });

  it("🔴 lo que no es el comando: null", () => {
    expect(parseCompactCommand("/compactar")).toBeNull();
    expect(parseCompactCommand("haz /compact")).toBeNull();
    expect(parseCompactCommand("compact")).toBeNull();
    expect(parseCompactCommand("")).toBeNull();
  });
});
