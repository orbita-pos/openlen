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
    // Pinned after updateModelContext(text) switched to holding state read via read_widget_context (still omitted in bubble).
    expect(sha(buildVisualsManual([...VISUAL_MODULES], "desktop"))).toBe("56c72f807f47f3c5c12c27de7ccc2c720b057b8f50e32f0a0533d7598ed1455a");
    expect(sha(buildVisualsManual([], "unknown"))).toBe("bb4f444d6c8c95e52804884353ef7646375fa09d8bcdf4a5b5f5da4d949a7c76");
    expect(sha(buildVisualsManual(["chart"], "mobile"))).toBe("5b51a7a22f21fc148da20cae7109f65d4d9c1f8b2fcea211ed1c2c475602098d");
    expect(buildVisualsManual(["chart"], "mobile", "chat")).toBe(buildVisualsManual(["chart"], "mobile"));
    expect(buildVisualsManual([], "desktop", "chat")).toContain("updateModelContext(text)");
  });

  // What a visual shares is its state now (spec local 2026-11-22-visuales-de-verdad, §2): kept by the chat, read with
  // read_widget_context when the person refers to it — never «for their next message».
  it("updateModelContext keeps the visual's state, read with read_widget_context", () => {
    const m = buildVisualsManual([], "desktop", "chat");
    expect(m).toContain("updateModelContext(text) keeps the visual's current state");
    expect(m).toContain("read_widget_context");
    expect(m).not.toContain("for their next message");
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
