import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { AI_IMAGE_EDIT_CREDIT_COST, debitCredits, getCreditState } from "@/lib/credits";

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
// Response: { imageBase64, mimeType } — the edited image.
//
// Calls Gemini 2.5 Flash Image (Nano Banana) directly over its native
// :generateContent endpoint — the same TS-direct pattern as lib/assemble/*
// (the Rust @openlen/ai-gateway is the STREAMING-TEXT path and has no image-
// out). Mask-free: the instruction drives the edit. One flat credit charge,
// debited only on success. Auth + project ownership required. The edited bytes
// are returned to the client, which persists them through the existing
// upload-on-apply flow — this route never touches storage.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// The Nano Banana image model. Overridable while the GA id settles.
const MODEL_ID = process.env.OPENLEN_IMAGE_EDIT_MODEL || "gemini-2.5-flash-image";

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "ai_unavailable" }, 503);

  const url = `${GEMINI_BASE}/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: cleanPrompt },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    return json(
      { error: "ai_request_failed", message: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: "ai_error", status: res.status, detail: text.slice(0, 400) }, 502);
  }

  const payload = (await res.json().catch(() => null)) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
      finishReason?: string;
    }>;
  } | null;

  if (payload?.promptFeedback?.blockReason) {
    return json({ error: "blocked", reason: payload.promptFeedback.blockReason }, 422);
  }

  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    // The model can decline an edit and reply with text instead — surface it.
    const reply = parts.map((p) => p.text ?? "").join(" ").trim();
    return json(
      { error: "no_image", message: reply || "The model returned no image." },
      422,
    );
  }

  // Charge only once we have a real result.
  await debitCredits(userId, AI_IMAGE_EDIT_CREDIT_COST);

  return json(
    {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
      cost: AI_IMAGE_EDIT_CREDIT_COST,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
