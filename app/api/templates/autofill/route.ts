import { and, eq } from "drizzle-orm";
import { captureException } from "@inariwatch/capture";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState, debitCredits, AUTOFILL_CREDIT_COST } from "@/lib/credits";
import { consumeToken, RATE_LIMITS } from "@/lib/rate-limit";
import { detectSlotPath } from "@/lib/html-engine";
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

// In-flight protection: only one autofill per project at a time. If a user
// double-clicks Apply (or has multiple tabs open on the same project), the
// 2nd request gets 409 Conflict instead of racing the 1st write. Cleared
// in a finally block so a crash doesn't permanently lock the project.
const inFlightProjects = new Set<string>();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthenticated");
  const userId = session.user.id;

  // Rate limit BEFORE doing any work. Autofill burns ~\$0.002/call which
  // adds up fast if a user spams. 10/hour is the free-tier ceiling.
  const rateCheck = consumeToken(`autofill:${userId}`, RATE_LIMITS.autofill);
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil(rateCheck.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({
        error: `Rate limit excedido — máximo ${rateCheck.limit} autofills por hora. Probá de nuevo en ${formatRetry(retryAfterSec)}.`,
        retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfterSec),
          "x-ratelimit-limit": String(rateCheck.limit),
          "x-ratelimit-remaining": "0",
        },
      },
    );
  }

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

  // Concurrent request protection.
  const inFlightKey = `${userId}:${projectId}`;
  if (inFlightProjects.has(inFlightKey)) {
    return new Response(
      JSON.stringify({
        error: "Ya hay un autofill en proceso para este proyecto. Esperá a que termine antes de empezar otro.",
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" },
      },
    );
  }
  inFlightProjects.add(inFlightKey);

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
        // Credit gate — autofill is a flat charge (Gemini read + Kimi
        // fill), debited on success below.
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            kind: "credits",
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

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
        if (detectSlotPath(fill.filledHtml)) {
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
          if (err instanceof Error) {
            captureException(err, { route: "autofill", stage: "pre-snapshot", projectId, userId });
          }
        });

        const now = new Date();
        try {
          const nextData: ProjectData = { html: fill.filledHtml };
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
          if (err instanceof Error) {
            captureException(err, { route: "autofill", stage: "db-update", projectId, userId });
          }
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

        await debitCredits(userId, AUTOFILL_CREDIT_COST);

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
        if (err instanceof Error) {
          captureException(err, { route: "autofill", stage: "stream", projectId, userId });
        }
        emit("error", {
          kind: "unhandled",
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      } finally {
        // Always release the in-flight lock, even on errors / cancellation.
        inFlightProjects.delete(inFlightKey);
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

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)} hr`;
}
