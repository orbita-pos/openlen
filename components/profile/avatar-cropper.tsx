"use client";

// RECORTAR LA FOTO DE PERFIL, en el navegador y sin librería: la imagen se
// arrastra y se acerca bajo un círculo, y sale un cuadrado de 512×512 que va a
// POST /api/me/avatar (allí se queda en un WebP de 400×400). Las cuentas, en
// crop-math.ts. La imagen se lee de un blob: local, así que el canvas no se
// «ensucia» y `toBlob` funciona.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";

import { clampOffset, coverScale, sourceRect, type CropState } from "./crop-math";

const VIEW = 280;
const OUT = 512;

export function AvatarCropper({
  file,
  onCancel,
  onSaved,
}: {
  file: File;
  onCancel: () => void;
  onSaved: (avatar: string) => void;
}) {
  const t = useTranslations("explore.profile");
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [state, setState] = useState<CropState>({ zoom: 1, dx: 0, dy: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const place = (next: CropState) => {
    if (!size) return;
    setState({ zoom: next.zoom, ...clampOffset(size.w, size.h, VIEW, next) });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: state.dx, dy: state.dy };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) place({ ...state, dx: d.dx + e.clientX - d.x, dy: d.dy + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = async () => {
    const img = imgRef.current;
    if (!img || !size) return;
    setBusy(true);
    setError(null);
    const { sx, sy, side } = sourceRect(size.w, size.h, VIEW, state);
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    canvas.getContext("2d")?.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
    // Sin WebP en el navegador, `toBlob` da PNG, que el servidor también acepta.
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.9));
    const form = new FormData();
    if (blob) form.append("file", blob, "avatar.webp");
    const r = blob ? await fetch("/api/me/avatar", { method: "POST", body: form }).catch(() => null) : null;
    const j = r?.ok ? ((await r.json().catch(() => null)) as { avatar?: string } | null) : null;
    setBusy(false);
    if (!j?.avatar) {
      setError(t("photoFailed"));
      return;
    }
    onSaved(j.avatar);
  };

  const scale = size ? coverScale(size.w, size.h, VIEW) * state.zoom : 1;
  const w = size ? size.w * scale : VIEW;
  const h = size ? size.h * scale : VIEW;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label={t("photoTitle")} data-avatar-cropper="">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141416] p-5 text-neutral-100">
        <h2 className="text-base font-semibold">{t("photoTitle")}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t("photoHint")}</p>
        <div
          className="relative mx-auto mt-4 cursor-grab touch-none overflow-hidden rounded-xl bg-black active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ width: w, height: h, left: VIEW / 2 + state.dx - w / 2, top: VIEW / 2 + state.dy - h / 2 }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-white/70" />
        </div>
        <label className="mt-4 flex items-center gap-3 text-xs text-neutral-400">
          {t("zoom")}
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={state.zoom}
            onChange={(e) => place({ ...state, zoom: Number(e.target.value) })}
            className="flex-1 accent-[#ff5a36]"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/5">
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !size}
            className="rounded-lg bg-[#ff5a36] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
