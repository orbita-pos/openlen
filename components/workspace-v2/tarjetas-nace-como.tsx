// LAS DOS TARJETAS DEL PRINCIPIO: Página o App (spec local 2026-10-07-apps).
//
// Decisión del dueño: al empezar se ELIGE, como el «Make something new» de
// Claude Design — dos tarjetas con su dibujo y una línea, y debajo el
// compositor de siempre. Página va marcada por defecto: es lo que OpenLen hacía
// siempre y lo que pide casi todo el mundo. Elegir App no hace nada todavía;
// lo hace el primer mensaje, que viaja con `naceComo: "app"` y el proyecto
// recibe el esqueleto antes del turno (`lib/projects/nacer-como-app.ts`).
//
// Es un `radiogroup` de verdad (flechas, una sola parada de tabulador) porque
// es una elección exclusiva: dos botones sueltos leen como dos acciones.

"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Con qué nace el proyecto en blanco. `"pagina"` es lo de siempre. */
export type NaceComo = "pagina" | "app";

export function TarjetasNaceComo({
  value,
  onChange,
  disabled = false,
}: {
  value: NaceComo;
  onChange: (v: NaceComo) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("wsChrome");
  const refs = useRef<Record<NaceComo, HTMLButtonElement | null>>({ pagina: null, app: null });
  const opciones: ReadonlyArray<{ id: NaceComo; titulo: string; linea: string; dibujo: ReactNode }> = [
    { id: "pagina", titulo: t("start.kind.page"), linea: t("start.kind.pageHint"), dibujo: <DibujoPagina /> },
    { id: "app", titulo: t("start.kind.app"), linea: t("start.kind.appHint"), dibujo: <DibujoApp /> },
  ];

  // Flechas: con dos opciones, cualquier flecha va a la otra (y la elige, como
  // un grupo de radios nativo).
  const alPulsar = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const otra: NaceComo = value === "pagina" ? "app" : "pagina";
    onChange(otra);
    refs.current[otra]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t("start.kind.label")} className="grid grid-cols-2 gap-3">
      {opciones.map((o) => {
        const elegida = value === o.id;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[o.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={elegida}
            tabIndex={elegida ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            onKeyDown={alPulsar}
            className={`group text-left rounded-[14px] border p-2.5 transition disabled:opacity-60 ${
              elegida
                ? "border-[color:var(--accent)] ring-1 ring-[color:var(--accent)] bg-elev"
                : "bd hover:bd-strong bg-elev"
            }`}
          >
            <div
              className={`rounded-[9px] overflow-hidden border bd transition ${
                elegida ? "text-[color:var(--accent)]" : "fg-faint group-hover:fg-muted"
              }`}
              style={{ background: "var(--bg)" }}
            >
              {o.dibujo}
            </div>
            <div className="mt-2 px-0.5 flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-3 w-3 shrink-0 rounded-full border transition ${
                  elegida ? "border-[color:var(--accent)] border-[4px]" : "bd-strong"
                }`}
              />
              <span className="text-[13px] font-semibold fg">{o.titulo}</span>
            </div>
            <p className="mt-0.5 px-0.5 text-[11.5px] leading-snug fg-muted">{o.linea}</p>
          </button>
        );
      })}
    </div>
  );
}

// LOS DIBUJOS, en `currentColor`: la tarjeta elegida los tiñe del acento y la
// otra los deja en gris, en claro y en oscuro sin una sola regla más.

/** Una página: un titular grande, su botón, y bloques que se leen de arriba abajo. */
function DibujoPagina() {
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
function DibujoApp() {
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
