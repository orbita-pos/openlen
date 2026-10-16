import { describe, expect, it } from "vitest";
import { VISUAL_TOKENS, buildVisualsManual } from "./manual";
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
