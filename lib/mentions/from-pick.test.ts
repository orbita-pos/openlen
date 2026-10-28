import { describe, expect, it } from "vitest";

import type { DesignSelection } from "@/lib/apps/design/types";

import { mentionFromDesignSelection, mentionFromPagePick } from "./from-pick";
import type { MentionKind } from "./types";

const labels = (k: MentionKind) => ({ link: "Enlace", heading: "Título", button: "Botón", element: "Elemento" })[k as "link"] ?? k;

describe("mentionFromPagePick", () => {
  it("turns a click on a page into an element mention named like the index names it", () => {
    const m = mentionFromPagePick(
      { hint: 'a — "Ver el mostrador"', tag: "a", path: "section:nth-of-type(1) > a:nth-of-type(1)", text: "Ver el mostrador" },
      "contacto",
      labels,
    );
    expect(m).toEqual({
      type: "element",
      label: "@Enlace · Ver el mostrador",
      text: "Ver el mostrador",
      target: { type: "page", page: "contacto", path: "section:nth-of-type(1) > a:nth-of-type(1)", tag: "a", text: "Ver el mostrador" },
    });
  });

  it("falls back to the tag when the element has no text of its own", () => {
    const m = mentionFromPagePick({ hint: "div.hero", tag: "div", path: "div:nth-of-type(1)", text: "" }, null, labels);
    expect(m.label).toBe("@Elemento · div");
    expect(m.type === "element" && m.target).toEqual({ type: "page", page: null, path: "div:nth-of-type(1)", tag: "div" });
  });
});

describe("mentionFromDesignSelection", () => {
  const base: DesignSelection = {
    key: "k",
    chain: [
      { path: "/src/components/ui/button.tsx", line: 40, component: "Button" },
      { path: "/src/App.tsx", line: 9, component: "App" },
    ],
    primary: 1,
    tag: "button",
    text: "Guardar pedido",
    textEditable: true,
    copies: 1,
    screen: "#/",
    styles: {} as DesignSelection["styles"],
    image: null,
    designId: null,
    fonts: [],
  };

  it("points at the use line, the one the person wrote", () => {
    expect(mentionFromDesignSelection(base, labels)).toEqual({
      type: "element",
      label: "@Botón · Guardar pedido",
      text: "Guardar pedido",
      target: { type: "app", path: "/src/App.tsx", line: 9, tag: "button", text: "Guardar pedido", screen: "#/" },
    });
  });

  it("gives nothing when the element has no source line", () => {
    expect(mentionFromDesignSelection({ ...base, chain: [], primary: -1 }, labels)).toBeNull();
  });
});

describe("what an app pick tells about where the element is", () => {
  it("carries its copies and its screen", () => {
    const s = {
      key: "k", chain: [{ path: "/src/Ventas.tsx", line: 4, component: "Ventas" }], primary: 0, tag: "li", text: "Pedido", textEditable: true,
      copies: 12, screen: "#/ventas", styles: {} as DesignSelection["styles"], image: null, designId: null, fonts: [],
    } as DesignSelection;
    const m = mentionFromDesignSelection(s, labels)!;
    expect(m.type === "element" && m.target).toMatchObject({ copies: 12, screen: "#/ventas" });
  });
});
