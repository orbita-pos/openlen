import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { LenWatchPhase } from "@/lib/notifications/types";

import { lenWatchTexts, lenWatchTurnPrompt } from "./texts";

const LOCALES = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"] as const;
const PHASES: readonly LenWatchPhase[] = ["down", "fixing", "fix_ready", "fixed", "fix_failed", "needs_owner", "recovered"];
const V = { projectTitle: "Holi", url: "https://holi.openlen.app", chatUrl: "https://openlen.com/new?project=p1&chat=1", detail: "Len changed main.jsx.", shipsUnpublished: false };

describe("lenWatchTexts", () => {
  it("has every phase in every language, with nothing left unfilled", () => {
    for (const l of LOCALES) {
      for (const phase of PHASES) {
        const t = lenWatchTexts(phase, l, V);
        for (const [k, s] of Object.entries(t)) {
          expect(s, `${l} ${phase} ${k}`).toBeTruthy();
          expect(s, `${l} ${phase} ${k}`).not.toContain("lenWatch.");
          expect(s, `${l} ${phase} ${k}`).not.toMatch(/\{[a-zA-Z]+\}/);
        }
        expect(t.emailText).toContain(V.chatUrl);
      }
    }
  });

  it("names the project and the address", () => {
    const t = lenWatchTexts("fixing", "es", V);
    expect(t.title).toContain("Holi");
    expect(t.emailText).toContain("https://holi.openlen.app");
  });

  it("warns that unpublished changes would go too", () => {
    const es = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/es/topbar.json"), "utf8")) as { lenWatch: { notice: { shipsUnpublished: string } } };
    expect(lenWatchTexts("fix_ready", "es", { ...V, shipsUnpublished: true }).emailText).toContain(es.lenWatch.notice.shipsUnpublished);
    expect(lenWatchTexts("fix_ready", "es", V).emailText).not.toContain(es.lenWatch.notice.shipsUnpublished);
  });

  it("the chat row's message exists in every language", () => {
    for (const l of LOCALES) {
      const prompt = lenWatchTurnPrompt(l);
      expect(prompt, l).toBeTruthy();
      expect(prompt, l).not.toContain("lenWatch.");
    }
    expect(lenWatchTurnPrompt("xx")).toBe(lenWatchTurnPrompt("en"));
  });

  it("an unknown language reads as English", () => {
    expect(lenWatchTexts("down", "xx", V)).toEqual(lenWatchTexts("down", "en", V));
  });

  it("no detail leaves no hole", () => {
    expect(lenWatchTexts("fixed", "en", { ...V, detail: null }).emailText).not.toMatch(/\n{3,}/);
  });
});
