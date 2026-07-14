import "server-only";

// Transform + cache para PLANTILLAS (spec 2026-07-14): clave sha256 del html
// — el transform corre una vez por versión de plantilla, no por clon. Un
// fallback (Chrome caído, timeout) NO se cachea: el siguiente clon reintenta
// y mientras tanto recibe el html original (statu quo, jamás peor).
import { createHash } from "node:crypto";
import { transformIngestedHtml, type TransformOptions } from "./index";
import { getCachedTransform, putCachedTransform } from "./cache";

export async function transformTemplateCached(
  templateKey: string,
  html: string,
  opts: TransformOptions = {},
): Promise<string> {
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
  const hit = await getCachedTransform(templateKey, hash);
  if (hit !== null) return hit;

  const out = await transformIngestedHtml(html, {
    timeoutMs: 8000,
    source: `from-template:${templateKey}`,
    ...opts,
  });
  if (out.report.fallback === undefined) {
    await putCachedTransform(templateKey, hash, out.html);
  }
  return out.html;
}
