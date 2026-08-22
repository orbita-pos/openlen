// El script del inspector, comprobado como SCRIPT.
//
// POR QUÉ EXISTE. `use-element-inspect.ts` compone su runtime como un template
// literal gigante, y eso tiene una trampa que ya mordió: **una comilla invertida
// dentro de un comentario CIERRA el literal a mitad**. El fichero seguía siendo
// TypeScript válido en apariencia y el error salía a 50 líneas de distancia,
// hablando de una coma que faltaba. Lo mismo pasa con un `${` accidental.
//
// La comprobación de sintaxis de abajo caza esa clase entera por un céntimo de
// tiempo, y es la misma que ya protege al editor en línea
// (`inline-edit-core.test.ts`).

import { describe, it, expect } from "vitest";
import { injectElementInspect } from "./use-element-inspect";

/** El script tal cual se inyecta, sin la envoltura `<script>`. */
function injectedSource(): string {
  const out = injectElementInspect("<html><body><h1>hola</h1></body></html>");
  const m = out.match(/<script[^>]*>([\s\S]*)<\/script>/);
  if (!m) throw new Error("la inyección ya no trae un <script> — cambió la forma");
  return m[1]!;
}

describe("el script del inspector se compone entero", () => {
  it("es JavaScript sintácticamente válido", () => {
    // `new Function` PARSEA sin ejecutar: es exactamente lo que hace falta aquí.
    expect(() => new Function(injectedSource())).not.toThrow();
  });

  it("se inyecta ANTES de </body>, no al final del documento", () => {
    const out = injectElementInspect("<html><body><h1>hola</h1></body></html>");
    expect(out.indexOf("<script")).toBeLessThan(out.lastIndexOf("</body>"));
  });

  it("un documento vacío se devuelve intacto", () => {
    expect(injectElementInspect("")).toBe("");
  });
});

/**
 * EL CONTRATO ENTRE EL PANEL Y EL SCRIPT.
 *
 * El panel manda `{ scope: "…" }` por postMessage y el script decide con un
 * `if (d.scope === "…")`. Si los dos nombres dejan de coincidir, el usuario
 * pulsa y no pasa NADA: sin error, sin log, sin pista. Es el mismo modo de fallo
 * que ya nos costó una corrida en el prompt del runtime — el emisor decía un
 * marcador y el receptor buscaba otro.
 */
describe("los scopes que el panel emite existen en el script", () => {
  const SOURCE = injectedSource();

  it.each([
    "element",
    "page",
    "style",
    "linkify-button",
  ])("el script atiende el scope %s", (scope) => {
    expect(SOURCE).toContain(`d.scope === '${scope}'`);
  });
});

/**
 * LA GUARDA DEL FORMULARIO. Un `<button>` dentro de un `<form>` SÍ tiene trabajo
 * —enviarlo— y convertirlo en `<a>` rompería el formulario en silencio: el
 * usuario vería el mismo botón y dejaría de recibir mensajes.
 *
 * El panel ya no ofrece el campo ahí (`formIndex == null`), pero eso es la UI.
 * Esto comprueba la segunda mitad: que el script se niegue igual aunque le
 * llegue la orden.
 */
describe("convertir un botón en enlace", () => {
  const SOURCE = injectedSource();

  it("se niega dentro de un <form>", () => {
    expect(SOURCE).toMatch(/closest\('form'\)\)\s*return/);
  });

  it("sólo actúa sobre <button>, no sobre cualquier elemento", () => {
    expect(SOURCE).toContain("tagName.toLowerCase() !== 'button'");
  });

  it("no arrastra atributos que sólo significan algo en un <button>", () => {
    for (const attr of ["type", "disabled", "name", "value", "form"]) {
      expect(SOURCE).toContain(`at.name === '${attr}'`);
    }
  });

  // La ruta del inspector lleva el nombre de etiqueta (button:nth-of-type(n)),
  // así que al convertir deja de resolver. Sin re-seleccionar, el panel seguiría
  // apuntando a un elemento que ya no existe y la siguiente edición no haría nada.
  it("re-selecciona después de convertir", () => {
    expect(SOURCE).toMatch(/selected = a;[\s\S]{0,40}postSelected\(a\)/);
  });
});
