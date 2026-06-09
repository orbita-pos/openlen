"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Cropper, { type Area } from "react-easy-crop";
import {
  Check,
  Contrast,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  RotateCcw,
  RotateCw,
  Sun,
  Droplet,
  X,
} from "lucide-react";
import { useFocusTrap } from "./use-focus-trap";

// ────────────────────────────────────────────────────────────────────────
// In-browser image editor — crop + zoom + rotate + flip + brightness /
// contrast / saturation. 100% client-side canvas: no server, no AI, no
// new endpoint. On apply it exports a WebP File that the caller feeds into
// the EXISTING upload flow (POST /api/projects/<id>/assets), which already
// re-optimizes + stores on R2.
//
// Flip is baked into the cropper's source image (pre-flip) rather than
// faked with a CSS transform, so the exported crop stays pixel-correct even
// when combined with rotation (a mirror-the-rect shortcut only works at 0°/
// 180°). Crop + rotation + filters are previewed live and reproduced 1:1 on
// export via the canonical react-easy-crop rotation recipe.
// ────────────────────────────────────────────────────────────────────────

export interface ImageEditorProps {
  /** Object/data URL of the image to edit. Must be canvas-safe (same-origin
   *  or CORS-clean) — the Upload tab passes the local file's object URL. */
  src: string;
  /** Original filename — used to name the exported file. */
  fileName: string;
  onCancel: () => void;
  onApply: (edited: File) => void;
}

type AspectKey = "original" | "square" | "r43" | "r34" | "r169" | "r916";

const FIXED_ASPECTS: Record<Exclude<AspectKey, "original">, number> = {
  square: 1,
  r43: 4 / 3,
  r34: 3 / 4,
  r169: 16 / 9,
  r916: 9 / 16,
};

const ASPECT_CHIPS: { key: AspectKey; label: string }[] = [
  { key: "original", label: "" }, // label resolved via t("editor.original")
  { key: "square", label: "1:1" },
  { key: "r169", label: "16:9" },
  { key: "r43", label: "4:3" },
  { key: "r34", label: "3:4" },
  { key: "r916", label: "9:16" },
];

const ZERO_CROP = { x: 0, y: 0 };

