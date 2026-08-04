import { TemplateVisualMetadataSchema, type TemplateVisualMetadata } from "./visual-metadata";
import type { TemplateRecord } from "./store";

export function coerceSuggestedMetadata(value: unknown): TemplateVisualMetadata | null {
  if (!value || typeof value !== "object") return null;
  const parsed = TemplateVisualMetadataSchema.safeParse({
    ...(value as Record<string, unknown>),
    schemaVersion: "template-visual-metadata/1.0",
    reviewStatus: "unreviewed",
  });
  return parsed.success ? parsed.data : null;
}

export interface SuggestVisualMetadataOptions {
  apiKey?: string;
  modelId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export type SuggestVisualMetadataResult =
  | { ok: true; metadata: TemplateVisualMetadata; raw: string }
  | { ok: false; kind: "missing_key" | "missing_screenshot" | "fetch" | "model" | "parse"; message: string };

export async function suggestVisualMetadata(
  record: TemplateRecord,
  options: SuggestVisualMetadataOptions = {},
): Promise<SuggestVisualMetadataResult> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, kind: "missing_key", message: "GEMINI_API_KEY not set" };
  if (!record.screenshotUrl) {
    return { ok: false, kind: "missing_screenshot", message: `template ${record.id} has no screenshot` };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let screenshot: Response;
  try {
    screenshot = await fetchImpl(record.screenshotUrl, { signal: options.signal });
  } catch (error) {
    return { ok: false, kind: "fetch", message: error instanceof Error ? error.message : String(error) };
  }
  if (!screenshot.ok) {
    return { ok: false, kind: "fetch", message: `screenshot ${screenshot.status}` };
  }
  const bytes = Buffer.from(await screenshot.arrayBuffer());
  const mimeType = screenshot.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const modelId = options.modelId
    ?? process.env.OPENLEN_METADATA_MODEL
    ?? process.env.STYLE_MATCH_TEXT_MODEL
    ?? "gemini-2.5-flash";
  const prompt = [
    "Analyze the attached full-page template screenshot and return metadata.",
    "Describe what is visibly present, not what the template name implies.",
    "Use lowercase snake_case taxonomy tags.",
    "visualSignals are signals present in the screenshot.",
    "negativeTags are domains/audiences for which this design would be misleading.",
    "Do not mark the result reviewed; human review is mandatory.",
    "Return strict JSON matching template-visual-metadata/1.0.",
    "Required keys: schemaVersion, domains, audiences, ageRanges, emotionalRegisters, visualArchetypes, visualSignals, layoutTraits, requiredAssetTypes, negativeTags, supportedSiteTypes, supportedSectionRoles, themeability, identityStrength, reviewStatus.",
    "Every taxonomy collection is an array of lowercase snake_case strings. themeability and identityStrength are low|medium|high. reviewStatus is unreviewed.",
    `Template: ${record.name}`,
    `Family: ${record.family}`,
    `Pitch: ${record.pitch}`,
    `Description: ${record.description}`,
  ].join("\n");
  let modelResponse: Response;
  try {
    modelResponse = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: prompt },
            { inlineData: { mimeType, data: bytes.toString("base64") } },
          ] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2_048,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
  } catch (error) {
    return { ok: false, kind: "model", message: error instanceof Error ? error.message : String(error) };
  }
  if (!modelResponse.ok) {
    return { ok: false, kind: "model", message: `Gemini ${modelResponse.status}` };
  }
  const payload = await modelResponse.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim());
  } catch {
    return { ok: false, kind: "parse", message: "malformed metadata JSON" };
  }
  const metadata = coerceSuggestedMetadata(value);
  return metadata
    ? { ok: true, metadata, raw }
    : { ok: false, kind: "parse", message: "metadata schema rejected model output" };
}
