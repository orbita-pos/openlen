// lib/functions/curl.ts — EL `curl` DE LA TERMINAL DE LEN, CON LO DE VERDAD
// (spec local 2026-10-11, Parte 1): las dos URLs de las funciones del proyecto
// (la principal y la propia del borrador) van a la puerta, SIEMPRE al borrador;
// cuentan para la cuota como cualquier llamada; y lo que vuelve a Len pasa por
// el tapado (Len nunca ve un secreto de rebote).

import "server-only";

import { draftProjectUrl, ensureBackend, projectUrl } from "@/lib/backend/registry";
import { decryptToken } from "@/lib/integrations/crypto";

import type { FunctionsCurl } from "./curl-types";
import { functionsEnabled } from "./engines";
import { maskSecrets } from "./mask";
import { invokeFunctionInternally } from "./serve";

const FUERA = new Set(["host", "content-length", "connection", "transfer-encoding"]);

export async function functionsCurlFor(projectId: string): Promise<FunctionsCurl | null> {
  if (!functionsEnabled()) return null;
  const rec = await ensureBackend(projectId);
  const borrador = await draftProjectUrl(rec);
  const secretos = { SUPABASE_SERVICE_ROLE_KEY: decryptToken(rec.secretKeyEncrypted) };
  return {
    prefixes: [`${projectUrl(rec.ref)}/functions/v1/`, `${borrador}/functions/v1/`],
    async call(r) {
      const headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !FUERA.has(k.toLowerCase())));
      const conCuerpo = r.bodyB64 !== null && r.method !== "GET" && r.method !== "HEAD";
      const res = await invokeFunctionInternally(
        new Request(r.url, { method: r.method, headers, ...(conCuerpo ? { body: Buffer.from(r.bodyB64!, "base64") } : {}) }),
      );
      const bytes = Buffer.from(await res.arrayBuffer());
      const texto = bytes.toString("utf8");
      // Sólo se tapa lo que es texto: un binario se devuelve tal cual.
      const cuerpo = Buffer.from(texto, "utf8").equals(bytes) ? Buffer.from(maskSecrets(texto, secretos), "utf8") : bytes;
      return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers), bodyB64: cuerpo.toString("base64") };
    },
  };
}
