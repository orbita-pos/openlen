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
import { rootProject } from "@/lib/projects/root-project";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";
import { getSubdomainOwner } from "@/lib/projects";
import { publishBaseHost } from "@/lib/publish/deploy-url";
import { publishedBaseHosts, resolveCustomDomainSub, subDeLaPagina } from "@/lib/publish/request-origin";
import type { AuthConfig } from "./auth/config";
import { authConfigFor } from "./auth-config-for";
import { sendAuthEmail } from "./auth/mail";
import { hashSecretKey, newDatabasePassword, newJwtSecret, newProjectRef, newPublishableKey, newSecretKey } from "./keys";
import { projectDatabase } from "./pg";
import {
  classifyExistingBackend,
  createEnvironment,
  dbNameOf,
  ensureDraftPublicRef,
  getEnvironment,
  getEnvironmentByPublicRef,
  listEnvironments,
  markEnvironmentProvisioned,
  type Environment,
  type EnvironmentRecord,
} from "./environments";
import { buildDraftDatabase } from "./draft";
import { listProjectFiles } from "./files";
import { provisionDatabase } from "./provision";
/* ── carril D ── */
import { ensureStorageProvisioned } from "./storage/provision";
import { ensureRealtimeProvisioned } from "./realtime/provision";
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
  projectId = await rootProject(projectId);
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
  if (!/^[a-z]{20}$/.test(sub)) return false;
  // El ref propio de un borrador (spec local 2026-10-11) también está tomado.
  return (await getBackendByRef(sub)) !== null || (await getEnvironmentByPublicRef(sub)) !== null;
}

/** El backend del proyecto, creándolo si no tiene (sin la base todavía: ésa
 *  se crea con la primera petición o la primera migración). */
export async function ensureBackend(projectId: string): Promise<BackendRecord> {
  projectId = await rootProject(projectId);
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

/** Los proyectos ya mirados por `adoptLegacyEnvironment` en este proceso. */
const adopted = new Set<string>();

/** Los proyectos con base de ANTES de los dos entornos: su base de siempre
 *  (`ol_<ref>`) pasa a ser el entorno que le toca, con `scope` = ref. Lo hace
 *  también `npm run backend-environments:migrate`; esto cubre lo que quede. */
export async function adoptLegacyEnvironment(rec: BackendRecord): Promise<void> {
  if (!rec.provisionedAt) return;
  // Una vez por proceso y proyecto: esto corre en CADA petición al backend, y
  // una vez adoptado (o visto que no hacía falta) ya no cambia.
  if (adopted.has(rec.projectId)) return;
  if ((await listEnvironments(rec.projectId)).length > 0) {
    adopted.add(rec.projectId);
    return;
  }
  const [p] = await db.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, rec.projectId)).limit(1);
  await db
    .insert(schema.projectBackendEnvironments)
    .values({
      projectId: rec.projectId,
      environment: classifyExistingBackend({ status: p?.status ?? null }),
      scope: rec.ref,
      jwtSecretEncrypted: rec.jwtSecretEncrypted,
      provisionedAt: rec.provisionedAt,
      // El borrador nace con su ref propio (spec local 2026-10-11).
      ...(classifyExistingBackend({ status: p?.status ?? null }) === "draft" ? { publicRef: newProjectRef() } : {}),
    })
    .onConflictDoNothing();
  adopted.add(rec.projectId);
}

export async function hasLiveEnvironment(rec: BackendRecord): Promise<boolean> {
  await adoptLegacyEnvironment(rec);
  const live = await getEnvironment(rec.projectId, "live");
  return Boolean(live?.provisionedAt);
}

/** El entorno con su base creada. El borrador nace la primera vez que se pide;
 *  producción, SÓLO al publicar (lib/backend/data-changes.ts). */
