// lib/apps/error-overlay.ts — LA CAPA DE ERROR DEL LIENZO, como la de Vite.
//
// Un fuente que no compila se sirve como un módulo que LANZA su error
// (`moduloDeError`, servir.ts). Eso basta para los ojos de Len y para la consola,
// pero quien mira el lienzo veía la pantalla en blanco sin una palabra: Jesús paró
// a Len entre dos ediciones (abrió `<Paralaje>` en una y lo iba a cerrar en la
// siguiente) y la app se quedó en blanco (10/10). Vite, en el mismo caso, pinta
// encima su capa: el mensaje, el fichero y la línea, el trozo de código, y se
// cierra con Esc, con un clic fuera, o al arreglar el código. Ésta es esa capa.
//
// Sólo la llevan el lienzo y los ojos: la publicación se niega a publicar una
// app que no compila, así que nunca llega a un visitante. El texto entra con
// `textContent`, nunca como HTML (es el código del dueño), y en un shadow root,
// para que el CSS de la app no la toque ni ella al de la app.
import { codeFrame } from "./code-frame";
import type { Diagnostico } from "./compilador";

export interface ErrorOverlayEntry {
  readonly message: string;
  /** `ruta:línea:columna`, lo que se puede abrir en la lente Código. */
  readonly file: string;
  readonly frame: string | null;
}

export function errorOverlayEntries(errores: readonly Diagnostico[], carpeta?: Readonly<Record<string, string>>): ErrorOverlayEntry[] {
  return errores.map((d) => {
    const fuente = carpeta && Object.hasOwn(carpeta, d.ruta) ? carpeta[d.ruta]! : null;
    return {
      message: d.mensaje,
      file: d.linea === null ? d.ruta : d.columna === null ? `${d.ruta}:${d.linea}` : `${d.ruta}:${d.linea}:${d.columna}`,
      frame: fuente !== null && d.linea !== null ? codeFrame(fuente, d.linea, d.columna) : null,
    };
  });
}

// Los colores y las medidas, los de la capa de Vite (`vite-error-overlay`).
const CSS = [
  ":host{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;margin:0;background:rgba(0,0,0,.66)}",
  ".window{font-family:SFMono-Regular,Consolas,'Liberation Mono',Menlo,Courier,monospace;line-height:1.5;box-sizing:border-box;max-width:min(80vw,960px);color:#d8d8d8;margin:30px auto;padding:2.5vh 4vw;position:relative;background:#181818;border-radius:6px 6px 8px 8px;box-shadow:0 19px 38px rgba(0,0,0,.3),0 15px 12px rgba(0,0,0,.22);overflow:hidden;border-top:8px solid #ff5555;direction:ltr;text-align:left}",
  "pre{font-family:inherit;font-size:14px;margin:0 0 1em;overflow-x:auto;white-space:pre}",
  ".plugin{color:#cfa4ff;font-size:13px;margin-bottom:.75em;white-space:pre-wrap}",
  ".message{color:#ff5555;font-weight:600;line-height:1.3;white-space:pre-wrap}",
  ".file{color:#2dd9da;margin-bottom:.5em;white-space:pre-wrap;word-break:break-all}",
  ".frame{color:#e2aa53}",
  ".tip{font-family:system-ui,sans-serif;font-size:13px;color:#999;border-top:1px dotted #999;padding-top:13px;line-height:1.8}",
  "@media (max-width:600px){.window{max-width:none;margin:12px;padding:16px}pre{font-size:12px}}",
].join("");

// JavaScript del navegador, a mano: va DENTRO del módulo de error. Sin
// documento (Node, una prueba) no hace nada, y el módulo sólo lanza.
const PINTAR = `function (titulo, errores, css) {
  if (typeof document === "undefined" || !document.documentElement) return;
  var vieja = document.querySelector("openlen-error-overlay");
  if (vieja) vieja.remove();
  var host = document.createElement("openlen-error-overlay");
  var raiz = host.attachShadow({ mode: "open" });
  var estilo = document.createElement("style");
  estilo.textContent = css;
  raiz.appendChild(estilo);
  var ventana = document.createElement("div");
  ventana.className = "window";
  function bloque(etiqueta, clase, texto) {
    var el = document.createElement(etiqueta);
    el.className = clase;
    el.textContent = texto;
    ventana.appendChild(el);
  }
  bloque("pre", "plugin", titulo);
  for (var i = 0; i < errores.length; i++) {
    bloque("pre", "message", errores[i].message);
    bloque("pre", "file", errores[i].file);
    if (errores[i].frame) bloque("pre", "frame", errores[i].frame);
  }
  bloque("div", "tip", "Click outside, press Esc key, or fix the code to dismiss.");
  raiz.appendChild(ventana);
  function cerrar() {
    host.remove();
    document.removeEventListener("keydown", tecla);
  }
  function tecla(e) {
    if (e.key === "Escape") cerrar();
  }
  ventana.addEventListener("click", function (e) { e.stopPropagation(); });
  host.addEventListener("click", cerrar);
  document.addEventListener("keydown", tecla);
  (document.body || document.documentElement).appendChild(host);
}`;

/** La llamada que pinta la capa, para ir delante del `throw` del módulo de error. */
export function errorOverlayScript(titulo: string, entries: readonly ErrorOverlayEntry[]): string {
  return `(${PINTAR})(${JSON.stringify(titulo)}, ${JSON.stringify(entries)}, ${JSON.stringify(CSS)});\n`;
}
