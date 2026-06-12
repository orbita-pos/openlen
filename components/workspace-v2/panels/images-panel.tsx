// Images panel — the drop engine's drag source. Thumbnails from three
// hosted sources (OpenLen curated · Unsplash · the active business profile)
// can be DRAGGED onto the canvas (custom-MIME payload the drop script
// accepts) or CLICKED to enter the same placement mode paste uses — which is
// also the mobile path. Sources are ports of the Replace modal's tabs,
// narrowed to the 272px sidebar; payload shapes match the modal exactly so
// performSwap's Unsplash attribution keeps working.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DROP_ASSET_MIME,
  fileNameToAlt,
  type DropAsset,
} from "../drop-place-core";
import {
  ResponsiveImage,
  type ResponsiveVariant,
} from "../responsive-image";

type SourceId = "openlen" | "unsplash" | "uploads" | "profile";

export interface ImagesPanelProfile {
  name: string;
  logoUrl?: string | null;
  photos?: string[];
}

interface OpenLenImage {
  id: string;
  style: string;
  family: string[];
  alt: string;
  src: { hero: string; tablet: string; thumb: string };
}

interface OpenLenManifest {
  count: number;
  images: OpenLenImage[];
}

// Mirror of the Replace modal's chip list; labels resolve via
// modalsAsset openlen.filters.<value>.
const STYLE_FILTERS = [
  "all",
  "3d-abstract",
  "gradient-bg",
  "device-mockup",
  "creator-mockup",
  "product-still-life",
  "claymorph",
  "interior-editorial",
  "architecture-editorial",
  "nature-editorial",
  "travel-editorial",
  "wedding-editorial",
  "music-editorial",
  "gaming-editorial",
  "food-editorial",
  "lifestyle-editorial",
  "sports-editorial",
  "pet-editorial",
  "fashion-editorial",
] as const;

interface UnsplashPhoto {
  id: string;
  alt: string;
  thumb: string;
  full: string;
  author: string;
  authorUrl: string;
  photoUrl: string;
  downloadLocation: string | null;
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
  total: number;
  demoMode: boolean;
}

function startAssetDrag(e: React.DragEvent, asset: DropAsset) {
  // Custom MIME only — never text/uri-list or text/plain, so a drop that
  // misses every target can't navigate anything.
  e.dataTransfer.setData(DROP_ASSET_MIME, JSON.stringify(asset));
  e.dataTransfer.effectAllowed = "copy";
}

function ImageCard({
  asset,
  thumb,
  variants,
  overlay,
  aspect,
  ariaLabel,
  onPick,
}: {
  asset: DropAsset;
  thumb: string;
  variants?: ResponsiveVariant[];
  overlay?: string;
  aspect: string;
  ariaLabel: string;
  onPick: (asset: DropAsset) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgCls = `absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
    loaded ? "opacity-100" : "opacity-0"
  }`;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => startAssetDrag(e, asset)}
      onClick={() => onPick(asset)}
      className={`group relative ${aspect} rounded-md overflow-hidden ring-1 ring-[color:var(--border)] bg-app hover:ring-[color:var(--accent)]/60 transition focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] cursor-grab active:cursor-grabbing`}
      aria-label={ariaLabel}
      title={asset.alt}
    >
      {variants ? (
        <ResponsiveImage
          src={thumb}
          variants={variants}
          alt={asset.alt ?? ""}
          onLoad={() => setLoaded(true)}
          loading="lazy"
          sizes="136px"
          className={imgCls}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={asset.alt ?? ""}
          onLoad={() => setLoaded(true)}
          loading="lazy"
          className={imgCls}
        />
      )}
      {overlay && (
        <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent text-white text-[9.5px] opacity-0 group-hover:opacity-100 transition truncate text-left">
          {overlay}
        </div>
      )}
    </button>
  );
}

