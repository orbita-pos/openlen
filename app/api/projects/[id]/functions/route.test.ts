// @vitest-environment node
//
// GET /api/projects/[id]/functions (spec local 2026-10-11, Parte 6): quién entra
// y qué contesta, sin motor y con él.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewDeps } from "@/lib/functions/overview";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const real = vi.hoisted(() => ({ deps: null as null | OverviewDeps }));
vi.mock("@/lib/functions/overview-real", () => ({ realOverviewDeps: () => real.deps }));

import { auth } from "@/auth";
import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";

import { GET } from "./route";

const pedir = () => GET(new Request("http://x/api/projects/p1/functions"), { params: Promise.resolve({ id: "p1" }) });

beforeEach(() => {
  fijarAccesoDePrueba(null);
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
  real.deps = {
    deployment: async () => null,
    monthCalls: async () => 3,
    plan: async () => "free",
    blocked: async () => false,
    recentErrors: async () => [],
    now: () => new Date("2026-10-12T12:00:00Z"),
  };
});

describe("GET /api/projects/[id]/functions", () => {
  it("401 sin sesión; 404 si no entra", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await pedir()).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
    fijarAccesoDePrueba(() => null);
    expect((await pedir()).status).toBe(404);
  });

  it("sin motor: available false", async () => {
    real.deps = null;
    expect(await (await pedir()).json()).toEqual({ available: false });
  });

  it("con motor: el resumen, también para quien sólo mira", async () => {
    fijarAccesoDePrueba(() => ({ rol: "lector", duenoId: "dueno" }));
    expect(await (await pedir()).json()).toEqual({ available: true, blocked: false, functions: [], usage: { month: "2026-10", calls: 3, quota: 10_000 }, errors: [] });
  });
});
