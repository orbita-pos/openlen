"use client";

// EL TEXTO DE LEN EN EL CHAT, sacado de `panels/chat-panel.tsx` para que el
// ejemplo de `/dev/terminal` pinte el mismo componente que el Chat.
//
// A8 de Len 3.1 (DeepSeek `web-assistant-markdown`, MIT): Markdown DE VERDAD.
// `parseLenMarkdown` da el árbol y aquí se pinta con un solo `switch` sobre sus
// nodos, como su renderer: cada texto es texto que React escapa, el HTML crudo
// sale tal cual escrito, los enlaces sólo a http(s) y mailto absolutos, y una
// imagen remota no se carga (sale como enlace). Cada línea que escribió Len
// sigue siendo su línea (`whitespace-pre-wrap` en cada bloque), como antes.

import { createElement, Fragment, type ReactNode } from "react";
import type { Definition, ListItem, Nodes, PhrasingContent, Root, RootContent } from "mdast";

import { parseLenMarkdown, safeHref, wholeHttpUrl } from "@/lib/chat/markdown-de-len";
import { isCommonsCopy } from "@/lib/chat/commons-image";
import { PhotoGallery, type GalleryPhoto } from "./chat/photo-gallery";
import { rutaMencionada } from "@/lib/workspace-v2/abrir-fichero";

const CODE_CLASS = "font-mono text-[11.5px] rounded px-1 border bd";

/** Un trozo de código del texto de Len; si nombra un fichero del turno, lo abre. */
function CodigoDeLen({
  texto,
  ruta,
  onAbrir,
}: {
  texto: string;
  ruta: string | null;
  onAbrir: ((ruta: string) => void) | undefined;
}) {
  if (!ruta || !onAbrir) return <code className={CODE_CLASS}>{texto}</code>;
  return (
    <button
      type="button"
      onClick={() => onAbrir(ruta)}
      title={ruta}
      className={`${CODE_CLASS} text-accent hover:underline align-baseline`}
    >
      {texto}
    </button>
  );
}

/** Un enlace del chat: se abre en otra pestaña, sin darle a la página de destino acceso a ésta. */
export function ChatLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-2 hover:underline break-all">
      {children}
    </a>
  );
}

interface Pintar {
  readonly rutas: readonly string[];
  readonly onAbrir: ((ruta: string) => void) | undefined;
  /** Las definiciones `[x]: url` del texto, para los enlaces por referencia. */
  readonly definiciones: ReadonlyMap<string, Definition>;
}

/** Cada bloque separado del anterior; el primero, pegado. Y sus líneas, las de Len. */
const BLOQUE = "mt-2 first:mt-0";
const LINEAS = "whitespace-pre-wrap break-words";

function enLinea(nodos: readonly PhrasingContent[], p: Pintar): ReactNode[] {
  return nodos.map((n, i) => <Fragment key={i}>{frase(n, p)}</Fragment>);
}

function frase(n: PhrasingContent, p: Pintar): ReactNode {
  switch (n.type) {
    case "text":
      return n.value;
    case "strong":
      return <strong className="font-semibold">{enLinea(n.children, p)}</strong>;
    case "emphasis":
      return <em>{enLinea(n.children, p)}</em>;
    case "delete":
      return <del>{enLinea(n.children, p)}</del>;
    case "inlineCode": {
      const url = wholeHttpUrl(n.value);
      if (url) return <ChatLink href={url}><code className={CODE_CLASS}>{n.value}</code></ChatLink>;
      return <CodigoDeLen texto={n.value} ruta={p.onAbrir ? rutaMencionada(n.value, p.rutas) : null} onAbrir={p.onAbrir} />;
    }
    case "break":
      return <br />;
    case "link": {
      const href = safeHref(n.url);
      return href ? <ChatLink href={href}>{enLinea(n.children, p)}</ChatLink> : enLinea(n.children, p);
    }
    case "linkReference": {
      const href = safeHref(p.definiciones.get(n.identifier)?.url);
      return href ? <ChatLink href={href}>{enLinea(n.children, p)}</ChatLink> : enLinea(n.children, p);
    }
    case "image":
    case "imageReference": {
      // Una imagen remota no se carga en el chat: lo que diga Len, como enlace a ella.
      const url = n.type === "image" ? n.url : p.definiciones.get(n.identifier)?.url;
      const texto = n.alt || url || "";
      const href = safeHref(url);
      return href ? <ChatLink href={href}>{texto}</ChatLink> : texto;
    }
    case "html":
      return n.value;
    case "footnoteReference":
      return <sup>[{n.label ?? n.identifier}]</sup>;
    default:
      return null;
  }
}

