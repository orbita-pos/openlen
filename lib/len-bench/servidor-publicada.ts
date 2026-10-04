// lib/len-bench/servidor-publicada.ts — la publicada, servida como en producción.
//
// Copia del bloque `*.openlen.app` de infra/caddy/Caddyfile, en lo que un
// visitante puede tocar:
//   · los prefijos con `handle` propio van a Next (formularios, datos, chat,
//     analítica…), CON el Host de la publicada, como hace reverse_proxy;
//   · `/assets/*` sale de `<sub>/assets`;
//   · todo lo demás es `try_files {path} {path}/index.html /index.html` sobre
//     `<sub>/current` — y por eso un enlace roto devuelve la HOME (memoria
//     `caddy-broken-links-serve-home`). Los graders lo saben.
//
// ⚠️ `/uploads/*` NO es un proxy en Caddy: es `file_server` sobre
// /var/openlen/uploads. Aquí va a Next porque, sin R2, el almacenamiento local
// escribe en ./public/uploads (lib/storage/index.ts) y quien sirve esa carpeta
// en local es Next. Mismo fichero, otro camino.
//
// lib/publish/flight-check.ts tiene otro servidor de releases, pero sólo sirve
// la home y `/assets/` para Lighthouse: sin try_files ni proxy no vale aquí.
//
// Si el Caddyfile gana o pierde un `handle`, esta lista se queda atrás, pero
// no en silencio: servidor-publicada.test.ts lee el bloque del Caddyfile y se
// pone rojo. Al tocar el Caddyfile, tocar esto.

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export const PREFIJOS_A_NEXT: readonly string[] = [
  "/c/", "/api/f/", "/api/lienzo/", "/api/d/", "/api/a/", "/api/m/", "/api/cm/", "/api/bk/", "/api/b/", "/api/chat/", "/uploads/",
  // El backend de las páginas (lib/backend): la API de Supabase.
  "/rest/v1/", "/auth/v1/",
];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".xml": "application/xml", ".txt": "text/plain",
};

async function existeFichero(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isFile(), () => false);
}

/**
 * La carpeta de la release viva. En la caja `current` es un enlace a
 * `releases/<sha>`; en Windows sin modo desarrollador `publishToDir` no puede
 * crear el enlace (EPERM) y deja un FICHERO con el sha dentro
 * (lib/publish/filesystem.ts). Medido en esta máquina el 2026-09-23: da EPERM.
 * Sin esto, `/` servía ese fichero y la «home» publicada era el sha.
 */
async function dirDeLaRelease(subDir: string): Promise<string> {
  const current = path.join(subDir, "current");
  if (await existeFichero(current)) {
    return path.join(subDir, "releases", (await fs.readFile(current, "utf8")).trim());
  }
  return current;
}

export async function servirPublicada(o: {
  readonly raiz: string;
  readonly sub: string;
  readonly next: string;
  readonly hostPublicado: string;
}): Promise<{ url: string; cerrar(): Promise<void> }> {
  const subDir = path.join(o.raiz, o.sub);
  const assets = path.join(subDir, "assets");

  const servidor = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://lb.local");
      const ruta = decodeURIComponent(url.pathname);
      if (PREFIJOS_A_NEXT.some((p) => ruta.startsWith(p))) {
        const destino = new URL(req.url ?? "/", o.next);
        // El `Origin` de la propia publicada es el de su host, como en
        // producción. Sin esto Chromium mandaba 127.0.0.1, `requestingHost` lo
        // lee antes que el Host, y los almacenes (`/api/d/`) contestaban 404.
        const origen =
          req.headers.origin === `http://${req.headers.host}` ? { origin: `https://${o.hostPublicado}` } : {};
        const prox = http.request(
          destino,
          { method: req.method, headers: { ...req.headers, ...origen, host: o.hostPublicado, "x-forwarded-host": o.hostPublicado } },
          (r) => {
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          },
        );
        prox.on("error", (e) => res.writeHead(502).end(`proxy: ${e.message}`));
        req.pipe(prox);
        return;
      }
      let fichero: string | null = null;
      if (ruta.startsWith("/assets/")) {
        const nombre = ruta.slice("/assets/".length);
        if (/^[A-Za-z0-9._-]+$/.test(nombre)) fichero = path.join(assets, nombre);
      } else {
        const limpia = path.normalize(ruta).replace(/^([/\\])+/, "");
        if (limpia.includes("..")) {
          res.writeHead(400).end();
          return;
        }
        // Por petición y no al arrancar: si el encargo vuelve a publicar, la
        // release viva cambia y el servidor tiene que ver la nueva.
        const actual = await dirDeLaRelease(subDir);
        for (const c of [path.join(actual, limpia), path.join(actual, limpia, "index.html"), path.join(actual, "index.html")]) {
          if (await existeFichero(c)) {
            fichero = c;
            break;
          }
        }
      }
      if (!fichero || !(await existeFichero(fichero))) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(fichero).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(await fs.readFile(fichero));
    })().catch((e: unknown) => res.writeHead(500).end(String(e)));
  });

  await new Promise<void>((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(0, "127.0.0.1", resolve);
  });
  const a = servidor.address();
  if (a === null || typeof a === "string") throw new Error("el servidor de la publicada no consiguió puerto");
  return {
    url: `http://127.0.0.1:${a.port}`,
    // `close()` a secas espera a que el cliente suelte sus conexiones, y
    // Chromium deja la suya viva tras enviar un formulario: se cortan todas.
    cerrar: () =>
      new Promise<void>((r) => {
        servidor.close(() => r());
        servidor.closeAllConnections();
      }),
  };
}
