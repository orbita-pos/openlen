// @vitest-environment node
// POST /api/projects/[id]/publish — una app web que no compila no se publica, y
// la respuesta dice qué fichero y qué línea (spec local 2026-10-07-apps).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publishProject: vi.fn(), gate: vi.fn(), markPublished: vi.fn() }));
vi.mock("@/lib/security-review/real", () => ({ securityReviewer: () => ({ gate: mocks.gate, markPublished: mocks.markPublished }) }));
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
import { StripeAccountMismatchError, StripeSyncFailedError } from "@/lib/stripe/publish-errors";

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
  mocks.gate.mockReset();
  mocks.gate.mockResolvedValue({ kind: "open", view: null });
  mocks.markPublished.mockReset();
  mocks.markPublished.mockResolvedValue(undefined);
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

describe("POST /publish — Stripe (spec local 2026-10-21-stripe-integration)", () => {
  it("another account: 422 stripe_account_mismatch; the copy failed: 502 stripe_sync_failed; a published one returns the summary", async () => {
    mocks.publishProject.mockRejectedValueOnce(new StripeAccountMismatchError());
    const a = await pide();
    expect([a.status, await a.json()]).toEqual([422, { error: "stripe_account_mismatch" }]);
    mocks.publishProject.mockRejectedValueOnce(new StripeSyncFailedError(new Error("Too many requests"), "req_1"));
    const b = await pide();
    expect([b.status, await b.json()]).toEqual([502, { error: "stripe_sync_failed", message: "Too many requests", requestId: "req_1" }]);
    const stripe = { created: { products: 1, prices: 1, paymentLinks: 1, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 }, swaps: 1, chargesEnabled: false };
    mocks.publishProject.mockResolvedValueOnce({ subdomain: "mi-pos", url: "https://mi-pos.openlen.app", publishedAt: new Date(), stripe });
    expect((await (await pide()).json()).stripe).toEqual(stripe);
  });
});

describe("POST /publish — la revisión de seguridad (spec local 2026-10-15)", () => {
  const FP = "c".repeat(64);
  const rls = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };
  const view = { fingerprint: FP, status: "done", blocking: [rls], medium: [], accepted: [] };

  it("🔴 lo grave frena: 428 security_findings con la vista, y no se publica", async () => {
    mocks.gate.mockResolvedValue({ kind: "blocked", view });
    const res = await pide();
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "security_findings", ...view });
    expect(mocks.publishProject).not.toHaveBeenCalled();
  });

  it("con la revisión corriendo: 428 security_review_pending con su huella", async () => {
    mocks.gate.mockResolvedValue({ kind: "pending", view: { ...view, status: "running", blocking: [] } });
    const res = await pide();
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "security_review_pending", fingerprint: FP });
  });

  it("«Publicar igual» viaja hasta la puerta con quién lo pide y su idioma", async () => {
    mocks.publishProject.mockResolvedValue({ url: "https://mi-pos.openlen.app" });
    const res = await pide({ acceptSecurityFingerprint: FP, locale: "es" });
    expect(res.status).toBe(200);
    expect(mocks.gate).toHaveBeenCalledWith({ projectId: "p1", accept: FP, actorId: "u1", locale: "es" });
  });

  it("una huella que no es una: 400 antes de mirar nada", async () => {
    const res = await pide({ acceptSecurityFingerprint: "nope" });
    expect(res.status).toBe(400);
    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it("si la revisión misma revienta, se publica (nunca frena por un fallo nuestro)", async () => {
    mocks.gate.mockRejectedValue(new Error("db down"));
    mocks.publishProject.mockResolvedValue({ url: "https://mi-pos.openlen.app" });
    expect((await pide()).status).toBe(200);
  });

  it("🔴 tras publicar, la revisión con la que pasó queda como base de la siguiente (como la rama base de un PR)", async () => {
    mocks.gate.mockResolvedValue({ kind: "open", view: { ...view, blocking: [] } });
    mocks.publishProject.mockResolvedValue({ url: "https://mi-pos.openlen.app" });
    expect((await pide()).status).toBe(200);
    expect(mocks.markPublished).toHaveBeenCalledWith("p1", FP);
  });

  it("si publicar falla, no hay base nueva; y si marcarla falla, la publicación sigue bien", async () => {
    mocks.gate.mockResolvedValue({ kind: "open", view: { ...view, blocking: [] } });
    mocks.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    expect((await pide()).status).toBe(500);
    expect(mocks.markPublished).not.toHaveBeenCalled();
    mocks.publishProject.mockResolvedValue({ url: "https://mi-pos.openlen.app" });
    mocks.markPublished.mockRejectedValue(new Error("db down"));
    expect((await pide()).status).toBe(200);
  });

  it("con la revisión apagada no hay nada que marcar", async () => {
    mocks.publishProject.mockResolvedValue({ url: "https://mi-pos.openlen.app" });
    expect((await pide()).status).toBe(200);
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });
});
