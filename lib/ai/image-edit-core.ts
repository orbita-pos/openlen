// Gemini 2.5 Flash Image (Nano Banana) instruction edit — the CORE, extracted
// from app/api/projects/[id]/ai-edit-image/route.ts so the same call powers
// both the route (in-editor Replace modal) and the agent's editar_imagen tool.
//
// The route stays a byte-identical shell: it keeps auth / ownership / MIME
// allowlist / size cap / credit gate and maps this core's result straight to
// its HTTP responses (the failure branch carries the exact status + body the
// route used to build inline). The Gemini transport and the credit debit are
// INJECTED (ImageEditDeps) so the mapping + "debit only on success" invariant
// are unit-testable with zero network + zero DB.

import { AI_IMAGE_EDIT_CREDIT_COST } from "@/lib/credits";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// The Nano Banana image model. Overridable while the GA id settles.
export const IMAGE_EDIT_MODEL_ID =
  process.env.OPENLEN_IMAGE_EDIT_MODEL || "gemini-2.5-flash-image";

export interface ImageEditInput {
  /** Source image, base64 (no data: prefix). */
  imageBase64: string;
  /** image/png | image/jpeg | image/webp */
  mimeType: string;
  /** The natural-language edit instruction (already trimmed by the caller). */
  prompt: string;
}

/** The raw transport outcome — the ONLY thing injected, so the mapping + debit
 *  below is pure. Each variant mirrors a distinct branch of the original route. */
export type GeminiImageOutcome =
  | { kind: "image"; imageBase64: string; mimeType: string }
  | { kind: "blocked"; reason: string }
  | { kind: "no_image"; message: string }
  | { kind: "http_error"; status: number; detail: string }
  | { kind: "network_error"; message: string }
  | { kind: "unavailable" };

export interface ImageEditDeps {
  /** POST the edit to Gemini and return the parsed outcome. */
  callGemini(input: ImageEditInput): Promise<GeminiImageOutcome>;
  /** Debit credits — invoked ONLY on a successful edit. The caller binds the
   *  userId (route: the session user; agent: the AgentSession user). */
  debit(cost: number): Promise<void>;
}

export interface ImageEditOk {
  imageBase64: string;
  mimeType: string;
  cost: number;
}

/** Failure carries the exact HTTP status + JSON body the route emitted inline,
 *  so the route shell stays byte-identical. Consumers that only need a reason
 *  (the agent tool) read `error`. */
export interface ImageEditErr {
  error: string;
  status: number;
  body: Record<string, unknown>;
}

export type ImageEditResult = ImageEditOk | ImageEditErr;

export async function editImageWithGemini(
  input: ImageEditInput,
  deps: ImageEditDeps,
): Promise<ImageEditResult> {
  const outcome = await deps.callGemini(input);
  switch (outcome.kind) {
    case "unavailable":
      return { error: "ai_unavailable", status: 503, body: { error: "ai_unavailable" } };
    case "network_error":
      return {
        error: "ai_request_failed",
        status: 502,
        body: { error: "ai_request_failed", message: outcome.message },
      };
    case "http_error":
      return {
        error: "ai_error",
        status: 502,
        body: { error: "ai_error", status: outcome.status, detail: outcome.detail },
      };
    case "blocked":
      return { error: "blocked", status: 422, body: { error: "blocked", reason: outcome.reason } };
    case "no_image":
      return { error: "no_image", status: 422, body: { error: "no_image", message: outcome.message } };
    case "image": {
      // Charge only once we have a real result — same as the original route.
      await deps.debit(AI_IMAGE_EDIT_CREDIT_COST);
      return {
        imageBase64: outcome.imageBase64,
        mimeType: outcome.mimeType || "image/png",
        cost: AI_IMAGE_EDIT_CREDIT_COST,
      };
    }
  }
}

/** The real Gemini transport — the fetch + parse block lifted verbatim from the
 *  route. Reads GEMINI_API_KEY lazily (so import is side-effect-free) and
 *  reports each failure mode as a distinct GeminiImageOutcome. */
export function realImageEditTransport(): (
  input: ImageEditInput,
) => Promise<GeminiImageOutcome> {
  return async (input) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { kind: "unavailable" };

    const url = `${GEMINI_BASE}/${IMAGE_EDIT_MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: input.prompt },
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
      return { kind: "network_error", message: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { kind: "http_error", status: res.status, detail: text.slice(0, 400) };
    }

    const payload = (await res.json().catch(() => null)) as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
        finishReason?: string;
      }>;
    } | null;

    if (payload?.promptFeedback?.blockReason) {
      return { kind: "blocked", reason: payload.promptFeedback.blockReason };
    }

    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      // The model can decline an edit and reply with text instead — surface it.
      const reply = parts.map((p) => p.text ?? "").join(" ").trim();
      return { kind: "no_image", message: reply || "The model returned no image." };
    }

    return {
      kind: "image",
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "",
    };
  };
}
