// Del Host al proyecto, para el servicio de Realtime. No usa
// lib/backend/registry.ts: arrastra lo de publicar y sus crates nativos, que
// esbuild no puede empaquetar en el .mjs del servicio. Sólo la URL del
// proyecto, `<ref>.<base>`, la que usa supabase-js (como Storage): el host de
// la página pediría resolver proyectos y dominios propios, y nadie llama a
// Realtime por ahí.
//
// La base del proyecto la crea Next (ensureProvisioned, la primera petición o
// `supabase db push`). Sin base todavía, broadcast y presence funcionan igual
// (no la tocan); postgres_changes y los canales privados contestan su error.

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/crypto";
import { publishedBaseHosts } from "@/lib/publish/request-origin";

import { projectDatabase } from "../pg";
import type { RealtimeProject } from "./channel";
import { ensureRealtimeProvisioned } from "./provision";

const REF_RE = /^[a-z]{20}$/;

/** El `ref` de `<ref>.<base>`, o null. */
export function refFromHost(hostHeader: string, bases: readonly string[] = publishedBaseHosts()): string | null {
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
  for (const base of bases) {
    if (!host.endsWith(`.${base}`)) continue;
    const label = host.slice(0, -(base.length + 1));
    if (REF_RE.test(label)) return label;
  }
  return null;
}

export async function realtimeProjectForHost(host: string, bases?: readonly string[]): Promise<RealtimeProject | null> {
  const ref = refFromHost(host, bases);
  if (!ref) return null;
  const [rec] = await db.select().from(schema.projectBackends).where(eq(schema.projectBackends.ref, ref)).limit(1);
  if (!rec) return null;
  // Como `backendProjectFor` (registry.ts).
  const project: RealtimeProject = {
    ref,
    publishableKey: rec.publishableKey,
    secretKeyHash: rec.secretKeyHash,
    jwtSecret: decryptToken(rec.jwtSecretEncrypted),
  };
  if (!rec.provisionedAt) return project;
  await ensureRealtimeProvisioned({ scope: ref, ref }).catch((err: unknown) => {
    console.error("[realtime] no se pudo montar el esquema realtime", ref, err);
  });
  return { ...project, db: projectDatabase(`ol_${ref}`) };
}
