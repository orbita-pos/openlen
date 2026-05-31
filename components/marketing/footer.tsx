"use client";

import { FileCode, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { GithubIcon, TwitterIcon } from "@/components/ui/brand-icons";
import { OpenLenMark } from "@/components/openlen-logo";

const REPO = "https://github.com/orbita-pos/openlen";
const LICENSE_URL = `${REPO}/blob/master/LICENSE`;

// Client component: it's rendered inside MarketingChrome ("use client"), so it
// must use the client useTranslations hook, not the server getTranslations.
// Internal links use the next-intl Link so the active locale prefix is kept.
export function Footer() {
  const t = useTranslations("marketing");

  const columns: {
    title: string;
    links: { label: string; href: string; external?: boolean }[];
  }[] = [
    {
      title: t("footer.product.title"),
      links: [
        { label: t("footer.product.features"), href: "/#features" },
        { label: t("footer.product.pricing"), href: "/#pricing" },
      ],
    },
    {
      title: t("footer.openSource.title"),
      links: [
        { label: "GitHub", href: REPO, external: true },
        { label: t("footer.openSource.agplLicense"), href: LICENSE_URL, external: true },
      ],
    },
    {
      title: t("footer.company.title"),
      links: [
        { label: t("footer.company.blog"), href: "/blog" },
        { label: t("footer.company.privacy"), href: "/privacy" },
        { label: t("footer.company.terms"), href: "/terms" },
        { label: t("footer.company.contact"), href: "/support" },
      ],
    },
    {
      title: t("footer.legal.title"),
      links: [
        { label: t("footer.legal.cookies"), href: "/cookie-policy" },
        { label: t("footer.legal.acceptableUse"), href: "/acceptable-use" },
        { label: t("footer.legal.refunds"), href: "/refund" },
        { label: t("footer.legal.subprocessors"), href: "/subprocessors" },
        { label: t("footer.legal.docs"), href: "/docs" },
      ],
    },
  ];

  const linkClass =
    "text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors";
  const iconClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition";

  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-10">
          <div className="col-span-2 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 group">
              <OpenLenMark className="h-6 w-6 shrink-0" />
              <span className="font-semibold tracking-tight">
                Open<span className="text-coral-700 dark:text-coral-400">Len</span>
              </span>
            </Link>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
              {t("footer.tagline")}
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                aria-label={t("footer.githubAria")}
                className={iconClass}
              >
                <GithubIcon size={15} />
              </a>
              <a
                href="https://twitter.com"
                aria-label={t("footer.twitterAria")}
                className={iconClass}
              >
                <TwitterIcon size={15} />
              </a>
              <Link href="/docs" aria-label={t("footer.docsAria")} className={iconClass}>
                <FileCode size={15} />
              </Link>
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {col.title}
              </div>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className={linkClass}>
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className={linkClass}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 pt-6 border-t border-zinc-100 dark:border-zinc-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>© 2026 OpenLen</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1.5"
            >
              <ShieldCheck size={12} /> {t("footer.licensed")}
            </a>
            <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">·</span>
            <span className="hidden sm:inline">
              {t("footer.builtWith")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            {t("footer.operational")}
          </div>
        </div>
      </div>
    </footer>
  );
}
