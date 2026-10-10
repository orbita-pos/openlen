// QUÉ ENTORNO LE TOCA A UNA PETICIÓN (spec local 2026-10-09, sección 4).
//
// La URL del proyecto es una sola (`<ref>.<publish host>`, la que Len pone en
// `createClient`), así que lo que distingue el borrador de producción es DESDE
// DÓNDE llega la petición:
//   · el lienzo de ESTE proyecto (`lienzo-<HMAC>.…`)  → borrador
//   · el lienzo de OTRO proyecto                       → 403
//   · el origen de medida de los ojos de Len (loopback) → borrador
//   · todo lo demás                                     → producción, si existe
// 🔴 Lo que tiene forma de lienzo NUNCA cae a producción: si no es el suyo, se
// rechaza. Un `Origin` de loopback falso sólo da el borrador, detrás de la misma
// RLS que producción: no ve nada que la clave publicable no vea ya allí.

import { etiquetaDelHost } from "@/lib/lienzo/prefijo";

import type { Environment } from "./environments";

export type EnvironmentDecision =
  | { readonly kind: "env"; readonly environment: Environment; readonly attributed: boolean }
  | { readonly kind: "forbidden"; readonly message: string };

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function parse(value: string | null): URL | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function decideEnvironment(i: {
  origin: string | null;
  referer: string | null;
  lienzoLabel: string | null;
  hasLive: boolean;
}): EnvironmentDecision {
  const fallback: Environment = i.hasLive ? "live" : "draft";
  const source = parse(i.origin) ?? parse(i.referer);
  if (!source) return { kind: "env", environment: fallback, attributed: false };
  const label = etiquetaDelHost(source.host);
  if (label) {
    return label === i.lienzoLabel
      ? { kind: "env", environment: "draft", attributed: true }
      : { kind: "forbidden", message: "This canvas does not belong to this project." };
  }
  if (LOOPBACK_ORIGIN.test(source.origin)) return { kind: "env", environment: "draft", attributed: true };
  return { kind: "env", environment: fallback, attributed: true };
}

/** Una lectura de Storage que un `<img>` pide sin `Origin` (y, desde el lienzo,
 *  sin `Referer`): la de un objeto PÚBLICO o la de una URL FIRMADA. La firmada
 *  sólo vale en el entorno cuyo secreto firmó su token, así que probar el otro
 *  no abre nada. */
export function isPublicObjectRead(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const p = new URL(req.url).pathname;
  return ["/storage/v1/object/public/", "/storage/v1/render/image/public/", "/storage/v1/object/sign/", "/storage/v1/render/image/sign/"].some((pre) =>
    p.startsWith(pre),
  );
}
