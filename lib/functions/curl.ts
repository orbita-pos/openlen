// lib/functions/curl.ts — EL `curl` DE LA TERMINAL DE LEN, CON LO DE VERDAD
// (spec local 2026-10-11, Parte 1): las dos URLs de las funciones del proyecto
// (la principal y la propia del borrador) van a la puerta, SIEMPRE al borrador;
// cuentan para la cuota como cualquier llamada; y lo que vuelve a Len —cuerpo y
// cabeceras— pasa por el tapado, con los secretos del borrador (Len nunca ve un
// secreto de rebote).

import "server-only";

import { draftProjectUrl, ensureBackend, projectUrl } from "@/lib/backend/registry";
import { decryptToken } from "@/lib/integrations/crypto";

import type { FunctionsCurl } from "./curl-types";
import { functionsEnabled } from "./engines";
import { maskBody, maskSecrets } from "./mask";
import { pgSecretStore } from "./secret-store-pg";
import { invokeFunctionInternally } from "./serve";

const FUERA = new Set(["host", "content-length", "connection", "transfer-encoding"]);

export async function functionsCurlFor(projectId: string): Promise<FunctionsCurl | null> {
  if (!functionsEnabled()) return null;
  const rec = await ensureBackend(projectId);
  const borrador = await draftProjectUrl(rec);
  return {
    prefixes: [`${projectUrl(rec.ref)}/functions/v1/`, `${borrador}/functions/v1/`],
    async call(r) {
      const headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !FUERA.has(k.toLowerCase())));
      const conCuerpo = r.bodyB64 !== null && r.method !== "GET" && r.method !== "HEAD";
      const res = await invokeFunctionInternally(
        new Request(r.url, { method: r.method, headers, ...(conCuerpo ? { body: Buffer.from(r.bodyB64!, "base64") } : {}) }),
      );
      const bytes = Buffer.from(await res.arrayBuffer());
      // Los secretos de AHORA, en cada llamada: un `supabase secrets set` de esta
      // misma orden ya cuenta. Cuerpo y cabeceras (una función puede devolver
      // un secreto en una cabecera).
      const secretos = { SUPABASE_SERVICE_ROLE_KEY: decryptToken(rec.secretKeyEncrypted), ...(await pgSecretStore.values(projectId, "draft")) };
      return {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries([...res.headers].map(([k, v]) => [k, maskSecrets(v, secretos)])),
        bodyB64: maskBody(bytes, secretos).toString("base64"),
      };
    },
  };
}
