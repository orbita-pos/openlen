import { describe, it, expect, vi } from "vitest";
import { bakeLiveValues } from "./bake-values";

describe("bakeLiveValues", () => {
  it("escribe el valor del Sheet como TEXTO en el marcador data-ol-live", () => {
    const values = new Map([["precio-taco", "$50"]]);
    const out = bakeLiveValues('<span data-ol-live="precio-taco">$45</span>', values);
    expect(out.html).toContain(">$50</span>");
    expect(out.baked).toBe(1);
  });

  it("clave inexistente en el Sheet → conserva el fallback estático (mejora, no dependencia)", () => {
    const values = new Map([["precio-taco", "$50"]]);
    const out = bakeLiveValues('<span data-ol-live="otro">$45</span>', values);
    expect(out.html).toContain(">$45<");
    expect(out.baked).toBe(0);
  });

  it("SEGURIDAD: un valor con HTML queda INERTE — texto escapado, jamás innerHTML", () => {
    const evil = new Map([["x", "<img src=x onerror=alert(1)>"]]);
    const out = bakeLiveValues('<span data-ol-live="x">y</span>', evil);
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;img");
  });

  it("SEGURIDAD: comillas y ampersands también se escapan (atributos no se pueden romper)", () => {
    const evil = new Map([["x", `"><script>alert(1)</script> & 'q'`]]);
    const out = bakeLiveValues('<span data-ol-live="x">y</span>', evil);
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&amp;");
    expect(out.html).toContain("&quot;");
    expect(out.html).toContain("&#39;");
  });

  it("cero marcadores data-ol-live → html ORIGINAL byte-idéntico (early return, sin parsear)", () => {
    const html = "<!doctype html><html><body><h1>Hola</h1></body></html>";
    const out = bakeLiveValues(html, new Map([["x", "1"]]));
    expect(out.html).toBe(html);
    expect(out.baked).toBe(0);
  });

  it("varios marcadores: mezcla de claves presentes y ausentes, cuenta solo las horneadas", () => {
    const values = new Map([
      ["precio-taco", "$50"],
      ["stock-playeras", "12"],
    ]);
    const html =
      '<span data-ol-live="precio-taco">$45</span>' +
      '<span data-ol-live="stock-playeras">0</span>' +
      '<span data-ol-live="sin-dato">fallback</span>';
    const out = bakeLiveValues(html, values);
    expect(out.html).toContain(">$50</span>");
    expect(out.html).toContain(">12</span>");
    expect(out.html).toContain(">fallback<");
    expect(out.baked).toBe(2);
  });

  it("no muta el Map de entrada (llamador puede reusarlo)", () => {
    const values = new Map([["x", "1"]]);
    const spy = vi.fn(values.get.bind(values));
    values.get = spy;
    bakeLiveValues('<span data-ol-live="x">0</span>', values);
    expect(values.size).toBe(1);
    expect(values.get("x")).toBe("1");
  });
});
