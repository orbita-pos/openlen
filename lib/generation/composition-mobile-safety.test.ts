import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";

import {
  COMPOSITION_MOBILE_SAFETY_VERSION,
  ensureCompositionMobileSafety,
} from "./composition-mobile-safety";

const HTML = `<!doctype html><html><head><title>Mundo Pincel</title></head><body><main>
  <section data-openlen-role="hero"><h1>Despierta la creatividad</h1></section>
  <section data-openlen-role="coloring_gallery"><h2>Creaciones de nuestros&nbsp;pequeños&nbsp;artistas.</h2></section>
</main></body></html>`;

function roles(html: string): string[] {
  return parse(html).querySelectorAll("[data-openlen-role]")
    .map((node) => node.getAttribute("data-openlen-role") ?? "");
}

describe("ensureCompositionMobileSafety", () => {
  it("adds one scoped, versioned style without changing copy or role order", () => {
    const result = ensureCompositionMobileSafety(HTML);

    expect(result.match(new RegExp(`data-openlen-composition-safety="${COMPOSITION_MOBILE_SAFETY_VERSION}"`, "g"))).toHaveLength(1);
    expect(result).toContain("Creaciones de nuestros&nbsp;pequeños&nbsp;artistas.");
    expect(roles(result)).toEqual(["hero", "coloring_gallery"]);
    expect(result).toContain("[data-openlen-role] *{min-width:0}");
    expect(result).toContain("overflow-wrap:anywhere");
    expect(result).not.toContain("overflow-x:hidden");
    expect(result).not.toContain("overflow-x:clip");
  });

  it("is byte-for-byte idempotent", () => {
    const once = ensureCompositionMobileSafety(HTML);
    expect(ensureCompositionMobileSafety(once)).toBe(once);
  });

  it("does not add an unscoped universal rule", () => {
    const result = ensureCompositionMobileSafety(HTML);
    const owned = parse(result).querySelector(`[data-openlen-composition-safety="${COMPOSITION_MOBILE_SAFETY_VERSION}"]`)?.textContent ?? "";
    expect(owned).not.toMatch(/(^|})\s*\*\s*\{/);
    expect(owned).not.toMatch(/(^|})\s*(?:h1|h2|p|button)\s*\{/);
  });
});
