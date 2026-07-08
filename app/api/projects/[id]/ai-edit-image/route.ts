import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { AI_IMAGE_EDIT_CREDIT_COST, debitCredits, getCreditState } from "@/lib/credits";
import { editImageWithGemini, realImageEditTransport } from "@/lib/ai/image-edit-core";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/ai-edit-image — instruction-based AI image edit.
//
// Body (JSON): { imageBase64, mimeType, prompt }
//   imageBase64 — the source image, base64 (no data: prefix). The client
//                 downsamples to ≤1536px before sending to keep the body lean.
//   mimeType    — image/png | image/jpeg | image/webp
//   prompt      — the natural-language edit ("remove the person on the left",
//                 "extend the sky upward", "make the background a soft studio
//                 gradient").
// Response: { imageBase64, mimeType, cost } — the edited image.
//
// This route is a SHELL over lib/ai/image-edit-core.ts (shared with the agent's
// editar_imagen tool). It keeps auth + project ownership + MIME allowlist + the
// 6MB cap + the credit gate here, then hands the Gemini call + debit-on-success
// to the core and maps its result straight back to HTTP — byte-identical to the
// pre-extraction behavior the client (replace-asset-modal) depends on. The
// edited bytes are returned to the client, which persists them through the
// existing upload-on-apply flow — this route never touches storage.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_INPUT_BYTES = 6 * 1024 * 1024; // decoded source cap
const MAX_PROMPT_CHARS = 600;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  // Ownership gate.
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  if (rows.length === 0) return json({ error: "not_found" }, 404);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { imageBase64, mimeType, prompt } = (bodyJson ?? {}) as {
    imageBase64?: unknown;
    mimeType?: unknown;
    prompt?: unknown;
  };

  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    return json({ error: "missing_image" }, 400);
  }
  if (typeof mimeType !== "string" || !ALLOWED_MIME.has(mimeType)) {
    return json({ error: "unsupported_type" }, 415);
  }
  const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!cleanPrompt) return json({ error: "missing_prompt" }, 400);
  if (cleanPrompt.length > MAX_PROMPT_CHARS) {
    return json({ error: "prompt_too_long" }, 400);
  }
  // Reject oversize before spending anything (base64 length ≈ bytes × 4/3).
  if (imageBase64.length > Math.ceil((MAX_INPUT_BYTES * 4) / 3) + 4) {
    return json({ error: "image_too_large" }, 413);
  }

  // Credit gate. Flat cost; only enough to guarantee the user can pay.
  const credit = await getCreditState(userId);
  if (credit.balance < AI_IMAGE_EDIT_CREDIT_COST) {
    return json(
      { error: "insufficient_credits", needed: AI_IMAGE_EDIT_CREDIT_COST, balance: credit.balance },
      402,
    );
  }

  const result = await editImageWithGemini(
    { imageBase64, mimeType, prompt: cleanPrompt },
    { callGemini: realImageEditTransport(), debit: (cost) => debitCredits(userId, cost) },
  );
  if ("error" in result) return json(result.body, result.status);
  return json(
    { imageBase64: result.imageBase64, mimeType: result.mimeType, cost: result.cost },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
