// LAS FOTOS DEL DUEÑO VIAJAN DENTRO DEL DOCUMENTO QUE SE VA A MIRAR.
//
// Cuando algo nuestro renderiza la página del usuario para juzgarla, instala un
// guardia SSRF que corta loopback — y hace bien. Pero en desarrollo no hay
// almacenamiento en la nube, así que NUESTRO subidor devuelve URLs de
// `localhost`: el guardia las corta, la captura sale con un hueco, y quien mira
// no puede distinguir ese hueco de una imagen rota de verdad.
//
// El 2026-08-27 eso acabó con el Agente borrándole a Jesús una foto que él mismo
// había adjuntado. Aquí no hay petición que cortar: los bytes salen del
// almacenamiento y viajan como `data:`.
import { afterEach, describe, expect, it, vi } from "vitest";

import { inlineOwnAssets } from "./inline-own-assets";

const BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EN_DATA = `data:image/png;base64,${BYTES.toString("base64")}`;

/** Un almacenamiento de mentira. `get` devuelve bytes para lo que se le diga y
 *  `null` para lo demás — que es el caso de fail-soft. */
function conAlmacen(archivos: Record<string, Buffer | null>) {
  const get = vi.fn(async (projectId: string, filename: string) => {
    const b = archivos[`${projectId}/${filename}`];
    return b ? { contents: b, contentType: "image/png" } : null;
  });
  vi.doMock("@/lib/projects/assets", () => ({ getAssetStorage: () => ({ get }) }));
  return { get };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/projects/assets");
});

/** El módulo se re-importa tras el mock: el import de `assets` es perezoso, así
 *  que hay que rehacerlo para que vea el doble. */
async function inlinear(html: string): Promise<string> {
  const mod = await import("./inline-own-assets");
  return mod.inlineOwnAssets(html);
}

describe("las subidas del propio dueño", () => {
  it("se convierten en data:, así no hay petición que el guardia pueda cortar", async () => {
    conAlmacen({ "p1/casa.png": BYTES });
    const html = '<img src="http://localhost:3000/api/projects/p1/assets/casa.png" alt="casa">';
    const r = await inlinear(html);
    expect(r).toContain(EN_DATA);
    expect(r).not.toContain("localhost:3000");
    // Lo demás del atributo se queda como estaba.
    expect(r).toContain('alt="casa"');
  });

  it("da igual el host: se reconocen por la RUTA", async () => {
    conAlmacen({ "p1/casa.png": BYTES });
    // Una instalación autoalojada con su propio dominio.
    const r = await inlinear(
      '<img src="https://mi-openlen.example.com/api/projects/p1/assets/casa.png">',
    );
    expect(r).toContain(EN_DATA);
  });

  it("y una ruta relativa también", async () => {
    conAlmacen({ "p1/casa.png": BYTES });
    const r = await inlinear('<img src="/api/projects/p1/assets/casa.png">');
    expect(r).toContain(EN_DATA);
  });

  it("también dentro de un url() de CSS en línea", async () => {
    conAlmacen({ "p1/fondo.png": BYTES });
    const r = await inlinear(
      '<div style="background-image:url(\'/api/projects/p1/assets/fondo.png\')"></div>',
    );
    expect(r).toContain(EN_DATA);
  });

  it("la misma imagen repetida se lee UNA vez", async () => {
    const { get } = conAlmacen({ "p1/casa.png": BYTES });
    const uno = '<img src="/api/projects/p1/assets/casa.png">';
    const r = await inlinear(uno + uno + uno);
    expect(get).toHaveBeenCalledTimes(1);
    expect(r.split("data:image/png").length - 1).toBe(3);
  });
});

describe("lo que NO se toca", () => {
  it("una URL ajena, una del catálogo y un data: que ya lo era", async () => {
    conAlmacen({});
    const html =
      '<img src="https://images.unsplash.com/photo-1">' +
      '<img src="https://evil.example.com/x.png">' +
      '<img src="data:image/png;base64,AAAA">';
    expect(await inlinear(html)).toBe(html);
  });

  /**
   * FAIL-SOFT. Este paso sólo puede mejorar un render, jamás impedirlo: si el
   * almacenamiento no tiene el fichero —o no responde— la página se mira como
   * se miraba ayer, con su hueco. Lo contrario sería cambiar «una foto que no
   * se ve» por «no se verifica nada».
   */
  it("un fichero que no existe deja el <img> intacto", async () => {
    conAlmacen({ "p1/otra.png": BYTES });
    const html = '<img src="/api/projects/p1/assets/nohay.png">';
    expect(await inlinear(html)).toBe(html);
  });

  it("y si el almacenamiento lanza, tampoco pasa nada", async () => {
    vi.doMock("@/lib/projects/assets", () => ({
      getAssetStorage: () => ({
        get: async () => {
          throw new Error("almacenamiento caído");
        },
      }),
    }));
    const html = '<img src="/api/projects/p1/assets/casa.png">';
    expect(await inlinear(html)).toBe(html);
  });

  /**
   * EL CASO NORMAL, y el que importa que sea barato: en producción las subidas
   * salen por `images.openlen.com` y no entran aquí, así que la inmensa mayoría
   * de páginas no tienen ninguna subida propia. Ni siquiera se toca el
   * almacenamiento.
   */
  it("una página sin subidas propias ni abre el almacenamiento", async () => {
    const { get } = conAlmacen({ "p1/casa.png": BYTES });
    const html = '<img src="https://images.openlen.com/foto.webp"><h1>Hola</h1>';
    expect(await inlinear(html)).toBe(html);
    expect(get).not.toHaveBeenCalled();
  });

  it("y una cadena vacía se devuelve tal cual", async () => {
    conAlmacen({});
    expect(await inlinear("")).toBe("");
  });
});

// El import estático se usa para que el fichero no compile con la función sin
// existir; las pruebas van por el dinámico, que es el que ve el doble.
void inlineOwnAssets;
