// @vitest-environment node
// `import.meta.env` de una app por entorno (lib/apps/entorno.ts): las variables
// del dueño de ESE entorno, y lo de OpenLen encima.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend/registry", () => ({
  getBackendByProject: vi.fn(),
  projectUrl: (ref: string) => `https://${ref}.openlen.app`,
}));
vi.mock("@/lib/apps/env/store", () => ({ envVarsFor: vi.fn() }));

import { getBackendByProject } from "@/lib/backend/registry";
import { envVarsFor } from "@/lib/apps/env/store";
import { PLATFORM_ENV_NAMES } from "@/lib/apps/env/rules";
import { entornoPublicoDeLaApp, platformEnv } from "./entorno";

beforeEach(() => {
  vi.mocked(getBackendByProject).mockResolvedValue({ ref: "abc", publishableKey: "sb_publishable_x" } as never);
  vi.mocked(envVarsFor).mockReset();
  vi.mocked(envVarsFor).mockImplementation(
    async (_id, target): Promise<Record<string, string>> =>
      target === "draft" ? { VITE_STRIPE: "pk_test_1", VITE_SUPABASE_URL: "no-puede" } : { VITE_STRIPE: "pk_live_1" },
  );
});

describe("entornoPublicoDeLaApp", () => {
  it("cada entorno con lo suyo, y lo de OpenLen encima", async () => {
    expect(await entornoPublicoDeLaApp("p1", "draft")).toEqual({
      VITE_STRIPE: "pk_test_1",
      VITE_SUPABASE_URL: "https://abc.openlen.app",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      VITE_SUPABASE_ANON_KEY: "sb_publishable_x",
    });
    expect((await entornoPublicoDeLaApp("p1", "production")).VITE_STRIPE).toBe("pk_live_1");
    expect(envVarsFor).toHaveBeenCalledWith("p1", "production");
  });

  it("con las del dueño ya leídas, no vuelve a la base", async () => {
    expect((await entornoPublicoDeLaApp("p1", "production", { VITE_X: "1" })).VITE_X).toBe("1");
    expect(envVarsFor).not.toHaveBeenCalled();
  });

  it("sin backend, sólo las del dueño", async () => {
    vi.mocked(getBackendByProject).mockResolvedValue(null);
    expect(await entornoPublicoDeLaApp("p1", "production")).toEqual({ VITE_STRIPE: "pk_live_1" });
  });

  it("los nombres de OpenLen son los reservados", async () => {
    expect(Object.keys(await platformEnv("p1")).sort()).toEqual([...PLATFORM_ENV_NAMES].sort());
  });
});
