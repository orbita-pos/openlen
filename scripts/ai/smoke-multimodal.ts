// Phase 4.1 smoke: confirm Gemini accepts a native `inlineData` image part on
// the streamGenerateContent endpoint with our model IDs — BEFORE relying on
// the rebuilt @openlen/ai-gateway binary.
//
// IMPORTANT: the gateway uses the NATIVE Gemini API
// (…/v1beta/models/<model>:streamGenerateContent), NOT the OpenAI-compatible
// /chat/completions endpoint. The native API does not fetch remote URLs — it
// takes base64 `inlineData`. This script POSTs exactly the body shape the
// Rust crate now builds (see crates/ai-gateway/src/gemini/mod.rs), so a 200 +
// non-empty response validates both the model and the wire format.
//
//   npm run ai:smoke-multimodal               # default gemini-3.5-flash
//   npm run ai:smoke-multimodal -- --model=gemini-3.1-pro-preview

// Module marker — keeps `arg`/`main` out of the global script scope so they
// don't collide with identically-named helpers in other standalone scripts.
export {};

// 1×1 PNG — smallest valid image; we only need Gemini to accept the part.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const model = arg("model", "gemini-3.5-flash");
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY missing from env (.env.local).");
    process.exit(1);
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "An image is attached. Reply with the single word OK to confirm you received it.",
          },
          { inlineData: { mimeType: "image/png", data: TINY_PNG_BASE64 } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 1024, temperature: 0 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  console.log(`POST ${model}:streamGenerateContent (native inlineData)…`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  console.log(`HTTP ${res.status}`);
  const raw = await res.text();
  if (!res.ok) {
    console.error("Non-200 response:\n", raw.slice(0, 2000));
    process.exit(1);
  }

  // Parse SSE `data:` frames and concatenate any candidate text.
  let text = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const json = line.slice(5).trim();
    if (!json || json === "[DONE]") continue;
    try {
      const frame = JSON.parse(json);
      const parts = frame?.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) if (typeof p.text === "string") text += p.text;
    } catch {
      /* ignore non-JSON keepalive frames */
    }
  }

  text = text.trim();
  if (text.length === 0) {
    console.error("200 but no text returned — model emitted no output (check maxOutputTokens / thinking budget).");
    process.exit(1);
  }
  console.log(`✓ ${model} accepted inlineData and replied: ${JSON.stringify(text.slice(0, 80))}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
