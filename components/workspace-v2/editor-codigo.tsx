"use client";

// EL EDITOR DE LA LENTE «CÓDIGO», como el de VS Code: CodeMirror 6 con lo que
// casi todo el mundo usa — colores, números de línea, Tab que sangra, cierre de
// paréntesis y etiquetas, plegar, varios cursores (Alt+clic), buscar y
// reemplazar en el fichero (Ctrl+F, Ctrl+H… el `searchKeymap`), deshacer por
// fichero y autocompletar.
//
// NO CONTROLADO a propósito: CodeMirror es dueño de su documento (con su
// historial y su selección), y repintarlo desde React en cada tecla los
// rompería. El padre recibe cada cambio (`onCambio`) y, cuando el contenido
// cambia POR FUERA —«cargar lo de ahora», un guardado normalizado—, sube
// `revision` y el editor se reemplaza con `valor`.
//
// Los colores son los del taller (`--sx-*` de tokens.css): el mismo código se ve
// igual en el editor que en la vista de sólo lectura, en claro y en oscuro.
//
// Pulsar el NÚMERO de una línea la comenta para el siguiente mensaje a Len (la
// #8): `onNumero`. Las líneas que ya llevan comentario se marcan en el margen.

import { useEffect, useRef } from "react";
import { Annotation, EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  crosshairCursor,
  drawSelection,
  dropCursor,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { coloresDelEditor } from "./colores-del-editor";

/** El lenguaje por la extensión del fichero; sin uno conocido, texto plano. */
export function lenguajeDeRuta(ruta: string): Extension {
  const ext = ruta.slice(ruta.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
    case "webmanifest":
      return json();
    case "md":
      return markdown();
    case "sql":
      return sql();
    default:
      return [];
  }
}


const tema = EditorView.theme({
  "&": { height: "100%", fontSize: "11.5px", backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--fg)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-faint)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { cursor: "pointer", padding: "0 8px 0 10px" },
  ".cm-lineNumbers .cm-gutterElement:hover": { color: "var(--accent)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)", outline: "1px solid var(--accent)" },
  ".cm-panels": { backgroundColor: "var(--bg-elev)", color: "var(--fg)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button, .cm-panels label": { fontSize: "11.5px", fontFamily: "inherit" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border-strong, var(--border))",
    borderRadius: "6px",
    padding: "3px 8px",
    margin: 0,
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "var(--accent)" },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--bg)",
    color: "var(--fg-muted)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "3px 8px",
    margin: 0,
    textTransform: "none",
  },
  ".cm-button:hover": { color: "var(--fg)", borderColor: "var(--border-strong, var(--border))" },
  ".cm-panel.cm-search label": { display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--fg-muted)" },
  ".cm-panel.cm-search [name=close]": { color: "var(--fg-faint)", fontSize: "14px", top: "4px", right: "6px" },
  ".cm-tooltip": { backgroundColor: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--fg)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "white" },
  ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "1px solid var(--border)", color: "var(--fg-muted)" },
  ".ol-linea-saltada": { backgroundColor: "var(--accent-soft, color-mix(in srgb, var(--accent) 15%, transparent))" },
  ".ol-marca-comentario": { color: "var(--accent)", paddingLeft: "4px" },
});

/** Marca lo que entra POR FUERA (`revision`): no es una tecla del dueño, y no se avisa con `onCambio`. */
const deFuera = Annotation.define<boolean>();

// ── Las líneas con comentario, en el margen ──────────────────────────────────
class MarcaDeComentario extends GutterMarker {
  override toDOM() {
    const s = document.createElement("span");
    s.className = "ol-marca-comentario";
    s.textContent = "●";
    return s;
  }
}
const MARCA = new MarcaDeComentario();
const ponerComentadas = StateEffect.define<readonly number[]>();
const comentadas = StateField.define<readonly number[]>({
  create: () => [],
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(ponerComentadas)) return e.value;
    return v;
  },
});
const margenDeComentarios = gutter({
  class: "ol-gutter-comentarios",
  markers: (view) => {
    const lineas = view.state.field(comentadas);
    const marcas = lineas
      .filter((n) => n >= 1 && n <= view.state.doc.lines)
      .sort((a, b) => a - b)
      .map((n) => MARCA.range(view.state.doc.line(n).from));
    return RangeSet.of(marcas);
  },
});

