// @vitest-environment node
//
// La decisión del proxy de salida del Chromium del servidor: a dónde se deja
// conectar y A QUÉ IP. El DNS va inyectado: así se prueba el rebinding sin
// depender de la red. Lo que pasa en un Chromium de verdad está en
// `egress-proxy.browser.test.ts`.
import { describe, expect, it } from "vitest";

import { allowEgressOrigin, decideEgress } from "./egress-proxy";

const dnsDe = (map: Record<string, { address: string; family: 4 | 6 }[]>) => async (host: string) => {
  const r = map[host];
  if (!r) throw new Error("ENOTFOUND");
  return r;
};

describe("decideEgress — a dónde puede salir el Chromium del servidor", () => {
  it("un host público pasa, y se conecta a la IP que se resolvió (no se vuelve a resolver)", async () => {
    const lookup = dnsDe({ "cdn.tailwindcss.com": [{ address: "104.18.10.20", family: 4 }] });
    expect(await decideEgress("cdn.tailwindcss.com", 443, lookup)).toEqual({ ok: true, address: "104.18.10.20" });
  });

  it("🔴 un nombre que resuelve a una IP privada no pasa (el rebinding de DNS)", async () => {
    const lookup = dnsDe({ "rebind.example-ataque.com": [{ address: "127.0.0.1", family: 4 }] });
    expect(await decideEgress("rebind.example-ataque.com", 80, lookup)).toEqual({ ok: false });
    const lan = dnsDe({ "intranet.empresa-falsa.com": [{ address: "10.0.0.5", family: 4 }] });
    expect(await decideEgress("intranet.empresa-falsa.com", 80, lan)).toEqual({ ok: false });
  });

  it("🔴 con una respuesta mixta (pública y privada) no pasa: falla cerrado", async () => {
    const lookup = dnsDe({
      "mixto.example-ataque.com": [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    });
    expect(await decideEgress("mixto.example-ataque.com", 80, lookup)).toEqual({ ok: false });
  });

  it("las IPv6 del DNS no cuentan; sin ninguna IPv4 no pasa", async () => {
    const lookup = dnsDe({
      "dual.example.org": [
        { address: "2606:2800:220:1::248", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ],
      "solo6.example.org": [{ address: "2606:2800:220:1::248", family: 6 }],
    });
    expect(await decideEgress("dual.example.org", 443, lookup)).toEqual({ ok: true, address: "93.184.216.34" });
    expect(await decideEgress("solo6.example.org", 443, lookup)).toEqual({ ok: false });
  });

  it("literales e internos: privados y v6 no; un v4 público sí", async () => {
    const nunca = async () => {
      throw new Error("no debería resolver");
    };
    for (const h of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "0.0.0.0", "[::1]", "::1", "localhost", "app.localhost", "metadata", "db.internal", "nas.local"]) {
      expect(await decideEgress(h, 80, nunca), h).toEqual({ ok: false });
    }
    expect(await decideEgress("8.8.8.8", 443, nunca)).toEqual({ ok: true, address: "8.8.8.8" });
  });

  it("un nombre que no resuelve no pasa", async () => {
    expect(await decideEgress("no-existe.example-ataque.com", 80, dnsDe({}))).toEqual({ ok: false });
  });

  it("🔴 un origen local registrado pasa, sólo en su puerto, y deja de pasar al soltarlo", async () => {
    const nunca = async () => {
      throw new Error("no debería resolver");
    };
    const soltar = allowEgressOrigin("127.0.0.1:45678");
    expect(await decideEgress("127.0.0.1", 45678, nunca)).toEqual({ ok: true, address: "127.0.0.1" });
    expect(await decideEgress("127.0.0.1", 3000, nunca)).toEqual({ ok: false });
    soltar();
    expect(await decideEgress("127.0.0.1", 45678, nunca)).toEqual({ ok: false });
  });
});
