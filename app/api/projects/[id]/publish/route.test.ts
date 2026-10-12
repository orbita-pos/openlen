// @vitest-environment node
// POST /api/projects/[id]/publish — una app web que no compila no se publica, y
// la respuesta dice qué fichero y qué línea (spec local 2026-10-07-apps).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publishProject: vi.fn() }));
// Compartir el proyecto: aquí quien pide es el dueño (ver acceso-de-prueba.ts).
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn(async () => "u1") }));
vi.mock("@/lib/projects", async () => {
  class E extends Error {}
  return {
    publishProject: mocks.publishProject,
    unpublishProject: vi.fn(),
    ProjectNotFoundError: class extends E {},
    SubdomainInvalidError: class extends E {},
    SubdomainLimitError: class extends E {},
    SubdomainTakenError: class extends E {},
  };
});

import { POST } from "./route";
import { AppNoCompilaError } from "@/lib/apps/compilador";
import { FunctionSecretsMissingError, FunctionsDeployFailedError, FunctionsDoNotCompileError } from "@/lib/functions/publish-errors";

const pide = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://openlen.com/api/projects/p1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subdomain: "mi-pos", ...extra }),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );

beforeEach(() => {
  mocks.publishProject.mockReset();
});

describe("POST /publish — una app web", () => {
  it("🔴 si no compila: 422 con cada error como fichero:línea — mensaje", async () => {
    mocks.publishProject.mockRejectedValue(
      new AppNoCompilaError([{ ruta: "/src/App.jsx", linea: 12, columna: 5, mensaje: "Unexpected token" }]),
    );
    const res = await pide();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "app_does_not_compile", errors: ["/src/App.jsx:12:5 — Unexpected token"] });
  });

  it("CONTRA-PRUEBA: otro fallo sigue siendo un 500 sin detalles", async () => {
    mocks.publishProject.mockRejectedValue(new Error("disco lleno"));
    const res = await pide();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "publish_failed" });
  });
});

describe("POST /publish — las Edge Functions (spec local 2026-10-11)", () => {
  it("🔴 faltan secretos en producción: 428 con sus nombres; «Publicar igual» viaja hasta publishProject", async () => {
    mocks.publishProject.mockRejectedValueOnce(new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]));
    const res = await pide();
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "secrets_required", missing: ["STRIPE_SECRET_KEY"] });
    mocks.publishProject.mockResolvedValueOnce({ subdomain: "mi-pos", url: "https://mi-pos.openlen.app", publishedAt: new Date() });
    expect((await pide({ skipMissingSecrets: true })).status).toBe(200);
    expect(mocks.publishProject.mock.calls.at(-1)![0]).toMatchObject({ functions: { skipMissingSecrets: true } });
  });

  it("no compilan: 422 con fichero y línea; el despliegue falla: 502 (la página no cambió)", async () => {
    mocks.publishProject.mockRejectedValueOnce(new FunctionsDoNotCompileError([{ ruta: "/supabase/functions/checkout/index.ts", linea: 3, columna: 5, gravedad: "Error", mensaje: "x" }]));
    const a = await pide();
    expect(a.status).toBe(422);
    expect(await a.json()).toEqual({ error: "functions_do_not_compile", errors: ["/supabase/functions/checkout/index.ts:3:5 — x"] });
    mocks.publishProject.mockRejectedValueOnce(new FunctionsDeployFailedError(new Error("motor")));
    expect((await pide()).status).toBe(502);
  });
});
