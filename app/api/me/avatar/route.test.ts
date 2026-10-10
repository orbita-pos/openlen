// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  processImage: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  setAvatarUrl: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/images", () => ({
  processImage: m.processImage,
  OpenLenImageError: class OpenLenImageError extends Error {
    kind = "decode";
  },
}));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({ upload: m.upload, delete: m.remove }) }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { upload: { limit: 100, windowMs: 3_600_000 } },
  consumeToken: () => ({ allowed: true }),
  rateLimitedResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/profile/identity", () => ({ setAvatarUrl: m.setAvatarUrl }));

import { DELETE, POST } from "./route";

const USER = "1b2c3d4e-0000-4000-8000-0123456789ab";
const NUESTRA = `https://uploads.openlen.com/avatars/${USER}-0123456789abcdef.webp`;
const GOOGLE = "https://lh3.googleusercontent.com/a/ana";

function peticion(file?: File): Request {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/me/avatar", { method: "POST", body: form });
}
const webp = (bytes = 10) => new File([new Uint8Array(bytes)], "a.webp", { type: "image/webp" });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: USER } });
  m.processImage.mockResolvedValue({
    variants: [{ bytes: Buffer.from("webp-bytes"), width: 400, height: 400, format: "webp", mime: "image/webp", size: 10 }],
  });
  m.upload.mockImplementation(async ({ key }: { key: string }) => ({ url: `https://uploads.openlen.com/${key}`, size: 10 }));
});

describe("POST /api/me/avatar", () => {
  it("sin sesión, 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await POST(peticion(webp()))).status).toBe(401);
  });

  it("🔴 un GIF (415) o 5 MB y un byte (413) no entran, y no se procesa nada", async () => {
    expect((await POST(peticion(new File([new Uint8Array(4)], "a.gif", { type: "image/gif" })))).status).toBe(415);
    expect((await POST(peticion(webp(5 * 1024 * 1024 + 1)))).status).toBe(413);
    expect((await POST(peticion())).status).toBe(400);
    expect(m.processImage).not.toHaveBeenCalled();
  });

  it("🔴 un WebP de 400×400 a avatars/<usuario>-<hash>.webp, y se borra la vieja NUESTRA", async () => {
    m.setAvatarUrl.mockResolvedValue({ previous: NUESTRA, image: GOOGLE });
    const r = await POST(peticion(webp()));
    expect(r.status).toBe(200);
    const { avatar } = (await r.json()) as { avatar: string };
    expect(avatar).toMatch(new RegExp(`/avatars/${USER}-[0-9a-f]{16}\\.webp$`));
    expect(m.processImage).toHaveBeenCalledWith(
      expect.objectContaining({ variants: [{ width: 400, maxHeight: 400, format: "webp", quality: 85 }], autoOrient: true }),
    );
    expect(m.upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/webp" }));
    expect(m.setAvatarUrl).toHaveBeenCalledWith(USER, avatar);
    expect(m.remove).toHaveBeenCalledWith(`avatars/${USER}-0123456789abcdef.webp`);
  });

  it("🔴 si la de antes era la de Google, no se borra nada", async () => {
    m.setAvatarUrl.mockResolvedValue({ previous: GOOGLE, image: GOOGLE });
    expect((await POST(peticion(webp()))).status).toBe(200);
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("una imagen que no se puede leer, 422", async () => {
    const { OpenLenImageError } = await import("@/lib/images");
    m.processImage.mockRejectedValue(new OpenLenImageError("decode", false, "no se puede leer"));
    expect((await POST(peticion(webp()))).status).toBe(422);
    expect(m.setAvatarUrl).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/avatar", () => {
  it("🔴 vuelve a la de Google y borra la subida", async () => {
    m.setAvatarUrl.mockResolvedValue({ previous: NUESTRA, image: GOOGLE });
    const r = await DELETE();
    expect(await r.json()).toEqual({ avatar: GOOGLE });
    expect(m.setAvatarUrl).toHaveBeenCalledWith(USER, null);
    expect(m.remove).toHaveBeenCalledWith(`avatars/${USER}-0123456789abcdef.webp`);
  });
});
