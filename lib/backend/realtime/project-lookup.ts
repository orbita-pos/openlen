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

import { etiquetaDeLienzo } from "@/lib/lienzo/host";

import { decideEnvironment } from "../environment-routing";
import { dbNameOf, listEnvironments, newScope } from "../environments";
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

export async function realtimeProjectForHost(host: string, origin: string | null = null, bases?: readonly string[]): Promise<RealtimeProject | null> {
  const ref = refFromHost(host, bases);
  if (!ref) return null;
  const [rec] = await db.select().from(schema.projectBackends).where(eq(schema.projectBackends.ref, ref)).limit(1);
  if (!rec) return null;
  // El entorno, como `serveBackend` (lib/backend/serve.ts): el lienzo propio y
  // los ojos de Len al borrador, un lienzo ajeno fuera, lo demás a producción.
  const envs = await listEnvironments(rec.projectId);
  const hasLive = envs.some((e) => e.environment === "live" && e.provisionedAt);
  const decision = decideEnvironment({ origin, referer: null, lienzoLabel: etiquetaDeLienzo(rec.projectId), hasLive });
  // Un lienzo ajeno: como un tenant que no existe.
  if (decision.kind === "forbidden") return null;
  const env = envs.find((e) => e.environment === decision.environment) ?? null;
  // Un proyecto de antes sin adoptar todavía: su base de siempre.
  const legacy = envs.length === 0 && rec.provisionedAt ? rec.ref : null;
  const scope = env?.scope ?? legacy;
  // `ref` es la llave de Realtime para TODO (temas, sesiones, slot, base): la
  // del ENTORNO, para que un broadcast del borrador no llegue a producción.
  const project: RealtimeProject = {
    ref: scope ?? newScope(rec.ref, decision.environment),
    publishableKey: rec.publishableKey,
    secretKeyHash: rec.secretKeyHash,
    jwtSecret: decryptToken(env?.jwtSecretEncrypted ?? rec.jwtSecretEncrypted),
  };
  if (!scope || !(env ? env.provisionedAt : rec.provisionedAt)) return project;
  await ensureRealtimeProvisioned({ scope, ref: rec.ref }).catch((err: unknown) => {
    console.error("[realtime] no se pudo montar el esquema realtime", scope, err);
  });
  return { ...project, db: projectDatabase(dbNameOf(scope)) };
}
