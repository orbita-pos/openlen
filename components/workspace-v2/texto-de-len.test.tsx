// A8 of Len 3.1, DeepSeek's `web-assistant-markdown` (MIT): what Len writes is read as real Markdown —
// CommonMark blocks plus GFM tables, task lists, strikethrough and autolinks — with no raw HTML, links
// only to absolute http(s) and mailto, and no remote images loaded. Until now a hand formatter painted
// bold, italics, code and links, and lists (44 % of Len's turns in October) came out as raw text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { TextoDeLen } from "./texto-de-len";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
function paint(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}
const md = (texto: string) => paint(<TextoDeLen texto={texto} />);

describe("Len's text as real Markdown", () => {
  it("a list is a list, with no dash left in the text", () => {
    const el = md("Qué hice:\n- el **hero** azul\n- el pie con `tel:` arreglado");
    const items = [...el.querySelectorAll("ul > li")].map((li) => li.textContent);
    expect(items).toEqual(["el hero azul", "el pie con tel: arreglado"]);
    expect(el.querySelector("li strong")?.textContent).toBe("hero");
    expect(el.textContent).not.toContain("- ");
  });

  it("a numbered list keeps where it starts", () => {
    const ol = md("3. tres\n4. cuatro").querySelector("ol")!;
    expect(ol.getAttribute("start")).toBe("3");
    expect(ol.querySelectorAll("li")).toHaveLength(2);
  });

  it("a heading, a quote, a rule, strikethrough and a task list", () => {
    const el = md("## Qué cambió\n\n> lo que pediste\n\n---\n\n~~viejo~~ nuevo\n\n- [x] hecho\n- [ ] falta");
    expect(el.querySelector("h1,h2,h3,h4,h5,h6")?.textContent).toBe("Qué cambió");
    expect(el.textContent).not.toContain("##");
    expect(el.querySelector("blockquote")?.textContent).toBe("lo que pediste");
    expect(el.querySelector("hr")).not.toBeNull();
    expect(el.querySelector("del")?.textContent).toBe("viejo");
    const boxes = [...el.querySelectorAll<HTMLInputElement>("li input[type=checkbox]")];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true]]);
  });

  it("a table is a table, inside its own scroll", () => {
    const el = md("| Plan | Créditos |\n|:--|--:|\n| Pro | 500 |\n| Max | 1.300 |");
    expect([...el.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["Plan", "Créditos"]);
    expect([...el.querySelectorAll("tbody td")].map((c) => c.textContent)).toEqual(["Pro", "500", "Max", "1.300"]);
    expect(el.querySelector("tbody td:last-child")!.getAttribute("style")).toContain("right");
    expect(el.querySelector("table")!.parentElement!.className).toContain("overflow-x-auto");
  });

  it("a fenced block is code, literal and in its own scroll", () => {
    const el = md("Así:\n\n```js\nconst a = **b**;\n```");
    const code = el.querySelector("pre > code")!;
    expect(code.textContent).toBe("const a = **b**;");
    expect(el.querySelector("pre")!.className).toContain("overflow-x-auto");
    expect(el.textContent).not.toContain("```");
  });

  it("raw HTML is inert text: nothing is created from it", () => {
    const el = md('Mira <img src=x onerror="alert(1)"> y\n\n<script>alert(1)</script>');
    expect(el.querySelector("img, script")).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });

  it("links: only absolute http(s) and mailto open, in a new tab; anything else is its text", () => {
    const el = md("[a](https://x.com/a) [b](javascript:alert(1)) [c](/relativa) [d](mailto:hola@x.com)");
    const links = [...el.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://x.com/a", "mailto:hola@x.com"]);
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(el.textContent).toBe("a b c d");
  });

  it("a remote image is not loaded: it is a link to it", () => {
    const el = md("![el logo](https://cdn.x.com/logo.png)");
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://cdn.x.com/logo.png");
    expect(el.textContent).toBe("el logo");
  });

  it("a code span that is a whole URL opens it, keeping its code look (DeepSeek's rule)", () => {
    const el = md("en `https://x.com/api?q=1` y `curl https://x.com`");
    expect(el.querySelector("a > code")?.textContent).toBe("https://x.com/api?q=1");
    expect(el.querySelectorAll("a")).toHaveLength(1);
  });

  it("each line Len wrote stays its own line, as before", () => {
    const p = md("Voy a ver qué hay.\nYa lo vi.").querySelector("p")!;
    expect(p.textContent).toBe("Voy a ver qué hay.\nYa lo vi.");
    expect(p.className).toContain("whitespace-pre-wrap");
  });

  it("the tail (the streaming caret) goes inside the last block", () => {
    const el = paint(<TextoDeLen texto={"uno\n\ndos"} cola={<span data-cola="" />} />);
    expect(el.querySelectorAll("p")[1]!.querySelector("[data-cola]")).not.toBeNull();
  });

  it("inline, for a line already cut (the question card): no blocks", () => {
    const el = paint(<TextoDeLen enLinea texto="**Hola** con `x`" />);
    expect(el.querySelector("p, ul, ol, div")).toBeNull();
    expect(el.querySelector("strong")?.textContent).toBe("Hola");
  });

  // The plan-mode scene from production caught it: a plan step «1. …» read as a list inside the card's <p>.
  it("inline, a numbered line keeps its number and makes no list", () => {
    const el = paint(<TextoDeLen enLinea texto="3. Revisar el **pie**" />);
    expect(el.querySelector("p, ul, ol, li, div")).toBeNull();
    expect(el.textContent).toBe("3. Revisar el pie");
  });
});