function OpenLenSource({ onPick }: { onPick: (asset: DropAsset) => void }) {
  const t = useTranslations("modalsAsset");
  const [data, setData] = useState<OpenLenManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    void fetch("/openlen-images/manifest.json")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OpenLenManifest>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.images.filter((img) => {
      if (styleFilter !== "all" && img.style !== styleFilter) return false;
      if (q) {
        const hay = `${img.alt} ${img.id} ${img.family.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, query, styleFilter]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2 pb-1.5 shrink-0 space-y-1.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            data
              ? t("openlen.searchPlaceholder", { count: data.count })
              : t("common.loading")
          }
          className="w-full h-8 px-2.5 rounded-md border bd bg-app text-[12px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
        />
        <div className="flex items-center gap-1 overflow-x-auto nice-scroll pb-1 -mb-1">
          {STYLE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStyleFilter(f)}
              className={`shrink-0 px-2 py-0.5 rounded-full text-[10.5px] transition border ${
                styleFilter === f
                  ? "bg-[color:var(--accent)] text-white border-transparent"
                  : "bd bg-app fg-muted hover:fg"
              }`}
            >
              {t(`openlen.filters.${f}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 pb-3">
        {loading ? (
          <div className="py-8 text-center text-[11.5px] fg-faint">
            {t("common.loading")}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-[11.5px] text-red-600 dark:text-red-400">
            {t("openlen.loadFailed")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-[11.5px] fg-faint">
            {query.trim()
              ? t("openlen.noMatch", { query: query.trim() })
              : t("openlen.empty")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((img) => (
              <ImageCard
                key={img.id}
                asset={{
                  url: new URL(img.src.hero, window.location.origin).href,
                  alt: img.alt,
                }}
                thumb={img.src.thumb}
                variants={[
                  { width: 400, mime: "image/webp", url: img.src.thumb },
                  { width: 800, mime: "image/webp", url: img.src.tablet },
                ]}
                overlay={img.family[0] ?? img.style}
                aspect="aspect-[16/10]"
                ariaLabel={t("openlen.useImageAria", { alt: img.alt })}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UnsplashSource({ onPick }: { onPick: (asset: DropAsset) => void }) {
  const t = useTranslations("modalsAsset");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<UnsplashSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void fetch(`/api/unsplash/search?q=${encodeURIComponent(debounced)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<UnsplashSearchResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2 pb-1.5 shrink-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            data?.demoMode
              ? t("unsplash.demoPlaceholder")
              : t("unsplash.searchPlaceholder")
          }
          className="w-full h-8 px-2.5 rounded-md border bd bg-app text-[12px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 pb-2">
        {loading && !data ? (
          <div className="py-8 text-center text-[11.5px] fg-faint">
            {t("common.loading")}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-[11.5px] text-red-600 dark:text-red-400">
            {t("unsplash.searchFailed")}
          </div>
        ) : !data || data.results.length === 0 ? (
          <div className="py-8 text-center text-[11.5px] fg-faint">
            {debounced
              ? t("unsplash.noMatch", { query: debounced })
              : t("unsplash.typeToSearch")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {data.results.map((photo) => (
              <ImageCard
                key={photo.id}
                asset={{
                  url: photo.full,
                  alt: photo.alt || undefined,
                  credit: {
                    author: photo.author,
                    authorUrl: photo.authorUrl,
                    photoUrl: photo.photoUrl,
                  },
                  downloadLocation: photo.downloadLocation ?? undefined,
                }}
                thumb={photo.thumb}
                overlay={photo.author}
                aspect="aspect-[4/3]"
                ariaLabel={t("unsplash.usePhotoAria", {
                  author: photo.author,
                  alt: photo.alt,
                })}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 border-t bd bg-app/40 text-[10px] fg-faint ui-small shrink-0">
        {t.rich("unsplash.attribution", {
          link: (chunks) => (
            <a
              href="https://unsplash.com?utm_source=openlen&utm_medium=referral"
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent underline-offset-2 hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </div>
    </div>
  );
}

function UploadsSource({
  projectId,
  onPick,
}: {
  projectId: string;
  onPick: (asset: DropAsset) => void;
}) {
  const t = useTranslations("panelsA");
  const tAsset = useTranslations("modalsAsset");
  const [assets, setAssets] = useState<
    { url: string; filename: string }[] | null
  >(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setError(false);
    void fetch(`/api/projects/${projectId}/assets`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{
          assets: { url: string; filename: string }[];
        }>;
      })
      .then((d) => {
        if (!cancelled) setAssets(d.assets);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="py-8 text-center text-[11.5px] text-red-600 dark:text-red-400">
        {tAsset("unsplash.searchFailed")}
      </div>
    );
  }
  if (!assets) {
    return (
      <div className="py-8 text-center text-[11.5px] fg-faint">
        {tAsset("common.loading")}
      </div>
    );
  }
  if (assets.length === 0) {
    return (
      <div className="py-8 px-4 text-center text-[11.5px] fg-faint">
        {t("images.uploadsEmpty")}
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 py-2">
      <div className="grid grid-cols-2 gap-1.5">
        {assets.map((a) => (
          <ImageCard
            key={a.filename}
            asset={{ url: a.url, alt: fileNameToAlt(a.filename) }}
            thumb={a.url}
            aspect="aspect-[4/3]"
            ariaLabel={a.filename}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileSource({
  profile,
  onPick,
}: {
  profile: ImagesPanelProfile | null;
  onPick: (asset: DropAsset) => void;
}) {
  const t = useTranslations("panelsA");
  const items = useMemo(() => {
    if (!profile) return [];
    const out: { url: string; label: string }[] = [];
    if (profile.logoUrl) out.push({ url: profile.logoUrl, label: profile.name });
    for (const p of profile.photos ?? []) out.push({ url: p, label: profile.name });
    return out;
  }, [profile]);

  if (!items.length) {
    return (
      <div className="py-8 px-4 text-center text-[11.5px] fg-faint">
        {t("images.profileEmpty")}
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 py-2">
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((it, i) => (
          <ImageCard
            key={`${it.url}-${i}`}
            asset={{ url: it.url, alt: it.label }}
            thumb={it.url}
            aspect="aspect-[4/3]"
            ariaLabel={it.label}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

export function ImagesPanel({
  projectId,
  activeProfile,
  onPick,
}: {
  projectId?: string | null;
  activeProfile: ImagesPanelProfile | null;
  onPick: (asset: DropAsset) => void;
}) {
  const t = useTranslations("panelsA");
  const hasProfileAssets = !!(
    activeProfile &&
    (activeProfile.logoUrl || (activeProfile.photos ?? []).length > 0)
  );
  const [source, setSource] = useState<SourceId>("openlen");
  const shownSource: SourceId =
    (source === "profile" && !hasProfileAssets) ||
    (source === "uploads" && !projectId)
      ? "openlen"
      : source;
  // Keep the latest onPick in a ref so source components don't re-render on
  // every parent render.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const pick = useMemo(() => (a: DropAsset) => onPickRef.current(a), []);

  const sources: { id: SourceId; label: string }[] = [
    { id: "openlen", label: t("images.sources.openlen") },
    { id: "unsplash", label: t("images.sources.unsplash") },
    ...(projectId
      ? [{ id: "uploads" as const, label: t("images.sources.uploads") }]
      : []),
    ...(hasProfileAssets
      ? [{ id: "profile" as const, label: t("images.sources.profile") }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2 shrink-0">
        <p className="text-[10.5px] fg-faint leading-snug">{t("images.hint")}</p>
        <div className="mt-1.5 flex items-center gap-1">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={`px-2 py-1 rounded-md text-[11px] transition border ${
                shownSource === s.id
                  ? "bg-elev fg shadow-card bd"
                  : "border-transparent fg-muted hover:fg hover:bg-hover"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 mt-1">
        {shownSource === "openlen" && <OpenLenSource onPick={pick} />}
        {shownSource === "unsplash" && <UnsplashSource onPick={pick} />}
        {shownSource === "uploads" && projectId && (
          <UploadsSource projectId={projectId} onPick={pick} />
        )}
        {shownSource === "profile" && (
          <ProfileSource profile={activeProfile} onPick={pick} />
        )}
      </div>
    </div>
  );
}
