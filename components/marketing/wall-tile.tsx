"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";

/* One wall tile. The hover scroll animates object-position top → bottom, so a
   FIXED duration makes long pages fly and short pages crawl. On tile load we
   measure how many 16:10 folds tall the page is and size the duration for a
   constant scroll speed (~1.6s per fold). */

export interface WallTileProps {
  id: string;
  name: string;
  familyLabel: string;
  previewAlt: string;
  featuredLabel: string | null;
  thumbnailUrl: string;
  tileUrl: string | null;
}

export function WallTile({
  id,
  name,
  familyLabel,
  previewAlt,
  featuredLabel,
  thumbnailUrl,
  tileUrl,
}: WallTileProps) {
  const [duration, setDuration] = useState(7);

  // Cached images finish before React attaches onLoad, so measure from the
  // ref callback too when the image is already complete.
  const measure = (img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      const folds = (img.naturalHeight / img.naturalWidth) * (16 / 10);
      setDuration(Math.max(2.5, Math.min(20, (folds - 1) * 1.6)));
    }
  };

  return (
    <Link
      href={`/templates/${id}`}
      className="group relative block aspect-[16/10] overflow-hidden rounded-lg sm:rounded-xl ring-1 ring-zinc-200/80 dark:ring-white/[0.08] bg-zinc-100 dark:bg-zinc-900 transition-[box-shadow,border-color] duration-200 hover:ring-coral-400/70 dark:hover:ring-coral-500/40 hover:shadow-lg"
    >
      {tileUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tileUrl}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          ref={measure}
          onLoad={(e) => measure(e.currentTarget)}
          style={{ "--wall-dur": `${duration.toFixed(1)}s` } as React.CSSProperties}
          className="absolute inset-0 h-full w-full object-cover object-top [transition:object-position_1s_ease] group-hover:[transition:object-position_var(--wall-dur,7s)_linear_180ms] group-hover:[object-position:bottom] motion-reduce:!transition-none motion-reduce:group-hover:[object-position:top]"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl}
        alt={previewAlt}
        loading="lazy"
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover object-top ${
          tileUrl
            ? "transition-opacity duration-150 group-hover:opacity-0 motion-reduce:group-hover:opacity-100"
            : ""
        }`}
      />
      {featuredLabel && (
        <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-coral-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-md">
          ★ {featuredLabel}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="truncate text-[11.5px] font-semibold text-white">{name}</div>
        <div className="truncate text-[9px] font-medium uppercase tracking-wider text-white/70">
          {familyLabel}
        </div>
      </div>
    </Link>
  );
}
