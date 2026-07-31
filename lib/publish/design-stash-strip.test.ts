import { describe, it, expect } from "vitest";
import { stripDesignStash } from "./design-stash-strip";

describe("stripDesignStash", () => {
  it("elimina el atributo (comillas dobles, valores JSON entity-escaped)", () => {
    const html = '<section data-ol-was="{&quot;color&quot;:&quot;&quot;}" style="color:red">x</section>';
    expect(stripDesignStash(html)).toBe('<section style="color:red">x</section>');
  });
  it("elimina la variante con comillas simples y no toca lo demás", () => {
    const html = "<div data-ol-was='{\"padding\":\"\"}' class=\"a\">x</div><p data-ol-hidden>y</p>";
    expect(stripDesignStash(html)).toBe('<div class="a">x</div><p data-ol-hidden>y</p>');
  });
});
