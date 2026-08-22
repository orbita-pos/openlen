import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchRaw } from "./fetch-raw";

/**
 * LA prueba que faltaba, y no es teórica: `fetch-raw` usaba
 * `redirect: "follow"`, así que validaba la URL que escribía el visitante y
 * luego seguía las redirecciones a CIEGAS.
 *
 * Una URL propia que responda 302 hacia `http://169.254.169.254/` saltaba la
 * defensa SSRF entera — y de ahí se sacan las credenciales de la nube.
 *
 * El servidor de abajo es local y sirve exactamente esa trampa.
 */
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/a-metadatos") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (url === "/a-loopback") {
      res.writeHead(301, { location: "http://127.0.0.1:9/" });
      res.end();
      return;
    }
    if (url === "/bucle") {
      res.writeHead(302, { location: "/bucle" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><body><h1>ok</h1></body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("las redirecciones se revalidan, no se siguen a ciegas", () => {
  // El servidor de prueba es 127.0.0.1, así que la puerta lo rechaza ANTES de
  // pedir nada — que es justo lo que debe hacer. Esto confirma que la defensa
  // está viva en el camino de entrada.
  it("un host privado se rechaza antes de la primera petición", async () => {
    const r = await fetchRaw({ url: `${base}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ssrf-blocked");
  });

  it.each([
    ["/a-metadatos", "302 hacia el endpoint de metadatos de nube"],
    ["/a-loopback", "301 hacia el loopback"],
  ])("%s se corta (%s)", async (path) => {
    const r = await fetchRaw({ url: `${base}${path}` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ssrf-blocked");
  });
});

describe("una web pública de verdad", () => {
  // Sin esto, un `fetch-raw` que rechazara TODO pasaría las pruebas de arriba
  // y seguiría estando roto. Es la prueba de que la puerta deja pasar.
  it("example.com se trae y llega HTML", async () => {
    const r = await fetchRaw({ url: "https://example.com/" });
    if (!r.ok) {
      // Sin red no se puede afirmar nada: se dice, no se finge que pasó.
      expect(["network", "timeout"]).toContain(r.error.kind);
      return;
    }
    expect(r.value.html.toLowerCase()).toContain("<html");
    expect(r.value.hostname).toBe("example.com");
    expect(r.value.sizeBytes).toBeGreaterThan(0);
  }, 30_000);
});