/** Una lista apretada no lleva párrafos dentro: sus frases van directas en el `li`. */
function delElemento(item: ListItem, p: Pintar): ReactNode[] {
  return item.children.map((hijo, i) =>
    hijo.type === "paragraph" && !item.spread ? <Fragment key={i}>{enLinea(hijo.children, p)}</Fragment> : <Fragment key={i}>{bloque(hijo, p)}</Fragment>,
  );
}

/** A photo `image_search` copied to our storage, the one remote image the chat loads (spec local
 *  2026-10-27-chat-drop-and-images); any other stays a link (`frase`). */
function fotoNuestra(n: PhrasingContent): GalleryPhoto | null {
  return n.type === "image" && isCommonsCopy(n.url) ? { url: n.url, alt: n.alt ?? "" } : null;
}
const soloEspacio = (n: PhrasingContent) => n.type === "break" || (n.type === "text" && !n.value.trim());

/** A paragraph with our photos: each run of them (spaces and line breaks between don't count) is
 *  one gallery, where it was written; the text around stays text. A `div`, since a gallery can't
 *  live in a `<p>`. */
function parrafoConFotos(nodos: readonly PhrasingContent[], p: Pintar, cola: ReactNode): ReactNode {
  const piezas: ReactNode[] = [];
  let texto: PhrasingContent[] = [];
  let fotos: GalleryPhoto[] = [];
  const cerrarTexto = () => {
    if (texto.some((n) => !soloEspacio(n))) piezas.push(<span key={piezas.length} className={LINEAS}>{enLinea(texto, p)}</span>);
    texto = [];
  };
  const cerrarFotos = () => {
    if (fotos.length) piezas.push(<PhotoGallery key={piezas.length} photos={fotos} />);
    fotos = [];
  };
  for (const n of nodos) {
    const foto = fotoNuestra(n);
    if (foto) {
      cerrarTexto();
      fotos.push(foto);
    } else if (fotos.length && soloEspacio(n)) {
      continue;
    } else {
      cerrarFotos();
      texto.push(n);
    }
  }
  cerrarFotos();
  cerrarTexto();
  return (
    <div className={`m-0 ${BLOQUE}`}>
      {piezas}
      {cola}
    </div>
  );
}

