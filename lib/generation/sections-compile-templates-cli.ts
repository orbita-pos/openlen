import { canonicalJsonSha256 } from "./content-hash";
import {
  redactDerivedSectionCompilation,
  type DerivedSectionCompilationReport,
  type DerivedSectionRejectionCodeSchema,
} from "./derived-section-contracts";
import type {
  CompiledDerivedSection,
  CompileDerivedSectionResult,
} from "./derived-section-compiler";
import type { ExtractTemplateBandsResult, ExtractedTemplateBand } from "./template-section-extractor";
import {
  TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT,
  type TemplateCorpusManifest,
  type TemplateCorpusRow,
} from "./template-section-corpus";
import type { z } from "zod";

export interface TemplateSectionCompilationDeps {
  loadCorpus(): Promise<TemplateCorpusManifest>;
  extract(row: TemplateCorpusRow): ExtractTemplateBandsResult;
  compile(band: ExtractedTemplateBand, row: TemplateCorpusRow): Promise<CompileDerivedSectionResult>;
  dedupe(sections: readonly CompiledDerivedSection[]): {
    accepted: readonly CompiledDerivedSection[];
    duplicates: readonly { rejectedId: string; representativeId: string; reason: "exact" | "structural" }[];
  };
  writeReportAtomic(report: DerivedSectionCompilationReport): Promise<void>;
  publishCatalog(sections: readonly CompiledDerivedSection[], report: DerivedSectionCompilationReport): Promise<void>;
}

export interface TemplateSectionCompilationResult {
  ok: true;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  report: DerivedSectionCompilationReport;
}

export function parseTemplateSectionCompilationArgs(argv: readonly string[]): "dry-run" | "publish" {
  const expectedCountArg = `--expected-count=${TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT}`;
  const allowed = new Set(["--dry-run", "--publish", expectedCountArg]);
  if (argv.length !== new Set(argv).size || argv.some((value) => !allowed.has(value))) {
    throw new Error("invalid_compile_argument");
  }
  const dryRun = argv.includes("--dry-run");
  const publish = argv.includes("--publish");
  if (dryRun === publish || !argv.includes(expectedCountArg)) throw new Error("invalid_compile_mode");
  return dryRun ? "dry-run" : "publish";
}

function catalogProjection(sections: readonly CompiledDerivedSection[]) {
  return [...sections]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((section) => ({
      id: section.id,
      contentHash: section.contentHash,
      provenance: section.provenance,
      semantics: section.semantics,
    }));
}

export async function runTemplateSectionCompilation(
  input: { mode: "dry-run" | "publish" },
  deps: TemplateSectionCompilationDeps,
): Promise<TemplateSectionCompilationResult> {
  const corpus = await deps.loadCorpus();
  const work: { row: TemplateCorpusRow; band: ExtractedTemplateBand }[] = [];
  for (const row of corpus.rows) {
    const extracted = deps.extract(row);
    if (!extracted.ok) throw new Error(extracted.code);
    for (const band of extracted.bands) work.push({ row, band });
  }

  const compiled = await Promise.all(work.map(({ row, band }) => deps.compile(band, row)));
  const acceptedBeforeDedupe: CompiledDerivedSection[] = [];
  const rejected: { templateId: string; ordinal: number; code: z.infer<typeof DerivedSectionRejectionCodeSchema> }[] = [];
  compiled.forEach((result, index) => {
    if (result.ok) acceptedBeforeDedupe.push(result.section);
    else rejected.push({
      templateId: work[index].row.templateId,
      ordinal: work[index].band.ordinal,
      code: result.code,
    });
  });
  const deduped = deps.dedupe(acceptedBeforeDedupe);
  const report = redactDerivedSectionCompilation({
    corpusManifestHash: corpus.manifestHash,
    catalogManifestHash: canonicalJsonSha256(catalogProjection(deduped.accepted)),
    expectedTemplates: TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT,
    processedTemplates: corpus.rows.length,
    accepted: deduped.accepted,
    rejected,
    duplicates: deduped.duplicates,
  });

  await deps.writeReportAtomic(report);
  if (input.mode === "publish") await deps.publishCatalog(deduped.accepted, report);
  return {
    ok: true,
    acceptedCount: deduped.accepted.length,
    rejectedCount: rejected.length,
    duplicateCount: deduped.duplicates.length,
    report,
  };
}
