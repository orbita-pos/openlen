// lib/functions/engines/cloudflare-api.ts — CLOUDFLARE PARA LAS EDGE FUNCTIONS
// (spec local 2026-10-12, Partes 1, 4 y 7): lo que comparten el motor, la puesta
// en marcha y las pruebas. Sin dependencias.

/** La misma en miniflare (pruebas) y en Cloudflare: lo probado es lo que corre. */
export const COMPATIBILITY_DATE = "2026-07-30";
export const COMPATIBILITY_FLAGS = ["nodejs_compat"] as const;
/** La entrada del script de un proyecto (la escribe el empaquetador). */
export const WORKER_MAIN_MODULE = "worker.mjs";
/** El Worker despachador: en la cuenta, no en el namespace. */
export const DISPATCHER_SCRIPT = "openlen-dispatch";

export interface CloudflareConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly namespace: string;
  readonly dispatchUrl: string;
  readonly dispatchKey: string;
}

/** Un fallo de la API de Cloudflare, con su estado y su mensaje. */
export class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export type Fetch = typeof fetch;

const API = "https://api.cloudflare.com/client/v4";

/** Una llamada a la API (con su token): el `result` de su sobre si fue bien; si
 *  no, CloudflareApiError con sus mensajes. */
export async function cfRequest<T>(
  cfg: Pick<CloudflareConfig, "accountId" | "apiToken">,
  f: Fetch,
  method: string,
  path: string,
  body?: BodyInit,
  contentType?: string,
): Promise<T> {
  const res = await f(`${API}/accounts/${cfg.accountId}${path}`, {
    method,
    headers: { authorization: `Bearer ${cfg.apiToken}`, ...(contentType ? { "content-type": contentType } : {}) },
    ...(body === undefined ? {} : { body }),
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[]; result?: T } | null;
  if (!res.ok || !data || data.success === false) {
    const mensaje = (data?.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
    throw new CloudflareApiError(res.status, mensaje || `HTTP ${res.status}`);
  }
  return data.result as T;
}

/** El multipart de subir un script: `metadata` y cada fichero como módulo ES. */
export function scriptForm(metadata: Readonly<Record<string, unknown>>, files: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  for (const [nombre, texto] of Object.entries(files)) form.append(nombre, new Blob([texto], { type: "application/javascript+module" }), nombre);
  return form;
}
