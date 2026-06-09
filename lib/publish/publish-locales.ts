// Locales a published page can be translated into (Speak Every Language).
// Client-safe: zero imports — the publish modal renders these as chips and
// the server validates against the same list. Mirrors the 10 app locales.

export interface PublishLocale {
  code: string;
  /** Native name — a proper noun, identical across UI languages. */
  name: string;
}

export const PUBLISH_LOCALES: readonly PublishLocale[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "nl", name: "Nederlands" },
] as const;

export function isPublishLocale(code: string): boolean {
  return PUBLISH_LOCALES.some((l) => l.code === code);
}

/** English names for the translator prompt — unambiguous for the model. */
export const LOCALE_ENGLISH_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Simplified Chinese",
  nl: "Dutch",
};
