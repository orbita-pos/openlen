// @vitest-environment node
// «Your uploads» in the image modal (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §6): what was uploaded
// before (the assets store, absolute URLs) and what lives in the folder now (img/…, by its root-relative path).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn(async () => ({ rol: "dueno", duenoId: "u1" })) }));
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, where: () => cadena, limit: async () => [{ id: "p1" }] };
  return { db: { select: () => cadena }, schema: { projects: { id: "id", userId: "userId" } } };
});
const viejas = [{ filename: "a.webp", contentType: "image/webp", size: 10, url: "/api/projects/p1/assets/a.webp", uploadedAt: 100 }];
vi.mock("@/lib/projects/assets", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAssetStorage: () => ({ list: async () => viejas }),
}));
vi.mock("@/lib/backend/files", () => ({
  listFolderMedia: vi.fn(async () => [{ filename: "foto.webp", contentType: "image/webp", size: 20, url: "/img/foto.webp", uploadedAt: 200 }]),
}));

import { GET } from "./route";

describe("GET /api/projects/[id]/assets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the folder's images first by date, with their relative path; the old ones absolute, as before", async () => {
    const r = await GET(new Request("http://openlen.test/api/projects/p1/assets"), { params: Promise.resolve({ id: "p1" }) });
    const { assets } = (await r.json()) as { assets: { url: string }[] };
    expect(assets.map((a) => a.url)).toEqual(["/img/foto.webp", "http://openlen.test/api/projects/p1/assets/a.webp"]);
  });
});
