"use client";

/**
 * LEN'S PHOTOS IN A REPLY (spec local 2026-10-27-chat-drop-and-images, Part B), the way ChatGPT
 * shows search photos: one wide, two side by side, three or more as a bento (one big tile and two
 * small, «+N» on the last), and a tile opens a big view with prev/next and the credit Commons gave
 * (`/api/commons-credit`). Like ChatGPT's, nothing to download and nothing to drag out, and the
 * photos send no referrer. Only photos `isCommonsCopy` lets through ever get here.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { CommonsCredit } from "@/lib/chat/commons-image";

export interface GalleryPhoto {
  readonly url: string;
  readonly alt: string;
}

const VISIBLE = 3;
/** One fetch per photo for the whole session: the credit never changes. */
const credits = new Map<string, Promise<CommonsCredit | null>>();
function creditOf(url: string): Promise<CommonsCredit | null> {
  let p = credits.get(url);
  if (!p) {
    p = fetch(`/api/commons-credit?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? (r.json() as Promise<CommonsCredit>) : null))
      .catch(() => null);
    credits.set(url, p);
    // A failure isn't remembered: the next open tries again.
    void p.then((c) => c ?? credits.delete(url));
  }
  return p;
}

const IMG = { draggable: false, referrerPolicy: "no-referrer" as const, decoding: "async" as const };

function Tile({ photo, className, onOpen, label, children }: { photo: GalleryPhoto; className: string; onOpen: (el: HTMLButtonElement) => void; label: string; children?: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <a href={photo.url} target="_blank" rel="noopener noreferrer" className={`grid place-items-center bg-elev p-2 text-[12px] text-link underline-offset-2 hover:underline ${className}`}>
        {photo.alt || photo.url}
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={(e) => onOpen(e.currentTarget)} className={`group relative min-h-0 min-w-0 overflow-hidden bg-elev ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...IMG} src={photo.url} alt={photo.alt} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" />
      {children}
    </button>
  );
}

export function PhotoGallery({ photos }: { photos: readonly GalleryPhoto[] }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  if (photos.length === 0) return null;
  const layout = photos.length === 1 ? "single" : photos.length === 2 ? "pair" : "bento";
  const show = (i: number) => (el: HTMLButtonElement) => {
    opener.current = el;
    setOpen(i);
  };
  const label = (i: number) => t("photos.open", { number: i + 1 });
  const extra = photos.length - VISIBLE;

  return (
    <div data-photo-gallery="" data-layout={layout} aria-label={t("photos.gallery")} role="group" className="my-2 w-full">
      {layout === "single" && <Tile photo={photos[0]!} label={label(0)} onOpen={show(0)} className="block max-h-[320px] w-full rounded-xl" />}
      {layout === "pair" && (
        <div className="grid aspect-[16/9] grid-cols-2 gap-1">
          {photos.map((p, i) => (
            <Tile key={p.url} photo={p} label={label(i)} onOpen={show(i)} className={i === 0 ? "rounded-l-xl rounded-r-md" : "rounded-l-md rounded-r-xl"} />
          ))}
        </div>
      )}
      {layout === "bento" && (
        <div className="grid aspect-[9/5] grid-cols-3 grid-rows-2 gap-1">
          {photos.slice(0, VISIBLE).map((p, i) => (
            <Tile
              key={p.url}
              photo={p}
              label={label(i)}
              onOpen={show(i)}
              className={i === 0 ? "col-span-2 row-span-2 rounded-l-xl rounded-r-md" : i === 1 ? "rounded-md rounded-tr-xl" : "rounded-md rounded-br-xl"}
            >
              {i === VISIBLE - 1 && extra > 0 && (
                <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11.5px] font-semibold text-white">
                  {t("photos.more", { count: extra })}
                </span>
              )}
            </Tile>
          ))}
        </div>
      )}
      {open !== null && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => {
            setOpen(null);
            queueMicrotask(() => opener.current?.focus());
          }}
        />
      )}
    </div>
  );
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: readonly GalleryPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useTranslations("panelsChat");
  const photo = photos[index]!;
  const [credit, setCredit] = useState<CommonsCredit | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    setCredit(null);
    void creditOf(photo.url).then((c) => live && setCredit(c));
    return () => {
      live = false;
    };
  }, [photo.url]);
  useEffect(() => closeRef.current?.focus(), []);
  const prev = index > 0 ? () => onIndex(index - 1) : null;
  const next = index < photos.length - 1 ? () => onIndex(index + 1) : null;
  const link = "underline-offset-2 hover:underline";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={credit?.title ?? photo.alt}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowLeft") prev?.();
        else if (e.key === "ArrowRight") next?.();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/85 p-4 text-white backdrop-blur-sm"
    >
      <button ref={closeRef} type="button" aria-label={t("photos.close")} onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
        <X size={18} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...IMG} src={photo.url} alt={photo.alt} className="max-h-[78vh] max-w-full rounded-lg object-contain" />
      <div className="mt-3 max-w-[min(720px,100%)] text-center text-[12.5px] leading-relaxed text-white/80">
        <b className="font-semibold text-white">{credit?.title ?? photo.alt}</b>
        {credit && (
          <>
            {" · "}
            {t("photos.by", { author: credit.author })}
            {" · "}
            {credit.licenseUrl ? (
              <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer" className={link}>
                {credit.license}
              </a>
            ) : (
              credit.license
            )}
            {" · "}
            <a href={credit.pageUrl} target="_blank" rel="noopener noreferrer" className={link}>
              {t("photos.source")}
            </a>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" aria-label={t("photos.previous")} disabled={!prev} onClick={() => prev?.()} className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:invisible">
            <ChevronLeft size={20} />
          </button>
          <button type="button" aria-label={t("photos.next")} disabled={!next} onClick={() => next?.()} className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:invisible">
            <ChevronRight size={20} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
