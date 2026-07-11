import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { listTemplates, type TemplateRecord } from "@/lib/templates/store";
import { WallTile } from "./wall-tile";

// Edge-to-edge template wall: real template previews, full-bleed under the
// hero. Reuses the `demoStrip.*` i18n keys (eyebrow / title / browseAll) →
// zero translation churn.
//
// Every tile is the COMPLETE 16:10 fold (`thumbnailUrl` is captured at
// 1280×800, so aspect-[16/10] shows it uncropped and sharp). On hover the
// crisp fold cross-fades into the full-page `tileUrl` underneath, whose
// object-position animates top → bottom: the card slow-scrolls through the
// whole page without JS. Reduced motion keeps the static fold.

const MAX_TILES = 20;

function selectTiles(all: TemplateRecord[], max: number): TemplateRecord[] {
  const pool = all.filter((t) => t.thumbnailUrl);
  const featured = pool.filter((t) => t.featured);
  const rest = pool.filter((t) => !t.featured);

  const byFamily = new Map<string, TemplateRecord[]>();
  for (const t of rest) {
    const arr = byFamily.get(t.family) ?? [];
    arr.push(t);
    byFamily.set(t.family, arr);
  }
  const families = [...byFamily.keys()];
  const interleaved: TemplateRecord[] = [];
  for (let i = 0, added = true; added; i++) {
    added = false;
    for (const fam of families) {
      const next = byFamily.get(fam)?.[i];
      if (next) {
        interleaved.push(next);
        added = true;
      }
    }
  }
  return [...featured, ...interleaved].slice(0, max);
}

export async function MosaicWall() {
  const t = await getTranslations("marketing");
  const tf = await getTranslations("families");
  const all = await listTemplates();
  const count = all.length;
  const tiles = selectTiles(all, MAX_TILES);

  if (tiles.length === 0) return null;

  return (
    <section
      id="templates"
      className="relative border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-[#070707]"
    >
      <div className="mx-auto max-w-6xl px-6 pt-16 sm:pt-20 pb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
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
                  <span className="serif-accent bg-gradient-to-br from-coral-500 via-coral-600 to-rose-500 bg-clip-text text-transparent pr-[0.04em]">
                    {chunks}
                  </span>
                ),
              })}
            </h2>
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
            {t("demoStrip.description")}
          </div>
        </div>
      </div>

      {/* Full-bleed wall — only thin side gutters, not the max-w container. */}
      <div className="relative px-3 sm:px-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {tiles.map((tpl) => {
            if (!tpl.thumbnailUrl) return null;
            return (
              <WallTile
                key={tpl.id}
                id={tpl.id}
                name={tpl.name}
                familyLabel={tf(`${tpl.family}.label`)}
                previewAlt={t("templateCard.previewAlt", { name: tpl.name })}
                featuredLabel={tpl.featured ? t("templateCard.featured") : null}
                thumbnailUrl={tpl.thumbnailUrl}
                tileUrl={tpl.tileUrl}
              />
            );
          })}
        </div>
        {/* Soft bottom fade so the wall melts into the CTA row. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-zinc-50/60 dark:to-[#070707]"
        />
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-8 pb-16 flex items-center justify-center">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
        >
          {t("demoStrip.browseAll", { count })}
          <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
