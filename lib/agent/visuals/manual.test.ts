import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VISUAL_TOKENS, bubbleEditsMissing, buildVisualsManual } from "./manual";
import { VISUAL_MODULES } from "./widget";

const CDN_HOSTS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

describe("buildVisualsManual — the common part", () => {
  const common = buildVisualsManual([], "unknown");

  it("names every variable the frame defines", () => {
    for (const t of VISUAL_TOKENS) expect(common).toContain(t.name);
  });

  it("lists every allowed CDN", () => {
    for (const h of CDN_HOSTS) expect(common).toContain(h);
  });

  it("explains the two bridges, fixed positioning and the order to write in", () => {
    expect(common).toContain("sendPrompt(");
    expect(common).toContain("openLink(");
    expect(common).toContain("position: fixed");
    expect(common.indexOf("<style>")).toBeGreaterThan(-1);
    expect(common.indexOf("<script>")).toBeGreaterThan(common.indexOf("<style>"));
  });

  it("asks for a screen-reader summary and names the icon font", () => {
    expect(common).toContain("sr-only");
    expect(common).toContain('<i class="icon-');
  });

  it("never tells the visual to detect the theme itself", () => {
    expect(common).not.toContain("prefers-color-scheme");
  });

  it("has no module section when none is asked", () => {
    for (const m of VISUAL_MODULES) expect(common).not.toContain(`## ${m}`);
  });
});

describe("buildVisualsManual — modules and platform", () => {
  it("includes only the modules asked", () => {
    const m = buildVisualsManual(["chart"], "desktop");
    expect(m).toContain("## chart");
    expect(m).not.toContain("## diagram");
  });

  it("includes each module once even if asked twice", () => {
    const m = buildVisualsManual(["chart", "chart", "mockup"], "desktop");
    expect(m.split("## chart").length - 1).toBe(1);
    expect(m.split("## mockup").length - 1).toBe(1);
  });

  it("gives the phone width on mobile and the chat column width otherwise", () => {
    expect(buildVisualsManual([], "mobile")).toContain("360px");
    expect(buildVisualsManual([], "desktop")).toContain("420px");
    expect(buildVisualsManual([], "unknown")).toContain("420px");
  });
});

// THE PERSON'S OWN ASSISTANT IN THE PUBLISHED PAGE'S BUBBLE (spec local 2026-11-06-asistente-propio, §4.2, §5; phase 2B):
// the same manual, speaking of the business's bubble; Len's chat gets exactly today's.
describe("buildVisualsManual — the surface", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("the chat's manual is byte for byte today's", () => {
    // Pinned after A5 added updateModelContext(text) to chat visuals (still omitted in bubble).
    expect(sha(buildVisualsManual([...VISUAL_MODULES], "desktop"))).toBe("b2a1a07075004600f387d9daa6937f3f4b57b9e88978af13bb28fa6dd9be26ba");
    expect(sha(buildVisualsManual([], "unknown"))).toBe("da764280378aca16284abea083dcaeab611cbbde8098dd5ccfea54db63ee871e");
    expect(sha(buildVisualsManual(["chart"], "mobile"))).toBe("d50d2e486f97a372f9a726dc4e13f6bd6f2ec032c4fac6a15907db5c67e66fbd");
    expect(buildVisualsManual(["chart"], "mobile", "chat")).toBe(buildVisualsManual(["chart"], "mobile"));
    expect(buildVisualsManual([], "desktop", "chat")).toContain("updateModelContext(text)");
  });

  it("the bubble's manual speaks of the business's bubble and its color", () => {
    const m = buildVisualsManual(["chart", "mockup"], "mobile", "bubble");
    expect(m).toContain("# Visuals in the business's chat bubble");
    expect(m).toContain("--accent: the business's color");
    expect(m).toMatch(/sendPrompt\(text\) sends text to you as a message from the visitor/);
    expect(m).toMatch(/fetch\(\) reaches nothing/);
    expect(m).toMatch(/only to this business's own site/);
    expect(m).not.toContain("OpenLen's chat");
    expect(m).not.toContain("the inbox");
    expect(m).toContain("## chart");
    // Final review I5: the bubble holds a visual to about 450px and scrolls past it.
    expect(m).toContain("up to about 450px");
    expect(m).not.toContain("grows to fit it");
    expect(m).not.toContain("updateModelContext");
  });

  it("🔴 every bubble edit still finds its text: the chat's manual can't change under the bubble unnoticed", () => {
    expect(bubbleEditsMissing()).toEqual([]);
  });
});
