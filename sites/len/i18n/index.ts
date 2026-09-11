import { en } from "./en";
import { es } from "./es";

export const LANGS = ["en", "es"] as const;
export type Lang = (typeof LANGS)[number];
export type Diccionario = typeof es;

const DICS: Record<Lang, Diccionario> = { en, es };

export function isLang(x: string): x is Lang {
  return (LANGS as readonly string[]).includes(x);
}

export function dic(lang: Lang): Diccionario {
  return DICS[lang];
}

/** "2026-08-22" a «22 de agosto de 2026» / "August 22, 2026". En UTC: la fecha no baila con la zona. */
export function fecha(iso: string, lang: Lang): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
