import {
  BarChart3,
  Code,
  Heart,
  LayoutGrid,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { countTemplates } from "@/lib/templates/store";

interface FeatureItem {
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string;
}

const items: FeatureItem[] = [
  {
    icon: LayoutGrid,
    titleKey: "features.items.templates.title",
    bodyKey: "features.items.templates.body",
  },
  {
    icon: BarChart3,
    titleKey: "features.items.analytics.title",
    bodyKey: "features.items.analytics.body",
  },
  {
    icon: Code,
    titleKey: "features.items.ownHtml.title",
    bodyKey: "features.items.ownHtml.body",
  },
  {
    icon: Unlock,
    titleKey: "features.items.openSource.title",
    bodyKey: "features.items.openSource.body",
  },
];

export async function Features() {
  const t = await getTranslations("marketing");
  const templateCount = await countTemplates().catch(() => 0);
  return (
    <section id="features" className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge tone="coral">
            <Heart size={11} /> {t("features.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
            {t.rich("features.title", {
              muted: (chunks) => (
                <span className="text-zinc-500 dark:text-zinc-400">{chunks}</span>
              ),
            })}
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-zinc-200 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-800 rounded-2xl overflow-hidden">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.titleKey}
                className="group relative bg-white dark:bg-[#0a0a0a] p-7 sm:p-8 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-950"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-400 ring-1 ring-coral-200/60 dark:ring-coral-500/20">
                  <Icon size={18} strokeWidth={2} />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
                  {t(it.titleKey, { count: templateCount })}
                </h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {t(it.bodyKey)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
