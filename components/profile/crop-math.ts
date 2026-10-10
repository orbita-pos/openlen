// LAS CUENTAS DEL RECORTE DE LA FOTO (avatar-cropper.tsx), puras. La imagen se
// pinta bajo un círculo de `view` px: a zoom 1 lo tapa por su lado corto, y
// (dx, dy) es cuánto se movió su centro. Nunca deja hueco dentro del círculo.

export interface CropState {
  readonly zoom: number;
  readonly dx: number;
  readonly dy: number;
}

export function coverScale(w: number, h: number, view: number): number {
  return view / Math.min(w, h);
}

const clamp = (v: number, max: number) => (max === 0 ? 0 : Math.min(max, Math.max(-max, v)));

export function clampOffset(w: number, h: number, view: number, s: CropState): { dx: number; dy: number } {
  const scale = coverScale(w, h, view) * s.zoom;
  return {
    dx: clamp(s.dx, Math.max(0, (w * scale - view) / 2)),
    dy: clamp(s.dy, Math.max(0, (h * scale - view) / 2)),
  };
}

/** El cuadrado de la imagen ORIGINAL que queda dentro del círculo. */
export function sourceRect(w: number, h: number, view: number, s: CropState): { sx: number; sy: number; side: number } {
  const scale = coverScale(w, h, view) * s.zoom;
  const { dx, dy } = clampOffset(w, h, view, s);
  return {
    sx: ((w * scale) / 2 - view / 2 - dx) / scale,
    sy: ((h * scale) / 2 - view / 2 - dy) / scale,
    side: view / scale,
  };
}
