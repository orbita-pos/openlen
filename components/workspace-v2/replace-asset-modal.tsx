"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  CATEGORY_LABELS,
  CURATED_ICONS,
  type CuratedIcon,
  type IconCategory,
} from "@/lib/lucide-curated";
import { useFocusTrap } from "./use-focus-trap";
import {
  ResponsiveImage,
  type ResponsiveVariant,
} from "./responsive-image";

export type ReplaceKind = "icon" | "image";

export interface ReplaceCredit {
  /** Photographer name. */
  author: string;
  /** Photographer profile URL on Unsplash (with our utm tag). */
  authorUrl: string;
  /** Photo page on Unsplash. */
  photoUrl: string;
}

export interface ReplacePayload {
  /** For kind="icon": the inline SVG markup to swap in. HTML-mode uses this
   *  to replace the iframe element. */
  svgMarkup?: string;
  /** For kind="icon": the Lucide name (e.g. "check"). Canva-mode uses this
   *  to set `props.name` on the Icon node; the compiler inlines the SVG. */
  iconName?: string;
  /** For kind="image": the new image URL. */
  url?: string;
  /** For kind="image": alt text (optional). */
  alt?: string;
  /** When the image comes from Unsplash, attribution metadata required
   *  by the Unsplash API guidelines. The iframe wraps the swapped image
   *  with a visible credit line that links to the photographer + Unsplash. */
  credit?: ReplaceCredit;
}

export interface ReplaceAssetModalProps {
  open: boolean;
  kind: ReplaceKind | null;
  /** The clicked element's outerHTML when it was an <svg>. Used to display
   *  a preview of the current icon in the picker so the user has visual
   *  reference for what they're replacing. */
  currentSvg?: string | null;
  /** The clicked element's `src` when it was an <img>. Used to pre-fill
   *  the URL input. */
  currentSrc?: string | null;
  /** The current project's id — required for the Upload tab so it knows
   *  where to POST. When omitted, the Upload tab shows a disabled state. */
  projectId?: string | null;
  onClose: () => void;
  onPick: (payload: ReplacePayload) => void;
}

