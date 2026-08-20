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

describe("la valla cerrada a mitad del documento", () => {
  // Medido en la página de SaaS de la muestra: el modelo cerró la valla tras un
  // </style> y escribió cuatro párrafos de notas de diseño, sin </body></html>.
  // El parser cerró las etiquetas solo y la prosa quedó DENTRO del <body>,
  // visible para el visitante.
  const truncado = [
    "<!doctype html><html><head><style>:root{--bg:#fff}",
    "  </style>",
    "",
    "```",
    "### Visual Highlights & Design Approach",
    "* **Confident, Modern Palette:** el fondo crema…",
  ].join("\n");

  it("corta en la valla cuando el documento no cierra", () => {
    const out = extractDocument(truncado);
    expect(out).not.toContain("Visual Highlights");
    expect(out.endsWith("</style>")).toBe(true);
  });

  // La página de documentación de la misma muestra enseña bloques de código.
  // Si cerró bien, aquí no se toca nada.
  it("un documento BIEN cerrado que contiene ``` se queda intacto", () => {
    const conFence = "<!doctype html><html><body><pre>\n```bash\nnpm i\n```\n</pre></body></html>";
    expect(extractDocument(conFence)).toBe(conFence);
  });

  it("sin valla y sin cierre, sigue fallando su propia comprobación", () => {
    const truncadaSinValla = "<!doctype html><html><body><h1>a medias";
    expect(extractDocument(truncadaSinValla)).toBe(truncadaSinValla);
  });
});
