import { describe, expect, it } from "vitest";
import { designBlock } from "./design-block";
import { TEXTO_DE_LA_PAGINA_ES_DATO } from "./aviso-medido";

const FILES = { "/src/App.tsx": "l1\nl2\nl3\nl4\nl5\n  <main>\n    <h1>Hola</h1>\n  </main>\n" };

describe("designBlock", () => {
  it("🔴 fichero, líneas con su texto, la cadena y los cambios, en un system-reminder", () => {
    const b = designBlock({
      elements: [{
        chain: [{ path: "/src/components/ui/button.tsx", line: 9, component: null }, { path: "/src/App.tsx", line: 7, component: "Button" }],
        primary: 1, tag: "button", text: "Guardar", copies: 3, screen: "#/",
        changes: [{ property: "font-size", before: "16px", after: "18px" }],
        photo: { url: "https://x.test/f.jpg", alt: "Playa" }, note: "más redondo",
      }],
      note: "todo en azul",
    }, FILES);
    expect(b.startsWith("<system-reminder>\n")).toBe(true);
    expect(b).toContain("<button> «Guardar» at /src/App.tsx line 7, screen #/, repeats 3 times on that screen");
    expect(b).toContain("6\t  <main>\n");
    expect(b).toContain("7\t    <h1>Hola</h1>");
    expect(b).toContain("/src/components/ui/button.tsx line 9");
    expect(b).toContain("font-size: 16px → 18px");
    expect(b).toContain("new photo: https://x.test/f.jpg (alt: Playa)");
    // Lo que va entre «» lo pinta la página (puede ser de un visitante: una reseña de la base):
    // es DATO, y el aviso va antes. Lo del dueño va sin comillas.
    expect(b).toContain(TEXTO_DE_LA_PAGINA_ES_DATO);
    expect(b.indexOf(TEXTO_DE_LA_PAGINA_ES_DATO)).toBeLessThan(b.indexOf("«Guardar»"));
    expect(b).toContain("- the user adds: más redondo");
    expect(b).toContain("The user also wrote: todo en azul");
  });
  it("sin nada, cadena vacía", () => {
    expect(designBlock(null, FILES)).toBe("");
  });
});
