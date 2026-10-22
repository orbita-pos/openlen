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
  // Documentación (TEST-NET-1/2/3), multicast y lo reservado con la difusión
  // dentro (21/10): nada de esto es una web.
  [192, 0, 2, 0, 24],
  [198, 51, 100, 0, 24],
  [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
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
 * Se leen los 128 bits (21/10: antes miraba el texto, y una que empezaba por
 * «::» salía pública, y una mapeada sólo se reconocía escrita con puntos). Lo
 * que lleva una IPv4 dentro —mapeada `::ffff:0:0/96`, 6to4 `2002::/16`— se
 * juzga por esa IPv4: `::ffff:7f00:1` es el loopback. Bloquea además `::1`,
 * `::`, la compatible `::/96`, NAT64 `64:ff9b::/32`, Teredo `2001::/32`,
 * documentación `2001:db8::/32`, descarte `100::/64`, `fc00::/7`, `fe80::/10`,
 * `fec0::/10` y multicast `ff00::/8`. Lo que no se puede leer, también.
 */
export function ipv6IsPrivate(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const ceros = (n: number) => g.slice(0, n).every((x) => x === 0);
  const v4 = (alto: number, bajo: number) => `${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`;
  if (ceros(8) || (ceros(7) && g[7] === 1)) return true; // `::` y `::1`
  if (ceros(5) && g[5] === 0xffff) return ipInPrivateRange(v4(g[6]!, g[7]!)); // mapeada a IPv4
  if (ceros(6)) return true; // compatible con IPv4, en desuso
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  if (g[0] === 0x2002) return ipInPrivateRange(v4(g[1]!, g[2]!)); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true; // Teredo y documentación
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // descarte 100::/64
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 — únicas locales
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 — enlace local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 — sitio local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
  return false;
}

/** Los ocho grupos de 16 bits de una IPv6 (con «::» y una IPv4 al final), o null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0]!;
  let cola: number[] = [];
  const conPuntos = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (conPuntos) {
    const p = conPuntos[2]!.split(".").map(Number);
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    cola = [(p[0]! << 8) | p[1]!, (p[2]! << 8) | p[3]!];
    s = conPuntos[1]!.endsWith("::") ? conPuntos[1]! : conPuntos[1]!.slice(0, -1);
  }
  const mitades = s.split("::");
  if (mitades.length > 2) return null;
  const grupos = (t: string) => (t === "" ? [] : t.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : Number.NaN)));
  const delante = grupos(mitades[0]!);
  const detras = mitades.length === 2 ? grupos(mitades[1]!) : [];
  if ([...delante, ...detras].some(Number.isNaN)) return null;
  const conocidos = delante.length + detras.length + cola.length;
  if (mitades.length === 1 ? conocidos !== 8 : conocidos > 7) return null;
  return [...delante, ...new Array<number>(mitades.length === 2 ? 8 - conocidos : 0).fill(0), ...detras, ...cola];
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
