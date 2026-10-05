// @vitest-environment node
//
// En producción (un proyecto sin almacén propio: el de R2 del entorno), la ruta
// de Storage EXIGE el esquema `storage`: si no se puede montar, 503 con un
// mensaje, no un error de SQL a medias. (ensureProvisioned sólo lo registra,
// para no tumbar /rest/v1 ni /auth/v1: registry-hook.test.ts.)
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./provision", () => ({
  ensureStorageProvisioned: async () => {
    throw new Error("permission denied to grant role");
  },
}));

const { handleBackendRequest } = await import("../router");
const { newStorageTestProject } = await import("./testing");
const { TEST_URL } = await import("../testing/project");

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

afterEach(() => vi.unstubAllEnvs());

describe("Storage en producción sin su esquema", () => {
  it("503 «not ready», sin tocar R2", async () => {
    const t = await newStorageTestProject("");
    vi.stubEnv("R2_ACCOUNT_ID", "a");
    vi.stubEnv("R2_ACCESS_KEY", "b");
    vi.stubEnv("R2_SECRET_KEY", "c");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleBackendRequest(new Request(`${TEST_URL}/storage/v1/bucket`, { headers: { apikey: t.secretKey } }), t.project);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ message: "The project storage is not ready yet. Try again in a moment." });
    err.mockRestore();
  });
});
