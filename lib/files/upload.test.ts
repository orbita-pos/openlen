import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/terminal/operar-a-mano", () => ({ operarAMano: vi.fn() }));
vi.mock("@/lib/agent/terminal/editar-a-mano", () => ({ guardarAMano: vi.fn() }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import { guardarAMano } from "@/lib/agent/terminal/editar-a-mano";
import { operarAMano } from "@/lib/agent/terminal/operar-a-mano";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import { isBlobPointer, parsePointer } from "./blob-pointer";
import { uploadProjectFile } from "./upload";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openlen-upload-"));
  __setStorageForTest(new FilesystemStorage({ rootDir: dir, publicUrlBase: "/uploads" }));
  vi.mocked(operarAMano).mockReset();
  vi.mocked(guardarAMano).mockReset();
  vi.mocked(cargarFicherosDeLaTerminal).mockReset();
});

afterEach(() => {
  __setStorageForTest(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("uploadProjectFile", () => {
  it("a new binary is created through the editor's path, as a pointer", async () => {
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({ "/index.html": "<h1>x</h1>" });
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/img/logo.png"] });
    const r = await uploadProjectFile({ projectId: "p1", ownerId: "u1", personId: "u2", ruta: "/img/logo.png", bytes: PNG });
    expect(r).toEqual({ ok: true, ruta: "/img/logo.png" });
    const [projectId, ownerId, op, , personId] = vi.mocked(operarAMano).mock.calls[0]!;
    expect([projectId, ownerId, personId]).toEqual(["p1", "u1", "u2"]);
    expect(op).toMatchObject({ tipo: "crear", ruta: "/img/logo.png" });
    const contenido = (op as { contenido: string }).contenido;
    expect(isBlobPointer(contenido)).toBe(true);
    expect(parsePointer(contenido)?.size).toBe(PNG.byteLength);
  });

  it("a text file is created as text", async () => {
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({});
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/a/b.txt"] });
    await uploadProjectFile({ projectId: "p1", ownerId: "u1", ruta: "/a/b.txt", bytes: new TextEncoder().encode("hola\n") });
    expect(vi.mocked(operarAMano).mock.calls[0]![2]).toMatchObject({ tipo: "crear", ruta: "/a/b.txt", contenido: "hola\n" });
  });

  it("an existing file is replaced over what is there now", async () => {
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({ "/img/logo.png": "antes" });
    vi.mocked(guardarAMano).mockResolvedValue({ ok: true, contenido: "x" });
    const r = await uploadProjectFile({ projectId: "p1", ownerId: "u1", ruta: "/img/logo.png", bytes: PNG });
    expect(r.ok).toBe(true);
    expect(operarAMano).not.toHaveBeenCalled();
    const [, , ruta, contenido, base] = vi.mocked(guardarAMano).mock.calls[0]!;
    expect(ruta).toBe("/img/logo.png");
    expect(isBlobPointer(contenido)).toBe(true);
    expect(base).toBe("antes");
  });

  it("what a guard refuses comes back with its reason", async () => {
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({});
    vi.mocked(operarAMano).mockResolvedValue({ ok: false, motivo: "rechazado", detalle: "ENOSPC: no space left on device, write '/v.mp4'" });
    expect(await uploadProjectFile({ projectId: "p1", ownerId: "u1", ruta: "/v.mp4", bytes: PNG })).toEqual({
      ok: false,
      motivo: "ENOSPC: no space left on device, write '/v.mp4'",
    });
  });

  it("more than 50 MB is refused before anything is stored", async () => {
    const big = { byteLength: 50 * 1024 * 1024 + 1 } as Uint8Array;
    const r = await uploadProjectFile({ projectId: "p1", ownerId: "u1", ruta: "/v.mp4", bytes: big });
    expect(r).toEqual({ ok: false, motivo: "File too large: /v.mp4 is 50.0 MB, the maximum is 50 MB." });
    expect(operarAMano).not.toHaveBeenCalled();
  });
});