function bloque(n: RootContent, p: Pintar, cola?: ReactNode): ReactNode {
  switch (n.type) {
    case "paragraph":
      if (n.children.some((c) => fotoNuestra(c))) return parrafoConFotos(n.children, p, cola);
      return <p className={`m-0 ${BLOQUE} ${LINEAS}`}>{enLinea(n.children, p)}{cola}</p>;
    case "heading":
      // En el chat un título es una línea fuerte, no un cartel: h3 hacia abajo.
      return createElement(
        `h${Math.min(6, n.depth + 2)}`,
        { className: `m-0 ${BLOQUE} ${LINEAS} font-semibold ${n.depth <= 2 ? "text-[15px]" : ""}` },
        enLinea(n.children, p),
        cola,
      );
    case "list": {
      const items = n.children.map((item, i) => (
        <li key={i} className={`${LINEAS} mt-0.5 first:mt-0`}>
          {typeof item.checked === "boolean" && (
            <input type="checkbox" checked={item.checked} disabled readOnly className="mr-1.5 align-middle" />
          )}
          {delElemento(item, p)}
        </li>
      ));
      return n.ordered ? (
        <ol className={`m-0 ${BLOQUE} list-decimal pl-5`} {...(n.start != null && n.start !== 1 ? { start: n.start } : {})}>
          {items}
        </ol>
      ) : (
        <ul className={`m-0 ${BLOQUE} list-disc pl-5`}>{items}</ul>
      );
    }
    case "code":
      return (
        <pre className={`m-0 ${BLOQUE} overflow-x-auto rounded-lg border bd px-3 py-2 font-mono text-[12px] leading-[1.5]`}>
          <code>{n.value}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote className={`m-0 ${BLOQUE} border-l-2 bd pl-3 fg-muted`}>{n.children.map((h, i) => <Fragment key={i}>{bloque(h, p)}</Fragment>)}</blockquote>;
    case "table": {
      const [cabecera, ...filas] = n.children;
      const celda = (tag: "th" | "td", c: (typeof n.children)[number]["children"][number], j: number) =>
        createElement(
          tag,
          {
            key: j,
            className: `border bd px-2 py-1 ${tag === "th" ? "font-semibold" : ""}`,
            style: { textAlign: n.align?.[j] ?? "left" },
          },
          enLinea(c.children, p),
        );
      return (
        <div className={`${BLOQUE} overflow-x-auto`}>
          <table className="border-collapse text-[13px]">
            {cabecera && (
              <thead>
                <tr>{cabecera.children.map((c, j) => celda("th", c, j))}</tr>
              </thead>
            )}
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}>{f.children.map((c, j) => celda("td", c, j))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "thematicBreak":
      return <hr className={`${BLOQUE} border-0 border-t bd`} />;
    case "html":
      // Sin intérprete de HTML: sale como lo escribió.
      return <p className={`m-0 ${BLOQUE} ${LINEAS}`}>{n.value}{cola}</p>;
    case "footnoteDefinition":
      return (
        <div className={`${BLOQUE} text-[12px] fg-muted`}>
          [{n.label ?? n.identifier}] {n.children.map((h, i) => <Fragment key={i}>{bloque(h, p)}</Fragment>)}
        </div>
      );
    default:
      return null;
  }
}

/** Un bloque en una línea (`enLinea`): sus frases, sin elementos de bloque —va
 *  dentro de un `<p>` de quien llama—. Una lista conserva su número o su viñeta
 *  a la vista: «1. Revisar el pie», en la tarjeta del plan, sigue diciendo 1. */
function aplanado(n: RootContent, p: Pintar): ReactNode {
  switch (n.type) {
    case "paragraph":
    case "heading":
      return enLinea(n.children, p);
    case "list":
      return n.children.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {n.ordered ? `${(n.start ?? 1) + i}. ` : "• "}
          {item.children.map((h, j) => <Fragment key={j}>{j > 0 && " "}{aplanado(h, p)}</Fragment>)}
        </Fragment>
      ));
    case "blockquote":
    case "footnoteDefinition":
      return n.children.map((h, i) => <Fragment key={i}>{i > 0 && " "}{aplanado(h, p)}</Fragment>);
    case "code":
      return <code className={CODE_CLASS}>{n.value}</code>;
    case "html":
      return n.value;
    case "table":
      return n.children.map((fila, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {fila.children.map((c, j) => <Fragment key={j}>{j > 0 && " | "}{enLinea(c.children, p)}</Fragment>)}
        </Fragment>
      ));
    case "thematicBreak":
      return "—";
    default:
      return null;
  }
}

function definicionesDe(raiz: Root): Map<string, Definition> {
  const out = new Map<string, Definition>();
  const visitar = (n: Nodes) => {
    if (n.type === "definition") out.set(n.identifier, n);
    if ("children" in n) for (const h of n.children) visitar(h as Nodes);
  };
  visitar(raiz);
  return out;
}

/** Lo que Len escribe, en Markdown de verdad. `enLinea`: para una línea ya
 *  cortada (la tarjeta de la pregunta), sin bloques. `cola`: lo que va al final
 *  del último bloque (el cursor mientras escribe). */
export function TextoDeLen({
  texto,
  rutas = [],
  onAbrir,
  enLinea: soloEnLinea = false,
  cola,
}: {
  texto: string;
  /** Los ficheros que el turno leyó o cambió: un trozo de código que nombra
   *  uno de ellos abre ese fichero (la #9, `rutaMencionada`). */
  rutas?: readonly string[];
  onAbrir?: (ruta: string) => void;
  enLinea?: boolean;
  cola?: ReactNode;
}) {
  const raiz = parseLenMarkdown(texto);
  const p: Pintar = { rutas, onAbrir, definiciones: definicionesDe(raiz) };
  const bloques = raiz.children.filter((n) => n.type !== "definition");
  if (soloEnLinea) {
    return (
      <>
        {bloques.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            {aplanado(n, p)}
          </Fragment>
        ))}
        {cola}
      </>
    );
  }
  const ultimo = bloques.length - 1;
  const colaDentro = ultimo >= 0 && ["paragraph", "heading", "html"].includes(bloques[ultimo]!.type);
  return (
    <>
      {bloques.map((n, i) => (
        <Fragment key={i}>{bloque(n, p, i === ultimo && colaDentro ? cola : undefined)}</Fragment>
      ))}
      {!colaDentro && cola}
    </>
  );
}
