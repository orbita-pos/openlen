// Native Gemini worker — reaches this file ONLY via the seam's await import().
// Do not import this file statically anywhere (it requires the napi binary).

import type { GenInput, GenResult } from "./gen-types";
import type { SceneSpec } from "./scene-spec";
import { parseSceneSpecStrict, coerceSceneSpec } from "./scene-spec";
import { buildSystemPrompt, buildUserPrompt } from "./gemini-prompt";
import { GOLDEN } from "./golden-specs";
import { renderScenePoster } from "../publish/scene-poster";
import { fireworksStreamProvider, type StreamProviderLike } from "@/lib/ai/fireworks-as-stream-provider";
import { GeminiProvider, type InlineImage } from "@/lib/ai-gateway";

const FLASH_MODEL = "gemini-3.5-flash";
const MAX_REROLLS = 2;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Streams a single Gemini call and returns the accumulated text output. */
async function callGemini(
  provider: StreamProviderLike,
  opts: {
    system?: string;
    prompt: string;
    images?: InlineImage[];
    maxOutputTokens?: number;
    responseMimeType?: string;
    temperature?: number;
  },
): Promise<string> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    opts.system
      ? [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ]
      : [{ role: "user", content: opts.prompt }];

  let text = "";
  for await (const ev of provider.stream(
    {
      model: FLASH_MODEL,
      messages,
      images: opts.images,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      responseMimeType: opts.responseMimeType,
    },
    {},
  )) {
    if (ev.type === "text_delta") text += ev.text;
  }
  return text;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function nearestGolden(describe: string): SceneSpec {
  const words = new Set(describe.toLowerCase().split(/\s+/));
  let best = GOLDEN[0];
  let bestScore = -1;
  for (const g of GOLDEN) {
    const score = g.brief
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => words.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return structuredClone(best.spec);
}

// ── Vision critic ──────────────────────────────────────────────────────────

/** Ask Gemini Flash whether the rendered poster is acceptable.
 *  Returns true = keep / false = reroll.
 *  Fails open: any error → true so a critic outage never blocks generation. */
async function critiqueScene(
  provider: StreamProviderLike,
  posterJpeg: Buffer,
  describe: string,
): Promise<boolean> {
  try {
    const image: InlineImage = {
      mimeType: "image/jpeg",
      dataBase64: posterJpeg.toString("base64"),
    };
    const prompt = `You are reviewing a rendered 3D abstract decorative object intended for a web page hero background.
Brief: "${describe}"

Look at the attached image. Is this a clean, attractive, visually coherent ABSTRACT decorative 3D object that fits the mood of the brief?
Answer ONLY with the single word ACCEPT or REJECT — nothing else.`;

    const verdict = await callGemini(provider, {
      prompt,
      images: [image],
      maxOutputTokens: 256,
      temperature: 0.2,
    });

    // Accept unless verdict is unambiguously REJECT (no stray ACCEPT present).
    const hasReject = /\bREJECT\b/i.test(verdict);
    const hasAccept = /\bACCEPT\b/i.test(verdict);
    return !hasReject || hasAccept;
  } catch {
    // Fail-open: critic outage, render miss, or API error → keep the spec.
    return true;
  }
}

// ── Main export ────────────────────────────────────────────────────────────

/** Generate a SceneSpec from a brief.
 *  Max 2 re-rolls on bad JSON or critic rejection, then falls back to the
 *  nearest GOLDEN spec. */
export async function runGemini(
  input: GenInput,
): Promise<Omit<GenResult, "provider">> {
  // DOS PAPELES en este módulo, y no son el mismo: escribir el spec es texto
  // (razonador) y juzgar el póster renderizado es MIRAR (Qwen). Antes los hacía
  // Gemini los dos; ahora Gemini se queda para los píxeles y nada más.
  // `OPENLEN_3D_PROVIDER=gemini` vuelve atrás por completo.
  const usaGemini = process.env.OPENLEN_3D_PROVIDER?.trim().toLowerCase() === "gemini";
  if (usaGemini && !process.env.GEMINI_API_KEY) throw new Error("gemini_key_missing");
  const provider: StreamProviderLike = usaGemini
    ? (new GeminiProvider(process.env.GEMINI_API_KEY as string) as unknown as StreamProviderLike)
    : fireworksStreamProvider({
        requestId: "three3d-spec",
        operation: "page_planning",
        maxOutputTokens: 8_192,
        temperature: 0.9,
        jsonObject: true,
      });
  // Al razonador NUNCA se le manda una imagen: el crítico va aparte.
  const critico: StreamProviderLike = usaGemini
    ? provider
    : fireworksStreamProvider({
        requestId: "three3d-critic",
        operation: "final_scoring",
        maxOutputTokens: 256,
        temperature: 0.2,
      });
  const system = buildSystemPrompt();
  const user = buildUserPrompt(input);

  let rerolls = 0;
  while (rerolls <= MAX_REROLLS) {
    try {
      const raw = await callGemini(provider, { system, prompt: user, responseMimeType: "application/json" });
      const parsed = parseSceneSpecStrict(extractJson(raw));
      if (parsed.ok) {
        const poster = await renderScenePoster(parsed.value, {
          width: 640,
          height: 360,
          format: "jpeg",
        });
        if (await critiqueScene(critico, poster, input.describe)) {
          return { spec: parsed.value, rerolls, fallback: false };
        }
      }
    } catch {
      // Generation or render error on this roll — count it and try again.
    }
    rerolls++;
  }

  // All rolls exhausted: coerce the nearest golden spec as fallback.
  return {
    spec: coerceSceneSpec(nearestGolden(input.describe)),
    rerolls,
    fallback: true,
  };
}
