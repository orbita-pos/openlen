import { describe, expect, it } from "vitest";

import { conReintentoPorEperm } from "./reintentar-publicar";

const eperm = () => Object.assign(new Error("EPERM: operation not permitted, rename 'a' -> 'b'"), { code: "EPERM", syscall: "rename" });
const sinDormir = async () => {};

describe("conReintentoPorEperm — el rename que Windows retiene un instante", () => {
  it("🔴 un EPERM de rename pasajero se reintenta y la publicación sale", async () => {
    let llamadas = 0;
    const r = await conReintentoPorEperm(
      async () => {
        llamadas++;
        if (llamadas === 1) throw eperm();
        return "publicada";
      },
      { dormir: sinDormir },
    );
    expect(r).toBe("publicada");
    expect(llamadas).toBe(2);
  });

  it("si no se suelta, se rinde tras los intentos y lanza el EPERM de verdad", async () => {
    let llamadas = 0;
    await expect(
      conReintentoPorEperm(
        async () => {
          llamadas++;
          throw eperm();
        },
        { intentos: 3, dormir: sinDormir },
      ),
    ).rejects.toThrow(/EPERM/);
    expect(llamadas).toBe(3);
  });

  it("BRAZO DE CONTROL: otro error no se reintenta", async () => {
    let llamadas = 0;
    await expect(
      conReintentoPorEperm(
        async () => {
          llamadas++;
          throw Object.assign(new Error("EPERM: operation not permitted, open 'x'"), { code: "EPERM", syscall: "open" });
        },
        { dormir: sinDormir },
      ),
    ).rejects.toThrow(/open/);
    expect(llamadas).toBe(1);
  });
});
