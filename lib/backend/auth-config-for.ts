// La configuración de GoTrue de UN entorno del backend (spec local 2026-10-09).
// Aparte de registry.ts para poder probarla sin arrastrar lo de publicar.

import { publishBaseHost } from "@/lib/publish/deploy-url";

import { defaultAuthConfig, type AuthConfig } from "./auth/config";
import type { Environment } from "./environments";

export function authConfigFor(o: {
  ref: string;
  pageSub: string | null;
  overrides: Partial<AuthConfig>;
  environment: Environment;
}): AuthConfig {
  const base = publishBaseHost();
  const refHost = `${o.ref}.${base}`;
  const pageHost = o.pageSub ? `${o.pageSub}.${base}` : null;
  return {
    ...defaultAuthConfig(`https://${refHost}/auth/v1`),
    siteUrl: pageHost ? `https://${pageHost}` : `https://${refHost}`,
    ...o.overrides,
    uriAllowList: [
      ...(pageHost ? [`https://${pageHost}/**`] : []),
      `https://${refHost}/**`,
      ...((o.overrides.uriAllowList as string[] | undefined) ?? []),
    ],
    // El borrador no manda correos (como el Supabase local, que los deja en
    // Mailpit): sus cuentas se confirman solas.
    ...(o.environment === "draft" ? { mailerAutoconfirm: true } : {}),
  };
}
