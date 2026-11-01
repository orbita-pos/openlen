/**
 * A DELIVERED HTML (or SVG) opened on the canvas host (spec local 2026-10-31-len-movil, §5.1): what Len
 * delivers with `present` is never rendered on openlen.com, where its JavaScript would run with the
 * session of whoever opens it (the deliveries route always answers a download). The canvas host is a
 * `.app` origin of the project's own, where it runs whole (localStorage included), as the canvas does.
 *
 * Stored as it is: not `openCanvasDocument`, which would dress it as the project's page (its settings,
 * its app bundle). Framed by the workspace (the canvas host's own rule) and by `framedBy`.
 */
import { guardarDocumento } from "./almacen";
import { urlDelDocumento } from "./host";

type Env = Readonly<Record<string, string | undefined>>;

export type OpenDeliveredResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly status: 503; readonly error: "sin_host" };

export function openDeliveredHtml(
  input: {
    readonly projectId: string;
    readonly personId: string;
    readonly html: string;
    /** An SVG: wrapped in a bare page so it shows at its size. */
    readonly svg?: boolean;
    readonly requestHost: string | null;
    readonly framedBy: readonly string[];
  },
  env: Env = process.env,
): OpenDeliveredResult {
  const build = (docId: string) => urlDelDocumento({ projectId: input.projectId, docId, pagina: null, hostDeLaPeticion: input.requestHost }, env);
  if (build("check") === null) return { ok: false, status: 503, error: "sin_host" };
  const html = input.svg ? `<!doctype html><meta charset="utf-8"><body style="margin:0">${input.html}` : input.html;
  const docId = guardarDocumento({ html, projectId: input.projectId, userId: input.personId, pagina: null, app: null, ...(input.framedBy.length ? { framedBy: input.framedBy } : {}) });
  const url = build(docId);
  return url === null ? { ok: false, status: 503, error: "sin_host" } : { ok: true, url };
}
