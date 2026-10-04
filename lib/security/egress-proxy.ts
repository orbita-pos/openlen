// EL CHROMIUM DEL SERVIDOR SALE A LA RED POR UN PROXY QUE FILTRA (2026-10-04).
//
// `render-ssrf-guard.ts` intercepta las peticiones de UNA página, y tres puertas
// se le escapaban —las dejó apuntadas el revisor de publicación—:
//   · un WebSocket: la interceptación de Puppeteer no lo ve;
//   · el rebinding de DNS: la guarda resuelve el nombre y Chromium lo vuelve a
//     resolver por su cuenta, así que un DNS con TTL 0 contesta público a una y
//     127.0.0.1 a la otra;
//   · una ventana abierta con un clic DE VERDAD: otro target, sin interceptación.
//
// Este proxy está POR DEBAJO de todas las pestañas: Chromium manda por él todo
// su tráfico (`--proxy-server`), también el de loopback (`<-loopback>` le quita
// la excepción que trae de serie), y WebRTC no saca UDP por fuera
// (`disable_non_proxied_udp`). El proxy resuelve el nombre ÉL, rechaza si
// alguna IPv4 es privada y conecta a la IP que resolvió: no hay segunda
// resolución que envenenar. Los orígenes locales que sí tienen que verse —el
// servidor de medida en 127.0.0.1— se registran con `allowEgressOrigin`.
//
// Lo que NO cubre: un fallo del propio Chromium que ignore su proxy. Para eso
// está la otra vía que se valoró, un usuario propio con iptables; ésta cubre lo
// que puede hacer el JavaScript de una página, que es lo que corre aquí.

import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";

import { ipInPrivateRange } from "@/lib/style-match/scrape/validate-url";

export type EgressDecision = { readonly ok: true; readonly address: string } | { readonly ok: false };
type Lookup = (host: string) => Promise<readonly { address: string; family: number }[]>;

const allowed = new Map<string, number>();

/** Abre paso a un origen local exacto (`127.0.0.1:PUERTO`). Devuelve con qué
 *  cerrarlo. Cuenta las altas: dos llamadores con el mismo origen no se pisan. */
export function allowEgressOrigin(hostPort: string): () => void {
  const key = hostPort.toLowerCase();
  allowed.set(key, (allowed.get(key) ?? 0) + 1);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    const n = (allowed.get(key) ?? 1) - 1;
    if (n <= 0) allowed.delete(key);
    else allowed.set(key, n);
  };
}

const systemLookup: Lookup = (host) => dns.lookup(host, { all: true });

/** A dónde se deja conectar, y a QUÉ IP. Falla cerrado: lo que no se puede
 *  resolver, lo interno y lo mixto (una IPv4 pública y otra privada) no pasa. */
export async function decideEgress(hostRaw: string, port: number, lookup: Lookup = systemLookup): Promise<EgressDecision> {
  const host = hostRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowed.has(`${host}:${port}`)) return { ok: true, address: host };
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return { ok: false };
  }
  const literal = net.isIP(host);
  if (literal === 4) return ipInPrivateRange(host) ? { ok: false } : { ok: true, address: host };
  // Las IPv6 literales, fuera: como la guarda, sin repasar cada rango privado.
  if (literal === 6) return { ok: false };
  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false };
  }
  const v4 = addresses.filter((a) => a.family === 4).map((a) => a.address);
  if (v4.length === 0 || v4.some((a) => ipInPrivateRange(a))) return { ok: false };
  return { ok: true, address: v4[0]! };
}

function splitHostPort(authority: string, defaultPort: number): { host: string; port: number } | null {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defaultPort;
  return port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

const FORBIDDEN = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

function createEgressServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // Petición en forma absoluta (`GET http://host/ruta`): HTTP sin cifrar.
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const port = Number(target.port || 80);
    const d = await decideEgress(target.hostname, port);
    if (!d.ok) {
      res.writeHead(403).end();
      return;
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
    delete headers["proxy-connection"];
    const upstream = http.request(
      { host: d.address, port, method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });

  // HTTPS y WebSocket: Chromium abre un túnel con CONNECT.
  server.on("connect", async (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    const hp = splitHostPort(req.url ?? "", 443);
    const d = hp ? await decideEgress(hp.host, hp.port) : ({ ok: false } as const);
    if (!hp || !d.ok) {
      client.end(FORBIDDEN);
      return;
    }
    const upstream = net.connect(hp.port, d.address, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  // Un `Upgrade` en forma absoluta (ws:// sin túnel): se reenvía tal cual.
  server.on("upgrade", async (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      client.end(FORBIDDEN);
      return;
    }
    const port = Number(target.port || 80);
    const d = target.protocol === "http:" || target.protocol === "ws:" ? await decideEgress(target.hostname, port) : ({ ok: false } as const);
    if (!d.ok) {
      client.end(FORBIDDEN);
      return;
    }
    const upstream = net.connect(port, d.address, () => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!;
        if (/^proxy-connection$/i.test(name)) continue;
        lines.push(`${name}: ${/^host$/i.test(name) ? target.host : req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  return server;
}

let starting: Promise<number> | null = null;

/** El puerto del proxy del proceso. Se arranca la primera vez; si no arranca,
 *  la próxima llamada lo vuelve a intentar. */
function egressProxyPort(): Promise<number> {
  if (!starting) {
    starting = new Promise<number>((resolve, reject) => {
      const server = createEgressServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve((server.address() as net.AddressInfo).port);
      });
    }).catch((err) => {
      starting = null;
      throw err;
    });
  }
  return starting;
}

/** Lo que va en los `args` del `launch` de todo Chromium que pinte HTML ajeno. */
export async function isolatedNetworkArgs(): Promise<string[]> {
  const port = await egressProxyPort();
  return [
    `--proxy-server=http://127.0.0.1:${port}`,
    "--proxy-bypass-list=<-loopback>",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
}
