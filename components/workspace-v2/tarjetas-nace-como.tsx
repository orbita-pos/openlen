// WHAT A BLANK PROJECT IS BORN AS (spec local 2026-10-07-apps), and the drawings that go with each choice.
//
// Until 06/11 this file held the CARDS above the /new composer (Página / App / Juego / Herramienta, a radio
// group). Jesús: «así como lo tenemos con un grid baja el input y se ve feo» — the choice now lives in the
// composer itself, as the home page's pill (`components/marketing/hero-kind-picker.tsx`), which draws these.

"use client";

/** Con qué nace el proyecto en blanco. `"pagina"` es lo de siempre.
 *  TOOLS MADE BY LEN (spec local 2026-11-04-herramientas-hechas-por-len, §4.9 door 2): `"tool"`.
 *  THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.2): `"game"` too, before Herramienta. */
export type NaceComo = "pagina" | "app" | "game" | "tool";

// LOS DIBUJOS, en `currentColor`: la opción elegida los tiñe del acento y las
// demás los dejan en gris, en claro y en oscuro sin una sola regla más. La
// píldora los usa en miniatura (`hero-kind-picker.tsx`).

/** Una página: un titular grande, su botón, y bloques que se leen de arriba abajo. */
export function DibujoPagina() {
  return (
    <svg viewBox="0 0 160 84" className="block w-full h-auto" aria-hidden>
      <rect x="0" y="0" width="160" height="10" fill="currentColor" opacity="0.08" />
      <circle cx="7" cy="5" r="1.6" fill="currentColor" opacity="0.35" />
      <circle cx="12" cy="5" r="1.6" fill="currentColor" opacity="0.35" />
      <circle cx="17" cy="5" r="1.6" fill="currentColor" opacity="0.35" />
      <rect x="40" y="19" width="80" height="7" rx="2" fill="currentColor" opacity="0.75" />
      <rect x="54" y="30" width="52" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="66" y="38" width="28" height="7" rx="3.5" fill="currentColor" opacity="0.9" />
      <rect x="18" y="54" width="38" height="22" rx="3" fill="currentColor" opacity="0.14" />
      <rect x="61" y="54" width="38" height="22" rx="3" fill="currentColor" opacity="0.14" />
      <rect x="104" y="54" width="38" height="22" rx="3" fill="currentColor" opacity="0.14" />
    </svg>
  );
}

/** Una app: su barra de pantallas a un lado, cifras y una tabla que se usa. */
export function DibujoApp() {
  return (
    <svg viewBox="0 0 160 84" className="block w-full h-auto" aria-hidden>
      <rect x="0" y="0" width="34" height="84" fill="currentColor" opacity="0.1" />
      <rect x="7" y="9" width="18" height="4" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="7" y="22" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="7" y="30" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="7" y="38" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="7" y="46" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
      <rect x="42" y="9" width="34" height="18" rx="3" fill="currentColor" opacity="0.16" />
      <rect x="46" y="19" width="16" height="4" rx="1.5" fill="currentColor" opacity="0.75" />
      <rect x="81" y="9" width="34" height="18" rx="3" fill="currentColor" opacity="0.16" />
      <rect x="85" y="19" width="12" height="4" rx="1.5" fill="currentColor" opacity="0.75" />
      <rect x="120" y="9" width="32" height="18" rx="3" fill="currentColor" opacity="0.16" />
      <rect x="124" y="19" width="18" height="4" rx="1.5" fill="currentColor" opacity="0.75" />
      <rect x="42" y="34" width="110" height="6" rx="1.5" fill="currentColor" opacity="0.22" />
      <rect x="42" y="44" width="110" height="5" rx="1.5" fill="currentColor" opacity="0.1" />
      <rect x="42" y="53" width="110" height="5" rx="1.5" fill="currentColor" opacity="0.1" />
      <rect x="42" y="62" width="110" height="5" rx="1.5" fill="currentColor" opacity="0.1" />
      <rect x="128" y="71" width="24" height="7" rx="3.5" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** A game: a level seen from the side — the player on a platform, coins above, an enemy below, the score. */
export function DibujoJuego() {
  return (
    <svg viewBox="0 0 160 84" className="block w-full h-auto" aria-hidden>
      <rect x="8" y="7" width="26" height="4" rx="2" fill="currentColor" opacity="0.7" />
      <circle cx="138" cy="9" r="2.4" fill="currentColor" opacity="0.5" />
      <circle cx="145" cy="9" r="2.4" fill="currentColor" opacity="0.5" />
      <circle cx="152" cy="9" r="2.4" fill="currentColor" opacity="0.5" />
      <rect x="0" y="72" width="160" height="12" fill="currentColor" opacity="0.2" />
      <rect x="22" y="52" width="40" height="5" rx="2" fill="currentColor" opacity="0.3" />
      <rect x="92" y="38" width="46" height="5" rx="2" fill="currentColor" opacity="0.3" />
      <rect x="36" y="37" width="10" height="15" rx="2.5" fill="currentColor" opacity="0.9" />
      <circle cx="105" cy="29" r="3" fill="currentColor" opacity="0.75" />
      <circle cx="115" cy="29" r="3" fill="currentColor" opacity="0.75" />
      <circle cx="125" cy="29" r="3" fill="currentColor" opacity="0.75" />
      <rect x="104" y="62" width="13" height="10" rx="5" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** A tool: a small panel docked in the app, with a list and a switch — something you keep using. */
export function DibujoHerramienta() {
  return (
    <svg viewBox="0 0 160 84" className="block w-full h-auto" aria-hidden>
      <rect x="0" y="0" width="22" height="84" fill="currentColor" opacity="0.1" />
      <rect x="6" y="8" width="10" height="10" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="6" y="24" width="10" height="10" rx="2.5" fill="currentColor" opacity="0.3" />
      <rect x="6" y="40" width="10" height="10" rx="2.5" fill="currentColor" opacity="0.3" />
      <rect x="34" y="12" width="60" height="6" rx="2" fill="currentColor" opacity="0.75" />
      <rect x="34" y="28" width="112" height="12" rx="3" fill="currentColor" opacity="0.14" />
      <rect x="34" y="46" width="112" height="12" rx="3" fill="currentColor" opacity="0.14" />
      <rect x="34" y="64" width="112" height="12" rx="3" fill="currentColor" opacity="0.14" />
      <rect x="128" y="31" width="14" height="6" rx="3" fill="currentColor" opacity="0.9" />
      <rect x="128" y="49" width="14" height="6" rx="3" fill="currentColor" opacity="0.35" />
    </svg>
  );
}
