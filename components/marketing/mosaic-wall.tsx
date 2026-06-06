import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { listTemplates, type TemplateRecord } from "@/lib/templates/store";

// Framer-style edge-to-edge template wall: a dense column-masonry of real
// template previews, full-bleed under the hero. Reuses the `demoStrip.*` i18n
// keys (eyebrow / title / browseAll) → zero translation churn.
//
// Source = `thumbnailUrl`: the crisp 1280×800 fold AVIF (~80KB). Sharp on
// retina and light enough that a wall of ~21 scrolls smoothly. We crop it only
// to LANDSCAPE/SQUARE windows (16:9 → 1:1, object-top): cropping the fold to a
// tall portrait would sliver it (there's only 800px of captured height), and
// the full-page `tileUrl` that *could* do portrait is too low-res (~600px) and
// renders blurry. So size variety comes from wide-vs-square tiles, all showing
// a sharp hero. (A true tall-portrait wall would need hi-res full-page tiles.)

const MAX_TILES = 21;

// Landscape → square only (all ≥ 1:1). Rotated so heights vary tile-to-tile
// for the masonry rhythm without ever slivering the 16:10 fold.
const ASPECTS = [
  "16 / 10",
  "1 / 1",
  "16 / 9",
  "4 / 3",
  "3 / 2",
  "1 / 1",
  "16 / 10",
  "5 / 4",
  "16 / 9",
  "4 / 3",
] as const;

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
                  <span className="text-zinc-500 dark:text-zinc-400">{chunks}</span>
                ),
              })}
            </h2>
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
            {t("demoStrip.description")}
          </div>
        </div>
      </div>

      {/* Full-bleed masonry — only thin side gutters, not the max-w container. */}
      <div className="relative px-3 sm:px-4">
        <div className="gap-3 sm:gap-4 [column-fill:balance] columns-2 sm:columns-3 lg:columns-4 xl:columns-5">
          {tiles.map((tpl, i) => {
            const src = tpl.thumbnailUrl;
            if (!src) return null;
            return (
              <Link
                key={tpl.id}
                href={`/templates/${tpl.id}`}
                className="group relative mb-3 sm:mb-4 block break-inside-avoid overflow-hidden rounded-lg sm:rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/[0.08] bg-zinc-100 dark:bg-zinc-900 transition-[box-shadow,border-color] duration-200 hover:ring-coral-400/70 dark:hover:ring-coral-500/40 hover:shadow-lg"
                style={{ aspectRatio: ASPECTS[i % ASPECTS.length] }}
              >
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-br from-zinc-200 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={t("templateCard.previewAlt", { name: tpl.name })}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
                {tpl.featured && (
                  <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-coral-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-md">
                    ★ {t("templateCard.featured")}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <div className="truncate text-[11.5px] font-semibold text-white">
                    {tpl.name}
                  </div>
                  <div className="truncate text-[9px] font-medium uppercase tracking-wider text-white/70">
                    {tf(`${tpl.family}.label`)}
                  </div>
                </div>
              </Link>
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
