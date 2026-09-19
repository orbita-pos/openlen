// @vitest-environment node
//
// LA GUARDA DE LA TABLA DE IDIOMAS DEL FORMULARIO.
//
// El guion horneado en cada página publicada lleva DENTRO las veinte frases
// que ve el visitante (el «gracias» y el aviso de error, en los diez idiomas),
// porque el binario de Rust no lee los JSON del repo. Es una copia, y una copia
// sin guarda se pudre en silencio: alguien retoca la traducción del catálogo,
// la página publicada sigue diciendo lo viejo, y nadie se entera hasta que un
// visitante lo lee.
//
// MEDIDO el 2026-09-19 en producción, que es de donde sale esta prueba: el
// respaldo del «gracias» estaba HARDCODEADO en inglés, así que una taquería de
// Guadalajara le contestaba «Thanks — we got your message» a un cliente que
// escribió en español.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { LOCALES, RUTA_FORMS, tablaDeIdiomas, tablaEnForms } from "../../scripts/forms-i18n.mjs";

const fuente = () => readFileSync(join(process.cwd(), RUTA_FORMS), "utf8");

/** El guion tal y como se hornea, sacado del literal crudo de Rust. */
function guionHorneado(): string {
  const s = fuente();
  const abre = 'const FORM_SCRIPT: &str = r#"';
  const a = s.indexOf(abre) + abre.length;
  return s.slice(a, s.indexOf('"#;', a));
}

/** Lo EJECUTA. Un doble de `document` hecho a mano, no jsdom: aquí el global
 *  es mío y no hay dudas sobre en cuál corre el script
 *  (ver memoria jsdom-corre-el-script-en-otro-global). Se entra por el camino
 *  sin-JS (`?openlen_form=ok`), que es el que pinta el «gracias» al cargar. */
function graciasEnIdioma(lang: string): string {
  let pintado = "";
  const form = {
    getAttribute: () => null,
    matches: () => true,
    parentNode: {
      replaceChild: (caja: { textContent: string }) => {
        pintado = caja.textContent;
      },
    },
  };
  const document = {
    documentElement: { getAttribute: (n: string) => (n === "lang" ? lang : null) },
    createElement: () => ({ setAttribute() {}, style: { cssText: "" }, textContent: "" }),
    querySelector: () => form,
    addEventListener() {},
  };
  runInNewContext(guionHorneado(), { document, location: { search: "?openlen_form=ok" } });
  return pintado;
}

describe("el formulario publicado habla los diez idiomas", () => {
  it("la tabla dentro de forms.rs es la de los catálogos", () => {
    // Si esto falla: `node scripts/forms-i18n.mjs --write`.
    expect(tablaEnForms()).toBe(tablaDeIdiomas());
  });

  it("están los diez, y ninguno cae al inglés por omisión", () => {
    const tabla = tablaDeIdiomas();
    for (const loc of LOCALES) expect(tabla, `falta ${loc}`).toContain(`"${loc}":`);
    expect(LOCALES).toHaveLength(10);
  });

  it("🔴 ninguna frase visible queda hardcodeada en el guion", () => {
    const guion = fuente().slice(fuente().indexOf("const FORM_SCRIPT"));
    const hasta = guion.slice(0, guion.indexOf('"#;'));
    // Las dos que estaban sueltas el 19/09, cada una por su sitio.
    expect(hasta).not.toContain("||'✓ Thanks");
    expect(hasta).not.toContain("alert('Something");
    // Y se leen por la tabla, no por una constante.
    expect(hasta).toContain("tr('ok')");
    expect(hasta).toContain("tr('err')");
  });

  it("el idioma se resuelve en el NAVEGADOR, contra <html lang>", () => {
    // No al hornear: la variante traducida de una página publicada (/fr/, /ja/)
    // comparte el mismo guion y tiene que acertar sin volver a hornearlo.
    const guion = fuente();
    expect(guion).toContain("document.documentElement.getAttribute('lang')");
    expect(guion).toContain("slice(0,2)"); // pt-BR -> pt, zh-CN -> zh
  });

  it("🔴 EJECUTADO: el visitante lee su idioma, no el inglés", () => {
    const catalogo = JSON.parse(tablaDeIdiomas().replace(/^var T=/, "").replace(/;$/, ""));
    // Los tres casos que importan: el que falló en producción, uno de otro
    // alfabeto, y un idioma que no conocemos.
    expect(graciasEnIdioma("es")).toBe(catalogo.es.ok);
    expect(graciasEnIdioma("ja")).toBe(catalogo.ja.ok);
    expect(graciasEnIdioma("xx")).toBe(catalogo.en.ok); // sin idioma conocido, inglés
    // Y la variante regional entra por su raíz: `/pt-BR/` habla portugués.
    expect(graciasEnIdioma("pt-BR")).toBe(catalogo.pt.ok);
    expect(graciasEnIdioma("es")).not.toBe(catalogo.en.ok);
  });

  it("el guion se queda en ASCII puro", () => {
    const guion = fuente();
    const trozo = guion.slice(guion.indexOf("const FORM_SCRIPT"));
    const cuerpo = trozo.slice(0, trozo.indexOf('"#;'));
    // eslint-disable-next-line no-control-regex
    expect(cuerpo).not.toMatch(/[^\x00-\x7f]/);
  });
});
