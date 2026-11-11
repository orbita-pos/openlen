import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FIGURE_COLORS } from "@/lib/figure/look";

import { activityOf } from "./activity";
import { contrast, tintOf, tintStyle } from "./tint";

const QUIET = { failed: false, toolRunning: false, streaming: false, waiting: false, typing: false };

describe("activityOf", () => {
  it("says what she is doing, the turn's own work first", () => {
    expect(activityOf(QUIET)).toBe("ready");
    expect(activityOf({ ...QUIET, typing: true })).toBe("listening");
    expect(activityOf({ ...QUIET, waiting: true, typing: true })).toBe("thinking");
    expect(activityOf({ ...QUIET, waiting: true, streaming: true })).toBe("talking");
    expect(activityOf({ ...QUIET, waiting: true, streaming: true, toolRunning: true })).toBe("working");
  });

  it("🔴 after a failed turn, her owner writing again has her listening", () => {
    expect(activityOf({ ...QUIET, failed: true, typing: true })).toBe("listening");
    expect(activityOf({ ...QUIET, failed: true })).toBe("error");
  });

  it("a new turn after a failed one is thinking, not an error", () => {
    expect(activityOf({ ...QUIET, failed: true, waiting: true })).toBe("thinking");
  });
});

describe("tintOf", () => {
  it("🔴 the text over her color always reads, whatever color she is", () => {
    for (const color of [...FIGURE_COLORS, "#ffffff", "#000000", "#1d1d1f", "#f2c35b", "#808080", "#7dd3fc", "#5b21b6"]) {
      const t = tintOf(color)!;
      expect(contrast(t.tint, t.ink), color).toBeGreaterThanOrEqual(4.5);
    }
    expect(tintOf("#ffffff")!.ink).toBe("#1d1d1f");
    expect(tintOf("#1d1d1f")!.ink).toBe("#f4f4f5");
  });

  it("her header's background is her color, mostly paper: dark text reads on the light one, light on the dark", () => {
    for (const color of FIGURE_COLORS) {
      const t = tintOf(color)!;
      expect(contrast(t.soft, "#1d1d1f"), color).toBeGreaterThanOrEqual(7);
      expect(contrast(t.softDark, "#f4f4f5"), color).toBeGreaterThanOrEqual(7);
    }
  });

  it("🔴 her owner's bubble keeps an edge on any panel: a white one on a light theme, a black one on a dark theme", () => {
    for (const color of ["#ffffff", "#fafafa", "#000000", "#1d1d1f", ...FIGURE_COLORS]) {
      const t = tintOf(color)!;
      expect(contrast(t.tint, t.edge), color).toBeGreaterThanOrEqual(1.25);
    }
    expect(tintStyle("#ffffff")["--assistant-edge"]).toBe(tintOf("#ffffff")!.edge);
  });

  it("what is not a color tints nothing", () => {
    expect(tintOf("transparent")).toBeNull();
    expect(tintStyle("red")).toEqual({});
    expect(Object.keys(tintStyle("#FFC21A"))).toEqual(["--assistant-tint", "--assistant-ink", "--assistant-edge", "--assistant-soft", "--assistant-soft-dark"]);
    expect(tintStyle("#FFC21A")["--assistant-tint"]).toBe("#ffc21a");
  });
});

describe("her tint in the workspace's CSS", () => {
  const css = readFileSync(path.join(process.cwd(), "app/[locale]/new/tokens.css"), "utf8");
  it("🔴 the muted lines and icons inside her owner's bubble take the bubble's ink: a photo's caption must read on her color", () => {
    expect(css).toMatch(/\.assistant-tint \[data-user-bubble\] :is\(\.fg-muted, \.fg-faint, \[class\*="nc-accent-text"\]\)\s*\{[^}]*color:\s*inherit/);
  });
  it("the bubble and the send button wear that edge", () => {
    expect(css).toMatch(/\[data-user-bubble\]\s*\{[^}]*border-color:\s*var\(--assistant-edge\)/);
    expect(css).toMatch(/\[data-send="send"\]:not\(:disabled\)\s*\{[^}]*var\(--assistant-edge\)/);
  });
});
