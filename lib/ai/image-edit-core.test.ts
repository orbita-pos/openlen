// Unit tests for lib/ai/image-edit-core.ts — the Gemini image-edit mapping +
// debit-on-success logic, extracted from the ai-edit-image route so it can be
// exercised with a scripted transport and a fake credit debit (no network, no
// DB). Run via vitest (listed in vitest.config.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_IMAGE_EDIT_CREDIT_COST } from "@/lib/credits";
import {
  editImage,
  openaiImageEditTransport,
  realImageEditTransport,
  type ImageEditOutcome,
  type ImageEditDeps,
} from "./image-edit-core";

const INPUT = { imageBase64: "QUJD", mimeType: "image/png", prompt: "remove the logo" };

function makeDeps(outcome: ImageEditOutcome) {
  const debits: number[] = [];
  const calls: typeof INPUT[] = [];
  const deps: ImageEditDeps = {
    async callProvider(input) {
      calls.push(input);
      return outcome;
    },
    async debit(cost) {
      debits.push(cost);
    },
  };
  return { deps, debits, calls };
}

describe("editImage", () => {
  it("maps a Gemini image to the success shape and debits exactly once", async () => {
    const { deps, debits, calls } = makeDeps({
      kind: "image",
      imageBase64: "ZWRpdGVk",
      mimeType: "image/webp",
    });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      imageBase64: "ZWRpdGVk",
      mimeType: "image/webp",
      cost: AI_IMAGE_EDIT_CREDIT_COST,
    });
    expect(debits).toEqual([AI_IMAGE_EDIT_CREDIT_COST]);
    // The input is forwarded verbatim to the transport.
    expect(calls).toEqual([INPUT]);
  });

  it("falls back to image/png when the model returns an image with no mimeType", async () => {
    const { deps } = makeDeps({ kind: "image", imageBase64: "ZWRpdGVk", mimeType: "" });
    const r = await editImage(INPUT, deps);
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.mimeType).toBe("image/png");
  });

  it("maps a blocked outcome to the route's 422 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "blocked", reason: "SAFETY" });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      error: "blocked",
      status: 422,
      body: { error: "blocked", reason: "SAFETY" },
    });
    expect(debits).toEqual([]);
  });

  it("maps a no_image outcome to the route's 422 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "no_image", message: "declined" });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      error: "no_image",
      status: 422,
      body: { error: "no_image", message: "declined" },
    });
    expect(debits).toEqual([]);
  });

  it("maps an http_error to the route's 502 ai_error body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "http_error", status: 500, detail: "boom" });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      error: "ai_error",
      status: 502,
      body: { error: "ai_error", status: 500, detail: "boom" },
    });
    expect(debits).toEqual([]);
  });

  it("maps a network_error to the route's 502 ai_request_failed body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "network_error", message: "ECONNRESET" });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      error: "ai_request_failed",
      status: 502,
      body: { error: "ai_request_failed", message: "ECONNRESET" },
    });
    expect(debits).toEqual([]);
  });

  it("maps unavailable (no API key) to the route's 503 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "unavailable" });
    const r = await editImage(INPUT, deps);
    expect(r).toEqual({
      error: "ai_unavailable",
      status: 503,
      body: { error: "ai_unavailable" },
    });
    expect(debits).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// EL TRANSPORTE DE OpenAI (gpt-image-2) — el camino por defecto.
// `fetch` inyectado: ninguna de estas pruebas abre un socket.

const PNG_B64 = "iVBORw0KGgo="; // bytes cualesquiera; sólo importa que decodifique

function fetchQueDevuelve(
  status: number,
  cuerpo: unknown,
): { impl: typeof fetch; vistos: Array<{ url: string; init: RequestInit }> } {
  const vistos: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    vistos.push({ url: String(url), init: init ?? {} });
    const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
    return new Response(texto, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, vistos };
}

// Las claves se restauran: estas pruebas escriben process.env, y un fichero
// que deja el entorno pisado convierte al siguiente en un misterio.
function conClavesAisladas() {
  const previo: Record<string, string | undefined> = {};
  const CLAVES = ["OPENAI_API_KEY", "GEMINI_API_KEY"] as const;
  beforeEach(() => {
    for (const k of CLAVES) previo[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of CLAVES) {
      if (previo[k] === undefined) delete process.env[k];
      else process.env[k] = previo[k];
    }
  });
}

describe("transporte de OpenAI — gpt-image-2", () => {
  conClavesAisladas();
  const ENTRADA = { imageBase64: PNG_B64, mimeType: "image/png", prompt: "quítale el fondo" };

  it("sin OPENAI_API_KEY devuelve unavailable, no revienta", async () => {
    const previo = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { impl } = fetchQueDevuelve(200, {});
      expect(await openaiImageEditTransport(impl)(ENTRADA)).toEqual({ kind: "unavailable" });
    } finally {
      if (previo !== undefined) process.env.OPENAI_API_KEY = previo;
    }
  });

  it("manda multipart al endpoint de edits, con el modelo y el prompt", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl, vistos } = fetchQueDevuelve(200, { data: [{ b64_json: "AAAA" }] });
    const r = await openaiImageEditTransport(impl)(ENTRADA);

    expect(r).toEqual({ kind: "image", imageBase64: "AAAA", mimeType: "image/png" });
    expect(vistos).toHaveLength(1);
    expect(vistos[0].url).toBe("https://api.openai.com/v1/images/edits");

    const form = vistos[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toBe("quítale el fondo");
    expect(form.get("image")).toBeInstanceOf(Blob);
    // El precio de 4 créditos SALE de esta línea: en "high" un 1024² cuesta ~3x.
    expect(form.get("quality")).toBe("medium");

    // EL FALLO CLÁSICO DE MULTIPART: fijar content-type a mano borra el boundary
    // que pone FormData, y el servidor devuelve un 400 que parece de los campos.
    const headers = vistos[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(headers.authorization).toBe("Bearer sk-prueba");
  });

  it("conserva el TIPO de la imagen: un webp entra y sale webp", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl, vistos } = fetchQueDevuelve(200, { data: [{ b64_json: "BBBB" }] });
    const r = await openaiImageEditTransport(impl)({ ...ENTRADA, mimeType: "image/webp" });

    expect((vistos[0].init.body as FormData).get("output_format")).toBe("webp");
    // Sin esto una foto webp volvía como png y pesaba varias veces más EN LA
    // PÁGINA del usuario — un fallo que no da error, sólo hace la página lenta.
    expect(r).toEqual({ kind: "image", imageBase64: "BBBB", mimeType: "image/webp" });
  });

  // EL MODO DE FALLO QUE IMPORTA. Los dos llegan como 400; sólo uno es culpa del
  // usuario. Confundirlos le dice «falló OpenLen» cuando lo que pasó es que su
  // instrucción se rechazó — o al revés, le culpa a él de un bug nuestro.
  it("un rechazo por contenido es blocked, no un error nuestro", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl } = fetchQueDevuelve(400, {
      error: { code: "moderation_blocked", message: "rejected by our safety system" },
    });
    const r = await openaiImageEditTransport(impl)(ENTRADA);
    expect(r.kind).toBe("blocked");
  });

  it("y un 400 CUALQUIERA sigue siendo http_error — el brazo de control", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl } = fetchQueDevuelve(400, {
      error: { code: "invalid_request_error", message: "Unknown parameter." },
    });
    const r = await openaiImageEditTransport(impl)(ENTRADA);
    // Si esto también saliera "blocked", la prueba de arriba no probaría nada:
    // pasaría con un transporte que llame "blocked" a todo.
    expect(r.kind).toBe("http_error");
  });

  it("una respuesta 200 sin imagen no se cuela como éxito", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl } = fetchQueDevuelve(200, { data: [] });
    expect((await openaiImageEditTransport(impl)(ENTRADA)).kind).toBe("no_image");
  });
});

