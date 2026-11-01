// How the shared viewer shows a delivered file (spec local 2026-10-31-len-movil, §5.1).
import { describe, expect, it } from "vitest";

import { viewKindOf } from "./view-kind";

describe("viewKindOf", () => {
  it.each([
    ["deck.pptx", "office"],
    ["report.DOCX", "office"],
    ["budget.xlsx", "office"],
    ["macro.xlsm", "office"],
    ["rows.csv", "office"],
    ["chart.svg", "html"],
    ["panel.html", "html"],
    ["panel.htm", "html"],
    ["a.PNG", "image"],
    ["b.jpeg", "image"],
    ["c.webp", "image"],
    ["d.gif", "image"],
    ["clip.mov", "video"],
    ["clip.mp4", "video"],
    ["clip.webm", "video"],
    ["report.pdf", "pdf"],
    ["notes.md", "text"],
    ["data.json", "text"],
    ["readme.txt", "text"],
    ["x.zip", "download"],
    ["noext", "download"],
  ] as const)("%s → %s", (name, kind) => {
    expect(viewKindOf(name)).toBe(kind);
  });
});
