import type { InlineImage } from "@/lib/ai-gateway";
import type { FableModelOperation } from "@/lib/generation/fable-model-policy";
import { fireworksStreamProvider } from "@/lib/ai/fireworks-as-stream-provider";

// lib/style-match/autofill/model-call.ts — una llamada, tres módulos.
//
// `extract-text`, `extract-image` y `fill-template` hacían la MISMA llamada a
// mano —montar el cuerpo, mandar `fetch`, desenvolver la respuesta, traducir el
// error a su vocabulario— cada uno con su copia. Aquí vive una vez.
//
// QUÉ MODELO CORRE lo decide la política por `operation`: el razonador para
// texto, Qwen para lo que mira. Al razonador NUNCA se le manda una imagen.

export type ModelCallResult =
  | {
      readonly ok: true;
      readonly raw: string;
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly ok: false; readonly kind: "aborted" | "api"; readonly message: string };

export async function callModel(input: {
  readonly system: string;
  readonly user: string;
  /** Sólo para las operaciones con papel de VISIÓN. */
  readonly images?: readonly InlineImage[];
  readonly operation: FableModelOperation;
  readonly requestId: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  /** Pedir un objeto JSON. `fill-template` NO lo quiere: su salida es un bloque
   *  de ops con protocolo propio. */
  readonly jsonObject?: boolean;
  readonly signal?: AbortSignal;
}): Promise<ModelCallResult> {
  const provider = fireworksStreamProvider({
    requestId: input.requestId,
    operation: input.operation,
    maxOutputTokens: input.maxOutputTokens,
    temperature: input.temperature,
    ...(input.jsonObject ? { jsonObject: true } : {}),
  });

  let raw = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  try {
    for await (const ev of provider.stream(
      {
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        ...(input.images?.length ? { images: [...input.images] } : {}),
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature,
      },
      input.signal ? { signal: input.signal } : {},
    )) {
      if (ev.type === "text_delta") raw += ev.text;
      else if (ev.type === "usage") {
        usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      } else if (ev.type === "done" && ev.stopReason.kind === "error") {
        return { ok: false, kind: "api", message: "el proveedor devolvió un error" };
      }
    }
  } catch (err) {
    // Un abort del llamador no es un fallo del proveedor, y los llamadores lo
    // distinguen en su respuesta: confundirlos haría que un usuario que cancela
    // viera un mensaje de error.
    if (input.signal?.aborted) return { ok: false, kind: "aborted", message: "Request aborted" };
    return { ok: false, kind: "api", message: err instanceof Error ? err.message : String(err) };
  }
  return usage ? { ok: true, raw, usage } : { ok: true, raw };
}
