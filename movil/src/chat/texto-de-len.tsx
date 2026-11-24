// WHAT LEN (OR AN AGENT) WRITES, DRAWN ON THE PHONE. It is Markdown: the web draws it
// (components/workspace-v2/texto-de-len.tsx) and Claude Code's text «will be rendered … using the
// CommonMark specification». The phone painted it raw until 24/11 — «**You're around A2**», «*went*»
// with their asterisks. Same parser as the web (`parseLenMarkdown`, DeepSeek's), a smaller painter:
// each text is text React escapes, raw HTML stays inert text, a link opens only when it is an
// absolute http(s) or mailto address (`safeHref`) and in the system browser, and an image is its
// alt text (nothing remote loads in a bubble). What a person writes is never passed through here.
import type { ReactNode } from "react";
import type { ListItem, Nodes, PhrasingContent, RootContent } from "mdast";
import { parseLenMarkdown, safeHref } from "@/lib/chat/markdown-de-len";
import { plataforma } from "../sesion/plataforma";

function enLinea(nodes: readonly PhrasingContent[]): ReactNode[] {
  return nodes.map((n, i) => inline(n, i));
}

function inline(n: PhrasingContent, key: number): ReactNode {
  switch (n.type) {
    case "text":
      return n.value;
    case "strong":
      return <strong key={key}>{enLinea(n.children)}</strong>;
    case "emphasis":
      return <em key={key}>{enLinea(n.children)}</em>;
    case "delete":
      return <s key={key}>{enLinea(n.children)}</s>;
    case "inlineCode":
      return <code key={key}>{n.value}</code>;
    case "break":
      return <br key={key} />;
    case "link": {
      const href = safeHref(n.url);
      if (!href) return <span key={key}>{enLinea(n.children)}</span>;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(ev) => {
            ev.preventDefault();
            void plataforma.abrirNavegador(href).catch(() => {});
          }}
        >
          {enLinea(n.children)}
        </a>
      );
    }
    case "linkReference":
      return <span key={key}>{enLinea(n.children)}</span>;
    case "image":
    case "imageReference":
      return n.alt ? <span key={key}>{n.alt}</span> : null;
    case "html":
      return n.value;
    case "footnoteReference":
      return `[^${n.identifier}]`;
    default:
      return null;
  }
}

/** A tight list's item holds its sentences straight in the `li`, not in paragraphs. */
function item(li: ListItem, tight: boolean, key: number): ReactNode {
  const check = li.checked === true ? "☑ " : li.checked === false ? "☐ " : "";
  return (
    <li key={key}>
      {check}
      {li.children.map((c, i) => (tight && c.type === "paragraph" ? <span key={i}>{enLinea(c.children)}</span> : block(c, i)))}
    </li>
  );
}

function block(n: RootContent | Nodes, key: number): ReactNode {
  switch (n.type) {
    case "paragraph":
      return <p key={key}>{enLinea(n.children)}</p>;
    case "heading":
      return (
        <p key={key} className="ch-md-h">
          <strong>{enLinea(n.children)}</strong>
        </p>
      );
    case "list": {
      const tight = n.spread !== true;
      const items = n.children.map((li, i) => item(li, tight, i));
      return n.ordered ? (
        <ol key={key} start={n.start ?? undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "code":
      return (
        <pre key={key}>
          <code>{n.value}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote key={key}>{n.children.map((c, i) => block(c, i))}</blockquote>;
    case "table":
      return (
        <div key={key} className="ch-md-table">
          <table>
            <tbody>
              {n.children.map((row, r) => (
                <tr key={r}>
                  {row.children.map((cell, c) => (r === 0 ? <th key={c}>{enLinea(cell.children)}</th> : <td key={c}>{enLinea(cell.children)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return <p key={key}>{n.value}</p>;
    case "definition":
    case "footnoteDefinition":
      return null;
    default:
      return "children" in n && Array.isArray(n.children) ? <p key={key}>{enLinea(n.children as PhrasingContent[])}</p> : null;
  }
}

/** Len's (or an agent's) text, drawn: paragraphs, bold, italics, lists, code, links and tables. */
export function TextoDeLen({ texto }: { texto: string }) {
  let tree;
  try {
    tree = parseLenMarkdown(texto);
  } catch {
    return <>{texto}</>;
  }
  return <>{tree.children.map((n, i) => block(n, i))}</>;
}
