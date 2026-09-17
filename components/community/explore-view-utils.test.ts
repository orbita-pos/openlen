import { describe, expect, it } from "vitest";
import { appendExplorePage, liveUrlFor } from "./explore-view-utils";

// 🔴 UN `deployUrl` SIN ESQUEMA DENTRO DE UN `href` NO ES UN ENLACE AL DOMINIO
// VIEJO: ES UNA RUTA RELATIVA.
//
// `projects.deployUrl` se guarda BARE al publicar (`${sub}.${host}`), y el
// `href` de la tarjeta lo tomaba tal cual. El navegador lo resolvía contra la
// página actual. MEDIDO en producción el 2026-09-17: `/es/explore` daba
// `href="kira.openlen.com"` → `https://openlen.com/es/kira.openlen.com` → 404
// «Page not found». Las 24 tarjetas estaban muertas.
//
// El arreglo de verdad está antes, en el store (que ahora deriva y devuelve
// absoluta). Esto es el cinturón para la fila sin subdominio, donde no hay nada
// que derivar y la columna cruda sigue mandando — y vive en UNA función porque
// `explore-view.tsx` ya tenía esta lógica y `explore-card.tsx` no: la misma
// tarjeta contestaba distinto según por qué puerta se entrara.
describe("liveUrlFor", () => {
  it("una bare se vuelve absoluta, o el href sería relativo y daría 404", () => {
    expect(liveUrlFor("kira.openlen.com")).toBe("https://kira.openlen.com");
  });

  it("una absoluta se respeta tal cual (es lo que devuelve el store ya)", () => {
    expect(liveUrlFor("https://kira.openlen.app")).toBe("https://kira.openlen.app");
  });

  it("http vale: un dominio propio sin TLS todavía", () => {
    expect(liveUrlFor("http://midominio.test")).toBe("http://midominio.test");
  });

  it("sin nada devuelve undefined, no cadena vacía", () => {
    expect(liveUrlFor(null)).toBeUndefined();
    expect(liveUrlFor("")).toBeUndefined();
  });
});

describe("appendExplorePage", () => {
  it("appends new items and dedupes by id", () => {
    const a = [{ id: "1" }, { id: "2" }] as any;
    const b = [{ id: "2" }, { id: "3" }] as any;
    expect(appendExplorePage(a, b).map((x: any) => x.id)).toEqual(["1", "2", "3"]);
  });
  it("returns the page as-is when the accumulator is empty", () => {
    const b = [{ id: "1" }] as any;
    expect(appendExplorePage([], b)).toEqual(b);
  });
});
