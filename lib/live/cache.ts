import "server-only";

// Cache FS de datos vivos (spec 2026-07-14): un fetch por URL de Sheet, no
// por página — muchas páginas pueden apuntar al mismo Sheet, y el cron
// (siguiente task) hace UN fetch por URL aunque N páginas lo compartan. FS y
// no R2/DB a propósito, igual que lib/transform/cache.ts: cero migraciones,
// cero escrituras a producción; un fetch fallido cae al último dato bueno en
// vez de romper la página. Un cache que falla NUNCA rompe el bake: get →
// null, put → silencio.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SheetData } from "./sheet-source";

interface CachedSheetFile {
  savedAt: number;
  values: [string, string][];
  rows: Record<string, string>[];
}

function cacheDir(): string {
  return process.env.OPENLEN_LIVE_CACHE_DIR?.trim() || join(tmpdir(), "openlen-live-cache");
}

function keyFile(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return join(cacheDir(), `${hash}.json`);
}

export async function getCachedSheet(url: string, ttlMs: number): Promise<SheetData | null> {
  try {
    const raw = await readFile(keyFile(url), "utf8");
    const parsed = JSON.parse(raw) as CachedSheetFile;
    if (Date.now() - parsed.savedAt >= ttlMs) return null;
    return { values: new Map(parsed.values), rows: parsed.rows };
  } catch {
    return null;
  }
}

export async function putCachedSheet(url: string, data: SheetData): Promise<void> {
  try {
    const file = keyFile(url);
    // 0700: mismo razonamiento que lib/transform/cache.ts — el default vive
    // bajo tmpdir compartido, que nadie más que el app-user pre-plante
    // archivos. En Windows el mode se ignora — inofensivo.
    await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
    const payload: CachedSheetFile = {
      savedAt: Date.now(),
      values: [...data.values],
      rows: data.rows,
    };
    // Escritura atómica: tmp+rename — un lector concurrente jamás ve un half-write.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, file);
  } catch {
    // El cache es una mejora, no una dependencia.
  }
}
