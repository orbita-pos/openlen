import "server-only";

// Cache FS del transform de plantillas (spec 2026-07-14): el transform corre
// UNA vez por versión de plantilla (clave templateId+contentHash), no por
// clon — el primer clon paga ~2s de Chrome, los siguientes cero. FS y no
// R2/DB a propósito: cero migraciones, cero escrituras a producción; el
// deploy (atomic swap) o un reboot lo vacían y se re-llena solo, lazy. Un
// cache que falla NUNCA rompe el clon: get → null, put → silencio.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cacheDir(): string {
  return process.env.OPENLEN_TRANSFORM_CACHE_DIR?.trim() || join(tmpdir(), "openlen-transform-cache");
}

function keyFile(templateId: string, contentHash: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(cacheDir(), `${safe(templateId)}-${safe(contentHash)}.html`);
}

export async function getCachedTransform(templateId: string, contentHash: string): Promise<string | null> {
  try {
    return await readFile(keyFile(templateId, contentHash), "utf8");
  } catch {
    return null;
  }
}

export async function putCachedTransform(
  templateId: string,
  contentHash: string,
  html: string,
): Promise<void> {
  try {
    const file = keyFile(templateId, contentHash);
    await mkdir(cacheDir(), { recursive: true });
    // Escritura atómica: tmp+rename — un clon concurrente jamás lee un half-write.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, html, "utf8");
    await rename(tmp, file);
  } catch {
    // El cache es una mejora, no una dependencia.
  }
}
