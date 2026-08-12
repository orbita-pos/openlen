import { createHash } from "node:crypto";

import { canonicalJsonSha256 } from "./content-hash";
import type { TemplateRecord } from "@/lib/templates/store";
import type { TemplateMode } from "@/lib/templates/families";
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";

export const TEMPLATE_SECTION_CORPUS_VERSION = "template-section-corpus/1.0" as const;
export const TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT = 450 as const;

export type TemplateCorpusErrorCode =
  | "template_corpus_count_mismatch"
  | "template_corpus_duplicate"
  | "template_corpus_unpublished"
  | "template_corpus_invalid_record"
  | "template_corpus_unavailable"
  | "template_corpus_stale";

export class TemplateCorpusError extends Error {
  constructor(readonly code: TemplateCorpusErrorCode) {
    super(code);
    this.name = "TemplateCorpusError";
  }
}

export interface TemplateCorpusRow {
  templateId: string;
  templateContentHash: string;
  storageKey: string;
  storageUrl: string;
  mode: TemplateMode;
  visualMetadata: TemplateVisualMetadata | null;
  html: string;
}

export interface TemplateCorpusManifest {
  schemaVersion: typeof TEMPLATE_SECTION_CORPUS_VERSION;
  expectedCount: typeof TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT;
  rows: readonly TemplateCorpusRow[];
  manifestHash: string;
}

export interface RedactedTemplateCorpusManifest {
  schemaVersion: typeof TEMPLATE_SECTION_CORPUS_VERSION;
  expectedCount: typeof TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT;
  rowCount: number;
  manifestHash: string;
  rows: readonly {
    templateId: string;
    templateContentHash: string;
    mode: TemplateMode;
  }[];
}

const TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{12}$/;

function sha12(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function canonicalStorageKey(record: TemplateRecord): string {
  return `templates/${record.id}-${record.contentHash}.html`;
}

function validateRecords(records: readonly TemplateRecord[]): TemplateRecord[] {
  if (records.length !== TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT) {
    throw new TemplateCorpusError("template_corpus_count_mismatch");
  }
  if (records.some((record) => record.status !== "published")) {
    throw new TemplateCorpusError("template_corpus_unpublished");
  }
  const ids = records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) {
    throw new TemplateCorpusError("template_corpus_duplicate");
  }
  if (records.some((record) =>
    !TEMPLATE_ID_PATTERN.test(record.id) ||
    record.id.length > 128 ||
    !CONTENT_HASH_PATTERN.test(record.contentHash) ||
    record.storageKey !== canonicalStorageKey(record) ||
    !record.storageUrl.trim()
  )) {
    throw new TemplateCorpusError("template_corpus_invalid_record");
  }
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function manifestHashProjection(rows: readonly TemplateCorpusRow[]) {
  return rows.map((row) => ({
    templateId: row.templateId,
    templateContentHash: row.templateContentHash,
    mode: row.mode,
    visualMetadataHash: canonicalJsonSha256(row.visualMetadata),
  }));
}

function redactedRows(rows: readonly TemplateCorpusRow[]) {
  return rows.map((row) => ({
    templateId: row.templateId,
    templateContentHash: row.templateContentHash,
    mode: row.mode,
  }));
}

export async function buildTemplateCorpus(
  records: readonly TemplateRecord[],
  deps: { fetchText(storageUrl: string): Promise<string | null> },
): Promise<TemplateCorpusManifest> {
  const ordered = validateRecords(records);
  const fetched = await Promise.all(ordered.map(async (record) => {
    let html: string | null;
    try {
      html = await deps.fetchText(record.storageUrl);
    } catch {
      throw new TemplateCorpusError("template_corpus_unavailable");
    }
    if (html === null) throw new TemplateCorpusError("template_corpus_unavailable");
    if (sha12(html) !== record.contentHash) {
      throw new TemplateCorpusError("template_corpus_stale");
    }
    return Object.freeze({
      templateId: record.id,
      templateContentHash: record.contentHash,
      storageKey: record.storageKey,
      storageUrl: record.storageUrl,
      mode: record.mode,
      visualMetadata: record.visualMetadata,
      html,
    });
  }));
  const rows = Object.freeze(fetched);
  return Object.freeze({
    schemaVersion: TEMPLATE_SECTION_CORPUS_VERSION,
    expectedCount: TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT,
    rows,
    manifestHash: canonicalJsonSha256(manifestHashProjection(rows)),
  });
}

export function redactTemplateCorpusManifest(
  manifest: TemplateCorpusManifest,
): RedactedTemplateCorpusManifest {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    expectedCount: manifest.expectedCount,
    rowCount: manifest.rows.length,
    manifestHash: manifest.manifestHash,
    rows: Object.freeze(redactedRows(manifest.rows)),
  });
}