export async function ensureEnvironmentReady(rec: BackendRecord, env: Environment): Promise<EnvironmentRecord> {
  await adoptLegacyEnvironment(rec);
  let e = await getEnvironment(rec.projectId, env);
  if (!e) {
    if (env === "live") throw new Error("producción todavía no existe: nace al publicar");
    e = await createEnvironment(rec.projectId, rec.ref, "draft");
  }
  const scoped = { scope: e.scope, ref: rec.ref };
  if (!e.provisionedAt) {
    await provisionDatabase({ ...scoped, dbPassword: decryptToken(rec.dbPasswordEncrypted) });
  }
  /* ── carril D ── El esquema `storage` y el `realtime` también en las bases
   * creadas antes que ellos (ésas no vuelven a provisionDatabase). Una vez por
   * proceso. Si fallan NO tumban /rest/v1 ni /auth/v1, que ya funcionaban: queda
   * en el registro y lo reintenta la siguiente petición; la ruta de Storage lo
   * exige ella misma. */
  const scope = e.scope;
  await ensureStorageProvisioned(scoped).catch((err: unknown) => {
    console.error("[storage] no se pudo montar el esquema storage", scope, err);
  });
  await ensureRealtimeProvisioned(scoped).catch((err: unknown) => {
    console.error("[realtime] no se pudo montar el esquema realtime", scope, err);
  });
  /* ── fin carril D ── */
  if (!e.provisionedAt && env === "draft") {
    // Nace con las tablas de producción (si la hay) y el seed. Si algo falla
    // la base se queda creada igual —sin marcarla no se crearía nunca— y lo
    // dice el registro; `supabase db reset` la rehace.
    const live = await getEnvironment(rec.projectId, "live");
    const password = decryptToken(rec.dbPasswordEncrypted);
    const r = await buildDraftDatabase({
      draft: { scope: e.scope, ref: rec.ref, password },
      live: live?.provisionedAt ? { scope: live.scope, ref: rec.ref, password } : null,
      files: await listProjectFiles(rec.projectId, "/supabase/"),
      includeLocal: false,
    });
    if (!r.ok) console.error("[backend] el borrador nació a medias", rec.ref, r);
  }
  if (!e.provisionedAt) {
    await markEnvironmentProvisioned(rec.projectId, env);
    e = { ...e, provisionedAt: new Date() };
  }
  return e;
}

export function projectUrl(ref: string): string {
  return `https://${ref}.${publishBaseHost()}`;
}

/** La URL propia del borrador (`https://<publicRef>.<publish host>`), creando
 *  el registro del entorno si aún no está (sin crear su base). */
export async function draftProjectUrl(rec: BackendRecord): Promise<string> {
  await adoptLegacyEnvironment(rec);
  const e = (await getEnvironment(rec.projectId, "draft")) ?? (await createEnvironment(rec.projectId, rec.ref, "draft"));
  return projectUrl(await ensureDraftPublicRef(e));
}

/** El host sin puerto y en minúsculas. */
function cleanHost(host: string | null): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export interface HostBackend {
  readonly record: BackendRecord;
  /** El subdominio de la página publicada, si lo tiene. */
  readonly pageSub: string | null;
  /** Fijado por el host: el ref propio del borrador va SIEMPRE al borrador. */
  readonly environment?: Environment;
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
      // El ref propio de un borrador (spec local 2026-10-11), como una rama de Supabase.
      const draft = await getEnvironmentByPublicRef(label);
      if (draft) {
        const byProject = await getBackendByProject(draft.projectId);
        if (byProject) {
          const [p] = await db.select({ subdomain: schema.projects.subdomain }).from(schema.projects).where(eq(schema.projects.id, draft.projectId)).limit(1);
          return { record: byProject, pageSub: p?.subdomain ?? null, environment: "draft" };
        }
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

export { authConfigFor } from "./auth-config-for";

/** Lo que necesita el enrutador para atender a este proyecto EN ESTE ENTORNO. */
export function backendProjectFor(hb: HostBackend, e: EnvironmentRecord): BackendProject {
  const rec = hb.record;
  const base = publishBaseHost();
  const pageHost = hb.pageSub ? `${hb.pageSub}.${base}` : null;
  const config = authConfigFor({ ref: rec.ref, pageSub: hb.pageSub, overrides: rec.authConfig as Partial<AuthConfig>, environment: e.environment });
  return {
    ref: rec.ref,
    scope: e.scope,
    environment: e.environment,
    publishableKey: rec.publishableKey,
    secretKeyHash: rec.secretKeyHash,
    jwtSecret: decryptToken(e.jwtSecretEncrypted),
    db: projectDatabase(dbNameOf(e.scope)),
    auth: {
      config,
      // The draft sends only to the project's team (lib/backend/auth/mail.ts).
      sendMail: (m) => sendAuthEmail(m, { siteHost: pageHost ?? `${rec.ref}.${base}`, projectId: rec.projectId, environment: e.environment }),
    },
  };
}
