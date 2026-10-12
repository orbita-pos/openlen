// @vitest-environment node
import { describe, expect, it } from "vitest";

import { poolAlertEmail, quotaEmail, quotaPush } from "./quota-messages";

const A = { projectId: "p 1", projectTitle: "Tacos", percent: 80 as const, calls: 8000, limit: 10000 };

describe("los avisos de las Edge Functions", () => {
  it("el push no lleva prosa: el nombre del producto, el del proyecto y los números", () => {
    expect(quotaPush(A)).toEqual({ title: "Edge Functions · Tacos", body: "80% · 8000 / 10000", url: "/new?project=p%201&view=database" });
    expect(quotaPush({ ...A, projectTitle: null }).title).toBe("Edge Functions");
  });

  it("el correo al dueño, en inglés como el del chat: al 80 % avisa de lo que viene; al 100 %, de lo que pasa ya", () => {
    const ochenta = quotaEmail({ ...A, siteUrl: "https://openlen.com" });
    expect(ochenta.subject).toBe("Your Edge Functions used 80% of this month's calls — Tacos");
    expect(ochenta.text).toContain('The Edge Functions of "Tacos" have made 8000 of the 10000 calls your plan includes this month (80%).');
    expect(ochenta.text).toContain("When they reach 10000, new calls get a 429 error until the month ends.");
    expect(ochenta.text).toContain("https://openlen.com/new?project=p%201&view=database");
    const cien = quotaEmail({ ...A, percent: 100, calls: 10000, projectTitle: null, siteUrl: "https://openlen.com" });
    expect(cien.subject).toBe("Your Edge Functions reached this month's limit — your project");
    expect(cien.text).toContain("Until the month ends, new calls get a 429 error.");
  });

  it("el correo al operador, en español: la bolsa, cuánto y qué variable sube el tope", () => {
    const c = poolAlertEmail({ pool: "free", month: "2026-10", spentNanoUsd: 200_000_000, capNanoUsd: 250_000_000 });
    expect(c.subject).toBe("[Edge Functions] La bolsa gratis va por el 80 % (2026-10)");
    expect(c.text).toContain("Gastado en 2026-10: $0.2000 de $0.2500 (80 %), a precio de lista.");
    expect(c.text).toContain("OPENLEN_FUNCTIONS_CAP_FREE_USD");
    expect(poolAlertEmail({ pool: "paid", month: "2026-10", spentNanoUsd: 600_000_000, capNanoUsd: 750_000_000 }).text).toContain("OPENLEN_FUNCTIONS_CAP_PAID_USD");
  });
});
