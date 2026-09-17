// @vitest-environment node
//
// 🔴 LO QUE VE LA COMUNIDAD SALE DE LA COLUMNA, Y LA COLUMNA ESTÁ CONGELADA.
//
// `projects.deployUrl` se escribe UNA VEZ, al publicar, con el host de ese
// momento. Las filas sembradas/publicadas antes del corte del 2026-08-23
// llevan ahí `<sub>.openlen.com` para siempre. `lib/projects.ts` nunca se lo
// cree: deriva de `subdomain` con el host de HOY y sólo cae a la columna si no
// hay subdominio. El store de comunidad devolvía la columna cruda.
//
// MEDIDO en producción el 2026-09-17 en `openlen.com/es/explore`: las 24
// tarjetas traían `href="kira.openlen.com"` — y eso NO es el dominio viejo con
// un 308, es una URL RELATIVA. El navegador la resolvía contra la página
// actual (`https://openlen.com/es/kira.openlen.com`) y eso contesta 404
// «Page not found». El redirect del bloque `*.openlen.com` no llegaba a
// entrar. Las tarjetas no iban por la puerta vieja: no iban a ningún sitio.
//
// Derivar arregla las DOS cosas de un golpe, porque lo derivado trae esquema.
import { beforeEach, describe, expect, it, vi } from "vitest";

// El store arrastra el binding nativo de Rust por `@/lib/normalize` (y éste por
// `@/lib/html-engine`), que vitest no puede cargar. Nada de eso participa en
// leer filas, así que se apaga en la puerta.
vi.mock("@/lib/html-engine", () => ({
  normalizeBornCanonical: (h: string) => h,
  sanitizeForPublish: (h: string) => ({ html: h }),
  gateReservedMarker: () => {},
}));

type Fila = Record<string, unknown>;
const { filas } = vi.hoisted(() => ({ filas: { value: [] as Fila[] } }));

// Constructor encadenable. `orderBy` tiene que ser a la vez esperable (lo hacen
// `getPublicProfile` y `listOpenReports`) y portador de `.limit` (lo hace
// `listExplore`), así que devuelve una promesa con el método colgado.
function terminal() {
  const p = Promise.resolve(filas.value) as Promise<Fila[]> & {
    limit?: () => Promise<Fila[]>;
  };
  p.limit = () => Promise.resolve(filas.value);
  return p;
}
const constructor = {
  from: () => constructor,
  innerJoin: () => constructor,
  where: () => constructor,
  orderBy: () => terminal(),
};

vi.mock("@/lib/db", () => ({
  db: { select: () => constructor },
  schema: {
    projects: {
      id: "id",
      title: "title",
      thumbnailUrl: "thumbnailUrl",
      deployUrl: "deployUrl",
      subdomain: "subdomain",
      remixCount: "remixCount",
      listedAt: "listedAt",
      visibility: "visibility",
      status: "status",
      userId: "userId",
    },
    users: { id: "id", handle: "handle", avatarUrl: "avatarUrl" },
    pageReports: {
      id: "id",
      projectId: "projectId",
      reason: "reason",
      note: "note",
      createdAt: "createdAt",
      status: "status",
    },
  },
}));

vi.mock("./handle", () => ({
  getUserByHandle: async (handle: string) => ({
    id: "u1",
    handle,
    name: "Kira",
    bio: null,
    avatarUrl: null,
  }),
}));

import { listExplore, getPublicProfile, listOpenReports } from "./store";

// La fila tal y como está HOY en la base: publicada antes del corte de host, y
// con la columna guardada BARE — `publishProject` escribe `${sub}.${host}`, sin
// esquema (lib/projects.ts).
const filaLegado = (over: Fila = {}): Fila => ({
  id: "p1",
  title: "Kira",
  thumbnailUrl: null,
  deployUrl: "kira.openlen.com",
  subdomain: "kira",
  remixCount: 0,
  listedAt: new Date("2026-06-01T00:00:00Z"),
  handle: "kira",
  avatarUrl: null,
  ...over,
});

describe("el store de comunidad deriva el host, no se cree la columna", () => {
  beforeEach(() => {
    filas.value = [];
    vi.stubEnv("PUBLISH_BASE_HOST", "openlen.app");
  });

  it("listExplore: una fila con `.com` guardado sale al `.app` de hoy, absoluta", async () => {
    filas.value = [filaLegado()];
    const { items } = await listExplore({ sort: "recent" });
    expect(items[0].deployUrl).toBe("https://kira.openlen.app");
  });

  it("getPublicProfile: el perfil público deriva igual que Explore", async () => {
    filas.value = [filaLegado({ id: "p2", title: "Solstice", subdomain: "solstice-demo", deployUrl: "solstice-demo.openlen.com" })];
    const perfil = await getPublicProfile("kira");
    expect(perfil?.pages[0].deployUrl).toBe("https://solstice-demo.openlen.app");
  });

  it("listOpenReports: el enlace del panel de admin también", async () => {
    filas.value = [
      filaLegado({ projectId: "p1", reason: "spam", note: null, createdAt: new Date(), visibility: "public" }),
    ];
    const reports = await listOpenReports();
    expect(reports[0].deployUrl).toBe("https://kira.openlen.app");
  });

  // El único caso en que la columna manda: sin subdominio no hay nada que
  // derivar. Misma regla que `lib/projects.ts` (`derivado ?? row.deployUrl`),
  // y no un atajo — un dominio propio vive ahí y no se toca.
  it("sin subdominio cae a la columna, no a null", async () => {
    filas.value = [filaLegado({ subdomain: null, deployUrl: "https://midominio.com" })];
    const { items } = await listExplore({ sort: "recent" });
    expect(items[0].deployUrl).toBe("https://midominio.com");
  });

  // Y la deriva no puede volver por la puerta de atrás: si mañana el box mueve
  // PUBLISH_BASE_HOST, esto se mueve con él en vez de quedarse clavado.
  it("sigue al box, no a un literal", async () => {
    vi.stubEnv("PUBLISH_BASE_HOST", "openlen.test");
    filas.value = [filaLegado()];
    const { items } = await listExplore({ sort: "recent" });
    expect(items[0].deployUrl).toBe("https://kira.openlen.test");
  });
});
