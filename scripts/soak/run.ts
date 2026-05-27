// F1 shadow-soak synthetic load runner.
//
// Wires a JSONL custom logger into `lib/shadow-soak.ts` (via setShadowLogger),
// then iterates the loaded inputs through every migrated call site. Each
// call sits inside its own try/catch so adversarial inputs that legitimately
// throw (slot-path → sanitize/optimize Rust adapter throws) do NOT abort
// the run — they get logged + absorbed.
//
// Outputs JSONL = one ShadowDivergenceRecord per line. Append-only; survives
// merge with prod logs via `cat synthetic.jsonl prod.jsonl > merged.jsonl`.
//
// Default invocation:
//   npx tsx scripts/soak/run.ts > /dev/null
//
// Full invocation (exercises optimize-html, pulls DB sample):
//   SOAK_LOG=soak-log.jsonl SOAK_DB_SAMPLE=20 NODE_ENV=production \
//   DATABASE_URL=<...> npx tsx scripts/soak/run.ts > /dev/null
//
// See docs/rust-f1-soak-runbook.md for the full procedure + how to interpret
// the resulting JSONL.

import { createWriteStream } from "node:fs";
import process from "node:process";

import {
  applyOps,
  buildScopedView,
  parseOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
  type TaggedHtmlResult,
} from "@/lib/html-ops";
import { normalizeBornCanonical } from "@/lib/normalize";
import { optimizeHtmlForProduction } from "@/lib/publish/optimize-html";
import { setShadowLogger, type ShadowDivergenceRecord } from "@/lib/shadow-soak";
import { sanitizeFilledHtml } from "@/lib/style-match/autofill/sanitize";

import {
  loadAdversarialInputs,
  loadDbProjectsSample,
  loadStarterTemplates,
  type SoakInput,
} from "./inputs";
import { generateOpBatches, generateOpsEnvelopes } from "./ops-generator";

interface JsonlWriter {
  write(record: ShadowDivergenceRecord): void;
  count(): number;
  close(): Promise<void>;
}

function createJsonlWriter(path: string): JsonlWriter {
  const stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
  let writtenCount = 0;
  return {
    write(record) {
      stream.write(JSON.stringify(record) + "\n");
      writtenCount += 1;
    },
    count: () => writtenCount,
    close: () => new Promise<void>((resolve) => stream.end(() => resolve())),
  };
}

function extractFirstOpId(taggedHtml: string): string | null {
  const m = /data-op-id="([a-z0-9]+)"/i.exec(taggedHtml);
  return m ? m[1] : null;
}

const RESOLVE_PATHS = [
  "section:first-child",
  "main > section",
  "h1",
  "body > *:first-child",
  "div.does-not-exist",
];

async function main(): Promise<void> {
  const logPath = process.env.SOAK_LOG ?? "soak-log.jsonl";
  const dbSampleSize = Number.parseInt(process.env.SOAK_DB_SAMPLE ?? "20", 10);

  console.log(`[soak] log path:           ${logPath}`);
  console.log(`[soak] NODE_ENV:           ${process.env.NODE_ENV ?? "(unset)"}`);
  console.log(`[soak] OPENLEN_SHADOW_MODE: ${process.env.OPENLEN_SHADOW_MODE ?? "(unset → defaults to shadow-prefer-ts)"}`);
  console.log(`[soak] DATABASE_URL:       ${process.env.DATABASE_URL ? "(set)" : "(unset → DB sample skipped)"}`);
  if (process.env.NODE_ENV !== "production") {
    console.log(
      "[soak] WARN: optimize-html-for-production is gated on NODE_ENV=production; " +
        "no records will be logged for that site. Set NODE_ENV=production to exercise it.",
    );
  }

  const writer = createJsonlWriter(logPath);
  setShadowLogger({ onDivergence: (record) => writer.write(record) });

  const starters = loadStarterTemplates();
  const dbRows = await loadDbProjectsSample(dbSampleSize);
  const adversarials = loadAdversarialInputs();
  const inputs: SoakInput[] = [...starters, ...dbRows, ...adversarials];
  console.log(
    `[soak] loaded ${inputs.length} inputs (starter=${starters.length}, db=${dbRows.length}, adversarial=${adversarials.length})`,
  );

  // parseOps is input-independent — run the envelope sweep once at the top
  // instead of N × envelopes redundant calls inside the per-input loop.
  // See docs/rust-f1-soak-decisions.md §"Departures from the session brief".
  const envelopes = generateOpsEnvelopes();
  for (const env of envelopes) {
    try {
      parseOps(env.envelope);
    } catch {
      /* envelope-driven throws absorbed */
    }
  }
  console.log(`[soak] parseOps swept ${envelopes.length} envelopes`);

  let processed = 0;
  for (const input of inputs) {
    processed += 1;
    process.stdout.write(
      `\r[soak] ${String(processed).padStart(3)}/${inputs.length} ${input.name.padEnd(48).slice(0, 48)}`,
    );

    // sanitize-filled-html — Rust gate throws on slot-path; TS arm has no
    // gate. Adversarial slot-path inputs will surface errorShapeMismatch.
    try {
      sanitizeFilledHtml(input.html);
    } catch {
      /* shadow-prefer-ts returns TS, but TS may throw on malformed input */
    }

    // normalize-born-canonical — pure regex chain on both sides; byte-equal
    // on the starter set per S2/S7 acceptance.
    try {
      normalizeBornCanonical(input.html);
    } catch {
      /* ignore */
    }

    // optimize-html-for-production — async; dev-mode-gated; logs orthogonal
    // bake-vs-minify deltas as Sem 8.5 telemetry per S8 decision.
    try {
      await optimizeHtmlForProduction(input.html);
    } catch {
      /* ignore */
    }

    // tag-with-op-ids — feeds the rest of the chat-flow chain. If it throws,
    // skip the downstream sites for this input.
    let tagged: TaggedHtmlResult | null = null;
    try {
      tagged = tagWithOpIds(input.html);
    } catch {
      /* skip downstream */
    }

    if (!tagged) continue;

    // strip-op-ids — TS regex vs Rust serializer round trip; serializer
    // whitespace drift is expected (not actionable).
    try {
      stripOpIds(tagged.taggedHtml);
    } catch {
      /* ignore */
    }

    // apply-ops — 8 batches per tagged input; cascade batch exercises S1
    // carry-over; invalid-op-id batch exercises the validation path.
    const batches = generateOpBatches(tagged.taggedHtml);
    for (const batch of batches) {
      try {
        applyOps(batch.taggedHtml, batch.ops);
      } catch {
        /* ignore */
      }
    }

    // resolve-op-id-by-path — multiple paths per input.
    for (const path of RESOLVE_PATHS) {
      try {
        resolveOpIdByPath(tagged.taggedHtml, path);
      } catch {
        /* ignore */
      }
    }

    // build-scoped-view — synthesizes a pin from the first op-id present.
    const firstOpId = extractFirstOpId(tagged.taggedHtml);
    if (firstOpId) {
      try {
        buildScopedView(tagged.taggedHtml, firstOpId);
      } catch {
        /* ignore */
      }
    }
  }

  process.stdout.write("\n");
  await writer.close();
  console.log(`[soak] wrote ${writer.count()} divergence records → ${logPath}`);
  console.log(`[soak] next: npx tsx scripts/soak/tail.ts ${logPath}`);
}

main().catch((err) => {
  console.error("[soak] fatal:", err);
  process.exit(1);
});
