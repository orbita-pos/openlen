// lib/language/detect.ts — EL IDIOMA DE LO ESCRITO, sin red ni modelo: la
// escritura (japonés, coreano, chino), ¿¡ñ, y las palabras más corrientes de
// cada idioma de la interfaz. Nació en Len por correo (`lib/len-email/inbound.ts`,
// que lo reexporta); el chat lo usa para nombrar el idioma en que ESCRIBE el
// usuario (`lib/agent/user-language.ts`), y por eso dice también cuánta señal hay.
import type { IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

const STOPWORDS: Readonly<Record<Exclude<IdiomaDelCorreo, "ja" | "ko" | "zh">, readonly string[]>> = {
  es: ["que", "el", "la", "los", "las", "por", "para", "con", "una", "del", "pon", "cambia", "quita", "también", "página", "precio", "gracias"],
  pt: ["que", "não", "uma", "com", "para", "você", "mais", "também", "página", "obrigado", "coloca", "muda", "do", "da"],
  en: ["the", "and", "please", "with", "change", "add", "remove", "page", "price", "can", "you", "thanks", "make", "to"],
  fr: ["le", "les", "des", "une", "avec", "pour", "est", "pas", "merci", "change", "ajoute", "dans", "sur"],
  de: ["der", "die", "das", "und", "bitte", "mit", "nicht", "ist", "ein", "eine", "auf", "danke", "ändere"],
  it: ["il", "che", "per", "con", "una", "non", "della", "grazie", "cambia", "aggiungi", "anche", "sono"],
  nl: ["de", "het", "een", "en", "van", "niet", "met", "voor", "bedankt", "graag", "verander", "ook"],
};

/** Lo que vale una señal que no deja dudas (la escritura, ¿¡ñ). */
const CLARA = 10;

/** El idioma y cuánta señal lo sostiene (palabras que lo delatan), o `null`
 *  si nada lo delata («ok», «continua», un enlace). */
export function languageSignal(text: string): { readonly language: IdiomaDelCorreo; readonly points: number } | null {
  if (/[぀-ヿ]/.test(text)) return { language: "ja", points: CLARA };
  if (/[가-힯]/.test(text)) return { language: "ko", points: CLARA };
  if (/[一-鿿]/.test(text)) return { language: "zh", points: CLARA };
  if (/[¿¡ñ]/i.test(text)) return { language: "es", points: CLARA };
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let best: IdiomaDelCorreo | null = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS) as [IdiomaDelCorreo, readonly string[]][]) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best ? { language: best, points: bestScore } : null;
}

/** El idioma de lo escrito, para lo que dice el servidor (Len contesta en el
 *  que le hablen). Sin señal clara, inglés, como `idiomaDelCorreo`. */
export function detectLanguage(text: string): IdiomaDelCorreo {
  return languageSignal(text)?.language ?? "en";
}
