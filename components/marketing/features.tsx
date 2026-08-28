import { Globe, Heart, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/ui/brand-icons";
import { countTemplates, listTemplates } from "@/lib/templates/store";

/* Each bento cell pairs the i18n title/body with a real product artifact —
   live template thumbnails, a drawn analytics panel, the published-page
   address bar, the actual repo layout — instead of an icon on a card. */

const CELL =
  "group relative overflow-hidden rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm p-7 sm:p-8 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-coral-950/[0.07] dark:hover:shadow-black/30";

function CellText({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h3 className="mt-6 text-[16px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {body}
      </p>
    </>
  );
}

export async function Features() {
  const t = await getTranslations("marketing");
  const [templateCount, allTemplates] = await Promise.all([
    countTemplates().catch(() => 0),
    listTemplates().catch(() => []),
  ]);
  // Real gallery artwork for the templates cell — featured first, then any
  // template that already has a thumbnail.
  const minis = [...allTemplates]
    .filter((tpl) => tpl.thumbnailUrl)
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, 4);

  return (
    <section id="features" className="relative scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge tone="coral">
            <Heart size={11} /> {t("features.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.08]">
            {t.rich("features.title", {
              muted: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-500 via-coral-600 to-rose-500 bg-clip-text text-transparent pr-[0.04em]">
                  {chunks}
                </span>
              ),
            })}
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* Templates — real gallery thumbnails, fanned. */}
          <div className={`${CELL} lg:col-span-3`}>
            <div className="flex gap-3">
              {minis.map((tpl, i) => (
                <div
                  key={tpl.id}
                  className={`relative h-40 flex-1 overflow-hidden rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/10 bg-zinc-100 dark:bg-zinc-900 transition-transform duration-300 group-hover:rotate-0 ${
                    i % 2 === 0 ? "rotate-[-1.2deg]" : "rotate-[1.2deg]"
                  } ${i === 3 ? "hidden sm:block" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tpl.tileUrl ?? tpl.thumbnailUrl ?? ""}
                    alt={tpl.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover object-top"
                  />
                  <span
                    className="absolute bottom-1.5 left-1.5 h-2 w-2 rounded-full ring-2 ring-white/80"
                    style={{ background: tpl.accent }}
                    aria-hidden
                  />
                </div>
              ))}
            </div>
            <CellText
              title={t("features.items.templates.title", { count: templateCount })}
              /* El «30 hubs link-in-bio» estaba CABLEADO en la copia mientras
                 el contador de creator-showcase.tsx ya era dinámico y decía
                 38: la página se contradecía sola. Ahora sale de la misma
                 lista que el resto. */
              body={t("features.items.templates.body", {
                creators: allTemplates.filter((tpl) => tpl.family === "creator").length,
              })}
            />
          </div>

          {/* Analytics — drawn week of traffic + country split. */}
          <div className={`${CELL} lg:col-span-2`}>
            <div className="rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/10 bg-white dark:bg-zinc-950/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[22px] font-semibold tracking-tight tabular-nums">
                  1,284
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  live
                </span>
              </div>
              <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden>
                {[34, 52, 41, 68, 57, 84, 100].map((h, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm ${
                      i === 6
                        ? "bg-gradient-to-t from-coral-600 to-coral-400"
                        : "bg-coral-500/25 dark:bg-coral-400/20"
                    }`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="mt-3 space-y-1.5" aria-hidden>
                {[
                  ["MX", 46],
                  ["US", 31],
                  ["ES", 14],
                ].map(([cc, pct]) => (
                  <div key={cc} className="flex items-center gap-2">
                    <span className="w-6 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      {cc}
                    </span>
                    <div className="h-1 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-1 rounded-full bg-coral-500/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[10px] tabular-nums text-zinc-400">
                      {pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <CellText
              title={t("features.items.analytics.title")}
              body={t("features.items.analytics.body")}
            />
          </div>

          {/* Your HTML — the published page's address bar + markup. */}
          <div className={`${CELL} lg:col-span-2`}>
            <div className="rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/10 bg-white dark:bg-zinc-950/60 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-white/[0.06] px-3.5 py-2.5">
                <span className="flex gap-1" aria-hidden>
                  <span className="h-2 w-2 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                  <span className="h-2 w-2 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                  <span className="h-2 w-2 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  <Lock size={9} className="text-emerald-500" />
                  margot<span className="text-coral-600 dark:text-coral-400">.openlen.com</span>
                </span>
              </div>
              <pre
                className="px-4 py-3 font-mono text-[11px] leading-[1.7] text-zinc-500 dark:text-zinc-400 overflow-hidden"
                aria-hidden
              >
                <span className="text-zinc-400 dark:text-zinc-600">&lt;</span>
                <span className="text-coral-600 dark:text-coral-400">section</span>{" "}
                <span className="text-violet-500">class</span>
                <span className="text-zinc-400 dark:text-zinc-600">=&quot;hero&quot;&gt;</span>
                {"\n"}
                {"  "}
                <span className="text-zinc-400 dark:text-zinc-600">&lt;</span>
                <span className="text-coral-600 dark:text-coral-400">h1</span>
                <span className="text-zinc-400 dark:text-zinc-600">&gt;</span>
                Margot Rey
                <span className="text-zinc-400 dark:text-zinc-600">&lt;/</span>
                <span className="text-coral-600 dark:text-coral-400">h1</span>
                <span className="text-zinc-400 dark:text-zinc-600">&gt;</span>
                {"\n"}
                <span className="text-zinc-400 dark:text-zinc-600">&lt;/</span>
                <span className="text-coral-600 dark:text-coral-400">section</span>
                <span className="text-zinc-400 dark:text-zinc-600">&gt;</span>
              </pre>
            </div>
            <CellText
              title={t("features.items.ownHtml.title")}
              body={t("features.items.ownHtml.body")}
            />
          </div>

          {/* Open source — the actual repo, clonable. */}
          <div className={`${CELL} lg:col-span-3`}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/10 bg-white dark:bg-zinc-950/60 px-4 py-3 font-mono text-[11.5px] leading-[1.9] text-zinc-600 dark:text-zinc-400">
                <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                  <GithubIcon size={12} />
                  orbita-pos/openlen
                </div>
                <div aria-hidden>
                  <span className="text-coral-600 dark:text-coral-400">$</span> git
                  clone github.com/orbita-pos/openlen
                  {"\n"}
                </div>
                <div className="text-zinc-400 dark:text-zinc-500" aria-hidden>
                  generator/ · editor/ · publish/ · analytics/
                </div>
              </div>
              <div className="flex sm:flex-col gap-2" aria-hidden>
                <span className="inline-flex items-center justify-center rounded-full bg-coral-500/10 px-3 py-1.5 text-[11px] font-semibold text-coral-700 dark:text-coral-300">
                  AGPLv3
                </span>
                <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  <Globe size={10} />
                  self-host
                </span>
              </div>
            </div>
            <CellText
              title={t("features.items.openSource.title")}
              body={t("features.items.openSource.body")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