export function ReplaceAssetModal({
  open,
  kind,
  currentSvg,
  currentSrc,
  projectId,
  onClose,
  onPick,
}: ReplaceAssetModalProps) {
  const t = useTranslations("modalsAsset");
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !kind) return null;
  if (typeof document === "undefined") return null;

  // Portal to <body> so the overlay escapes the sidebar's stacking/transform
  // context — a transformed ancestor would otherwise make `fixed` resolve
  // against the sidebar instead of the viewport.
  return createPortal(
    <div
      className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-asset-title"
        className="relative w-full max-w-2xl sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bd flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div
              id="replace-asset-title"
              className="text-[14px] sm:text-[15px] font-semibold fg font-display"
            >
              {kind === "icon" ? t("header.iconTitle") : t("header.imageTitle")}
            </div>
            <div className="hidden sm:block text-[12px] fg-faint mt-0.5 leading-snug">
              {kind === "icon"
                ? t("header.iconSubtitle")
                : t("header.imageSubtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {kind === "icon" ? (
          <IconPicker currentSvg={currentSvg ?? null} onPick={onPick} />
        ) : (
          <ImagePicker
            currentSrc={currentSrc ?? null}
            projectId={projectId ?? null}
            onPick={onPick}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Icon picker — Lucide grid + search
// ────────────────────────────────────────────────────────────────────────

function IconPicker({
  currentSvg,
  onPick,
}: {
  currentSvg: string | null;
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURATED_ICONS;
    return CURATED_ICONS.filter((i) => i.name.includes(q));
  }, [query]);

  const grouped = useMemo(() => {
    const byCategory = new Map<IconCategory, CuratedIcon[]>();
    for (const icon of filtered) {
      const list = byCategory.get(icon.category) ?? [];
      list.push(icon);
      byCategory.set(icon.category, list);
    }
    return Array.from(byCategory.entries());
  }, [filtered]);

  const handlePick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const svg = e.currentTarget.querySelector("svg");
      if (!svg) return;
      const name = e.currentTarget.dataset.iconName;
      onPick({ svgMarkup: svg.outerHTML, iconName: name });
    },
    [onPick],
  );

  return (
    <div className="flex flex-col max-h-[70vh]">
      <div className="px-4 sm:px-5 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("icon.searchPlaceholder")}
              className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
            />
          </div>
          {currentSvg && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-md ring-1 ring-[color:var(--border)] bg-app shrink-0">
              <span className="text-[10.5px] fg-faint ui-small">{t("icon.current")}</span>
              <span
                className="inline-flex items-center justify-center w-5 h-5 fg-muted"
                aria-hidden
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: currentSvg }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-4 sm:px-5 pb-4">
        {grouped.length === 0 ? (
          <div className="py-10 text-center text-[12px] fg-faint">
            {t("icon.noMatch", { query })}
          </div>
        ) : (
          grouped.map(([category, icons]) => (
            <div key={category} className="mt-3 first:mt-1">
              <div className="text-[10px] uppercase tracking-wider fg-faint mb-1.5 ui-small">
                {CATEGORY_LABELS[category]}
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                {icons.map(({ name, Component }) => (
                  <button
                    key={name}
                    type="button"
                    onClick={handlePick}
                    data-icon-name={name}
                    title={name}
                    aria-label={t("icon.pickAria", { name })}
                    className="group relative h-12 flex flex-col items-center justify-center gap-0.5 rounded-md ring-1 ring-[color:var(--border)] bg-app hover:bg-hover hover:ring-[color:var(--accent)]/50 transition fg-muted hover:text-[color:var(--accent)]"
                  >
                    <Component size={18} strokeWidth={2} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Image picker — tabbed: Paste URL · Unsplash · Upload (Upload TBD)
// ────────────────────────────────────────────────────────────────────────

type ImageTab = "openlen" | "paste" | "unsplash" | "upload";

function ImagePicker({
  currentSrc,
  projectId,
  onPick,
}: {
  currentSrc: string | null;
  projectId: string | null;
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [tab, setTab] = useState<ImageTab>("openlen");

  return (
    <div className="flex flex-col">
      <div className="px-4 sm:px-5 pt-2.5 flex gap-1 text-[12.5px] border-b bd shrink-0">
        <TabButton active={tab === "openlen"} onClick={() => setTab("openlen")}>
          {t("image.tabs.openlen")}
        </TabButton>
        <TabButton active={tab === "paste"} onClick={() => setTab("paste")}>
          {t("image.tabs.paste")}
        </TabButton>
        <TabButton active={tab === "unsplash"} onClick={() => setTab("unsplash")}>
          {t("image.tabs.unsplash")}
        </TabButton>
        <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
          {t("image.tabs.upload")}
        </TabButton>
      </div>
      {tab === "openlen" && <OpenLenTab onPick={onPick} />}
      {tab === "paste" && <PasteUrlTab currentSrc={currentSrc} onPick={onPick} />}
      {tab === "unsplash" && <UnsplashTab onPick={onPick} />}
      {tab === "upload" && (
        <UploadTab projectId={projectId} onPick={onPick} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-t-md transition border-b-2 -mb-[1px] ${
        active
          ? "fg border-[color:var(--accent)] font-medium"
          : "fg-faint hover:fg border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function PasteUrlTab({
  currentSrc,
  onPick,
}: {
  currentSrc: string | null;
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [url, setUrl] = useState(currentSrc ?? "");
  const [alt, setAlt] = useState("");
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setPreviewLoaded(false);
    setPreviewError(false);
  }, [url]);

  const isValidUrl = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      const u = new URL(trimmed);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [url]);

  const handleSubmit = useCallback(() => {
    if (!isValidUrl) return;
    onPick({ url: url.trim(), alt: alt.trim() || undefined });
  }, [isValidUrl, url, alt, onPick]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isValidUrl) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  return (
    <div className="flex flex-col">
      <div className="px-4 sm:px-5 py-4 space-y-3.5">
        <div>
          <label className="block text-[11px] fg-faint mb-1 ui-small uppercase tracking-wider">
            {t("paste.urlLabel")}
          </label>
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={handleUrlChange}
            onKeyDown={handleKey}
            placeholder="https://images.unsplash.com/…"
            className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition font-mono"
          />
          {url.trim() && !isValidUrl && (
            <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              {t("paste.invalidUrl")}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] fg-faint mb-1 ui-small uppercase tracking-wider">
            {t.rich("paste.altLabel", {
              hint: (chunks) => <span className="fg-faint">{chunks}</span>,
            })}
          </label>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t("paste.altPlaceholder")}
            className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
          />
        </div>

        {isValidUrl && (
          <div>
            <div className="text-[11px] fg-faint mb-1.5 ui-small uppercase tracking-wider">
              {t("paste.preview")}
            </div>
            <div className="relative rounded-md ring-1 ring-[color:var(--border)] bg-app overflow-hidden h-44 flex items-center justify-center">
              {previewError ? (
                <div className="text-[12px] fg-faint">
                  {t("paste.previewError")}
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={url.trim()}
                  alt={t("paste.previewAlt")}
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setPreviewError(true)}
                  className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${
                    previewLoaded ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
              {!previewLoaded && !previewError && (
                <div className="absolute text-[11px] fg-faint">{t("common.loading")}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 border-t bd bg-app/40 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValidUrl}
          className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium bg-[var(--accent-strong)] text-white hover:brightness-105 shadow-coral transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("paste.applyImage")}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// By OpenLen tab — curated AI-generated hero images. The manifest is built by
// scripts/openlen-images/process.ts from the source PNGs and committed at
// /openlen-images/manifest.json; the WebP variants it points to live on R2
// (images.openlen.com), with a local-filesystem fallback when R2 isn't set.
// ────────────────────────────────────────────────────────────────────────

type OpenLenStyle =
  | "3d-abstract"
  | "claymorph"
  | "fashion-editorial"
  | "device-mockup"
  | "product-still-life"
  | "food-editorial"
  | "interior-editorial"
  | "nature-editorial"
  | "architecture-editorial"
  | "lifestyle-editorial"
  | "gradient-bg"
  | "pet-editorial"
  | "creator-mockup"
  | "sports-editorial"
  | "travel-editorial"
  | "wedding-editorial"
  | "music-editorial"
  | "gaming-editorial";

interface OpenLenImage {
  id: string;
  promptNum: number;
  style: OpenLenStyle;
  family: string[];
  alt: string;
  src: { hero: string; tablet: string; thumb: string };
}

interface OpenLenManifest {
  version: number;
  generated: string;
  count: number;
  images: OpenLenImage[];
}

// Filter chip values; labels are resolved via t("openlen.filters.<value>").
const OPENLEN_STYLE_FILTERS: (OpenLenStyle | "all")[] = [
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
];

// Short badge keys shown on each card's hover overlay; resolved via
// t("openlen.badges.<style>").
const OPENLEN_STYLE_BADGE_KEY: Record<OpenLenStyle, string> = {
  "3d-abstract": "3d-abstract",
  "gradient-bg": "gradient-bg",
  "device-mockup": "device-mockup",
  "creator-mockup": "creator-mockup",
  "product-still-life": "product-still-life",
  claymorph: "claymorph",
  "interior-editorial": "interior-editorial",
  "architecture-editorial": "architecture-editorial",
  "nature-editorial": "nature-editorial",
  "travel-editorial": "travel-editorial",
  "wedding-editorial": "wedding-editorial",
  "music-editorial": "music-editorial",
  "gaming-editorial": "gaming-editorial",
  "food-editorial": "food-editorial",
  "lifestyle-editorial": "lifestyle-editorial",
  "sports-editorial": "sports-editorial",
  "pet-editorial": "pet-editorial",
  "fashion-editorial": "fashion-editorial",
};

function OpenLenTab({
  onPick,
}: {
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [data, setData] = useState<OpenLenManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState<OpenLenStyle | "all">("all");

  useEffect(() => {
    let cancelled = false;
    void fetch("/openlen-images/manifest.json")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OpenLenManifest>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("openlen.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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

  const handlePick = (image: OpenLenImage) => {
    // image.src.hero is a root-relative path (/openlen-images/...). Resolve
    // it to an absolute URL against the app origin — a relative URL gets
    // rejected by the chat's attached-image check and breaks once the page
    // is published to a subdomain.
    onPick({
      url: new URL(image.src.hero, window.location.origin).href,
      alt: image.alt,
    });
  };

  return (
    <div className="flex flex-col max-h-[70vh]">
      <div className="px-4 sm:px-5 pt-3 pb-2 shrink-0 space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            data
              ? t("openlen.searchPlaceholder", { count: data.count })
              : t("common.loading")
          }
          className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
        />
        <div className="flex items-center gap-1.5">
          {OPENLEN_STYLE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStyleFilter(f)}
              className={`px-2.5 py-1 rounded-full text-[11px] transition border ${
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

      <div className="flex-1 overflow-y-auto nice-scroll px-4 sm:px-5 pb-4">
        {loading ? (
          <div className="py-10 text-center text-[12px] fg-faint">{t("common.loading")}</div>
        ) : error ? (
          <div className="py-10 text-center text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[12px] fg-faint">
            {query.trim()
              ? t("openlen.noMatch", { query: query.trim() })
              : t("openlen.empty")}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {filtered.map((img) => (
              <OpenLenCard
                key={img.id}
                image={img}
                onPick={() => handlePick(img)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-2 border-t bd bg-app/40 flex items-center justify-between text-[10.5px] fg-faint ui-small">
        <span>{t("openlen.footer")}</span>
        {data && (
          <span className="font-mono">
            {filtered.length}/{data.count}
          </span>
        )}
      </div>
    </div>
  );
}

function OpenLenCard({
  image,
  onPick,
}: {
  image: OpenLenImage;
  onPick: () => void;
}) {
  const t = useTranslations("modalsAsset");
  const [loaded, setLoaded] = useState(false);
  // OpenLen manifest exposes hero/tablet/thumb — three widths of the
  // same WebP. Feed all three as a single-format multi-width set so
  // the card pulls the smallest variant that fits the slot (typically
  // `thumb` on the picker grid; higher-density displays may opt into
  // `tablet` automatically).
  const variants: ResponsiveVariant[] = [
    { width: 400, mime: "image/webp", url: image.src.thumb },
    { width: 800, mime: "image/webp", url: image.src.tablet },
    { width: 1920, mime: "image/webp", url: image.src.hero },
  ];
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative aspect-[16/10] rounded-md overflow-hidden ring-1 ring-[color:var(--border)] bg-app hover:ring-[color:var(--accent)]/60 transition focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
      aria-label={t("openlen.useImageAria", { alt: image.alt })}
      title={image.alt}
    >
      <ResponsiveImage
        src={image.src.thumb}
        variants={variants}
        alt={image.alt}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        sizes="(min-width: 768px) 33vw, 50vw"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent text-white text-[10.5px] opacity-0 group-hover:opacity-100 transition flex items-center justify-between">
        <span className="truncate">{image.family[0] ?? image.style}</span>
        <span className="ml-1 px-1.5 py-0.5 rounded-sm bg-white/20 backdrop-blur-sm text-[9.5px] uppercase tracking-wider shrink-0">
          {t(`openlen.badges.${OPENLEN_STYLE_BADGE_KEY[image.style]}`)}
        </span>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Unsplash search tab
// ────────────────────────────────────────────────────────────────────────

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
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

function UnsplashTab({
  onPick,
}: {
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<UnsplashSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce search input.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(
      `/api/unsplash/search?q=${encodeURIComponent(debounced)}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<UnsplashSearchResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("unsplash.searchFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, t]);

  const handlePick = (photo: UnsplashPhoto) => {
    // Per Unsplash API guidelines, ping their download_location endpoint
    // whenever a user "uses" a photo. Fire-and-forget — failure here
    // doesn't block the swap. Demo-mode photos don't have a location.
    if (photo.downloadLocation) {
      void fetch("/api/unsplash/track-download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ downloadLocation: photo.downloadLocation }),
      }).catch(() => {
        /* best-effort */
      });
    }
    onPick({
      url: photo.full,
      alt: photo.alt || undefined,
      credit: {
        author: photo.author,
        authorUrl: photo.authorUrl,
        photoUrl: photo.photoUrl,
      },
    });
  };

  return (
    <div className="flex flex-col max-h-[70vh]">
      <div className="px-4 sm:px-5 pt-3 pb-2 shrink-0">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            data?.demoMode
              ? t("unsplash.demoPlaceholder")
              : t("unsplash.searchPlaceholder")
          }
          className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
        />
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-4 sm:px-5 pb-4">
        {loading && !data ? (
          <div className="py-10 text-center text-[12px] fg-faint">{t("common.loading")}</div>
        ) : error ? (
          <div className="py-10 text-center text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : !data || data.results.length === 0 ? (
          <div className="py-10 text-center text-[12px] fg-faint">
            {debounced ? t("unsplash.noMatch", { query: debounced }) : t("unsplash.typeToSearch")}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.results.map((photo) => (
              <UnsplashCard
                key={photo.id}
                photo={photo}
                onPick={() => handlePick(photo)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-2 border-t bd bg-app/40 flex items-center justify-between text-[10.5px] fg-faint ui-small">
        <span>
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
        </span>
        {data?.demoMode && (
          <span className="font-mono">{t("unsplash.demoBadge", { count: data.results.length })}</span>
        )}
      </div>
    </div>
  );
}

function UnsplashCard({
  photo,
  onPick,
}: {
  photo: UnsplashPhoto;
  onPick: () => void;
}) {
  const t = useTranslations("modalsAsset");
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative aspect-[4/3] rounded-md overflow-hidden ring-1 ring-[color:var(--border)] bg-app hover:ring-[color:var(--accent)]/60 transition focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
      aria-label={t("unsplash.usePhotoAria", { author: photo.author, alt: photo.alt })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumb}
        alt={photo.alt}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent text-white text-[10.5px] opacity-0 group-hover:opacity-100 transition">
        <span className="font-medium">{photo.author}</span>
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Upload tab — drag-drop / file input → POST to /api/projects/<id>/assets
// ────────────────────────────────────────────────────────────────────────

const ACCEPT_MIMES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const MAX_UPLOAD_MB = 8;

type UploadStatus = "idle" | "selected" | "uploading" | "done" | "error";

function UploadTab({
  projectId,
  onPick,
}: {
  projectId: string | null;
  onPick: (payload: ReplacePayload) => void;
}) {
  const t = useTranslations("modalsAsset");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const acceptFile = useCallback((next: File) => {
    setError(null);
    if (next.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(t("upload.tooLarge", { max: MAX_UPLOAD_MB }));
      setStatus("error");
      return;
    }
    if (!/^image\//.test(next.type)) {
      setError(t("upload.notImage"));
      setStatus("error");
      return;
    }
    setFile(next);
    setStatus("selected");
  }, [t]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    if (next) acceptFile(next);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const next = e.dataTransfer.files?.[0];
    if (next) acceptFile(next);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleUpload = useCallback(async () => {
    if (!file || !projectId) return;
    setStatus("uploading");
    setError(null);
    setProgress(0);

    // XHR rather than fetch so we can surface upload progress while large
    // files are streaming.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/assets`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(e.loaded / e.total);
    };
    xhr.onerror = () => {
      setError(t("upload.networkError"));
      setStatus("error");
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data?.url) {
          setStatus("done");
          onPick({ url: data.url as string, alt: alt.trim() || undefined });
        } else {
          setError(
            data?.message ?? data?.error ?? t("upload.failed", { status: xhr.status }),
          );
          setStatus("error");
        }
      } catch {
        setError(t("upload.failed", { status: xhr.status }));
        setStatus("error");
      }
    };

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  }, [file, projectId, alt, onPick, t]);

  if (!projectId) {
    return (
      <div className="px-4 sm:px-5 py-10 text-center text-[12px] fg-faint">
        {t("upload.unavailable")}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 sm:px-5 py-4 space-y-3.5">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`relative rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition ${
            dragOver
              ? "border-[color:var(--accent)] bg-accent-soft"
              : "border-[color:var(--border)] bg-app hover:border-[color:var(--accent)]/60"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_MIMES}
            className="sr-only"
            onChange={handleInputChange}
          />
          {previewUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={t("upload.previewAlt")}
                className="mx-auto max-h-36 object-contain rounded"
              />
              <div className="text-[11px] fg-muted">
                {file?.name} · {prettySize(file?.size ?? 0)}
              </div>
              <div className="text-[10.5px] fg-faint">
                {t("upload.swapHint")}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-[13px] fg font-medium">
                {t("upload.dropHere")}
              </div>
              <div className="text-[11px] fg-faint">
                {t("upload.browseHint", { max: MAX_UPLOAD_MB })}
              </div>
            </div>
          )}
        </div>

        {file && (
          <div>
            <label className="block text-[11px] fg-faint mb-1 ui-small uppercase tracking-wider">
              {t.rich("upload.altLabel", {
                hint: (chunks) => <span className="fg-faint">{chunks}</span>,
              })}
            </label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder={t("paste.altPlaceholder")}
              disabled={status === "uploading"}
              className="w-full h-9 px-3 rounded-md border bd bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition disabled:opacity-60"
            />
          </div>
        )}

        {status === "uploading" && (
          <div>
            <div className="text-[11px] fg-faint mb-1">
              {t("upload.uploadingProgress", { percent: Math.round(progress * 100) })}
            </div>
            <div className="h-1.5 rounded-full bg-hover overflow-hidden">
              <div
                className="h-full bg-[color:var(--accent)] transition-all"
                style={{ width: `${Math.max(2, progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 border-t bd bg-app/40 flex items-center justify-between gap-2">
        <span className="text-[10.5px] fg-faint ui-small">
          {t("upload.storedIn")}
        </span>
        <button
          type="button"
          onClick={() => void handleUpload()}
          disabled={!file || status === "uploading"}
          className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium bg-[var(--accent-strong)] text-white hover:brightness-105 shadow-coral transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {status === "uploading" ? t("upload.uploading") : t("upload.uploadApply")}
        </button>
      </div>
    </div>
  );
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
