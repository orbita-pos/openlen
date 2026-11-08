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
    // Pinned from the unchanged file on 08/11, before the bubble's surface existed.
    expect(sha(buildVisualsManual([...VISUAL_MODULES], "desktop"))).toBe("e8ac9d18b7322fa94814315ffc2f6011fc37fd12558294f43ec3853d33751e49");
    expect(sha(buildVisualsManual([], "unknown"))).toBe("2bed2eab7afd2c2e45598746b8e17c3a2bc07a0a948ce795e7d1916e057aa95f");
    expect(sha(buildVisualsManual(["chart"], "mobile"))).toBe("07091accb79842db703951ce5ead6aab9840cd8832ccf8656de51ea31ca32d75");
    expect(buildVisualsManual(["chart"], "mobile", "chat")).toBe(buildVisualsManual(["chart"], "mobile"));
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
  });

  it("🔴 every bubble edit still finds its text: the chat's manual can't change under the bubble unnoticed", () => {
    expect(bubbleEditsMissing()).toEqual([]);
  });
});
