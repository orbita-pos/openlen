// @vitest-environment node
//
// LA COOKIE DEL VISITANTE, EN UN NAVEGADOR DE VERDAD Y EN UN DOMINIO PROPIO.
//
// Esto no se puede comprobar leyendo la cabecera: quien decide si una cookie
// vale es el NAVEGADOR. Con `Domain=<sub>.openlen.app`, una página servida en
// `www.cafe.mx` recibe la cabecera y Chrome la tira con `InvalidDomain` —el
// dominio no cubre al host—, así que cada petición estrena visitante: el
// carrito no lee nada y cada guardado abre una fila nueva. Encontrado el
// 2026-09-18, aún sin ningún cliente afectado (1 dominio propio verificado, sin
// almacén, 0 filas), y arreglado antes de que lo hubiera.
//
// Se sirve por HTTP y se le dice a Chrome que trate estos dos orígenes como
// seguros: la cookie es `Secure`, y esto evita guardar un certificado en el
// repo. El puerto se conoce antes de arrancar el navegador porque la bandera
// lo lleva dentro.
//
// LA CONTRA-PRUEBA ES LA MITAD DEL VALOR: la cabecera VIEJA se reconstruye
// aquí a mano y tiene que seguir fallando. Sin ella, esta prueba pasaría
// igual si el arreglo no hiciera nada.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer";

import { cabeceraDeVisitante, COOKIE_VISITANTE } from "./visitante";

const SUBDOMINIO = "volcanica.openlen.app";
const DOMINIO_PROPIO = "www.cafe.mx";

/** La cabecera que se emitía hasta el 2026-09-18. Sólo existe aquí, como
 *  control: si algún día vuelve a pasar la prueba, el arreglo se deshizo. */
function cabeceraVieja(valor: string, sub: string): string {
  return `${COOKIE_VISITANTE}=${valor}; Path=/; Max-Age=63072000; HttpOnly; Secure; SameSite=Lax; Domain=${sub}.openlen.app`;
}

/** Qué cabecera emite el servidor en la prueba que está corriendo. */
let emitir: (valor: string) => string = cabeceraDeVisitante;

let servidor: Server;
let navegador: Browser;
let puerto = 0;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/api/d/")) {
      // El mismo trato que da la ruta: si la cookie llega, es un visitante
      // conocido; si no, se emite una nueva.
      const traida = (req.headers.cookie ?? "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${COOKIE_VISITANTE}=`));
      if (traida) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nuevo: false, visitante: traida.split("=")[1] }));
        return;
      }
      const valor = randomUUID();
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": emitir(valor),
      });
      res.end(JSON.stringify({ nuevo: true, visitante: valor }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>carrito</title><script>
      (async () => {
        const r1 = await fetch('/api/d/carrito', { method: 'POST', body: '{}' }).then((r) => r.json());
        const r2 = await fetch('/api/d/carrito').then((r) => r.json());
        const r3 = await fetch('/api/d/carrito').then((r) => r.json());
        window.__resultado = { r1, r2, r3 };
      })();
    </script>`);
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  puerto = (servidor.address() as { port: number }).port;

  const puppeteer = (await import("puppeteer")).default;
  const seguros = [SUBDOMINIO, DOMINIO_PROPIO]
    .map((h) => `http://${h}:${puerto}`)
    .join(",");
  navegador = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--host-resolver-rules=MAP * 127.0.0.1",
      `--unsafely-treat-insecure-origin-as-secure=${seguros}`,
    ],
  });
}, 120_000);

afterAll(async () => {
  await navegador?.close();
  servidor?.close();
});

interface Visita {
  mismoVisitante: boolean;
  bloqueos: string[];
}

/** Carga la página en `host` y hace tres peticiones a /api/d como haría un
 *  carrito: una que escribe y dos que leen. */
async function visitar(host: string): Promise<Visita> {
  const contexto = await navegador.createBrowserContext();
  try {
    const page = await contexto.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    const bloqueos: string[] = [];
    cdp.on("Network.responseReceivedExtraInfo", (e: { blockedCookies?: { blockedReasons: string[] }[] }) => {
      for (const b of e.blockedCookies ?? []) bloqueos.push(...b.blockedReasons);
    });

    await page.goto(`http://${host}:${puerto}/`, { waitUntil: "load" });
    await page.waitForFunction("window.__resultado", { timeout: 15_000 });
    const { r1, r2, r3 } = (await page.evaluate(
      "window.__resultado",
    )) as Record<"r1" | "r2" | "r3", { nuevo: boolean; visitante: string }>;

    return {
      mismoVisitante:
        !r2.nuevo && !r3.nuevo && r2.visitante === r1.visitante && r3.visitante === r1.visitante,
      bloqueos: [...new Set(bloqueos)],
    };
  } finally {
    await contexto.close();
  }
}

describe("la cookie del visitante en un navegador", () => {
  it("en un subdominio publicado es el mismo visitante en las tres peticiones", async () => {
    emitir = cabeceraDeVisitante;
    const visita = await visitar(SUBDOMINIO);
    expect(visita.bloqueos).toEqual([]);
    expect(visita.mismoVisitante).toBe(true);
  }, 60_000);

  it("🔴 y en un dominio propio TAMBIÉN", async () => {
    emitir = cabeceraDeVisitante;
    const visita = await visitar(DOMINIO_PROPIO);
    expect(visita.bloqueos).toEqual([]);
    expect(visita.mismoVisitante).toBe(true);
  }, 60_000);

  it("CONTRA-PRUEBA: la cabecera vieja, con Domain, Chrome la tira en el dominio propio", async () => {
    emitir = (valor) => cabeceraVieja(valor, "volcanica");
    const visita = await visitar(DOMINIO_PROPIO);
    expect(visita.bloqueos).toContain("InvalidDomain");
    expect(visita.mismoVisitante).toBe(false);
  }, 60_000);
});
