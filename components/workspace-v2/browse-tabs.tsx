"use client";
import { useTranslations } from "next-intl";

/** Slim 2-tab bar for the Explorar surface: Plantillas (curated) · Comunidad (feed). */
export function BrowseTabs({
  active,
  onSelect,
}: {
  active: "templates" | "explore";
  onSelect: (v: "templates" | "explore") => void;
}) {
  const t = useTranslations("projects");
  const tab = (view: "templates" | "explore", label: string) => (
    <button
      type="button"
      onClick={() => onSelect(view)}
      className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition ${
        active === view
          ? "fg border-[color:var(--accent)]"
          : "fg-faint hover:fg border-transparent"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="shrink-0 flex items-center gap-1 px-6 sm:px-8 border-b bd bg-app">
      {tab("templates", t("nav.templates"))}
      {tab("explore", t("nav.community"))}
    </div>
  );
}
