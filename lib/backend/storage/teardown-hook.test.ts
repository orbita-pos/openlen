// @vitest-environment node
//
// Carril D: borrar un proyecto (lib/backend/teardown.ts) se lleva también los
// ficheros de su Storage, aunque el borrado de la base falle (el proyecto ya no
// existe: sus ficheros son de nadie).
import { beforeEach, describe, expect, it, vi } from "vitest";

const orden: string[] = [];
let dropFalla = false;

vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("../pg", () => ({ backendConfigured: () => true }));
vi.mock("../provision", () => ({
  dropProjectDatabase: async (ref: string) => {
    orden.push(`drop ${ref}`);
    if (dropFalla) throw new Error("clúster caído");
  },
}));
vi.mock("./purge", () => ({
  purgeProjectStorage: async (ref: string) => {
    orden.push(`purge ${ref}`);
  },
}));

const { dropPageDatabase } = await import("../teardown");

beforeEach(() => {
  orden.length = 0;
  dropFalla = false;
});

describe("dropPageDatabase + Storage", () => {
  it("borra la base y luego los ficheros del ref", async () => {
    await dropPageDatabase("abcdefghijklmnopqrst");
    expect(orden).toEqual(["drop abcdefghijklmnopqrst", "purge abcdefghijklmnopqrst"]);
  });

  it("si la base no se pudo borrar, los ficheros se borran igual", async () => {
    dropFalla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await dropPageDatabase("abcdefghijklmnopqrst");
    expect(orden).toEqual(["drop abcdefghijklmnopqrst", "purge abcdefghijklmnopqrst"]);
    err.mockRestore();
  });
});
