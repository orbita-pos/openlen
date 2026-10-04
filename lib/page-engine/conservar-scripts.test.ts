import { describe, expect, it } from "vitest";

import { todoElJsDelDocumento } from "./conservar-scripts";

const CODIGO = 'document.getElementById("b").addEventListener("click",()=>{});';
const SCRIPT = "<script>" + CODIGO + "</script>";
const CDN = '<script src="https://cdn.tailwindcss.com"></script>';

const doc = (cuerpo: string, cabeza = "") =>
  "<!doctype html><html><head>" + cabeza + "</head><body>" + cuerpo + "</body></html>";

describe("todoElJsDelDocumento", () => {
  it("junta TODOS los bloques del modelo, no sólo el primero", () => {
    const out = todoElJsDelDocumento(
      doc("<h1>x</h1><script>window.a=1</script><p>y</p><script>window.b=2</script>"),
    );
    expect(out).toContain("window.a=1");
    expect(out).toContain("window.b=2");
  });

  // El CDN de Tailwind es la hoja de estilos disfrazada de script, y los
  // carriers `data-ol-*` son del normalizador. Ni uno ni otro es código del
  // modelo: colarlos aquí haría que una página SIN JavaScript propio pareciera
  // tenerlo, y el taller avisaría de una pausa que no le importa a nadie.
  it("deja fuera la infraestructura nuestra", () => {
    const soloInfra = doc("<h1>x</h1>", CDN + '<script data-ol-radius="">1</script>');
    expect(todoElJsDelDocumento(soloInfra)).toBe("");
  });

  it("una página sin scripts devuelve cadena vacía", () => {
    expect(todoElJsDelDocumento(doc("<h1>x</h1>"))).toBe("");
  });

  // Sin las etiquetas: lo que se busca dentro es código (`classList.add("x")`),
  // y un `</script>` de más rompería cualquier lectura.
  it("devuelve el CÓDIGO, sin las etiquetas <script>", () => {
    const out = todoElJsDelDocumento(doc("<h1>x</h1>" + SCRIPT));
    expect(out).not.toContain("<script");
    expect(out).toBe(CODIGO);
  });
});
