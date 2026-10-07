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

const pide = () =>
  POST(
    new Request("https://openlen.com/api/projects/p1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subdomain: "mi-pos" }),
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
