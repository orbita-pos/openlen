import dns from "node:dns/promises";
import type { ScrapeError } from "../types";

const PRIVATE_IPV4_RANGES: Array<[number, number, number, number, number]> = [
  [10, 0, 0, 0, 8],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [0, 0, 0, 0, 8],
  // CGNAT. Lo usan las nubes de verdad para direccionar dentro de su red, así
  // que "no es RFC-1918" no significa "es de internet".
  [100, 64, 0, 0, 10],
  // Asignaciones especiales del IETF y el rango de benchmarking. Ninguno es
  // una web pública, y los dos son alcanzables desde dentro.
  [192, 0, 0, 0, 24],
  [198, 18, 0, 0, 15],
];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * ¿Es una IPv6 que NO debemos alcanzar?
 *
 * Existe porque `ipInPrivateRange` sólo entiende IPv4 y devuelve `true` para
 * todo lo demás — correcto como cierre por defecto, ruinoso al pedir las dos
 * familias: bloqueaba TODA web con IPv6 pública, que hoy son casi todas
 * (`example.com` misma). Medido antes de darlo por bueno.
 *
 * Bloquea: `::1` (loopback), `::` (sin especificar), `fc00::/7` (únicas
 * locales), `fe80::/10` (enlace local) y las `::ffff:x.x.x.x` mapeadas a IPv4,
 * que son la puerta de atrás clásica — `::ffff:127.0.0.1` alcanza el loopback.
 */
export function ipv6IsPrivate(ip: string): boolean {
  const low = ip.toLowerCase().split("%")[0]!;
  if (low === "::1" || low === "::") return true;
  // IPv4 mapeada: se decide con las reglas de IPv4, que son las que valen.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
  if (mapped) return ipInPrivateRange(mapped[1]!);
  const head = low.split(":")[0] ?? "";
  if (head.length === 0) return false;
  const first = parseInt(head.padEnd(4, "0").slice(0, 4), 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 — únicas locales
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 — enlace local
  return false;
}

export function ipInPrivateRange(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const ipInt = ipv4ToInt(parts);
  for (const [a, b, c, d, prefix] of PRIVATE_IPV4_RANGES) {
    const baseInt = ipv4ToInt([a, b, c, d]);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}

export interface ValidatedUrl {
  url: URL;
  hostname: string;
  /** La IP que se validó.
   *
   *  QUIEN HAGA LA PETICIÓN DEBE CONECTARSE A ESTA, no al hostname. Si vuelve a
   *  resolver por su cuenta, un DNS con TTL 0 puede devolver una dirección
   *  pública aquí y 127.0.0.1 medio segundo después — es el ataque de DNS
   *  rebinding, y ninguna validación previa lo detiene. Por eso este contrato
   *  la devuelve: para que no haya una segunda resolución. */
  resolvedIp: string;
}

export async function validateUrl(
  raw: string,
): Promise<{ ok: true; value: ValidatedUrl } | { ok: false; error: ScrapeError }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: { kind: "invalid-url", reason: "Not a valid URL" } };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: { kind: "invalid-url", reason: `Protocol ${parsed.protocol} not allowed` },
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    return {
      ok: false,
      error: { kind: "ssrf-blocked", reason: `Hostname '${hostname}' is not allowed` },
    };
  }

  // AMBAS familias, no sólo IPv4. Con `{ family: 4 }` un host con A pública y
  // AAAA apuntando a ::1 pasaba la comprobación, y el `fetch` posterior podía
  // elegir la IPv6 — la validación miraba una dirección y la conexión usaba
  // otra. Se piden todas y se exige que TODAS sean públicas: basta una privada
  // para que el host quede fuera.
  let resolved: { address: string; family: number };
  try {
    const todas = await dns.lookup(hostname, { all: true });
    const privada = todas.find((a) =>
      a.family === 6 ? ipv6IsPrivate(a.address) : ipInPrivateRange(a.address),
    );
    if (privada) {
      return {
        ok: false,
        error: {
          kind: "ssrf-blocked",
          reason: `Hostname resolves to private IP ${privada.address}`,
        },
      };
    }
    const v4 = todas.find((a) => a.family === 4);
    // Sin IPv4 no hay a qué fijar la conexión: `resolvedIp` es lo que el
    // llamador debe usar para evitar el rebinding de DNS, y una IPv6 no encaja
    // en ese contrato todavía. Se rechaza en vez de aprobar a medias.
    if (!v4) {
      return {
        ok: false,
        error: { kind: "ssrf-blocked", reason: `Hostname '${hostname}' has no public IPv4` },
      };
    }
    resolved = { address: v4.address, family: 4 };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (ipInPrivateRange(resolved.address)) {
    return {
      ok: false,
      error: {
        kind: "ssrf-blocked",
        reason: `Hostname resolves to private IP ${resolved.address}`,
      },
    };
  }

  return {
    ok: true,
    value: { url: parsed, hostname, resolvedIp: resolved.address },
  };
}