// What the hand formatter guaranteed (lib/chat/formato-de-len.test.ts, 23/09 and 24/10): still true.
describe("what the old formatter guaranteed, still true", () => {
  it("bold, code, italics and a source's link, from real closings", () => {
    const el = md("eliges efectivo, y **Cobrar** registra el pago; quedó `tel:3312345678`, *«borra la sección»*, según el [cierre de Investing](https://mx.investing.com/currencies/usd-mxn).");
    expect(el.querySelector("strong")?.textContent).toBe("Cobrar");
    expect(el.querySelector("code")?.textContent).toBe("tel:3312345678");
    expect(el.querySelector("em")?.textContent).toBe("«borra la sección»");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://mx.investing.com/currencies/usd-mxn");
    expect(el.textContent).not.toMatch(/[*`[\]]/);
  });

  it.each(["un ** suelto sin cerrar", "una multiplicación 3 * 4 * 5", "un nombre de herramienta leer_estado", "una comilla ` sin cerrar"])(
    "invents no format: %s",
    (texto) => {
      const el = md(texto);
      expect(el.querySelector("strong, em, code, a")).toBeNull();
      expect(el.textContent).toBe(texto);
    },
  );

  it("a bare URL is a link, without the sentence's period", () => {
    const a = md("como https://monkeytype.com/. Listo").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://monkeytype.com/");
  });

  it("four line breaks between two notes leave two paragraphs and no gap at the end", () => {
    const el = md("Voy a ver qué hay ya en el proyecto antes de construir.\n\n\n\nEl proyecto está vacío.\n\n");
    expect([...el.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Voy a ver qué hay ya en el proyecto antes de construir.",
      "El proyecto está vacío.",
    ]);
  });
});

// Photos `image_search` copied to our storage (spec local 2026-10-27-chat-drop-and-images, Part B).
describe("Len's Commons photos", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const ours = (i: number) => `/uploads/commons/${SHA.slice(0, 39)}${i}-960.jpg`;

  it("an image of our Commons copies renders as a photo; any other stays a link", () => {
    const el = md(`Mira:

![Axolotl](${ours(1)})

Y ![rastreador](https://evil.example/commons/${SHA}-960.jpg)`);
    expect(el.querySelector(`img[src="${ours(1)}"]`)).not.toBeNull();
    expect(el.querySelector('img[src^="https://evil"]')).toBeNull();
    expect(el.querySelector<HTMLAnchorElement>('a[href^="https://evil"]')?.textContent).toBe("rastreador");
  });

  it("images in a row are one gallery", () => {
    const el = md(`![a](${ours(1)})
![b](${ours(2)})
![c](${ours(3)})`);
    const galleries = el.querySelectorAll("[data-photo-gallery]");
    expect(galleries).toHaveLength(1);
    expect(galleries[0]!.querySelectorAll("img")).toHaveLength(3);
  });
});