export function ImageEditor({ src, fileName, onCancel, onApply }: ImageEditorProps) {
  const t = useTranslations("modalsAsset");
  const trapRef = useFocusTrap(true);

  const [crop, setCrop] = useState(ZERO_CROP);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspectKey, setAspectKey] = useState<AspectKey>("original");
  const [naturalAspect, setNaturalAspect] = useState(4 / 3);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Flip is baked into a derived source so the crop math stays correct under
  // rotation. No flip → use the original src verbatim.
  const [workingSrc, setWorkingSrc] = useState(src);
  const genUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (genUrlRef.current) {
      URL.revokeObjectURL(genUrlRef.current);
      genUrlRef.current = null;
    }
    if (!flipH && !flipV) {
      setWorkingSrc(src);
      return;
    }
    void makeFlipped(src, flipH, flipV)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        genUrlRef.current = url;
        setWorkingSrc(url);
      })
      .catch(() => {
        if (!cancelled) setWorkingSrc(src);
      });
    return () => {
      cancelled = true;
    };
  }, [src, flipH, flipV]);

  useEffect(
    () => () => {
      if (genUrlRef.current) URL.revokeObjectURL(genUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const aspect =
    aspectKey === "original" ? naturalAspect : FIXED_ASPECTS[aspectKey];

  const filterStr =
    brightness === 100 && contrast === 100 && saturation === 100
      ? ""
      : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

  const isDirty =
    zoom !== 1 ||
    rotation !== 0 ||
    flipH ||
    flipV ||
    aspectKey !== "original" ||
    !!filterStr ||
    crop.x !== 0 ||
    crop.y !== 0;

  const onCropComplete = useCallback((_a: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const reset = useCallback(() => {
    setCrop(ZERO_CROP);
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setAspectKey("original");
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
  }, []);

  const handleApply = useCallback(async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setErr(null);
    try {
      const blob = await getEditedBlob(
        workingSrc,
        croppedAreaPixels,
        rotation,
        filterStr,
      );
      const edited = new File([blob], editedName(fileName), {
        type: blob.type || "image/webp",
      });
      onApply(edited);
    } catch {
      setErr(t("editor.failed"));
      setBusy(false);
    }
  }, [croppedAreaPixels, workingSrc, rotation, filterStr, fileName, onApply, t]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="workspace-v2 fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm fade-in"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-editor-title"
        className="relative flex flex-col w-full h-full sm:h-auto sm:max-w-3xl sm:max-h-[92vh] sm:mx-4 sm:rounded-2xl bg-elev sm:border bd shadow-elev overflow-hidden slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b bd flex items-center justify-between gap-2 shrink-0">
          <div
            id="image-editor-title"
            className="text-[14px] sm:text-[15px] font-semibold fg font-display"
          >
            {t("editor.title")}
          </div>
          <button
            type="button"
            onClick={() => !busy && onCancel()}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
            aria-label={t("editor.cancel")}
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        {/* Crop stage */}
        <div className="relative flex-1 min-h-[44vh] sm:min-h-[340px] bg-[#0e0e10]">
          <Cropper
            image={workingSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            minZoom={1}
            maxZoom={4}
            zoomSpeed={0.2}
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            onMediaLoaded={(m) =>
              setNaturalAspect(
                m.naturalHeight > 0 ? m.naturalWidth / m.naturalHeight : 4 / 3,
              )
            }
            style={{ mediaStyle: filterStr ? { filter: filterStr } : undefined }}
          />
        </div>

        {/* Controls */}
        <div className="shrink-0 overflow-y-auto nice-scroll border-t bd px-4 sm:px-5 py-3 space-y-3 max-h-[42vh] sm:max-h-none">
          {/* Aspect presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {ASPECT_CHIPS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setAspectKey(key)}
                className={`px-2.5 py-1 rounded-full text-[11px] transition border ${
                  aspectKey === key
                    ? "bg-[color:var(--accent)] text-white border-transparent"
                    : "bd bg-app fg-muted hover:fg"
                }`}
              >
                {key === "original" ? t("editor.original") : label}
              </button>
            ))}
          </div>

          {/* Transform row: rotate + flip */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <ToolButton
              onClick={() => setRotation((r) => normalizeAngle(r - 90))}
              label={t("editor.rotateLeft")}
            >
              <RotateCcw size={15} aria-hidden />
            </ToolButton>
            <ToolButton
              onClick={() => setRotation((r) => normalizeAngle(r + 90))}
              label={t("editor.rotateRight")}
            >
              <RotateCw size={15} aria-hidden />
            </ToolButton>
            <ToolButton
              active={flipH}
              onClick={() => setFlipH((v) => !v)}
              label={t("editor.flipH")}
            >
              <FlipHorizontal2 size={15} aria-hidden />
            </ToolButton>
            <ToolButton
              active={flipV}
              onClick={() => setFlipV((v) => !v)}
              label={t("editor.flipV")}
            >
              <FlipVertical2 size={15} aria-hidden />
            </ToolButton>

            <div className="ml-auto">
              <button
                type="button"
                onClick={reset}
                disabled={!isDirty}
                className="text-[11px] fg-faint hover:fg transition disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline"
              >
                {t("editor.reset")}
              </button>
            </div>
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
            <Slider
              label={t("editor.zoom")}
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={setZoom}
              display={`${zoom.toFixed(1)}×`}
            />
            <Slider
              label={t("editor.straighten")}
              min={-45}
              max={45}
              step={1}
              value={straightenOf(rotation)}
              onChange={(v) => setRotation(quarterTurnOf(rotation) + v)}
              display={`${straightenOf(rotation)}°`}
            />
            <Slider
              icon={<Sun size={13} aria-hidden />}
              label={t("editor.brightness")}
              min={0}
              max={200}
              step={1}
              value={brightness}
              onChange={setBrightness}
              display={`${brightness}%`}
            />
            <Slider
              icon={<Contrast size={13} aria-hidden />}
              label={t("editor.contrast")}
              min={0}
              max={200}
              step={1}
              value={contrast}
              onChange={setContrast}
              display={`${contrast}%`}
            />
            <Slider
              icon={<Droplet size={13} aria-hidden />}
              label={t("editor.saturation")}
              min={0}
              max={200}
              step={1}
              value={saturation}
              onChange={setSaturation}
              display={`${saturation}%`}
            />
          </div>

          {err && (
            <div className="text-[12px] text-red-600 dark:text-red-400">{err}</div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 sm:px-5 py-3 border-t bd bg-app/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="inline-flex items-center justify-center h-8 px-3.5 rounded-md text-[12px] font-medium ring-1 ring-[color:var(--border)] bg-app hover:bg-hover fg-muted hover:fg transition disabled:opacity-40"
          >
            {t("editor.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={busy || !croppedAreaPixels}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium bg-[var(--accent-strong)] text-white hover:brightness-105 shadow-coral transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {t("editor.processing")}
              </>
            ) : (
              <>
                <Check size={14} aria-hidden />
                {t("editor.apply")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ToolButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md ring-1 transition ${
        active
          ? "ring-[color:var(--accent)] bg-accent-soft text-[color:var(--accent)]"
          : "ring-[color:var(--border)] bg-app fg-muted hover:fg hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  icon,
  min,
  max,
  step,
  value,
  onChange,
  display,
}: {
  label: string;
  icon?: React.ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[11.5px]">
      <span className="flex items-center gap-1 fg-muted w-[88px] shrink-0">
        {icon}
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[color:var(--accent)] h-1.5 cursor-pointer"
      />
      <span className="font-mono fg-faint w-11 text-right tabular-nums">
        {display}
      </span>
    </label>
  );
}

// ─── geometry / canvas helpers ──────────────────────────────────────────

function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

// Split an arbitrary rotation into its nearest quarter-turn + fine offset so
// the straighten slider (−45..45) and the 90° buttons share one rotation value.
function quarterTurnOf(deg: number): number {
  return Math.round(deg / 90) * 90;
}
function straightenOf(deg: number): number {
  return deg - quarterTurnOf(deg);
}

function getRadianAngle(deg: number): number {
  return (deg * Math.PI) / 180;
}

function rotateSize(width: number, height: number, rotation: number) {
  const r = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(r) * width) + Math.abs(Math.sin(r) * height),
    height: Math.abs(Math.sin(r) * width) + Math.abs(Math.cos(r) * height),
  };
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (e) => reject(e));
    image.src = url;
  });
}

// Bake a horizontal/vertical flip into a fresh PNG object URL. Keeping flip in
// the source (vs a preview-only CSS transform) means the crop coordinates
// react-easy-crop reports already match the flipped pixels — correct under any
// rotation.
async function makeFlipped(
  src: string,
  flipH: boolean,
  flipV: boolean,
): Promise<string> {
  const img = await createImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, 0, 0);
  return await new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(URL.createObjectURL(b)) : reject(new Error("flip failed")),
      "image/png",
    ),
  );
}

const MAX_OUTPUT_EDGE = 2400;

async function getEditedBlob(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  filterStr: string,
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const rotRad = getRadianAngle(rotation);

  // 1) Draw the full rotated image onto a bounding-box canvas — the crop
  //    coordinates react-easy-crop returns are relative to this bbox.
  const { width: bw, height: bh } = rotateSize(
    image.naturalWidth,
    image.naturalHeight,
    rotation,
  );
  const full = document.createElement("canvas");
  const fctx = full.getContext("2d");
  if (!fctx) throw new Error("no 2d context");
  full.width = Math.round(bw);
  full.height = Math.round(bh);
  fctx.translate(full.width / 2, full.height / 2);
  fctx.rotate(rotRad);
  fctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
  fctx.drawImage(image, 0, 0);

  // 2) Crop to the selected rect, applying enhancement filters and capping
  //    the longest edge to keep the upload light (the server re-optimizes
  //    to ≤2000px WebP anyway).
  const scale = Math.min(
    1,
    MAX_OUTPUT_EDGE / Math.max(pixelCrop.width, pixelCrop.height),
  );
  const outW = Math.max(1, Math.round(pixelCrop.width * scale));
  const outH = Math.max(1, Math.round(pixelCrop.height * scale));
  const out = document.createElement("canvas");
  const octx = out.getContext("2d");
  if (!octx) throw new Error("no 2d context");
  out.width = outW;
  out.height = outH;
  octx.filter = filterStr || "none";
  octx.drawImage(
    full,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outW,
    outH,
  );

  return await new Promise<Blob>((resolve, reject) =>
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/webp",
      0.92,
    ),
  );
}

function editedName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}-edited.webp`;
}
