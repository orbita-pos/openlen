"use client";
// Reusable responsive-image renderer that consumes the variants[] +
// placeholder shape produced by `@openlen/images`. Picks the right
// element for the input shape:
//
//   - `variants` with >1 distinct MIME → `<picture>` with one
//     `<source>` per format, ordered (AVIF > WebP > original). The
//     browser picks the first format it can decode.
//   - `variants` all the same format → `<img srcset>` with widths.
//     `<picture>` would also work but `<img srcset>` is the canonical
//     single-format multi-resolution recipe.
//   - No `variants` (or just one) → plain `<img src>`.
//
// Whenever a `placeholder` is provided, `style.backgroundColor` is set
// to the dominant color so the layout box renders a tinted block
// before the image bytes paint — meaningful even when blurhash JS
// decoding isn't wired (see [[blurhash-canvas]] for the follow-up).

import type { CSSProperties, ImgHTMLAttributes } from "react";

export interface ResponsiveVariant {
  /** Variant width in pixels. The `<img srcset>` widths come from here
   *  via `widthDescriptor`. */
  width: number;
  /** IANA media type for this variant — `"image/webp"`, `"image/avif"`,
   *  `"image/jpeg"`, `"image/png"`. */
  mime: string;
  /** URL where the variant is served from. */
  url: string;
}

export interface ResponsivePlaceholder {
  /** Hex `#RRGGBB` of the source image's dominant color. Used as
   *  `style.backgroundColor` while the real bytes load. */
  dominantColor: string;
  /** Woltapp BlurHash string. Wired through but not yet rendered —
   *  see Phase J follow-up. */
  blurhash?: string;
  width?: number;
  height?: number;
}

export interface ResponsiveImageProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "src" | "srcSet" | "placeholder"
  > {
  /** Fallback URL — used as the `<img src>` when no variants are
   *  provided, or as the legacy fallback when variants are. */
  src: string;
  /** Optional variants[] from a /api/upload-style response. */
  variants?: ResponsiveVariant[];
  /** Optional placeholder for the dominant-color backdrop. */
  placeholder?: ResponsivePlaceholder;
  /** Required for non-decorative images. */
  alt: string;
  /** Hint for the browser's image selection algorithm. Passed through
   *  as `<img sizes>`; the default `"100vw"` is the largest reasonable
   *  guess when the caller doesn't know the layout. */
  sizes?: string;
}

/** Format-preference order: AVIF first (smallest), WebP second (broad
 *  support), then anything else. Browsers walk `<source>` tags top-to-
 *  bottom and pick the first they can decode. */
const FORMAT_ORDER = ["image/avif", "image/webp", "image/jpeg", "image/png"];

function pickStyle(
  placeholder: ResponsivePlaceholder | undefined,
  base: CSSProperties | undefined,
): CSSProperties | undefined {
  if (!placeholder?.dominantColor) return base;
  return {
    backgroundColor: placeholder.dominantColor,
    ...base,
  };
}

function groupByFormat(
  variants: ResponsiveVariant[],
): Map<string, ResponsiveVariant[]> {
  const map = new Map<string, ResponsiveVariant[]>();
  for (const v of variants) {
    const list = map.get(v.mime) ?? [];
    list.push(v);
    map.set(v.mime, list);
  }
  // Sort each format's variants by width ascending — the browser uses
  // `srcset`'s `Nw` descriptors to pick the right one, ordering is
  // cosmetic but readable diffs are nice.
  for (const list of map.values()) {
    list.sort((a, b) => a.width - b.width);
  }
  return map;
}

function srcSetForFormat(variants: ResponsiveVariant[]): string {
  return variants.map((v) => `${v.url} ${v.width}w`).join(", ");
}

export function ResponsiveImage({
  src,
  variants,
  placeholder,
  alt,
  sizes = "100vw",
  style,
  ...rest
}: ResponsiveImageProps) {
  const combinedStyle = pickStyle(placeholder, style);

  // No variants → plain <img>. The dominantColor still tints the
  // background while bytes load.
  if (!variants || variants.length === 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} sizes={sizes} style={combinedStyle} {...rest} />
    );
  }

  const grouped = groupByFormat(variants);

  // Single-format multi-width → <img srcset>. <picture> would be
  // equivalent but `srcset` is the canonical recipe and produces
  // smaller markup.
  if (grouped.size === 1) {
    const onlyFormat = Array.from(grouped.values())[0];
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        srcSet={srcSetForFormat(onlyFormat)}
        sizes={sizes}
        alt={alt}
        style={combinedStyle}
        {...rest}
      />
    );
  }

  // Multi-format → <picture> with <source> per format, ordered.
  const orderedFormats = Array.from(grouped.keys()).sort((a, b) => {
    const ia = FORMAT_ORDER.indexOf(a);
    const ib = FORMAT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return (
    <picture>
      {orderedFormats.map((mime) => {
        const list = grouped.get(mime);
        if (!list) return null;
        return (
          <source
            key={mime}
            type={mime}
            srcSet={srcSetForFormat(list)}
            sizes={sizes}
          />
        );
      })}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} sizes={sizes} style={combinedStyle} {...rest} />
    </picture>
  );
}
