// LOS DOCUMENTOS CIMD (Client ID Metadata Documents): el `client_id` es una
// URL https y el documento que sirve dice quién es el cliente. Claude, ChatGPT
// y Codex lo usan. La descarga va con la IP VALIDADA Y FIJADA (`validateUrl`
// + `lookup`): sin segunda resolución que envenenar (rebinding de DNS), sin
// redirecciones, 5 s y 64 KB como mucho.
import https from "node:https";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { isAcceptableRedirectUri } from "./redirects";

export interface ClientMetadataDocument {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

export type FetchJson = (url: string) => Promise<unknown>;

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

export function isCimdClientId(id: string): boolean {
  try {
    const u = new URL(id);
    return u.protocol === "https:" && u.pathname.length > 1 && !u.hash;
  } catch {
    return false;
  }
}

const pinnedFetchJson: FetchJson = async (url) => {
  const v = await validateUrl(url);
  if (!v.ok) throw new Error(`blocked: ${v.error.kind}`);
  const { url: target, resolvedIp } = v.value;
  if (target.protocol !== "https:") throw new Error("CIMD documents must be https");
  return new Promise((resolve, reject) => {
    const req = https.get(
      target,
      {
        headers: { accept: "application/json" },
        timeout: TIMEOUT_MS,
        lookup: (_host, _opts, cb) => cb(null, resolvedIp, resolvedIp.includes(":") ? 6 : 4),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
};

export async function fetchClientMetadataDocument(
  url: string,
  fetchJson: FetchJson = pinnedFetchJson,
): Promise<{ ok: true; doc: ClientMetadataDocument } | { ok: false; reason: string }> {
  let raw: unknown;
  try {
    raw = await fetchJson(url);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const d = raw as Partial<ClientMetadataDocument> | null;
  if (!d || d.client_id !== url) return { ok: false, reason: "client_id does not match the document URL" };
  if (
    !Array.isArray(d.redirect_uris) ||
    d.redirect_uris.length === 0 ||
    !d.redirect_uris.every((u) => typeof u === "string" && isAcceptableRedirectUri(u))
  ) {
    return { ok: false, reason: "redirect_uris missing or not acceptable" };
  }
  return {
    ok: true,
    doc: { client_id: url, client_name: typeof d.client_name === "string" ? d.client_name.slice(0, 100) : undefined, redirect_uris: d.redirect_uris },
  };
}
