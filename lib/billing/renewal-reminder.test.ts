// El recordatorio de renovación. La política de reembolso lo promete —«al
// menos 5 días hábiles antes de cada renovación», por la LFPC— y hasta el 04/10
// no lo mandaba nadie: Polar sólo avisa a los planes de 6 meses o más, y los
// nuestros son mensuales.
import { describe, expect, it, vi } from "vitest";

import {
  REMIND_AT_BUSINESS_DAYS,
  buildRenewalReminderEmail,
  businessDaysUntil,
  runRenewalReminders,
  shouldRemind,
  type PolarSubscription,
} from "./renewal-reminder";

const d = (iso: string) => new Date(iso);

describe("businessDaysUntil", () => {
  it("cuenta los días hábiles después de hoy y hasta el de la renovación", () => {
    // Lunes 5 → lunes 12 de octubre de 2026: mar, mié, jue, vie, lun = 5.
    expect(businessDaysUntil(d("2026-10-05T15:00:00Z"), d("2026-10-12T10:00:00Z"))).toBe(5);
  });

  it("el fin de semana no cuenta", () => {
    // Viernes 9 → lunes 12: sólo el lunes.
    expect(businessDaysUntil(d("2026-10-09T15:00:00Z"), d("2026-10-12T10:00:00Z"))).toBe(1);
  });

  it("el mismo día es 0", () => {
    expect(businessDaysUntil(d("2026-10-12T08:00:00Z"), d("2026-10-12T20:00:00Z"))).toBe(0);
  });
});

const SUB: PolarSubscription = {
  id: "sub_1",
  status: "active",
  amount: 1000,
  currency: "usd",
  recurring_interval: "month",
  recurring_interval_count: 1,
  current_period_end: "2026-10-13T10:00:00Z",
  cancel_at_period_end: false,
};
// Lunes 5 de octubre: al martes 13 quedan 6 días hábiles.
const NOW = d("2026-10-05T15:00:00Z");

describe("shouldRemind", () => {
  it("🔴 avisa cuando faltan 6 días hábiles: corriendo a diario, nunca menos de 5", () => {
    expect(REMIND_AT_BUSINESS_DAYS).toBe(6);
    expect(shouldRemind({ now: NOW, sub: SUB, sentFor: null })).toBe(true);
  });

  it("todavía no, si faltan más", () => {
    expect(shouldRemind({ now: d("2026-10-02T15:00:00Z"), sub: SUB, sentFor: null })).toBe(false);
  });

  it("una sola vez por renovación", () => {
    expect(shouldRemind({ now: NOW, sub: SUB, sentFor: d(SUB.current_period_end) })).toBe(false);
    // El aviso del mes ANTERIOR no cuenta para éste.
    expect(shouldRemind({ now: NOW, sub: SUB, sentFor: d("2026-09-13T10:00:00Z") })).toBe(true);
  });

  it("a quien ya canceló no se le avisa de un cobro que no habrá", () => {
    expect(shouldRemind({ now: NOW, sub: { ...SUB, cancel_at_period_end: true }, sentFor: null })).toBe(false);
  });

  it("sólo suscripciones activas", () => {
    for (const status of ["past_due", "canceled", "trialing", "unpaid"]) {
      expect(shouldRemind({ now: NOW, sub: { ...SUB, status }, sentFor: null }), status).toBe(false);
    }
  });

  it("los planes de 6 meses o más los avisa Polar: no se manda otro", () => {
    expect(shouldRemind({ now: NOW, sub: { ...SUB, recurring_interval: "year" }, sentFor: null })).toBe(false);
    expect(shouldRemind({ now: NOW, sub: { ...SUB, recurring_interval_count: 6 }, sentFor: null })).toBe(false);
  });

  it("una renovación ya pasada no se avisa", () => {
    expect(shouldRemind({ now: d("2026-10-14T00:00:00Z"), sub: SUB, sentFor: null })).toBe(false);
  });
});

describe("buildRenewalReminderEmail", () => {
  const mail = buildRenewalReminderEmail({
    plan: "max",
    amount: 2000,
    currency: "usd",
    renewsAt: d("2026-10-13T10:00:00Z"),
    manageUrl: "https://openlen.com/api/billing/portal",
  });

  it("dice el plan, el importe, la fecha y cómo cancelar, en español y en inglés", () => {
    for (const texto of [mail.text, mail.html]) {
      expect(texto).toContain("Max");
      expect(texto).toContain("US$20.00");
      expect(texto).toContain("13 de octubre de 2026");
      expect(texto).toContain("October 13, 2026");
      expect(texto).toContain("https://openlen.com/api/billing/portal");
    }
    expect(mail.subject).toMatch(/renueva/i);
  });

  it("el importe es el de la suscripción, no el de la portada: un Pro de $3.99 ve $3.99", () => {
    const viejo = buildRenewalReminderEmail({
      plan: "pro",
      amount: 399,
      currency: "usd",
      renewsAt: d("2026-10-13T10:00:00Z"),
      manageUrl: "https://openlen.com/api/billing/portal",
    });
    expect(viejo.text).toContain("US$3.99");
    expect(viejo.text).not.toContain("US$10");
  });
});

describe("runRenewalReminders", () => {
  const users = [
    { id: "u1", email: "ana@tiendaluna.mx", plan: "pro" as const, subscriptionId: "sub_1", sentFor: null },
    { id: "u2", email: "beto@tiendaluna.mx", plan: "max" as const, subscriptionId: "sub_2", sentFor: null },
    { id: "u3", email: "caro@tiendaluna.mx", plan: "pro" as const, subscriptionId: "sub_3", sentFor: null },
  ];

  it("🔴 avisa a quien toca, lo apunta, y un fallo con uno no para a los demás", async () => {
    const subs: Record<string, PolarSubscription> = {
      sub_1: SUB,
      sub_2: { ...SUB, id: "sub_2", current_period_end: "2026-11-01T10:00:00Z" }, // aún no
      sub_3: { ...SUB, id: "sub_3" },
    };
    const send = vi.fn(async (_to: string) => true);
    const markSent = vi.fn(async () => {});
    const errores: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errores.push(a));
    try {
      const r = await runRenewalReminders({
        now: NOW,
        manageUrl: "https://openlen.com/api/billing/portal",
        listPaidUsers: async () => users,
        fetchSubscription: async (id) => {
          if (id === "sub_1") throw new Error("polar 500");
          return subs[id];
        },
        send: async (m) => send(m.to),
        markSent,
      });
      expect(r).toEqual({ checked: 3, sent: 1, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(send.mock.calls.map((c) => c[0])).toEqual(["caro@tiendaluna.mx"]);
    expect(markSent).toHaveBeenCalledWith("u3", d(SUB.current_period_end));
    expect(errores.length).toBe(1);
  });

  it("si el correo no sale, no se apunta: mañana se reintenta", async () => {
    const markSent = vi.fn(async () => {});
    const r = await runRenewalReminders({
      now: NOW,
      manageUrl: "https://openlen.com/api/billing/portal",
      listPaidUsers: async () => [users[0]],
      fetchSubscription: async () => SUB,
      send: async () => false,
      markSent,
    });
    expect(r.sent).toBe(0);
    expect(markSent).not.toHaveBeenCalled();
  });
});
