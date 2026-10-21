import { ArtifactError, type ArtifactDataset } from "../../types";

/**
 * A dataset the dashboard carries as one of its own files, as Claude's dashboards attach a CSV, TSV or JSON file.
 * Rows Len wrote are a hypothetical scenario and are labeled as one; `title` and `description` (from
 * dashboard.json "datasets") say what they are and how they were made.
 */
export const DATASET_FILE = /\.(csv|tsv|json)$/i;
const MAX_ROWS = 500, MAX_COLUMNS = 64;

/** RFC 4180: quoted cells may hold the separator, quotes ("") and line breaks. An unquoted number is a number. */
function delimited(text: string, separator: string, path: string): { columns: string[]; rows: unknown[][] } {
  const records: { cells: string[]; quoted: boolean[] }[] = [];
  let cells: string[] = [], quoted: boolean[] = [], cell = "", inQuotes = false, wasQuoted = false;
  const endCell = () => { cells.push(cell); quoted.push(wasQuoted); cell = ""; wasQuoted = false; };
  const endRecord = () => { endCell(); if (cells.some((c, i) => c !== "" || quoted[i])) records.push({ cells, quoted }); cells = []; quoted = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"' && cell === "") { inQuotes = true; wasQuoted = true; }
    else if (c === separator) endCell();
    else if (c === "\n") endRecord();
    else if (c !== "\r") cell += c;
  }
  if (inQuotes) throw new ArtifactError("invalid_dataset", `${path}: a quoted cell is never closed`);
  if (cell !== "" || cells.length) endRecord();
  const [header, ...body] = records;
  if (!header) throw new ArtifactError("invalid_dataset", `${path}: empty; the first row names the columns`);
  const columns = header.cells.map((c) => c.trim());
  const rows = body.map((r, index) => {
    if (r.cells.length !== columns.length) throw new ArtifactError("invalid_dataset", `${path}: row ${index + 2} has ${r.cells.length} cells, the header ${columns.length}`);
    return r.cells.map((c, i) => !r.quoted[i] && /^-?\d+(\.\d+)?$/.test(c.trim()) ? Number(c) : c);
  });
  return { columns, rows };
}

/** A JSON array of row objects, bare or under rows/data/results. Columns in the order they first appear. */
function jsonRows(text: string, path: string): { columns: string[]; rows: unknown[][] } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ArtifactError("invalid_dataset", `${path}: not JSON`); }
  const list = Array.isArray(value) ? value : ((value as Record<string, unknown>)?.rows ?? (value as Record<string, unknown>)?.data ?? (value as Record<string, unknown>)?.results);
  if (!Array.isArray(list) || list.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new ArtifactError("invalid_dataset", `${path}: a JSON dataset is an array of row objects, bare or under "rows"`);
  const columns: string[] = [];
  for (const row of list) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const cell = (v: unknown) => v === undefined ? null : v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) ? v : JSON.stringify(v);
  return { columns, rows: list.map((row) => columns.map((c) => cell((row as Record<string, unknown>)[c]))) };
}

export function fileDataset(path: string, text: string, meta: { title?: string; description?: string } | undefined, capturedAt: string): ArtifactDataset {
  const kind = DATASET_FILE.exec(path)![1]!.toLowerCase();
  const table = kind === "json" ? jsonRows(text, path) : delimited(text, kind === "tsv" ? "\t" : ",", path);
  if (!table.columns.length || table.columns.length > MAX_COLUMNS || table.columns.some((c) => !c || c.length > 200) || new Set(table.columns).size !== table.columns.length) throw new ArtifactError("invalid_dataset", `${path}: 1 to ${MAX_COLUMNS} columns with distinct, non-empty names`);
  if (table.rows.length > MAX_ROWS) throw new ArtifactError("invalid_dataset", `${path}: ${table.rows.length} rows; ${MAX_ROWS} at most`);
  if (Buffer.byteLength(JSON.stringify(table)) > 2 * 1024 * 1024) throw new ArtifactError("dataset_too_large", `${path}: over 2 MB`);
  const title = typeof meta?.title === "string" ? meta.title.trim().slice(0, 120) : undefined;
  const description = typeof meta?.description === "string" ? meta.description.trim().slice(0, 500) : undefined;
  return { id: path, mode: "scenario", environment: null, visibility: "project", columns: table.columns, rows: table.rows, query: null, source: "file", capturedAt, truncated: false, ...(title ? { title } : {}), ...(description ? { description } : {}) };
}
