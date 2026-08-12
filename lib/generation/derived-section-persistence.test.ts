import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { parseSectionDerivation, publishDerivedSectionCatalog } from "@/lib/sections/store";
import {
  DerivedSectionProvenanceSchema,
  DerivedSectionSemanticsSchema,
} from "@/lib/generation/derived-section-contracts";

const provenance = DerivedSectionProvenanceSchema.parse({
  schemaVersion: "derived-section-provenance/1.0",
  sourceTemplateId: "arcana",
  sourceTemplateHash: "a".repeat(12),
  sourceBandOrdinal: 2,
  extractionVersion: "template-band-extractor/1.0",
  sourceHash: `sha256:${"a".repeat(64)}`,
  structuralFingerprint: `sha256:${"b".repeat(64)}`,
});
const semantics = DerivedSectionSemanticsSchema.parse({
  schemaVersion: "derived-section-semantics/1.0",
  role: "hero",
  layoutArchetypes: ["editorial"],
  domains: ["children_creativity"],
  audiences: ["children"],
  moods: ["playful"],
  negativeSignals: ["dashboard"],
});

describe("derived section persistence", () => {
  it("accepts pair-or-neither and rejects corrupt or one-sided rows", () => {
    expect(parseSectionDerivation(null, null)).toEqual({ provenance: null, derivedSemantics: null });
    expect(parseSectionDerivation(provenance, semantics)).toEqual({ provenance, derivedSemantics: semantics });
    expect(() => parseSectionDerivation(provenance, null)).toThrow("invalid_section_derivation");
    expect(() => parseSectionDerivation(null, semantics)).toThrow("invalid_section_derivation");
    expect(() => parseSectionDerivation({ ...provenance, html: "<html>" }, semantics)).toThrow("invalid_section_derivation");
  });

  it("ships an idempotent deploy-bundled migration with the provenance index", () => {
    const migration = readFileSync("scripts/sections-derived-migrate.ts", "utf8");
    const bundle = readFileSync("scripts/build-migrations.mjs", "utf8");
    const schema = readFileSync("lib/db/schema.ts", "utf8");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "provenance" jsonb');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "derivedSemantics" jsonb');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "sections_derived_source_idx"');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(bundle).toContain('"sections-derived-migrate"');
    expect(schema).toContain('provenance: jsonb("provenance")');
    expect(schema).toContain('derivedSemantics: jsonb("derivedSemantics")');
  });

  it("uploads the complete immutable catalog before one atomic database publication", async () => {
    const events: string[] = [];
    const upload = async ({ key, body }: { key: string; body: Buffer }) => {
      events.push(`upload:${key}`);
      return { key, url: `https://sections.invalid/${key}`, size: body.length, etag: "etag" };
    };
    const execute = async () => { events.push("execute"); return []; };
    const rows = ["arcana", "obra"].map((sourceTemplateId, ordinal) => ({
      id: `derived-hero-${sourceTemplateId}-${ordinal}-aaaaaaaaaaaa`,
      html: `<section id="hero-${ordinal}">${sourceTemplateId}</section>`,
      type: "hero" as const,
      mode: "light" as const,
      provenance: { ...provenance, sourceTemplateId, sourceBandOrdinal: ordinal },
      semantics,
      designTokens: {},
      fonts: [],
      needsJs: false,
      hasPlaceholders: false,
      contentHash: ordinal === 0 ? "a".repeat(12) : "b".repeat(12),
      renderScore: 90,
      sourceExactHash: ordinal === 0 ? `sha256:${"c".repeat(64)}` : `sha256:${"d".repeat(64)}`,
    }));
    await publishDerivedSectionCatalog(rows, { upload, execute });
    expect(events).toEqual([
      `upload:sections/${rows[0].id}-${rows[0].contentHash}.html`,
      `upload:sections/${rows[1].id}-${rows[1].contentHash}.html`,
      "execute",
    ]);
  });

  it("does not touch the database when any catalog upload fails", async () => {
    const execute = vi.fn(async () => []);
    await expect(publishDerivedSectionCatalog([{
      id: "derived-hero-arcana-0-aaaaaaaaaaaa",
      html: "<section>Arcana</section>",
      type: "hero",
      mode: "light",
      provenance,
      semantics,
      designTokens: {}, fonts: [], needsJs: false, hasPlaceholders: false,
      contentHash: "a".repeat(12), renderScore: 90, sourceExactHash: `sha256:${"c".repeat(64)}`,
    }], {
      upload: async () => { throw new Error("storage unavailable"); },
      execute,
    })).rejects.toThrow("storage unavailable");
    expect(execute).not.toHaveBeenCalled();
  });
});
