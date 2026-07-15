import "server-only";

import { validateUrl } from "@/lib/style-match/scrape/validate-url";

export interface SheetData {
  values: Map<string, string>;
  rows: Record<string, string>[];
}

const SHEET_ID_RE = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

/** De una URL de edición de Google Sheets a su export CSV público. Esta es la
 *  PRIMERA línea de defensa SSRF (spec datos-vivos §8): comparación exacta de
 *  host contra "docs.google.com" — cualquier otro host (incluida una IP de
 *  metadata/loopback, o un subdominio disfrazado como "docs.google.com.evil.com")
 *  nunca llega a construir una URL, así que jamás llega a fetch. */
export function resolveSheetCsvUrl(userUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(userUrl);
  } catch {
    return null;
  }

  if (parsed.hostname !== "docs.google.com") return null;

  const match = SHEET_ID_RE.exec(parsed.pathname);
  if (!match) return null;
  const id = match[1];

  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const gid = hashParams.get("gid") ?? parsed.searchParams.get("gid") ?? "0";

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/** Parser CSV mínimo pero correcto: campos entre comillas pueden contener
 *  comas, saltos de línea, y comillas escapadas (""). Un naive .split(",")
 *  rompería con cualquier celda de Sheets que tenga una coma (precios con
 *  miles, direcciones, descripciones). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Primera fila = encabezados → `rows` (un objeto por fila). Si hay
 *  EXACTAMENTE 2 columnas, ADEMÁS se construye `values` (col A → col B) —
 *  el formato clave|valor que usa el value-binding (`data-ol-live`). Con 3+
 *  columnas `values` queda vacío; ese CSV es una lista, no pares clave-valor. */
function toSheetData(text: string): SheetData {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return { values: new Map(), rows: [] };

  const [header, ...dataRows] = rows;
  const objRows: Record<string, string>[] = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });

  const values = new Map<string, string>();
  if (header.length === 2) {
    for (const r of dataRows) {
      if (r[0] !== undefined) values.set(r[0], r[1] ?? "");
    }
  }

  return { values, rows: objRows };
}

/** Lee un Google Sheet público como CSV, server-side. Único punto de fetch a
 *  un host externo en todo el feature "datos vivos" — doble guardia SSRF:
 *  1) `resolveSheetCsvUrl` acota el host ANTES de construir la URL (un dueño
 *     malicioso no puede apuntar a loopback/metadata: el host ajeno nunca
 *     produce una URL).
 *  2) `validateUrl` revalida la URL ya resuelta (defensa en profundidad —
 *     incluye resolución DNS a IP privada, no solo el string del host).
 *  Lanza en cualquier falla (SSRF/red/HTTP no-ok/timeout) — nunca devuelve un
 *  resultado parcial. El caller (el baker) decide el fallback: conservar el
 *  último valor conocido, la página publicada jamás se rompe por esto. */
export async function fetchSheet(
  userUrl: string,
  timeoutMs = 5000,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SheetData> {
  const csvUrl = resolveSheetCsvUrl(userUrl);
  if (!csvUrl) {
    throw new Error(`No es una URL de Google Sheets válida: ${userUrl}`);
  }

  const validated = await validateUrl(csvUrl);
  if (!validated.ok) {
    throw new Error(`Sheet URL bloqueada por el guardia SSRF: ${validated.error.kind}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(csvUrl, { signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error(`Sheet fetch expiró después de ${timeoutMs}ms`);
    }
    throw new Error(`Sheet fetch falló: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Sheet fetch falló: HTTP ${response.status}`);
  }

  const text = await response.text();
  return toSheetData(text);
}
