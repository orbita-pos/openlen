// lib/project-email/real.ts — PROJECT EMAIL WITH THE REAL THINGS (spec local
// 2026-10-22-email-integration): the tables in Postgres, the customers' Resend
// account, the owner and their plan, the notices, the functions' environment,
// DNS, and the server's secrets. What the routes and the timer use.

import "server-only";

import { promises as dns } from "node:dns";

import { and, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { DomainDeps } from "./domain";
import type { PanelDeps } from "./panel";
import { resendClients } from "./resend-clients";
import { pgEmailStore } from "./store-pg";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com").replace(/\/+$/, "");
}

async function ownerRow(projectId: string): Promise<{ userId: string; email: string; plan: unknown } | null> {
  const [r] = await db
    .select({ userId: schema.projects.userId, email: schema.users.email, plan: schema.users.plan })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return r ? { userId: r.userId, email: r.email ?? "", plan: r.plan } : null;
}

/** Both environments' functions get the new OPENLEN_EMAIL_FROM (lib/project-email/function-env.ts). */
async function applyFunctionEnvBoth(projectId: string): Promise<void> {
  const [{ realDeployDeps }, { applyFunctionEnv }] = await Promise.all([import("@/lib/functions/deploy"), import("@/lib/functions/deploy-core")]);
  const deps = realDeployDeps();
  if (!deps) return;
  for (const env of ["draft", "live"] as const) {
    await applyFunctionEnv(projectId, env, deps).catch((e: unknown) => console.warn("[email] could not reapply the functions' env", projectId, env, e));
  }
}

export function realDomainDeps(): DomainDeps {
  return {
    store: pgEmailStore,
    resend: resendClients(process.env.RESEND_CLIENTS_API_KEY?.trim() ?? ""),
    async planOfProject(projectId) {
      const { planFromDb } = await import("@/lib/plan");
      return planFromDb((await ownerRow(projectId))?.plan);
    },
    async ownerOf(projectId) {
      const r = await ownerRow(projectId);
      return r ? { userId: r.userId, email: r.email } : null;
    },
    async notify(e) {
      const { scheduleNotification } = await import("@/lib/notifications/dispatch");
      await scheduleNotification(e, `email_domain:${e.projectId}:${e.status}:${new Date().toISOString().slice(0, 10)}`);
    },
    applyFunctionEnv: applyFunctionEnvBoth,
    now: () => new Date(),
  };
}

export function realPanelDeps(): PanelDeps {
  return {
    ...realDomainDeps(),
    dc: { resolveTxt: (name) => dns.resolveTxt(name), fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
    resolveNs: (domain) => dns.resolveNs(domain),
    privateKeyPem: process.env.DOMAIN_CONNECT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim() || null,
    async customDomainOf(projectId) {
      const [r] = await db
        .select({ domain: schema.customDomains.domain })
        .from(schema.customDomains)
        .where(and(eq(schema.customDomains.projectId, projectId), isNotNull(schema.customDomains.verifiedAt)))
        .limit(1);
      return r?.domain ?? null;
    },
    returnUrl: `${siteUrl()}/api/email/domain-connect/return`,
    stateSecret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "",
  };
}
