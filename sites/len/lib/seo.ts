import type { Lang } from "@/i18n";

export const SITE = "https://len.openlen.com";
export const REPO = "https://github.com/orbita-pos/openlen";

/** `ruta` sin idioma y con barra final: "/", "/research/", "/research/<slug>/". */
export function alternates(ruta: string, lang: Lang) {
  return {
    canonical: `${SITE}/${lang}${ruta}`,
    languages: { en: `${SITE}/en${ruta}`, es: `${SITE}/es${ruta}`, "x-default": `${SITE}/en${ruta}` },
  };
}
