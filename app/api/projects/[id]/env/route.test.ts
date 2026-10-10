// @vitest-environment node
//
// /api/projects/[id]/env: quién entra, la forma de la respuesta y el código de
// cada salida. Lo de la base (versión, huella, 409 de verdad) lo prueba
// lib/apps/env/store.pg.test.ts contra Postgres.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const fila = vi.hoisted(() => ({ actual: null as null | Record<string, unknown> }));
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, where: () => cadena, limit: async () => (fila.actual ? [fila.actual] : []) };
  return {
    db: { select: () => cadena },
    schema: {
      projects: { id: "id", userId: "userId", data: "data", subdomain: "subdomain", publishedAt: "publishedAt", envHash: "envHash", publishedEnvHash: "publishedEnvHash" },
    },
  };
});
vi.mock("@/lib/apps/env/store", () => ({ listEnvVars: vi.fn(), replaceEnvVars: vi.fn() }));
vi.mock("@/lib/backend/files", () => ({ listProjectFiles: vi.fn() }));
vi.mock("@/lib/apps/entorno", () => ({ platformEnv: vi.fn() }));

import { GET, PUT } from "./route";
import { auth } from "@/auth";
import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { listEnvVars, replaceEnvVars } from "@/lib/apps/env/store";
import { listProjectFiles } from "@/lib/backend/files";
import { platformEnv } from "@/lib/apps/entorno";
import { envVersionOf } from "@/lib/apps/env/hash";

const ctx = () => ({ params: Promise.resolve({ id: "p1" }) });
const pedirGET = () => GET(new Request("http://x/api/projects/p1/env"), ctx());
const pedirPUT = (cuerpo: unknown) =>
  PUT(new Request("http://x/api/projects/p1/env", { method: "PUT", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }), ctx());
const comoUsuario = (id: string | null) => vi.mocked(auth).mockResolvedValue((id ? { user: { id } } : null) as never);
const FECHA = new Date("2026-10-10T12:00:00Z");
const VARS = [
  { name: "VITE_STRIPE", target: "draft" as const, value: "pk_test_1", updatedAt: FECHA, updatedBy: "u1" },
  { name: "VITE_STRIPE", target: "production" as const, value: "pk_live_1", updatedAt: FECHA, updatedBy: "u1" },
];
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" };

beforeEach(() => {
  fijarAccesoDePrueba(null);
  comoUsuario("u1");
  fila.actual = { data: { html: "", app: APP }, subdomain: "caja", publishedAt: FECHA, envHash: "b", publishedEnvHash: "a" };
  vi.mocked(listEnvVars).mockResolvedValue(VARS);
  vi.mocked(listProjectFiles).mockResolvedValue({ "/.env": "VITE_STRIPE=del-fichero\nVITE_MAPS=AIza1\n" });
  vi.mocked(platformEnv).mockResolvedValue({ VITE_SUPABASE_URL: "https://abc.openlen.app" });
  vi.mocked(replaceEnvVars).mockReset();
});

describe("GET /api/projects/[id]/env", () => {
  it("401 sin sesión; 404 si no entra", async () => {
    comoUsuario(null);
    expect((await pedirGET()).status).toBe(401);
    comoUsuario("u1");
    fijarAccesoDePrueba(() => null);
    expect((await pedirGET()).status).toBe(404);
  });

  it("las tres fuentes, la versión y si la publicada va atrasada", async () => {
    const r = await pedirGET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      vars: VARS.map(({ name, target, value }) => ({ name, target, value, updatedAt: FECHA.toISOString() })),
      fromFile: [
        { name: "VITE_STRIPE", value: "del-fichero", overridden: ["draft", "production"] },
        { name: "VITE_MAPS", value: "AIza1", overridden: [] },
      ],
      platform: [{ name: "VITE_SUPABASE_URL", value: "https://abc.openlen.app" }],
      version: envVersionOf(VARS),
      published: true,
      pendingPublish: true,
    });
    expect(listProjectFiles).toHaveBeenCalledWith("p1", "/.env");
  });

  it("sin publicar no hay nada que volver a publicar", async () => {
    fila.actual = { ...fila.actual!, subdomain: null, publishedAt: null };
    expect(await (await pedirGET()).json()).toMatchObject({ published: false, pendingPublish: false });
  });

  it("un lector ve; una página no tiene variables", async () => {
    fijarAccesoDePrueba(() => ({ rol: "lector", duenoId: "u1" }));
    expect((await pedirGET()).status).toBe(200);
    fila.actual = { ...fila.actual!, data: { html: "" } };
    const r = await pedirGET();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "not_an_app" });
  });
});

describe("PUT /api/projects/[id]/env", () => {
  const CUERPO = { version: "v1", vars: [{ name: "VITE_A", target: "draft", value: "1" }] };

  it("🔴 un lector no cambia nada (403) y no se llega a la base", async () => {
    fijarAccesoDePrueba(() => ({ rol: "lector", duenoId: "u1" }));
    expect((await pedirPUT(CUERPO)).status).toBe(403);
    expect(replaceEnvVars).not.toHaveBeenCalled();
  });

  it("400 con un cuerpo que no es la lista", async () => {
    expect((await pedirPUT("no es json")).status).toBe(400);
    expect((await pedirPUT({ version: "v1", vars: [{ name: "VITE_A", target: "staging", value: "" }] })).status).toBe(400);
    expect(replaceEnvVars).not.toHaveBeenCalled();
  });

  it("guarda con el DUEÑO como dueño y quien pide como autor", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "dueno" }));
    comoUsuario("editora");
    vi.mocked(replaceEnvVars).mockResolvedValue({ ok: true, vars: [] });
    expect((await pedirPUT(CUERPO)).status).toBe(200);
    expect(replaceEnvVars).toHaveBeenCalledWith({ projectId: "p1", ownerId: "dueno", userId: "editora", version: "v1", vars: CUERPO.vars });
  });

  it("cada salida con su código", async () => {
    vi.mocked(replaceEnvVars).mockResolvedValueOnce({ ok: false, reason: "invalid", problems: [{ code: "reserved", name: "VITE_SUPABASE_URL" }] });
    const invalido = await pedirPUT(CUERPO);
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toEqual({ error: "invalid", problems: [{ code: "reserved", name: "VITE_SUPABASE_URL" }] });

    vi.mocked(replaceEnvVars).mockResolvedValueOnce({ ok: false, reason: "conflict", vars: VARS });
    const conflicto = await pedirPUT(CUERPO);
    expect(conflicto.status).toBe(409);
    expect(await conflicto.json()).toMatchObject({ error: "conflict", version: envVersionOf(VARS) });

    vi.mocked(replaceEnvVars).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await pedirPUT(CUERPO)).status).toBe(404);
  });
});
