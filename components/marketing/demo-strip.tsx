import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { listTemplates } from "@/lib/templates/store";
import { TemplateCard } from "./template-card";

// Featured templates on the marketing landing page. One per family bucket
// so visitors see breadth at a glance — a polished creator hub (pier), a
// devtool marketing landing (mirror), and a premium editorial (manuscript).
// Order is intentional: pier first as the LCP card because it's the most
// visually striking. Full gallery is at /templates.
const FEATURED_IDS = ["pier", "mirror", "manuscript"] as const;

export async function DemoStrip() {
  const t = await getTranslations("marketing");
  // One query drives both the featured cards and the live template count.
  const all = await listTemplates();
  const byId = new Map(all.map((t) => [t.id, t]));
  const featured = FEATURED_IDS.flatMap((id) => {
    const t = byId.get(id);
    return t ? [t] : [];
  });
  const count = all.length;

  return (
    <section
      id="templates"
      className="relative border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-coral-700 dark:text-coral-400 mb-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-coral-500" />
              </span>
              {t("demoStrip.eyebrow", { count })}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t.rich("demoStrip.title", {
                br: () => <br className="sm:hidden" />,
                muted: (chunks) => (
                  <span className="text-zinc-500 dark:text-zinc-400">{chunks}</span>
                ),
              })}
            </h2>
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
            {t("demoStrip.description")}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
          {featured.map((t) => (
            // All three cards are above the fold on the marketing landing,
            // so they get eager loading + high fetchPriority. Without this
            // the 2nd/3rd cards' lazy-loaded thumbs sometimes lose the
            // load event race after hydration and stick on the shimmer.
            <TemplateCard key={t.id} template={t} priority />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center">
          <Link
            href="/templates"
            className="inline-flex items-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
          >
            {t("demoStrip.browseAll", { count })}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
