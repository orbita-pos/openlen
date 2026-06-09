// Client helper for instruction-based AI image editing.
//
// Downsamples the source to keep the request lean, POSTs it + the prompt to
// /api/projects/[id]/ai-edit-image (which calls Gemini 2.5 Flash Image and
// debits credits), and returns the edited image as a File so it slots into the
// existing Upload-tab flow (preview → "Upload & apply").

export class AiEditError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AiEditError";
    this.code = code;
  }
}

const MAX_EDGE = 1536;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToFile(b64: string, mime: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function downscale(file: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    // WebP keeps alpha (so a cut-out source survives) and stays small.
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
        "image/webp",
        0.92,
      ),
    );
    return { base64: await blobToBase64(blob), mimeType: "image/webp" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Run an instruction-based AI edit on `file`, returning the edited image as a
 *  PNG File. Throws AiEditError (with a `code`) on failure. */
export async function aiEditImage(
  projectId: string,
  file: File,
  prompt: string,
): Promise<File> {
  const { base64, mimeType } = await downscale(file);

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/ai-edit-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType, prompt }),
    });
  } catch (err) {
    throw new AiEditError("network", err instanceof Error ? err.message : "network error");
  }

  const data = (await res.json().catch(() => ({}))) as {
    imageBase64?: string;
    mimeType?: string;
    error?: string;
    message?: string;
  };

  if (!res.ok || !data.imageBase64) {
    throw new AiEditError(
      data.error || `http_${res.status}`,
      data.message || data.error || `Request failed (${res.status})`,
    );
  }

  const base = file.name.replace(/\.[^./\\]+$/, "") || "image";
  return base64ToFile(data.imageBase64, data.mimeType || "image/png", `${base}-ai.png`);
}
