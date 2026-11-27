// THE LANGUAGE OF THE WINDOW (spec local 2026-11-26-apps-en-el-escritorio, §4.3): `/desktop/<id>` is outside the locale
// segment — its `scope` and `start_url` must not change with the language, or switching it would break the installed app —
// so its texts come from the NEXT_LOCALE cookie, then Accept-Language, then English. Pure.
import { routing } from "@/i18n/routing";

export type DesktopLocale = (typeof routing.locales)[number];

const isLocale = (v: string): v is DesktopLocale => (routing.locales as readonly string[]).includes(v);

export function desktopLocale(i: { readonly cookie: string | null | undefined; readonly acceptLanguage: string | null | undefined }): DesktopLocale {
  const cookie = (i.cookie ?? "").trim().toLowerCase();
  if (isLocale(cookie)) return cookie;
  const ranked = String(i.acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { language: tag.trim().toLowerCase().split("-")[0] ?? "", quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((c) => c.quality > 0 && isLocale(c.language))
    // By quality, and by the order they came in when equal.
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  const first = ranked[0]?.language;
  return first && isLocale(first) ? first : routing.defaultLocale;
}
