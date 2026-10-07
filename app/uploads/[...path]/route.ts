// /uploads/… — LAS FOTOS SUBIDAS SIN R2, cuando Next no las sirve solo.
//
// Sin credenciales de R2, `FilesystemStorage` (`lib/storage/`) escribe en
// `public/uploads/` y devuelve `/uploads/<clave>`. En desarrollo Next sirve esa
// carpeta en vivo; con `next start` sólo sirve lo que había en `public/` al
// hacer el build, y en el ensayo de caja de crear-es-len (06/10) las fotos que
// se subieron después salían rotas en el chat y en la página. Lo que ya estaba
// en el build lo sigue sirviendo Next antes de llegar aquí; esta ruta sólo ve
// lo que llegó después. En la caja, `/uploads/*` lo sirve Caddy del disco.
//
// Sólo imágenes ráster —ni SVG ni HTML: esto es el origen de la app, y uno de
// esos podría correr script en él—, con `nosniff`, y nunca fuera de la carpeta.

import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export const runtime = "nodejs";

const TIPOS: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

const noEsta = () => new Response("Not found", { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  // Con R2 las fotos viven allí: aquí no hay nada que servir.
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY && process.env.R2_SECRET_KEY) return noEsta();
  const { path } = await ctx.params;
  if (!Array.isArray(path) || path.length === 0 || path.some((p) => p === "" || p === "." || p === "..")) return noEsta();
  const tipo = TIPOS[extname(path[path.length - 1]!).toLowerCase()];
  if (!tipo) return noEsta();
  const raiz = resolve(process.env.UPLOADS_DIR || "./public/uploads");
  const fichero = resolve(raiz, ...path);
  if (!fichero.startsWith(raiz + sep)) return noEsta();
  const bytes = await readFile(fichero).catch(() => null);
  if (!bytes) return noEsta();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": tipo,
      "X-Content-Type-Options": "nosniff",
      // Las claves llevan un trozo aleatorio: una foto no cambia bajo su URL.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
