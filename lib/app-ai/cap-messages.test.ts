import { describe, expect, it } from "vitest";

import { capEmail, capPush, capUrl, freePoolAlertEmail } from "./cap-messages";

const A = { projectId: "p 1", projectTitle: "Taquería", percent: 80 as const, spent: 6_000, cap: 7_500 };

describe("cap messages", () => {
  it("the push carries no prose and opens the Database view", () => {
    expect(capUrl("p 1")).toBe("/new?project=p%201&view=database");
    expect(capPush(A)).toEqual({ title: "AI · Taquería", body: "80% · 60 / 75", url: "/new?project=p%201&view=database" });
    expect(capPush({ ...A, projectTitle: null }).title).toBe("AI");
  });

  it("the owner's email says what happens and where to change it", () => {
    const m = capEmail({ ...A, percent: 100, spent: 7_500, siteUrl: "https://openlen.com" });
    expect(m.subject).toBe("Your apps reached this month's AI limit");
    expect(m.text).toContain("75 of the 75 credits");
    expect(m.text).toContain("402");
    expect(m.text).toContain("keep working without AI");
    expect(m.text).toContain("https://openlen.com/new?project=p%201&view=database");
    expect(capEmail({ ...A, siteUrl: "x" }).subject).toBe("Your apps used 80% of this month's AI limit");
  });

  it("the operator's email, in Spanish, names the variable", () => {
    const m = freePoolAlertEmail({ day: "2026-10-15", spent: 16_000, cap: 20_000 });
    expect(m.subject).toBe("[IA de las apps] El tope diario del plan gratis va por el 80 % (2026-10-15)");
    expect(m.text).toContain("$1.6000 de $2.0000");
    expect(m.text).toContain("OPENLEN_APP_AI_FREE_DAILY_USD");
  });
});
