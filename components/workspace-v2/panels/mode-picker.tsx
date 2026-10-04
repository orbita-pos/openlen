"use client";

// components/workspace-v2/panels/mode-picker.tsx — QUÉ LEN TRABAJA: Len o Len Odyssey.
//
// Len Odyssey (por dentro, `dynamis`: ver la cabecera de lib/agent/dynamis.ts) es un MODO aparte (`lib/agent/dynamis.ts`), como el Minimal de
// DeepSeek junto a su Standard: para encargos grandes, más lento y más caro. Se
// elige aquí, junto al mando de esfuerzo, y viaja con el turno igual que él: lo
// que se elija vale para el SIGUIENTE mensaje, nunca para el que ya corre.
//
// LAS ETIQUETAS DESCRIBEN EL TRABAJO, como las del mando de esfuerzo: nada de
// terminal, temperatura ni razonamiento. Quien no programa tiene que poder
// elegir sabiendo qué gana y qué paga.
//
// NO SE GUARDA. El mando de esfuerzo guarda la preferencia en la base; éste
// vive lo que el panel, y al volver se empieza en Len. Un modo que gasta más
// créditos no se queda puesto sin que nadie lo vea: es el perfil de DeepSeek,
// que se elige al abrir la sesión.

import type { AgentMode } from "@/lib/agent/dynamis";
import { ChevronDown } from "../icons";
import { useMandoDesplegable } from "../use-mando-desplegable";

const OPTIONS: readonly { readonly mode: AgentMode; readonly label: string; readonly desc: string }[] = [
  { mode: "len", label: "composer.modeLen", desc: "composer.modeLenDesc" },
  { mode: "dynamis", label: "composer.modeDynamis", desc: "composer.modeDynamisDesc" },
];

export function ModePicker({
  mode,
  onChange,
  abierto,
  onAbrir,
  variant = "chip",
  t,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  abierto: boolean;
  onAbrir: (v: boolean) => void;
  /** El traductor del panel, como en `MandoEsfuerzo`: así la prueba no monta
   *  el proveedor de next-intl. */
  t: (clave: string, valores?: Record<string, string>) => string;
  /** «chip»: el del chat de hoy. «pill»: la pastilla redonda del chat nuevo,
   *  junto a la del esfuerzo, con el menú abierto hacia la izquierda
   *  (plans/new-chat/). El menú es el mismo. */
  variant?: "chip" | "pill";
}) {
  const { refContenedor, refDisparador, alPulsarTecla } = useMandoDesplegable({
    abierto,
    cerrar: () => onAbrir(false),
  });
  const pick = (m: AgentMode) => {
    onChange(m);
    onAbrir(false);
  };

  return (
    <div className="relative" ref={refContenedor} onKeyDown={alPulsarTecla}>
      <button
        type="button"
        ref={refDisparador}
        aria-label={t("composer.mode")}
        title={t("composer.modeTitle")}
        aria-expanded={abierto}
        aria-haspopup="menu"
        // NO SE DESHABILITA CON EL TURNO CORRIENDO: vale para el siguiente.
        onClick={() => onAbrir(!abierto)}
        className={
          variant === "pill"
            ? `inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium transition ${
                mode === "dynamis"
                  ? "border-transparent bg-[var(--accent-strong)] text-white shadow-coral"
                  : "bd bg-side fg-muted hover:fg hover:border-[color:var(--border-strong)]"
              }`
            : `inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium transition ${
                abierto || mode === "dynamis"
                  ? "bg-[var(--accent-strong)] text-white shadow-coral"
                  : "fg-faint hover:fg hover:bg-hover"
              }`
        }
      >
        {t(mode === "dynamis" ? "composer.modeDynamis" : "composer.modeLen")}
        <ChevronDown size={11} />
      </button>
      {abierto && (
        <div
          role="menu"
          aria-label={t("composer.mode")}
          className={`absolute bottom-full ${variant === "pill" ? "right-0" : "left-0"} z-20 mb-1.5 w-64 overflow-hidden rounded-md bg-card ring-1 ring-[color:var(--border)] shadow-lg fade-in`}
        >
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === o.mode}
              onClick={() => pick(o.mode)}
              className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left transition hover:bg-hover ${
                mode === o.mode ? "bg-accent-soft" : ""
              }`}
            >
              <span className={`text-[11px] font-medium ${mode === o.mode ? "text-accent" : ""}`}>{t(o.label)}</span>
              <span className="text-[10px] leading-tight fg-faint">{t(o.desc)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
