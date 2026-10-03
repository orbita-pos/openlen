"use client";

// LA CARA DE LEN, QUIETA: el aro con sus dos ojos, para la cabecera de cada
// turno del chat nuevo (plans/new-chat/). Antes ahí iba `LenMark`, el aro sin
// ojos, y Jesús pidió ver a Len (03/10).
//
// No es `CaraDeLen`: aquélla carga `brand/len-cara/cara.js` y la anima en el
// bucle de cada fotograma. Con una por turno —hasta 50 en una charla— serían
// 50 caras animándose a la vez. La viva va en la barra de abajo, que es la que
// dice qué está haciendo Len; aquí basta con la cara.
//
// La geometría es la de `cara.js` en reposo (su `icon`): aro r=22 de 10 de
// grueso con el degradado de la marca, cristal crema y ojos de 5,4 × 9,6 en
// x=26,4 y x=37,6. Sin boca, sin brillo y sin orejas (memoria `la-cara-de-len`).

import { useId } from "react";

export function LenFace({ size = 16, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`lf-${id}`} gradientUnits="userSpaceOnUse" x1="14" y1="11" x2="52" y2="55">
          <stop offset="0" stopColor="#FF7E55" />
          <stop offset=".52" stopColor="#FF5A36" />
          <stop offset="1" stopColor="#E5391A" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="17.5" fill="#FFF1EA" />
      <circle cx="32" cy="32" r="22" fill="none" stroke={`url(#lf-${id})`} strokeWidth="10" />
      <rect x="23.7" y="27.7" width="5.4" height="9.6" rx="2.7" fill="#2A1A13" />
      <rect x="34.9" y="27.7" width="5.4" height="9.6" rx="2.7" fill="#2A1A13" />
    </svg>
  );
}
