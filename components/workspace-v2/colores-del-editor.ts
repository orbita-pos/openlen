/**
 * LOS COLORES DEL EDITOR, los de VS Code («Light+» en claro, «Dark+» en
 * oscuro): una función en amarillo/marrón, una variable en azul claro/marino,
 * un componente o un tipo en verde azulado, `import`/`return` en morado y
 * `const`/`function` en azul. Y las llaves por nivel, en tres colores que se
 * turnan (la «bracket pair colorization» de VS Code), para ver qué cierra qué.
 *
 * Los valores viven en `app/[locale]/new/tokens.css` (`--sx-*`), con su par de
 * oscuro: aquí sólo se dice qué color lleva cada cosa.
 *
 * Lo que cambia de color según el lenguaje (un `<App />` es un componente en
 * JSX pero una etiqueta en HTML; una propiedad es una variable en JS, rojo en
 * CSS y una clave en JSON) va en el estilo de ESE lenguaje: ver
 * `estilosPorLenguaje`.
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, languageDataProp, syntaxHighlighting, syntaxTree, type Language } from "@codemirror/language";
import { tags as t, type Highlighter, type Tag } from "@lezer/highlight";
import type { NodeType } from "@lezer/common";
import { htmlLanguage } from "@codemirror/lang-html";
import { cssLanguage } from "@codemirror/lang-css";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";

type Regla = { readonly tag: Tag | readonly Tag[]; readonly [estilo: string]: unknown };

/** Lo que pinta igual en todos los lenguajes. */
const comunes: Regla[] = [
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--sx-com)" },
  { tag: [t.string, t.special(t.string), t.monospace], color: "var(--sx-val)" },
  { tag: t.regexp, color: "var(--sx-reg)" },
  { tag: [t.escape, t.character], color: "var(--sx-esc)" },
  { tag: [t.number, t.unit], color: "var(--sx-num)" },
  { tag: [t.keyword, t.bool, t.null, t.self, t.atom, t.definitionKeyword, t.modifier, t.operatorKeyword, t.documentMeta], color: "var(--sx-pal)" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--sx-ctl)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--sx-var)" },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName))], color: "var(--sx-fun)" },
  { tag: [t.typeName, t.definition(t.typeName), t.className, t.definition(t.className), t.namespace], color: "var(--sx-tip)" },
  { tag: t.tagName, color: "var(--sx-etq)" },
  { tag: t.angleBracket, color: "var(--sx-ang)" },
  { tag: t.attributeName, color: "var(--sx-atr)" },
  { tag: t.attributeValue, color: "var(--sx-atv)" },
  { tag: t.heading, color: "var(--sx-tit)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--sx-cssv)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--danger, #e5484d)" },
];

/**
 * Lo propio de cada lenguaje, ENCIMA de lo común (gana la regla de la
 * etiqueta más concreta, y a igualdad, la de después).
 */
const propias: readonly (readonly [Language, Regla[]])[] = [
  [htmlLanguage, []],
  [
    // JS/JSX/TS: un componente (`<App />`) como un tipo; `<div>`, como etiqueta;
    // una propiedad, como variable, y si se llama (`getElementById(…)`), función.
    javascriptLanguage,
    [
      { tag: t.tagName, color: "var(--sx-tip)" },
      { tag: t.standard(t.tagName), color: "var(--sx-etq)" },
      { tag: [t.propertyName, t.definition(t.propertyName), t.special(t.propertyName)], color: "var(--sx-var)" },
      { tag: t.function(t.propertyName), color: "var(--sx-fun)" },
      { tag: t.attributeName, color: "var(--sx-atr)" },
    ],
  ],
  [
    // CSS: el selector, la propiedad y su valor (`flex`, `red`), cada uno con el suyo.
    cssLanguage,
    [
      { tag: [t.tagName, t.className, t.constant(t.className), t.labelName], color: "var(--sx-sel)" },
      { tag: [t.propertyName, t.attributeName], color: "var(--sx-atr)" },
      { tag: [t.atom, t.color], color: "var(--sx-cssv)" },
    ],
  ],
  // JSON: las claves.
  [jsonLanguage, [{ tag: t.propertyName, color: "var(--sx-pro)" }]],
];

/**
 * Un estilo COMPLETO por lenguaje, y el común para el resto (Markdown, SQL…).
 * No se apilan: si a un trozo le dieran color dos estilos, ganaría el que se
 * montó después, y un `const` de un `<script>` o un `red` de un `<style>` (un
 * `atom` es un subtipo de `keyword` en lezer) acabarían con el que no es.
 */
function estilosPorLenguaje(): Extension[] {
  const fuera: Extension[] = propias.map(([lenguaje, reglas]) =>
    syntaxHighlighting(HighlightStyle.define([...comunes, ...reglas] as Parameters<typeof HighlightStyle.define>[0], { scope: lenguaje })),
  );
  const resto = HighlightStyle.define(comunes as Parameters<typeof HighlightStyle.define>[0]);
  const conocido = (tipo: NodeType) => propias.some(([l]) => tipo.prop(languageDataProp) === l.data);
  const paraElResto: Highlighter = { style: (tags) => resto.style(tags), scope: (tipo) => !conocido(tipo) };
  return [...fuera, syntaxHighlighting(paraElResto), EditorView.styleModule.of(resto.module!)];
}

const ABRE = new Set(["(", "[", "{"]);
const CIERRA = new Set([")", "]", "}"]);
const NIVELES = 3;
const marcas = Array.from({ length: NIVELES }, (_, i) => Decoration.mark({ class: `cm-llave-${i + 1}` }));

/**
 * La profundidad de cada llave hasta donde se ve, contada desde el principio
 * del documento (una llave abierta arriba del todo cambia el color de las de
 * abajo). Sólo cuentan las del árbol: un `(` dentro de un texto no es llave.
 */
function llaves(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const hasta = view.viewport.to;
  const desde = view.viewport.from;
  let nivel = 0;
  syntaxTree(view.state).iterate({
    to: hasta,
    enter: (n) => {
      const nombre = n.type.name;
      if (ABRE.has(nombre)) {
        if (n.from >= desde) b.add(n.from, n.to, marcas[nivel % NIVELES]!);
        nivel++;
      } else if (CIERRA.has(nombre)) {
        nivel = Math.max(0, nivel - 1);
        if (n.from >= desde) b.add(n.from, n.to, marcas[nivel % NIVELES]!);
      }
    },
  });
  return b.finish();
}

const colorDeLlaves = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    arbol: unknown;
    constructor(view: EditorView) {
      this.decorations = llaves(view);
      this.arbol = syntaxTree(view.state);
    }
    update(u: ViewUpdate) {
      const arbol = syntaxTree(u.state);
      if (u.docChanged || u.viewportChanged || arbol !== this.arbol) {
        this.decorations = llaves(u.view);
        this.arbol = arbol;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const temaDeLlaves = EditorView.baseTheme({
  ".cm-llave-1, .cm-llave-1 *": { color: "var(--sx-ll1)" },
  ".cm-llave-2, .cm-llave-2 *": { color: "var(--sx-ll2)" },
  ".cm-llave-3, .cm-llave-3 *": { color: "var(--sx-ll3)" },
});

export const coloresDelEditor: Extension = [...estilosPorLenguaje(), colorDeLlaves, temaDeLlaves];
