import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { GET } from "./route";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const HOST = "lienzo-4f9c10cb878148f1b291c5d146579f09.openlen.app";
const OTRO = "lienzo-00000000000000000000000000000000.openlen.app";

const pide = (docId: string, host: string) =>
  GET(new Request(`https://${host}/api/lienzo/${docId}`, { headers: { host } }), {
    params: Promise.resolve({ docId }),
  });

let docId = "";
beforeEach(() => {
  vi.unstubAllEnvs();
  vaciarAlmacenParaPruebas();
  docId = guardarDocumento({ html: "<!doctype html><p>vista</p>", projectId: ID, userId: "u1", pagina: null });
});

describe("GET /api/lienzo/[docId]", () => {
  it("sirve el documento en su host, con las cabeceras del lienzo", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
    const res = await pide(docId, HOST);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>vista</p>");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://openlen.com");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  // ⚠️ ESTAS DOS NO FIJAN LA GUARDA DE FORMATO, y no pueden: `openlen.com` y
  // `localhost:3007` caerían igual por la rama «la etiqueta no coincide con el
  // proyecto» aunque `etiquetaDelHost` devolviera la primera etiqueta sin
  // comprobar su forma. A nivel de ruta esa guarda es redundante de verdad —es
  // defensa en profundidad—, y quien la fija es `lib/lienzo/host.test.ts`, que
  // la ejerce directamente (formato malo, etiqueta sin punto, mayúsculas).
  // Dicho aquí para que nadie intente «reforzar» esto con una aserción que no
  // puede discriminar. Lo que estas dos SÍ fijan es lo que importa: en el host
  // de la app, este documento no se sirve.
  it("🔴 404 en el host de la APP — servirlo ahí sería el agujero de la auditoría", async () => {
    expect((await pide(docId, "openlen.com")).status).toBe(404);
    expect((await pide(docId, "localhost:3007")).status).toBe(404);
  });

  it("404 en una página publicada y en el lienzo de OTRO proyecto", async () => {
    expect((await pide(docId, "marea.openlen.app")).status).toBe(404);
    expect((await pide(docId, OTRO)).status).toBe(404);
  });

  it("404 con un id desconocido — la misma respuesta que los demás", async () => {
    const res = await pide("no-existe", HOST);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("en desarrollo, frame-ancestors deja entrar a localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await pide(docId, "lienzo-4f9c10cb878148f1b291c5d146579f09.localhost:3007");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("http://localhost:*");
  });
});
