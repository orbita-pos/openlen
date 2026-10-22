// lib/project-email/state.ts — WHAT LEN KNOWS OF THE PROJECT'S EMAIL every turn (spec
// local 2026-10-22-email-integration, 6.8), in PROJECT STATE beside Stripe: the
// domain, its status, the address it sends from once ready, and the month
// against what the owner's plan includes. From OpenLen's tables, never from
// Resend. null with the email off.

import type { Plan } from "@/lib/plan";

import { EMAIL_LIMITS, monthOf } from "./limits";
import type { EmailDomainStatus, EmailStore } from "./types";

export interface EmailStateForLen {
  readonly domain: string | null;
  readonly status: EmailDomainStatus | "none";
  /** The address the project's emails go from; null until the domain is ready. */
  readonly from: string | null;
  readonly sent_this_month: number;
  readonly included_per_month: number;
  readonly plan: Plan;
}

export interface EmailStateDeps {
  readonly enabled: boolean;
  store: EmailStore;
  ownerOf(projectId: string): Promise<{ userId: string; email: string } | null>;
  planOf(userId: string): Promise<Plan>;
  now(): Date;
}

async function realStateDeps(): Promise<EmailStateDeps> {
  const [{ emailEnabledIn }, { realSendDeps }] = await Promise.all([import("./enabled"), import("./real")]);
  const d = realSendDeps();
  return { enabled: emailEnabledIn(), store: d.store, ownerOf: d.ownerOf, planOf: d.planOf, now: d.now };
}

export async function emailStateFor(projectId: string, deps?: EmailStateDeps): Promise<EmailStateForLen | null> {
  const d = deps ?? (await realStateDeps());
  if (!d.enabled) return null;
  const [domain, owner] = await Promise.all([d.store.getDomain(projectId), d.ownerOf(projectId)]);
  const plan = owner ? await d.planOf(owner.userId) : "free";
  return {
    domain: domain?.domain ?? null,
    status: domain?.status ?? "none",
    from: domain?.status === "ready" ? `noreply@${domain.sendingHost}` : null,
    sent_this_month: owner ? await d.store.usage(owner.userId, monthOf(d.now())) : 0,
    included_per_month: plan === "free" ? 0 : EMAIL_LIMITS[plan].includedPerMonth,
    plan,
  };
}
