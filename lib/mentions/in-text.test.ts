import { describe, expect, it } from "vitest";

import { liveMentions } from "./in-text";
import type { MentionRef } from "./types";

const page = (label: string, path: string): MentionRef => ({ type: "element", label, text: "", target: { type: "page", page: null, path, tag: "p" } });

const SHORT = page("@Texto · Pan", "p:nth-of-type(1)");
const LONG = page("@Texto · Pan de verdad", "p:nth-of-type(2)");
const FILE: MentionRef = { type: "file", label: "@/LEN.md", ruta: "/LEN.md" };

describe("liveMentions", () => {
  it("keeps the mentions whose label is in the text, in the order they appear", () => {
    expect(liveMentions(`mira ${FILE.label} y ${SHORT.label}`, [SHORT, FILE])).toEqual([FILE, SHORT]);
  });

  it("does not keep a label that only survives inside a longer one", () => {
    expect(liveMentions(`haz ${LONG.label} más grande`, [SHORT, LONG])).toEqual([LONG]);
  });

  it("keeps one mention once, however many times its label appears or it was picked", () => {
    expect(liveMentions(`${FILE.label} y otra vez ${FILE.label}`, [FILE, { ...FILE }])).toEqual([FILE]);
  });

  it("keeps two different elements that happen to share a label", () => {
    const twin = page("@Texto · Pan", "p:nth-of-type(7)");
    expect(liveMentions(`${SHORT.label} y ${twin.label}`, [SHORT, twin])).toEqual([SHORT, twin]);
  });
});
