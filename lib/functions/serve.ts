// lib/functions/serve.ts — LA PUERTA CON LO DE VERDAD (spec local 2026-10-11):
// el host → el backend (registry), el entorno como el resto del backend (el ref
// propio del borrador lo fija; si no, el Origin), el plan del dueño, lo
// desplegado y los contadores en Postgres, y las llamadas guardadas.
// Producción, sólo publicada; si el motor la perdió, se repone lo publicado.
// `invokeFunctionInternally` es el `curl` de la terminal de Len: SIEMPRE el
// borrador (Len no toca producción).

import "server-only";

import { decideEnvironment } from "@/lib/backend/environment-routing";
import { createEnvironment, getEnvironment } from "@/lib/backend/environments";
import { adoptLegacyEnvironment, backendForHost, hasLiveEnvironment } from "@/lib/backend/registry";
import { decryptToken } from "@/lib/integrations/crypto";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";

import { functionsBlocked } from "./blocks-pg";
import { ConcurrencyLimiter } from "./concurrency";
import { ensureDraftDeployed } from "./deploy-core";
import { ownerOf, realDeployDeps } from "./deploy";
import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled, functionsEngine } from "./engines";
import type { FunctionsEnvironment } from "./engines/types";
import { handleFunctionsRequest, type GatewayDeps } from "./gateway";
import { inflightCalls } from "./inflight";
import { recordInvocation } from "./invocations-pg";
import { ensureLiveDeployed } from "./live-core";
import { capsFromEnv } from "./meter";
import { pgSecretStore } from "./secret-store-pg";
import { pgUsageStore } from "./usage-pg";

/** Un proceso, una caja: las plazas «a la vez» viven aquí. */
const limiter = new ConcurrencyLimiter();

function realGatewayDeps(): GatewayDeps {
  return {
    engine: functionsEnabled() ? functionsEngine() : null,
    inflight: inflightCalls(),
    blocked: functionsBlocked,
    async resolve(req, o) {
      const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase().replace(/:\d+$/, "");
      const hb = await backendForHost(host);
      if (!hb) return null;
      let environment: FunctionsEnvironment;
      if (o.forceDraft) environment = "draft";
      else if (hb.environment) environment = hb.environment;
      else {
        const d = decideEnvironment({
          origin: req.headers.get("origin"),
          referer: req.headers.get("referer"),
          lienzoLabel: etiquetaDeLienzo(hb.record.projectId),
          hasLive: await hasLiveEnvironment(hb.record),
        });
        if (d.kind === "forbidden") return { forbidden: d.message };
        environment = d.environment;
      }
      const rec = hb.record;
      return {
        projectId: rec.projectId,
        ref: rec.ref,
        host,
        environment,
        published: hb.pageSub !== null,
        publishableKey: rec.publishableKey,
        secretKeyHash: rec.secretKeyHash,
        // Lo que se tapa en lo que Len lee: la clave del servicio y los secretos
        // de ESTE entorno (al visitante no se le tapa nada: es su respuesta).
        secrets: { SUPABASE_SERVICE_ROLE_KEY: decryptToken(rec.secretKeyEncrypted), ...(await pgSecretStore.values(rec.projectId, environment)) },
        async jwtSecret() {
          await adoptLegacyEnvironment(rec);
          const e = (await getEnvironment(rec.projectId, environment)) ?? (environment === "draft" ? await createEnvironment(rec.projectId, rec.ref, "draft") : null);
          if (!e) throw new Error("producción todavía no existe: nace al publicar");
          return decryptToken(e.jwtSecretEncrypted);
        },
      };
    },
    async plan(projectId) {
      return (await ownerOf(projectId))?.plan ?? "free";
    },
    async ensureDeployed(t) {
      const deps = realDeployDeps();
      if (!deps) return;
      if (t.environment === "draft") await ensureDraftDeployed(t.projectId, t.ref, deps);
      // Producción: si el motor la perdió, el paquete guardado al publicar.
      else await ensureLiveDeployed(t.projectId, t.ref, deps);
    },
    deployment: (p, e) => pgDeploymentStore.get(p, e),
    maps: (p, e) => pgDeploymentStore.maps(p, e),
    usage: pgUsageStore,
    limiter,
    caps: capsFromEnv(),
    record: recordInvocation,
    now: () => new Date(),
  };
}

export function serveFunctions(req: Request): Promise<Response> {
  return handleFunctionsRequest(req, realGatewayDeps());
}

export function invokeFunctionInternally(req: Request): Promise<Response> {
  return handleFunctionsRequest(req, realGatewayDeps(), { forceDraft: true });
}
