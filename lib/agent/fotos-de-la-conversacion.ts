/**
 * LAS FOTOS DE LA CONVERSACIÓN, conseguidas al empezar el turno — la de este
 * turno y las de los turnos que Len ve —, para que viajen pegadas a tu mensaje
 * como una imagen pegada en Claude Code, que la guarda en su almacén y la
 * vuelve a mandar en cada llamada.
 *
 * Las subidas NUESTRAS en disco (desarrollo, sin R2) se leen del disco: por
 * internet son `localhost`, y la defensa SSRF, con razón, no las baja — así en
 * dev Len no veía ninguna foto, ni la del turno en que la mandabas. Las demás,
 * como siempre: `validateUrl` antes de pedir nada, sin redirecciones, tope de
 * 4 MB (`fetchImageAsInlineData`).
 *
 * Una foto que no se consigue es `null`: la nota de tu mensaje lo dice
 * (`notaDeLaFoto`) y el turno sigue. Nunca tumba el turno.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { InlineImage } from "@/lib/ai-gateway";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";

/** El mismo tope que una foto bajada por internet. */
const TOPE_BYTES = 4 * 1024 * 1024;
const MIME_POR_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Las variables que se leen (las de `lib/storage/index.ts`). */
type Entorno = Readonly<Record<string, string | undefined>>;

export interface FuentesDeFotos {
  /** La URL de la petición: lo que es «este mismo servidor». */
  origen: string;
  signal?: AbortSignal;
  /** Dobles para las pruebas; por defecto, el disco y `fetchImageAsInlineData`. */
  leer?: (ruta: string) => Promise<Buffer>;
  deInternet?: (url: string, signal?: AbortSignal) => Promise<InlineImage | null>;
  env?: Entorno;
}

/** El fichero de una subida NUESTRA en disco, o `null` si la dirección no lo
 *  es. Con R2 no hay disco: sus subidas son públicas y bajan por internet como
 *  cualquier otra. Mismas variables que `lib/storage/index.ts`. */
export function rutaDeSubidaPropia(url: string, origen: string, env: Entorno = process.env): string | null {
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY && env.R2_SECRET_KEY) return null;
  let u: URL;
  try {
    u = new URL(url, origen);
    if (u.origin !== new URL(origen).origin) return null;
  } catch {
    return null;
  }
  const base = (env.UPLOADS_PUBLIC_URL || "/uploads").replace(/\/+$/, "");
  if (!base.startsWith("/") || !u.pathname.startsWith(`${base}/`)) return null;
  let clave: string;
  try {
    clave = decodeURIComponent(u.pathname.slice(base.length + 1));
  } catch {
    return null;
  }
  if (!clave || clave.includes("..") || !MIME_POR_EXTENSION[extname(clave).toLowerCase()]) return null;
  const raiz = resolve(env.UPLOADS_DIR || "./public/uploads");
  const ruta = resolve(raiz, clave);
  return ruta.startsWith(raiz + sep) ? ruta : null;
}

async function unaFoto(url: string, f: FuentesDeFotos): Promise<InlineImage | null> {
  const propia = rutaDeSubidaPropia(url, f.origen, f.env);
  if (propia) {
    const buf = await (f.leer ?? ((r: string) => readFile(r)))(propia);
    if (buf.length > TOPE_BYTES) return null;
    return { mimeType: MIME_POR_EXTENSION[extname(propia).toLowerCase()]!, dataBase64: buf.toString("base64") };
  }
  if (f.deInternet) return f.deInternet(url, f.signal);
  const valida = await validateUrl(url);
  if (!valida.ok) return null;
  return fetchImageAsInlineData(url, { redirect: "error", signal: f.signal });
}

/** Dirección → píxeles (o `null`), en paralelo y una vez por dirección. */
export async function conseguirFotos(
  urls: readonly string[],
  f: FuentesDeFotos,
): Promise<Map<string, InlineImage | null>> {
  const unicas = [...new Set(urls)];
  const pares = await Promise.all(unicas.map(async (u) => [u, await unaFoto(u, f).catch(() => null)] as const));
  return new Map(pares);
}
