import { describe, expect, it } from "vitest";

import { extractDocument } from "./extract-document";

const DOC = `<!doctype html><html><head></head><body><h1>Hola</h1></body></html>`;

describe("sacar el documento de la respuesta del modelo", () => {
  it("deja intacto un documento limpio", () => {
    expect(extractDocument(DOC)).toBe(DOC);
  });

  it("quita las vallas de markdown", () => {
    expect(extractDocument("```html\n" + DOC + "\n```")).toBe(DOC);
  });

  // El caso real: el brief de la taquería lo provocó en el intento inicial Y en
  // el reintento, y la ruta contestaba "Generation failed" con la página ya
  // escrita y pagada.
  it("quita la frase de cortesía que el modelo escribe antes", () => {
    const conPreambulo = "Here is a complete, self-contained HTML page for a neighborhood taquería.\n\n```html\n" + DOC;
    expect(extractDocument(conPreambulo)).toBe(DOC);
  });

  it("quita lo que el modelo escriba después", () => {
    expect(extractDocument(DOC + "\n\nEspero que te sirva.")).toBe(DOC);
  });

  // Una página de documentación enseña HTML como ejemplo. Cortar en el último
  // doctype se comería media página.
  it("corta en el PRIMER doctype, no en un ejemplo de código de la página", () => {
    const conEjemplo = `Aquí tienes:\n<!doctype html><html><body><pre>&lt;!doctype html&gt;</pre><p>ejemplo</p></body></html>`;
    const out = extractDocument(conEjemplo);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("ejemplo");
  });

  it("una respuesta truncada NO se cierra a la fuerza — tiene que seguir fallando", () => {
    const truncada = `<!doctype html><html><body><h1>a medias`;
    expect(extractDocument(truncada)).toBe(truncada);
  });

  it("sin doctype no inventa nada", () => {
    expect(extractDocument("no hay html aquí")).toBe("no hay html aquí");
  });
});
