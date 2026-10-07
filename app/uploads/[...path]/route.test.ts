// @vitest-environment node
//
// LAS FOTOS SUBIDAS SIN R2, con `next start`. El almacén de ficheros escribe en
// `public/uploads/`, pero Next sólo sirve lo que había en `public/` al hacer el
// build: en el ensayo de caja de crear-es-len (06/10) las miniaturas del chat y
// las fotos de la página salían rotas. Esta ruta sirve lo que llegó después.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "uploads-"));
  mkdirSync(join(raiz, "proj"), { recursive: true });
  writeFileSync(join(raiz, "proj", "foto_640w.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  writeFileSync(join(raiz, "proj", "malo.svg"), "<svg onload=alert(1)>");
  vi.stubEnv("UPLOADS_DIR", raiz);
  vi.stubEnv("R2_ACCOUNT_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

const pide = (...path: string[]) =>
  GET(new Request(`http://localhost:3007/uploads/${path.join("/")}`), { params: Promise.resolve({ path }) });

describe("/uploads/… sin R2", () => {
  it("🔴 sirve una foto que se subió después del build, con su tipo y nosniff", async () => {
    const res = await pide("proj", "foto_640w.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it("🔴 un SVG no se sirve: en el origen de la app podría correr script", async () => {
    expect((await pide("proj", "malo.svg")).status).toBe(404);
  });

  it("🔴 no sale de la carpeta", async () => {
    expect((await pide("..", "..", "etc", "passwd.jpg")).status).toBe(404);
    expect((await pide("proj", "..", "..", "x.jpg")).status).toBe(404);
  });

  it("lo que no existe es 404", async () => {
    expect((await pide("proj", "no-esta.jpg")).status).toBe(404);
  });

  it("BRAZO DE CONTROL: con R2, la ruta no sirve nada (las fotos están en R2)", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "a");
    vi.stubEnv("R2_ACCESS_KEY", "b");
    vi.stubEnv("R2_SECRET_KEY", "c");
    expect((await pide("proj", "foto_640w.jpg")).status).toBe(404);
  });
});
