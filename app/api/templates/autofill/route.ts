import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { LandingPage } from "@/lib/orchestrator/types";
import { createVersion } from "@/lib/projects/versions";
import {
  ExtractedBusinessDataSchema,
  extractFromImage,
  fillTemplate,
  type ExtractedBusinessData,
} from "@/lib/style-match/autofill";

// POST /api/templates/autofill
//
// Body shapes (one of):
//   { projectId: string, source: "image", image: base64, imageMime?: "image/jpeg" | "image/png" }
//   { projectId: string, source: "text",  data: ExtractedBusinessData }
//
// Streams Server-Sent Events:
//   progress  { stage: "extracting" | "tagging" | "calling-model" | "applying" | "persisting" }
//   extracted { data: ExtractedBusinessData }                    // only in image mode
//   delta     { bytes: number }                                  // cumulative Kimi bytes
//   done      { newHtml, appliedOps, totalOps, versionId, durationMs, source }
//   error     { kind, message }

export const runtime = "nodejs";

const ENCODER = new TextEncoder();
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthenticated");
  const userId = session.user.id;

  let body: {
    projectId?: unknown;
    source?: unknown;
    image?: unknown;
    imageMime?: unknown;
    data?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "invalid JSON body");
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return errorJson(400, "projectId is required");

  const source = body.source === "image" || body.source === "text" ? body.source : null;
  if (!source) return errorJson(400, "source must be 'image' or 'text'");

  let imageBuffer: Buffer | null = null;
  let imageMime: "image/jpeg" | "image/png" = "image/jpeg";
  let providedData: ExtractedBusinessData | null = null;

  if (source === "image") {
    if (typeof body.image !== "string" || body.image.length === 0) {
      return errorJson(400, "image (base64) is required when source = 'image'");
    }
    const stripped = body.image.replace(/^data:image\/(jpeg|png);base64,/, "");
    try {
      imageBuffer = Buffer.from(stripped, "base64");
    } catch {
      return errorJson(400, "image is not valid base64");
    }
    if (imageBuffer.byteLength === 0) return errorJson(400, "image is empty");
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
      return errorJson(
        400,
        `image too large (${(imageBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, max 8 MB)`,
      );
    }
    if (body.imageMime === "image/png") imageMime = "image/png";
  } else {
    const parsed = ExtractedBusinessDataSchema.safeParse(body.data);
    if (!parsed.success) {
      return errorJson(
        400,
        `data is invalid: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" | ")}`,
      );
    }
    providedData = parsed.data;
  }

  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return errorJson(404, "project not found");

  const currentHtml = existing.data?.html ?? "";
  if (!/<html[\s>]/i.test(currentHtml) || !/<\/html>/i.test(currentHtml)) {
    return errorJson(400, "project HTML is missing or malformed");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        let businessData: ExtractedBusinessData;

        if (source === "image" && imageBuffer) {
          emit("progress", { stage: "extracting" });
          const extracted = await extractFromImage({
            image: imageBuffer,
            mime: imageMime,
          });
          if (!extracted.ok) {
            emit("error", { kind: extracted.error.kind, message: extracted.error.message });
            closeStream();
            return;
          }
          businessData = extracted.data;
          emit("extracted", { data: businessData });
        } else if (providedData) {
          businessData = providedData;
        } else {
          emit("error", { kind: "bug", message: "Unreachable input branch" });
          closeStream();
          return;
        }

        const fill = await fillTemplate({
          sourceHtml: currentHtml,
          data: businessData,
          onStage: (stage) => emit("progress", { stage }),
          onChunk: (bytes) => emit("delta", { bytes }),
        });

        if (!fill.ok) {
          emit("error", { kind: fill.error.kind, message: fill.error.message });
          closeStream();
          return;
        }
        if (fill.filledHtml.includes("data-slot-path=")) {
          emit("error", {
            kind: "editor-marker-leak",
            message: "Model emitted editor-mode markers — try again.",
          });
          closeStream();
          return;
        }

        emit("progress", { stage: "persisting" });

        // Snapshot the PRE-apply HTML so the user can revert.
        await createVersion({
          projectId,
          html: currentHtml,
          label:
            source === "image"
              ? `Before Autofill (image)`
              : `Before Autofill (${businessData.business_name ?? "data"})`,
          source: "style-match",
        }).catch((err: unknown) => {
          console.error("[autofill] pre-apply snapshot failed", err);
        });

        const now = new Date();
        try {
          const nextData: LandingPage = { ...existing.data, html: fill.filledHtml };
          await db
            .update(schema.projects)
            .set({ data: nextData, updatedAt: now })
            .where(
              and(
                eq(schema.projects.id, projectId),
                eq(schema.projects.userId, userId),
              ),
            );
        } catch (err) {
          console.error("[autofill] db update failed", err);
          emit("error", { kind: "db", message: "Filled successfully but failed to save — try again." });
          closeStream();
          return;
        }

        const postVersionId = await createVersion({
          projectId,
          html: fill.filledHtml,
          label: `Autofill: ${businessData.business_name ?? "untitled"}`,
          source: "style-match",
        }).catch((err: unknown) => {
          console.error("[autofill] post-apply snapshot failed", err);
          return null;
        });

        emit("done", {
          source,
          newHtml: fill.filledHtml,
          appliedOps: fill.appliedOps,
          totalOps: fill.totalOps,
          versionId: postVersionId,
          extractedBusinessName: businessData.business_name,
          durationMs: Date.now() - t0,
          updatedAt: now.toISOString(),
        });
        closeStream();
      } catch (err) {
        console.error("[autofill] stream failed", err);
        emit("error", {
          kind: "unhandled",
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
