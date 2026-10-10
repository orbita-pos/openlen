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
  dropProjectDatabase: async (scope: string) => {
    orden.push(`drop ${scope}`);
    if (dropFalla) throw new Error("clúster caído");
  },
  dropDeveloperRole: async (ref: string) => {
    orden.push(`role ${ref}`);
  },
}));
vi.mock("../environments", () => ({ listEnvironments: async () => [] }));
vi.mock("./purge", () => ({
  purgeProjectStorage: async (scope: string) => {
    orden.push(`purge ${scope}`);
  },
}));

const { dropPageDatabases } = await import("../teardown");

beforeEach(() => {
  orden.length = 0;
  dropFalla = false;
});

describe("dropPageDatabases + Storage", () => {
  it("borra cada base y luego sus ficheros, y al final el rol del proyecto", async () => {
    await dropPageDatabases({ ref: "abcdefghijklmnopqrst", scopes: ["abcdefghijklmnopqrst", "abcdefghijklmnopqrst_d"] });
    expect(orden).toEqual([
      "drop abcdefghijklmnopqrst",
      "purge abcdefghijklmnopqrst",
      "drop abcdefghijklmnopqrst_d",
      "purge abcdefghijklmnopqrst_d",
      "role abcdefghijklmnopqrst",
    ]);
  });

  it("si la base no se pudo borrar, los ficheros se borran igual", async () => {
    dropFalla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await dropPageDatabases({ ref: "abcdefghijklmnopqrst", scopes: ["abcdefghijklmnopqrst"] });
    expect(orden).toEqual(["drop abcdefghijklmnopqrst", "purge abcdefghijklmnopqrst", "role abcdefghijklmnopqrst"]);
    err.mockRestore();
  });
});
