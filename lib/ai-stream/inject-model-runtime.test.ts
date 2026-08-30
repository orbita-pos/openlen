// EL SCRIPT QUE SE INYECTABA DOS VECES — 2026-08-30.
//
// Encontrado en producción, en la sesión del hermano de Jesús. El Agente
// verifica así:
//
//   const guardado = row.data.html;                       // ya lleva el <script>
//   const code     = scriptDelDocumento(guardado);        // lo EXTRAE
//   verifyEditedPage({ html: guardado, runtime: code })   // y le pasa las dos
//
// …y `verify.ts` hacía `injectModelRuntime(html, code)`, que añadía una segunda
// copia. El navegador la parseaba y moría con `Identifier 'GAMES' has already
// been declared`. Es un SyntaxError: el script entero NO CORRE. Así que los
// ojos veían una página inerte, `conHechos` forzaba `broken=true`, y el modelo
// se iba a "arreglar" un código que funcionaba — un ciclo de corrección extra
// que se cobra en créditos.
//
// A un visitante real no le pasó nunca: la página servida siempre tuvo UNA
// copia. Era un fallo que sólo existía dentro de nuestros propios ojos, y por
// eso nadie lo vio hasta que alguien de fuera lo probó.
//
// El injerto era correcto cuando el runtime vivía FUERA del documento, en la
// cápsula. Murió el 2026-08-26 (`933acc9d`) y el llamador se quedó.
import { describe, expect, it } from "vitest";
import { injectModelRuntime } from "./inject-model-runtime";

const CODE = 'const GAMES=[{id:"turno-nocturno"}];console.log(GAMES.length);';
const cuantasVeces = (h: string, s: string) => h.split(s).length - 1;

describe("injectModelRuntime no duplica lo que ya está", () => {
  it("🔴 un documento que YA trae su script se devuelve intacto", () => {
    const doc = `<html><body><h1>x</h1><script>${CODE}</script></body></html>`;
    const out = injectModelRuntime(doc, CODE);
    expect(out).toBe(doc);
    expect(cuantasVeces(out, "const GAMES")).toBe(1);
  });

  // BRAZO DE CONTROL. Si la idempotencia se vuelve «no injertes nunca», el
  // runtime desaparece de la vista que juzgan los ojos y volvemos al fallo
  // contrario: aprobar una página cuyo JavaScript nadie ejecutó.
  it("pero uno que NO lo trae sí lo recibe, antes de </body>", () => {
    const out = injectModelRuntime("<html><body><h1>x</h1></body></html>", CODE);
    expect(cuantasVeces(out, "const GAMES")).toBe(1);
    expect(out).toContain(`<script>${CODE}</script></body>`);
  });

  it("y sin </body> se pega al final en vez de perderse", () => {
    const out = injectModelRuntime("<h1>x</h1>", CODE);
    expect(out).toBe(`<h1>x</h1><script>${CODE}</script>`);
  });

  it("un código vacío no añade una etiqueta vacía ni bloquea el injerto", () => {
    // `code` vacío llega con la página sin JavaScript. La guarda mira `code &&`
    // a propósito: `"".includes("")` es true y habría devuelto el documento sin
    // tocar por el camino equivocado — con el mismo resultado, pero por una
    // razón falsa que se rompería al primer cambio.
    const doc = "<html><body></body></html>";
    expect(injectModelRuntime(doc, "")).toContain("<script></script>");
  });
});
