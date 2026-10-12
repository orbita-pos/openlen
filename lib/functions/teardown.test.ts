// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FunctionsEngine } from "./engines/types";
import { removeProjectFunctions } from "./teardown";

describe("removeProjectFunctions", () => {
  it("quita los dos destinos; si uno falla, el otro también se quita", async () => {
    const quitados: string[] = [];
    const engine: FunctionsEngine = {
      name: "local",
      deploy: async () => undefined,
      setEnv: async () => undefined,
      deployedHash: async () => null,
      invoke: async function* () {},
      remove: async (d) => {
        quitados.push(`${d.ref}|${d.environment}`);
        if (d.environment === "draft") throw new Error("ya no estaba");
      },
    };
    await removeProjectFunctions("abcdefghijklmnopqrst", engine);
    expect(quitados).toEqual(["abcdefghijklmnopqrst|draft", "abcdefghijklmnopqrst|live"]);
  });

  it("sin motor, nada", async () => {
    await removeProjectFunctions("abcdefghijklmnopqrst", null);
  });
});
