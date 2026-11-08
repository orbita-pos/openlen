// SHE FELL ASLEEP (spec local 2026-11-06-asistente-propio, §4.7; phase 2A): what the owner reads — never the visitor.
import { describe, expect, it } from "vitest";

import { asleepEmail, asleepPush } from "./asleep-messages";

const CAP = { type: "assistant_asleep", projectId: "p1", recipientUserId: "u1", assistantName: "Lucía", assistantSlug: "lucía", reason: "cap", spent: 12_480, cap: 12_500 } as const;
const CREDITS = { ...CAP, reason: "credits" } as const;

describe("asleep messages", () => {
  it("names her and why: the month's cap, or no credits", () => {
    expect(asleepPush(CAP)).toMatchObject({ title: "Lucía 💤", body: "124.80 / 125" });
    expect(asleepPush(CREDITS).title).toBe("Lucía 💤");
    expect(asleepPush(CREDITS).body).toBe("0");
    const cap = asleepEmail({ ...CAP, siteUrl: "https://openlen.com" });
    expect(cap.subject).toContain("Lucía");
    expect(cap.subject).toMatch(/limit/i);
    expect(cap.text).toContain("124.80");
    expect(cap.text).toContain("125");
    const credits = asleepEmail({ ...CREDITS, siteUrl: "https://openlen.com" });
    expect(credits.subject).toMatch(/credits/i);
    for (const e of [cap, credits]) expect(e.text).toMatch(/contact form/i);
  });

  // Final review, Minor 9: the owner names the assistant; the email doesn't give it a gender.
  it("🔴 never calls the assistant «her» or «him»", () => {
    for (const e of [asleepEmail({ ...CAP, siteUrl: "https://openlen.com" }), asleepEmail({ ...CREDITS, siteUrl: "https://openlen.com" })]) {
      expect(`${e.subject}\n${e.text}`).not.toMatch(/\b(her|him|his|she|he)\b/i);
    }
  });

  it("opens her place", () => {
    expect(asleepPush(CAP).url).toBe(`/assistant/${encodeURIComponent("lucía")}`);
    expect(asleepEmail({ ...CAP, siteUrl: "https://openlen.com" }).text).toContain(`https://openlen.com/assistant/${encodeURIComponent("lucía")}`);
  });
});
