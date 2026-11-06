"use client";

// THE HOME'S FOOTER (spec local 2026-11-06-portada-solo-input): one quiet row at the bottom of the only screen, so the
// legal links stay one click away from the home. The big `Footer` stays on every other page.

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { REPO } from "./footer";

export function HomeFooter() {
  const t = useTranslations("marketing");
  const linkClass = "hover:text-zinc-100 transition-colors";
  return (
    <footer data-home-footer className="relative z-10 px-6 pb-5 pt-2">
      <div className="mx-auto flex max-w-[88rem] flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12.5px] text-zinc-400">
        <span>© 2026 OpenLen</span>
        <Link href="/privacy" className={linkClass}>
          {t("footer.company.privacy")}
        </Link>
        <Link href="/terms" className={linkClass}>
          {t("footer.company.terms")}
        </Link>
        <Link href="/docs" className={linkClass}>
          {t("footer.legal.docs")}
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer" className={linkClass}>
          GitHub
        </a>
        <LocaleSwitcher />
      </div>
    </footer>
  );
}