describe("el selector de proveedor", () => {
  conClavesAisladas();
  const ENTRADA = { imageBase64: PNG_B64, mimeType: "image/png", prompt: "x" };

  it("por defecto va a OpenAI", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl, vistos } = fetchQueDevuelve(200, { data: [{ b64_json: "A" }] });
    await realImageEditTransport(impl, {})(ENTRADA);
    expect(vistos[0].url).toContain("api.openai.com");
  });

  it("OPENLEN_IMAGE_EDIT_PROVIDER=gemini vuelve a Nano Banana", async () => {
    process.env.GEMINI_API_KEY = "g-prueba";
    const { impl, vistos } = fetchQueDevuelve(200, {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "A" } }] } }],
    });
    await realImageEditTransport(impl, { OPENLEN_IMAGE_EDIT_PROVIDER: "gemini" })(ENTRADA);
    expect(vistos[0].url).toContain("generativelanguage.googleapis.com");
  });

  it("cualquier otro valor NO devuelve a Gemini — opt-out, no interruptor libre", async () => {
    process.env.OPENAI_API_KEY = "sk-prueba";
    const { impl, vistos } = fetchQueDevuelve(200, { data: [{ b64_json: "A" }] });
    await realImageEditTransport(impl, { OPENLEN_IMAGE_EDIT_PROVIDER: "nanobanana" })(ENTRADA);
    expect(vistos[0].url).toContain("api.openai.com");
  });
});
