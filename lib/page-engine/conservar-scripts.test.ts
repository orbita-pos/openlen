import { describe, expect, it } from "vitest";

import { conservarScripts } from "./conservar-scripts";

const CODIGO = 'document.getElementById("b").addEventListener("click",()=>{});';
const SCRIPT = "<script>" + CODIGO + "</script>";
const CDN = '<script src="https://cdn.tailwindcss.com"></script>';

const doc = (cuerpo: string, cabeza = "") =>
  "<!doctype html><html><head>" + cabeza + "</head><body>" + cuerpo + "</body></html>";

describe("conservarScripts — el código sale de la base, no de la petición", () => {
  it("devuelve el script que el saneador acaba de borrar del cuerpo editado", () => {
    const guardado = doc("<h1>Tacos</h1>" + SCRIPT);
    const editado = doc("<h1>Tacos al pastor</h1>");
    const out = conservarScripts(guardado, editado);
    expect(out).toContain("Tacos al pastor");
    expect(out).toContain(CODIGO);
  });

  it("y lo pone DENTRO del body, no después", () => {
    const out = conservarScripts(doc("<h1>x</h1>" + SCRIPT), doc("<h1>y</h1>"));
    expect(out.indexOf(CODIGO)).toBeLessThan(out.indexOf("</body>"));
  });

  /**
   * El CDN de Tailwind está en la lista blanca del saneador, así que SOBREVIVE
   * al cuerpo editado. Sin la comprobación de presencia acabaría dos veces en
   * el documento — y un `<script src>` duplicado es una petición de red de más
   * en cada carga.
   */
  it("NO duplica un script que el cuerpo editado ya trae", () => {
    const guardado = doc("<h1>x</h1>" + SCRIPT, CDN);
    const editado = doc("<h1>y</h1>", CDN);
    const out = conservarScripts(guardado, editado);
    expect(out.split(CDN).length - 1, "el CDN quedó dos veces").toBe(1);
    expect(out).toContain(CODIGO);
  });

  it("un documento guardado sin scripts no añade nada — byte a byte", () => {
    const editado = doc("<h1>y</h1>");
    expect(conservarScripts(doc("<h1>x</h1>"), editado)).toBe(editado);
  });

  it("y si el editado ya los trae todos, tampoco toca nada", () => {
    const editado = doc("<h1>y</h1>" + SCRIPT);
    expect(conservarScripts(doc("<h1>x</h1>" + SCRIPT), editado)).toBe(editado);
  });

  it("conserva VARIOS y en su orden", () => {
    const a = "<script>window.a=1</script>";
    const b = "<script>window.b=2</script>";
    const out = conservarScripts(doc("<h1>x</h1>" + a + b), doc("<h1>y</h1>"));
    expect(out.indexOf("window.a")).toBeLessThan(out.indexOf("window.b"));
  });

  /**
   * NO PUEDE INTRODUCIR CÓDIGO NUEVO. Es la propiedad que sustituye al hash de
   * la cápsula: el código sale del documento guardado, así que un cuerpo
   * hostil no puede colar nada — y lo que trajera ya lo borró el saneador
   * antes de llegar aquí.
   */
  it("lo que aporta sale SIEMPRE del guardado, nunca del editado", () => {
    const guardado = doc("<h1>x</h1>" + SCRIPT);
    const editado = doc("<h1>y</h1>");
    const out = conservarScripts(guardado, editado);
    for (const bloque of out.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
      expect(guardado).toContain(bloque);
    }
  });

  it("sin </body> se pegan al final en vez de perderse", () => {
    const out = conservarScripts("<h1>x</h1>" + SCRIPT, "<h1>y</h1>");
    expect(out).toContain(CODIGO);
  });
});
