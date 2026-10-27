import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/agent/skills/deliveries", () => ({ deliveryStore: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { deliveryStore } from "@/lib/agent/skills/deliveries";

const XLSX = new Uint8Array([0x50, 0x4b, 3, 4]);
const files = new Map<string, Uint8Array>([
  ["deliveries/p1/t-1/ab12cd34-Inventario-tienda.xlsx", XLSX],
  ["deliveries/p1/t-1/ab12cd34-menú.docx", new Uint8Array([7])],
]);
const get = vi.fn(async (key: string) => files.get(key) ?? null);
const pedir = (turn: string, file: string) =>
  GET(new Request(`http://localhost/api/projects/p1/deliveries/${turn}/${file}`), { params: Promise.resolve({ id: "p1", turn, file }) });

beforeEach(() => {
  get.mockClear();
  vi.mocked(auth).mockResolvedValue({ user: { id: "ana" } } as never);
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "lector", duenoId: "dueno-1" } as never);
  vi.mocked(deliveryStore).mockReturnValue({ put: vi.fn(), get });
});

// A file Len delivered with `present` (spec local 2026-10-26-len-skills, §4.9): private, served to
// whoever can SEE the project, and always as a download, never rendered on this origin.
describe("GET /api/projects/[id]/deliveries/[turn]/[file]", () => {
  it("serves the delivered file to whoever can see the project, as a download", async () => {
    const res = await pedir("t-1", "ab12cd34-Inventario-tienda.xlsx");
    expect(res.status).toBe(200);
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "ana", "ver");
    expect(get).toHaveBeenCalledWith("deliveries/p1/t-1/ab12cd34-Inventario-tienda.xlsx");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(XLSX);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Inventario-tienda.xlsx"; filename*=UTF-8''Inventario-tienda.xlsx`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("an accented name arrives encoded or not, and downloads with its name", async () => {
    for (const file of ["ab12cd34-men%C3%BA.docx", "ab12cd34-menú.docx"]) {
      const res = await pedir("t-1", file);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="men_.docx"; filename*=UTF-8''men%C3%BA.docx`);
    }
  });

  it("answers the access refusal as it comes, without reading the store", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(new Response(null, { status: 404 }) as never);
    expect((await pedir("t-1", "ab12cd34-Inventario-tienda.xlsx")).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await pedir("t-1", "ab12cd34-Inventario-tienda.xlsx")).status).toBe(401);
  });

  it("404 for a file that is not there", async () => {
    expect((await pedir("t-1", "ab12cd34-otro.xlsx")).status).toBe(404);
  });

  it("404 for anything that is not a delivered file's name, without reading the store", async () => {
    for (const [turn, file] of [["..", "ab12cd34-x.xlsx"], ["t-1", ".."], ["t-1", "x.xlsx"], ["t-1", "ab12cd34-..%2F..%2Fx"], ["t%2F..", "ab12cd34-x.xlsx"]]) {
      expect((await pedir(turn!, file!)).status).toBe(404);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("503 when this server has no private store for them", async () => {
    vi.mocked(deliveryStore).mockReturnValue(null);
    expect((await pedir("t-1", "ab12cd34-Inventario-tienda.xlsx")).status).toBe(503);
  });
});
