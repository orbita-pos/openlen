// @vitest-environment node
//
// La misma puerta que `lib/collections/i18n-parity.test.ts`, sobre la pantalla
// de «Mi negocio»: cada locale tiene que llevar LAS MISMAS hojas que `en`.
//
// POR QUÉ AQUÍ Y AHORA. La tarjeta del expediente se añadió el 2026-08-27 a los
// diez ficheros a mano. Sin esta puerta, olvidarse de uno no falla nada: la
// pantalla se pinta con `miNegocio.memoria.title` en crudo, en el idioma de
// alguien que no soy yo, y nadie se entera hasta que ese alguien lo enseña.
import { describe, expect, it } from "vitest";
import en from "../../messages/en/miNegocio.json";
import es from "../../messages/es/miNegocio.json";
import pt from "../../messages/pt/miNegocio.json";
import fr from "../../messages/fr/miNegocio.json";
import de from "../../messages/de/miNegocio.json";
import itLocale from "../../messages/it/miNegocio.json";
import ja from "../../messages/ja/miNegocio.json";
import ko from "../../messages/ko/miNegocio.json";
import zh from "../../messages/zh/miNegocio.json";
import nl from "../../messages/nl/miNegocio.json";

type Tree = { [k: string]: string | Tree };

function leafKeys(obj: Tree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") out.push(...leafKeys(v as Tree, `${prefix}${k}.`));
    else out.push(`${prefix}${k}`);
  }
  return out.sort();
}

const LOCALES: Record<string, Tree> = { en, es, pt, fr, de, it: itLocale, ja, ko, zh, nl };

describe("miNegocio i18n parity", () => {
  const enKeys = leafKeys(en as Tree);

  it("en trae un juego de claves no trivial", () => {
    expect(enKeys.length).toBeGreaterThan(30);
  });

  for (const [loc, msgs] of Object.entries(LOCALES)) {
    it(`${loc} lleva las mismas hojas que en`, () => {
      expect(leafKeys(msgs)).toEqual(enKeys);
    });
  }

  /**
   * Y ninguna vacía. Una cadena en blanco pasa la paridad de claves —está la
   * hoja— y en pantalla deja un botón sin texto, que es peor que la clave en
   * crudo: al menos la clave se ve y se reporta.
   */
  for (const [loc, msgs] of Object.entries(LOCALES)) {
    it(`${loc} no deja ninguna cadena vacía`, () => {
      const vacias: string[] = [];
      const recorrer = (o: Tree, p = "") => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") recorrer(v as Tree, `${p}${k}.`);
          else if (!String(v).trim()) vacias.push(`${p}${k}`);
        }
      };
      recorrer(msgs);
      expect(vacias).toEqual([]);
    });
  }
});
