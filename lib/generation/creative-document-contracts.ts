import { z } from "zod";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const CREATIVE_DOCUMENT_MANIFEST_VERSION = "creative-document-manifest/1.0" as const;

/**
 * Why a document is rejected, in terms the model can act on. These are the only
 * strings the repair turn is allowed to learn from, and the only ones telemetry
 * retains — no prompt, HTML, CSS, or provider bytes.
 */
export const CreativeDocumentRejectionSchema = z.enum([
  "no_document",
  "truncated",
  "reserved_marker",
  "script_removed",
  "event_handler_removed",
  "frame_removed",
  "unsafe_url_removed",
  "sanitization_failed",
  "seal_failed",
  "missing_title",
  "mobile_overflow",
  "invalid_geometry",
  "render_unavailable",
]);

export type CreativeDocumentRejection = z.infer<typeof CreativeDocumentRejectionSchema>;

export const CreativeDocumentResultCodeSchema = z.enum(["authored", "provider_failed", "rejected"]);

/**
 * Provenance for a page DeepSeek authored end to end. Deliberately small: the
 * model owns the document, OpenLen owns the hash, the turn count, and the
 * redacted reason any earlier attempt was discarded.
 */
export const CreativeDocumentManifestSchema = z
  .object({
    schemaVersion: z.literal(CREATIVE_DOCUMENT_MANIFEST_VERSION),
    briefHash: Sha256Schema,
    modelId: z.string().min(1).max(200),
    /** 1 when the first document was delivered, 2 when the repair turn was. */
    turns: z.number().int().min(1).max(2),
    repaired: z.boolean(),
    rejectedReasons: z.array(CreativeDocumentRejectionSchema).max(16),
    outputHash: Sha256Schema.nullable(),
    resultCode: CreativeDocumentResultCodeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.resultCode === "authored" && value.outputHash === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputHash"],
        message: "authored documents require an output hash",
      });
    }
    if (value.repaired && value.turns !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repaired"],
        message: "a repaired document must report two turns",
      });
    }
  });

export type CreativeDocumentManifest = z.infer<typeof CreativeDocumentManifestSchema>;
