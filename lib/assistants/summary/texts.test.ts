// THE MORNING SUMMARY'S WORDS (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): only what happened, in the
// language it was turned on in, like «ayer hablé con 14 personas, 3 dejaron su número» (§4.6).
import { describe, expect, it } from "vitest";

import { summaryTexts } from "./texts";

describe("summaryTexts", () => {
  it("names only what happened, with plurals, in the language it was turned on in", () => {
    const es = summaryTexts("es", "Lucía", { talkedWith: 14, contacts: 3, requests: 0 }, "https://openlen.com/es/assistant/lucia");
    expect(es.title).toBe("Lucía");
    expect(es.push).toBe("Ayer hablé con 14 personas y 3 te dejaron su contacto.");
    expect(es.emailSubject).toContain("Lucía");
    expect(es.emailText).toContain(es.push);
    expect(es.emailText).toContain("https://openlen.com/es/assistant/lucia");
    const one = summaryTexts("es", "Lucía", { talkedWith: 1, contacts: 0, requests: 1 }, "u");
    expect(one.push).toBe("Ayer hablé con 1 persona y 1 pidió algo que no pude hacer.");
    expect(summaryTexts("en", "Lucía", { talkedWith: 2, contacts: 1, requests: 1 }, "u").push).toBe("Yesterday I talked with 2 people, 1 left you their contact, and 1 asked for something I couldn't do.");
  });

  it("every language has its words, and a push stays under 200 characters", () => {
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      const t = summaryTexts(l, "Lucía", { talkedWith: 999, contacts: 999, requests: 999 }, "u");
      expect(t.push.length, l).toBeLessThan(200);
      expect(t.push, l).not.toMatch(/ownAssistant|\{/);
    }
  });

  it("🔴 a long A/B name is cut in the push — its question is never — and the email carries the whole line (item 29)", () => {
    const long = "Probando un titular larguísimo ".repeat(10).trim();
    const abReady = [{ experimentId: "ab_1", projectId: "p1", projectTitle: "Panadería", name: long, status: "winner_ready" as const, winnerVariant: "b" as const, rateA: 0.04, rateB: 0.052, liftPct: 31, totalViews: 840, probability: 0.97 }];
    const reference = [{ ...abReady[0]!, name: "Hero" }];
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      for (const counts of [{ talkedWith: 0, contacts: 0, requests: 0 }, { talkedWith: 14, contacts: 3, requests: 2 }]) {
        const t = summaryTexts(l, "Lucía", { ...counts, abReady }, "https://openlen.com/x");
        const ref = summaryTexts(l, "Lucía", { ...counts, abReady: reference }, "https://openlen.com/x");
        expect(t.push.length, l).toBeLessThan(200);
        expect(t.push, l).toContain("…");
        // what follows the name is whole: the push ends the way the short one does
        const tail = ref.push.slice(ref.push.indexOf("Hero") + 4);
        expect(t.push.endsWith(tail), `${l}: ${t.push}`).toBe(true);
        expect(t.emailText, l).toContain(long);
      }
    }
  });

  it("only counts that are too long are still cut at the end, like before", () => {
    const t = summaryTexts("es", "Lucía", { talkedWith: 99999, contacts: 99999, requests: 99999 }, "u");
    expect(t.push.length).toBeLessThan(200);
  });

  it("includes an A/B winner prompt cleanly even when yesterday had zero visits", () => {
    const abReady = [
      {
        experimentId: "ab_1",
        projectId: "p1",
        projectTitle: "Panadería",
        name: "Botón principal",
        status: "winner_ready" as const,
        winnerVariant: "b" as const,
        rateA: 0.04,
        rateB: 0.052,
        liftPct: 31,
        totalViews: 840,
        probability: 0.97,
      },
    ];
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      const onlyAb = summaryTexts(l, "Lucía", { talkedWith: 0, contacts: 0, requests: 0, abReady }, "https://openlen.com/es/assistant/lucia");
      expect(onlyAb.push.length, l).toBeLessThan(200);
      expect(onlyAb.push, l).not.toMatch(/ownAssistant|\{/);
      expect(onlyAb.push, l).toContain("31");
      const combined = summaryTexts(l, "Lucía", { talkedWith: 5, contacts: 1, requests: 0, abReady }, "https://openlen.com/es/assistant/lucia");
      expect(combined.push.length, l).toBeLessThan(200);
    }
  });
});
