/**
 * THE BYTES OF A PDF THE USER ATTACHED (26/10), for `Read`. The same doors as
 * a photo (`lib/agent/fotos-de-la-conversacion.ts`): our upload on disk
 * (development, no R2) is read from disk — over the network it is `localhost`,
 * which the SSRF defence rightly refuses — and anything else is checked by
 * `validateUrl` first and fetched without following redirects, under a cap.
 * Whatever comes back has to start like a PDF.
 */
import { readFile } from "node:fs/promises";

import { MAX_PDF_BYTES, bytesLookLike, type AttachedKind } from "@/lib/projects/chat-files";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";

import { rutaDeSubidaPropia } from "./fotos-de-la-conversacion";


export async function readAttachmentBytes(
  url: string,
  o: {
    /** The request's URL: what "this same server" is. */
    readonly origen: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly leer?: (ruta: string) => Promise<Buffer>;
    readonly validate?: typeof validateUrl;
    readonly fetchImpl?: typeof fetch;
    readonly maxBytes?: number;
    /** What the file is (spec local 2026-10-26-len-skills); absent = a PDF. */
    readonly kind?: AttachedKind;
  },
): Promise<Uint8Array | null> {
  const max = o.maxBytes ?? MAX_PDF_BYTES;
  try {
    const kind = o.kind ?? "pdf";
    const own = rutaDeSubidaPropia(url, o.origen, o.env ?? process.env, [`.${kind}`]);
    let bytes: Uint8Array;
    if (own) {
      bytes = new Uint8Array(await (o.leer ?? ((r: string) => readFile(r)))(own));
    } else {
      const checked = await (o.validate ?? validateUrl)(url);
      if (!checked.ok) return null;
      const res = await (o.fetchImpl ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > max) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (bytes.length > max || !bytesLookLike(kind, bytes)) return null;
    return bytes;
  } catch {
    return null;
  }
}