export interface EditorCodigoProps {
  readonly ruta: string;
  readonly valor: string;
  /** Cambia cuando el contenido cambia por fuera (o en el otro editor del mismo
   *  archivo): el editor se reemplaza con `valor`. */
  readonly revision: number | string;
  readonly soloLectura?: boolean;
  readonly onCambio?: (texto: string) => void;
  readonly onGuardar?: () => void;
  /** Pulsaron el número de una línea (comentarla para Len). */
  readonly onNumero?: (linea: number, texto: string) => void;
  /** Las líneas que llevan comentario pendiente. */
  readonly lineasComentadas?: readonly number[];
  /** Ir a una línea (un resultado de la búsqueda): se centra y se selecciona. */
  readonly salto?: { readonly linea: number; readonly n: number } | null;
  readonly etiqueta: string;
  /** Las frases de CodeMirror en el idioma del dueño (su clave es el texto en
   *  inglés: «Find», «replace all»…). Sin ellas, en inglés. */
  readonly frases?: Readonly<Record<string, string>>;
}

export default function EditorCodigo({
  ruta,
  valor,
  revision,
  soloLectura = false,
  onCambio,
  onGuardar,
  onNumero,
  lineasComentadas,
  salto = null,
  etiqueta,
  frases,
}: EditorCodigoProps) {
  const caja = useRef<HTMLDivElement>(null);
  const vista = useRef<EditorView | null>(null);
  // Los manejadores, siempre los últimos: el editor se crea una vez.
  const cb = useRef({ onCambio, onGuardar, onNumero });
  cb.current = { onCambio, onGuardar, onNumero };

  useEffect(() => {
    if (!caja.current) return;
    const v = new EditorView({
      parent: caja.current,
      state: EditorState.create({
        doc: valor,
        extensions: [
          // LO DE `basicSetup` de CodeMirror, menos sus números de línea: los
          // de aquí son clicables (comentar la línea para Len).
          lineNumbers({
            domEventHandlers: {
              mousedown: (view, line) => {
                const n = view.state.doc.lineAt(line.from).number;
                cb.current.onNumero?.(n, view.state.doc.line(n).text);
                return true;
              },
            },
          }),
          comentadas,
          margenDeComentarios,
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                cb.current.onGuardar?.();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
          lenguajeDeRuta(ruta),
          ...(frases ? [EditorState.phrases.of(frases)] : []),
          coloresDelEditor,
          tema,
          // «Las líneas bajan» (Jesús, 02/10): el ajuste de línea, como hasta ahora.
          EditorView.lineWrapping,
          EditorState.readOnly.of(soloLectura),
          EditorView.editable.of(!soloLectura),
          EditorView.contentAttributes.of({ "aria-label": etiqueta, spellcheck: "false", autocapitalize: "off" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.every((t) => t.annotation(deFuera))) cb.current.onCambio?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    vista.current = v;
    return () => {
      v.destroy();
      vista.current = null;
    };
    // Un fichero, un editor: la ruta y el modo lo rehacen; el texto, no (ver `revision`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, soloLectura]);

  // Lo que cambió POR FUERA: se reemplaza el documento entero.
  const vista0 = useRef(revision);
  useEffect(() => {
    const v = vista.current;
    if (!v || vista0.current === revision) return;
    vista0.current = revision;
    if (v.state.doc.toString() !== valor) {
      // Lo escrito en el OTRO editor llega a éste: el cursor se queda donde
      // estaba (recortado si el texto encogió).
      const cursor = Math.min(v.state.selection.main.head, valor.length);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: valor }, selection: { anchor: cursor }, annotations: deFuera.of(true) });
    }
  }, [revision, valor]);

  useEffect(() => {
    vista.current?.dispatch({ effects: ponerComentadas.of(lineasComentadas ?? []) });
  }, [lineasComentadas]);

  // A la línea pedida, una vez por salto.
  const saltado = useRef<number | null>(null);
  useEffect(() => {
    const v = vista.current;
    if (!v || !salto || saltado.current === salto.n || salto.linea > v.state.doc.lines) return;
    saltado.current = salto.n;
    const l = v.state.doc.line(salto.linea);
    v.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
    v.focus();
  }, [salto, revision]);

  return <div ref={caja} className="h-full min-h-0" data-editor-codigo="" />;
}
