// @vitest-environment node
import { describe, expect, it } from "vitest";

import { InflightCalls } from "./inflight";

describe("InflightCalls", () => {
  it("settled espera a que se anoten las que están en vuelo; sin ninguna, al momento", async () => {
    const v = new InflightCalls();
    await v.settled("p", "draft", 1000);
    const a = v.start("p", "draft");
    const b = v.start("p", "draft");
    let listo = false;
    const espera = v.settled("p", "draft", 5000).then(() => (listo = true));
    a();
    await new Promise((r) => setTimeout(r, 10));
    expect(listo).toBe(false);
    b();
    b(); // dos veces no cuenta dos
    await espera;
    expect(listo).toBe(true);
  });

  it("con tope: una llamada que no acaba no cuelga a use_page; otro proyecto u otro entorno, no cuentan", async () => {
    const v = new InflightCalls();
    v.start("p", "draft");
    v.start("q", "draft");
    const t0 = Date.now();
    await v.settled("p", "draft", 50);
    expect(Date.now() - t0).toBeLessThan(1000);
    await v.settled("p", "live", 5000);
  });
});
