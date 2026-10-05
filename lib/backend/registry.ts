// Qué proyecto tiene qué backend (la tabla `projectBackends` de la base de la
// app) y cómo se llega a él desde una petición.
//
// Una petición a /rest/v1 o /auth/v1 llega por uno de dos hosts:
//   · `<ref>.<publish host>`: la URL del proyecto que Len pone en
//     `createClient` (fija desde que existe, como `<ref>.supabase.co`).
//   · el de la página publicada (`<sub>.<publish host>` o su dominio propio):
//     lo mismo, desde su propio origen.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";
import { getSubdomainOwner } from "@/lib/projects";
import { publishBaseHost } from "@/lib/publish/deploy-url";
import { publishedBaseHosts, resolveCustomDomainSub, subDeLaPagina } from "@/lib/publish/request-origin";
import { defaultAuthConfig, type AuthConfig } from "./auth/config";
import { sendAuthEmail } from "./auth/mail";
import { hashSecretKey, newDatabasePassword, newJwtSecret, newProjectRef, newPublishableKey, newSecretKey } from "./keys";
import { projectDatabase } from "./pg";
import { devRoleOf, provisionDatabase } from "./provision";
/* ── carril D ── */
import { ensureStorageProvisioned } from "./storage/provision";
import type { BackendProject } from "./router";

export interface BackendRecord {
  readonly projectId: string;
  readonly ref: string;
  readonly publishableKey: string;
  readonly secretKeyHash: string;
  readonly secretKeyEncrypted: string;
  readonly jwtSecretEncrypted: string;
  readonly dbPasswordEncrypted: string;
  readonly authConfig: Record<string, unknown>;
  readonly provisionedAt: Date | null;
}

export async function getBackendByProject(projectId: string): Promise<BackendRecord | null> {
  const [row] = await db.select().from(schema.projectBackends).where(eq(schema.projectBackends.projectId, projectId)).limit(1);
  return row ?? null;
}

export async function getBackendByRef(ref: string): Promise<BackendRecord | null> {
  const [row] = await db.select().from(schema.projectBackends).where(eq(schema.projectBackends.ref, ref)).limit(1);
  return row ?? null;
}

/** ¿Es este subdominio el `ref` de algún backend? Un subdominio de página no
 *  puede serlo: los dos viven en el mismo comodín. */
export async function isBackendRef(sub: string): Promise<boolean> {
  return /^[a-z]{20}$/.test(sub) && (await getBackendByRef(sub)) !== null;
}

/** El backend del proyecto, creándolo si no tiene (sin la base todavía: ésa
 *  se crea con la primera petición o la primera migración). */
export async function ensureBackend(projectId: string): Promise<BackendRecord> {
  const existing = await getBackendByProject(projectId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = newProjectRef();
    // Ni un `ref` repetido ni uno que ya sea el subdominio de una página.
    if (await getSubdomainOwner(ref)) continue;
    const secretKey = newSecretKey();
    const rows = await db
      .insert(schema.projectBackends)
      .values({
        projectId,
        ref,
        publishableKey: newPublishableKey(),
        secretKeyHash: hashSecretKey(secretKey),
        secretKeyEncrypted: encryptToken(secretKey),
        jwtSecretEncrypted: encryptToken(newJwtSecret()),
        dbPasswordEncrypted: encryptToken(newDatabasePassword()),
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0];
    const raced = await getBackendByProject(projectId);
    if (raced) return raced;
  }
  throw new Error("no se pudo crear el backend del proyecto");
}

export async function ensureProvisioned(rec: BackendRecord): Promise<void> {
  if (!rec.provisionedAt) {
    await provisionDatabase({ ref: rec.ref, dbPassword: decryptToken(rec.dbPasswordEncrypted) });
    await db.update(schema.projectBackends).set({ provisionedAt: new Date() }).where(eq(schema.projectBackends.projectId, rec.projectId));
  }
  /* ── carril D: storage ── El esquema `storage` también en las bases creadas
   * antes de que hubiera Storage (ésas no vuelven a provisionDatabase). Una vez
   * por proceso: lib/backend/storage/provision.ts. */
  await ensureStorageProvisioned(rec.ref);
  /* ── fin carril D ── */
}

export function projectUrl(ref: string): string {
  return `https://${ref}.${publishBaseHost()}`;
}

/** El host sin puerto y en minúsculas. */
function cleanHost(host: string | null): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export interface HostBackend {
  readonly record: BackendRecord;
  /** El subdominio de la página publicada, si lo tiene. */
  readonly pageSub: string | null;
}

export async function backendForHost(hostHeader: string | null): Promise<HostBackend | null> {
  const host = cleanHost(hostHeader);
  if (!host) return null;
  for (const base of publishedBaseHosts()) {
    if (!host.endsWith(`.${base}`)) continue;
    const label = host.slice(0, -(base.length + 1));
    if (/^[a-z]{20}$/.test(label)) {
      const rec = await getBackendByRef(label);
      if (rec) {
        const [p] = await db.select({ subdomain: schema.projects.subdomain }).from(schema.projects).where(eq(schema.projects.id, rec.projectId)).limit(1);
        return { record: rec, pageSub: p?.subdomain ?? null };
      }
    }
  }
  const sub = await subDeLaPagina({
    headers: { get: (n) => (n.toLowerCase() === "host" ? host : null) },
    baseHost: publishedBaseHosts(),
    resolveCustomDomain: resolveCustomDomainSub,
  });
  if (!sub) return null;
  const owner = await getSubdomainOwner(sub);
  if (!owner) return null;
  const rec = await getBackendByProject(owner.projectId);
  return rec ? { record: rec, pageSub: sub } : null;
}

/** Lo que necesita el enrutador para atender a este proyecto. */
export function backendProjectFor(hb: HostBackend): BackendProject {
  const rec = hb.record;
  const base = publishBaseHost();
  const refHost = `${rec.ref}.${base}`;
  const pageHost = hb.pageSub ? `${hb.pageSub}.${base}` : null;
  const siteUrl = pageHost ? `https://${pageHost}` : `https://${refHost}`;
  const overrides = rec.authConfig as Partial<AuthConfig>;
  const config: AuthConfig = {
    ...defaultAuthConfig(`https://${refHost}/auth/v1`),
    siteUrl,
    ...overrides,
    uriAllowList: [
      ...(pageHost ? [`https://${pageHost}/**`] : []),
      `https://${refHost}/**`,
      ...((overrides.uriAllowList as string[] | undefined) ?? []),
    ],
  };
  return {
    ref: rec.ref,
    publishableKey: rec.publishableKey,
    secretKeyHash: rec.secretKeyHash,
    jwtSecret: decryptToken(rec.jwtSecretEncrypted),
    db: projectDatabase(devRoleOf(rec.ref)),
    auth: { config, sendMail: (m) => sendAuthEmail(m, pageHost ?? refHost) },
  };
}
