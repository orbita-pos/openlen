// EL BUCKET QUE NUNCA SE USÓ — 2026-08-30.
//
// Este módulo leía `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y
// `S3_PUBLIC_URL_BASE`. El servidor de producción no tiene ni una: tiene
// `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET` y
// `R2_PUBLIC_URL` — los mismos que `lib/storage/index.ts` usa desde siempre
// para elegir R2. Dos juegos de nombres para el MISMO bucket.
//
// Consecuencia medida: ninguna subida de usuario llegó nunca a R2. Todas a
// disco local, y de ahí la URL se resuelve contra `req.url`, que detrás de
// Caddy es `127.0.0.1:3000`. Siete proyectos publicados con un
// `localhost:3000/api/projects/…/assets/…` dentro — la foto del dueño rota
// para cualquiera que no fuese él, y el fallo es MUDO: sube bien, guarda bien,
// y sólo no carga.
//
// Lo que esto vigila no es el código, es la CORRESPONDENCIA con lo que el box
// tiene puesto. Por eso los nombres van escritos a mano aquí: si alguien
// renombra una variable, esta prueba cae — que es justo lo que no pasó.
import { beforeEach, describe, expect, it, vi } from "vitest";

const R2_DEL_BOX = {
  R2_ACCOUNT_ID: "cuenta123",
  R2_ACCESS_KEY: "llave",
  R2_SECRET_KEY: "secreto",
  R2_BUCKET: "openlen-uploads",
  R2_PUBLIC_URL: "https://uploads.openlen.com",
};

const S3_VARS = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_PUBLIC_URL_BASE",
  "S3_REGION",
  "S3_ENDPOINT",
];

/** Import fresco: la fábrica cachea su elección al primer uso. */
async function almacenCon(env: Record<string, string>) {
  vi.resetModules();
  for (const k of S3_VARS) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(R2_DEL_BOX)) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const mod = await import("./assets");
  return mod.getAssetStorage();
}

describe("el almacén de subidas encuentra la nube", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("🔴 con las R2_* del servidor elige la NUBE, no el disco", async () => {
    const s = await almacenCon(R2_DEL_BOX);
    expect(s.constructor.name).toBe("S3AssetStorage");
  });

  it("y con las S3_* de siempre también — no se le rompe a quien ya las tenía", async () => {
    const s = await almacenCon({
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_PUBLIC_URL_BASE: "https://cdn.ejemplo.test",
    });
    expect(s.constructor.name).toBe("S3AssetStorage");
  });

  // BRAZO DE CONTROL. Sin esto, «devuelve siempre la nube» pasaría las dos de
  // arriba — y en desarrollo, donde no hay credenciales, el disco local es LO
  // CORRECTO: es lo que hace que un clon nuevo arranque sin configurar nada.
  it("pero sin credenciales sigue siendo el disco local", async () => {
    const s = await almacenCon({});
    expect(s.constructor.name).toBe("LocalFsAssetStorage");
  });

  // Las credenciales a medias son el caso que de verdad se da: alguien pone la
  // cuenta y olvida el secreto. Elegir la nube ahí reventaría en cada subida.
  it("ni con las R2_* a medias", async () => {
    const s = await almacenCon({ R2_ACCOUNT_ID: "cuenta123", R2_ACCESS_KEY: "llave" });
    expect(s.constructor.name).toBe("LocalFsAssetStorage");
  });
});
