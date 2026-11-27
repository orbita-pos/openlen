// @vitest-environment node
//
// THE BY-HAND INSTALL TEXTS SAY THE SAME THING (spec local 2026-11-26-apps-en-el-escritorio, M10): each browser has its steps
// (`install.manual.<browser>`), and the one for a browser that can't be told (`other`) lists the ways instead. The two must not
// contradict: Safari on a Mac CAN install an app («Add to Dock…», its own text), so the generic one carries that sentence, as
// the locale wrote it, instead of saying Safari can't (the English wording is pinned in `desktop-window.test.tsx`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;

type Manual = { other: string; safari: string };
const manualOf = (locale: string): Manual => {
  const messages = JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "wsChrome.json"), "utf8")) as { desktop: { install: { manual: Manual } } };
  return messages.desktop.install.manual;
};

describe("install.manual.other", () => {
  for (const locale of LOCALES) {
    it(`${locale}: it carries the Safari way, the same sentence as install.manual.safari`, () => {
      const { other, safari } = manualOf(locale);
      expect(safari.length).toBeGreaterThan(0);
      expect(other).toContain(safari);
    });
  }
});
