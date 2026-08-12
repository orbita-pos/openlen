import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { compileDerivedSection, dedupeDerivedSections } from "@/lib/generation/derived-section-compiler";
import {
  parseTemplateSectionCompilationArgs,
  runTemplateSectionCompilation,
} from "@/lib/generation/sections-compile-templates-cli";
import { buildTemplateCorpus, TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT } from "@/lib/generation/template-section-corpus";
import { extractTemplateBands } from "@/lib/generation/template-section-extractor";
import { publishDerivedSectionCatalog } from "@/lib/sections/store";
import { listTemplates } from "@/lib/templates/store";

const REPORT_PATH = join(process.cwd(), "scratch", "visual-engine-derived-sections", "compilation-report.json");

function templateHead(html: string): string {
  return /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
}

function safeAssetReferences(html: string): boolean {
  for (const match of html.matchAll(/\b(?:src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (match[1] ?? match[2] ?? "").trim();
    if (!value || /^(?:javascript|vbscript|file):/i.test(value)) return false;
    if (/^https?:/i.test(value)) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return false;
      } catch {
        return false;
      }
    } else if (!value.startsWith("/") && !value.startsWith("data:image/")) {
      return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  const mode = parseTemplateSectionCompilationArgs(process.argv.slice(2));
  const result = await runTemplateSectionCompilation({ mode }, {
    loadCorpus: async () => buildTemplateCorpus(
      await listTemplates({ status: "published" }),
      {
        fetchText: async (storageUrl) => {
          const response = await fetch(storageUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          return response.ok ? response.text() : null;
        },
      },
    ),
    extract: extractTemplateBands,
    compile: async (band, row) => compileDerivedSection(band, {
      templateHead: templateHead(row.html),
      metadata: row.visualMetadata,
      mode: row.mode,
    }, {
      validateAssets: async (html) => safeAssetReferences(html),
      validateRender: async ({ html }) => {
        const rendered = await renderVisualQualityViewports(`<!doctype html><html><head></head><body>${html}</body></html>`);
        if (!rendered) return { ok: false, code: "render_failed" };
        return {
          ok: true,
          desktopVisible: rendered.desktop.dataBase64.length > 0,
          mobileVisible: rendered.mobile.dataBase64.length > 0,
          mobileOverflow: rendered.mobileOverflow === true,
          score: 100 - (rendered.weakTypographyHierarchy ? 10 : 0) - (rendered.squareComponentTreatment ? 5 : 0),
        };
      },
    }),
    dedupe: dedupeDerivedSections,
    writeReportAtomic: async (report) => {
      await mkdir(dirname(REPORT_PATH), { recursive: true });
      await writeJsonAtomic(REPORT_PATH, report);
    },
    publishCatalog: async (sections) => publishDerivedSectionCatalog(sections),
  });
  console.log(JSON.stringify({
    event: "derived_section_compilation",
    ok: result.ok,
    mode,
    expectedTemplates: TEMPLATE_SECTION_CORPUS_EXPECTED_COUNT,
    acceptedCount: result.acceptedCount,
    rejectedCount: result.rejectedCount,
    duplicateCount: result.duplicateCount,
    reportPath: "scratch/visual-engine-derived-sections/compilation-report.json",
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "derived_section_compilation",
      ok: false,
      code: error instanceof Error ? error.message : "compile_failed",
    }));
    process.exitCode = 1;
  });
}
