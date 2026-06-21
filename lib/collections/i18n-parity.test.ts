// @vitest-environment node
// Parity gate: every collections.json locale must carry the SAME leaf keys as
// en, so no UI string falls back / shows a raw key in any of the 10 locales.
import { describe, expect, it } from "vitest";
import en from "../../messages/en/collections.json";
import es from "../../messages/es/collections.json";
import pt from "../../messages/pt/collections.json";
import fr from "../../messages/fr/collections.json";
import de from "../../messages/de/collections.json";
import itLocale from "../../messages/it/collections.json";
import ja from "../../messages/ja/collections.json";
import ko from "../../messages/ko/collections.json";
import zh from "../../messages/zh/collections.json";
import nl from "../../messages/nl/collections.json";

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

describe("collections i18n parity", () => {
  const enKeys = leafKeys(en as Tree);

  it("en has a non-trivial key set", () => {
    expect(enKeys.length).toBeGreaterThan(30);
  });

  for (const [loc, msgs] of Object.entries(LOCALES)) {
    it(`${loc} has the same leaf keys as en`, () => {
      expect(leafKeys(msgs)).toEqual(enKeys);
    });
  }
});
