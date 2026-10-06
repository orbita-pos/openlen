import { describe, expect, it, vi } from "vitest";
import { uploadPhotos } from "./upload-photos";

const DATA = "data:image/png;base64,iVBORw0KGgo=";

function fakeFetch(fallan: readonly string[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("data:")) return new Response(new Blob(["x"], { type: "image/png" }));
    const file = (init?.body as FormData).get("file") as File;
    if (fallan.includes(file.name)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ url: `https://cdn/${file.name}` }), { status: 200 });
  });
}

describe("uploadPhotos — las fotos del estado vacío, antes del primer mensaje", () => {
  it("sube cada una por /api/upload, con el proyecto, y las devuelve en orden", async () => {
    const f = fakeFetch();
    const r = await uploadPhotos([{ dataUrl: DATA, nombre: "logo.png" }, { dataUrl: DATA, nombre: "local.png" }], "p1", f as unknown as typeof fetch);
    expect(r).toEqual({ images: [{ url: "https://cdn/logo.png" }, { url: "https://cdn/local.png" }], failed: 0 });
    const subida = f.mock.calls.find(([u]) => String(u) === "/api/upload")!;
    expect((subida[1]!.body as FormData).get("generationId")).toBe("p1");
  });

  it("🔴 una que falla no tumba las demás: se cuenta", async () => {
    const r = await uploadPhotos(
      [{ dataUrl: DATA, nombre: "a.png" }, { dataUrl: DATA, nombre: "b.png" }],
      "p1",
      fakeFetch(["a.png"]) as unknown as typeof fetch,
    );
    expect(r).toEqual({ images: [{ url: "https://cdn/b.png" }], failed: 1 });
  });
});
