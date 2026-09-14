"use client";

// components/workspace-v2/selector-de-modelo.tsx — QUÉ MOTOR ESCRIBE LA PÁGINA.
//
// LA FORMA ES LA DEL selector de modelo DE CLAUDE CODE
// Cada
// decisión de aquí se puede cotejar allí:
//
//  - EL NOMBRE DEL MODELO ES EL MANDO. La entrada de `/model` en su menú se
//    describe a sí misma como `Set the AI model for Claude Code (currently
//    Opus 5)`. Aquí la etiqueta tenue que ya decía el nombre es el botón; no se
//    añade un icono nuevo al compositor.
//  - LA PRIMERA FILA ES SIEMPRE EL DEFECTO. Es su `…`: valor `null`, label
//    «Default (recommended)», descripción «…».
//    El «(ahora: …)» sale de la MISMA función que decide quién escribe, así que
//    con una imagen adjunta cambia solo.
//  - LA DESCRIPCIÓN ES LA OCASIÓN, nunca los tokens ni el precio. Literal de
//    allí: «…», «…».
//  - LAS FILAS DESHABILITADAS LLEVAN EL MOTIVO DENTRO, en el sitio de la
//    descripción (`…`), y se hunden al
//    fondo de la lista. Aquí sólo hay un motivo: el razonador no tiene ojos.
//
// 🔴 SIN PRECIO POR FILA, y no es un olvido. Claude Code pinta
// ` · $5/$25 per Mtok`, pero sus sufijos existen para marcar DIFERENCIAS
// (`· Legacy`, `· ~2× usage vs Sonnet`, `· Requires usage credits`). Los dos
// papeles de aquí comparten tarifa exacta —los dos son `deepseek-flash`,
// 0,22/0,66—, así que el sufijo equivalente para «no hay diferencia» es
// ninguno. Ese mismo hecho es el que permite que este selector exista: la
// objeción con la que se rechazó el 13/09 («cuesta 6x, FREE pasa de ~20 páginas
// a ~3») era sobre Pro, que quedó fuera.
//
// 🔴 SIN LÍNEA DE ESFUERZO. Allí esa línea existe porque el esfuerzo es
// ajustable en esa misma pantalla (←→), y cuando no lo es explica por qué falta
// lo que la pantalla acaba de ofrecer. En Crear no ha habido nunca dial ni nada
// que lo insinúe: la línea levantaría la pregunta sólo para contestarla. Y hay
// dos razones de fondo para que tampoco pudiera ser un dial — Crear manda
// `effort: "none"` por la fila `page_edit` de la política, y el dial de V4 Flash
// no está medido. Decidido con Jesús el 2026-09-13.

import {
  ESCRITORES_ELEGIBLES,
  motivoNoDisponible,
  writerForTurn,
  type EscritorFijado,
  type TurnWriter,
} from "@/lib/ai/provider-switch";
import { displayNameForRole } from "@/lib/generation/model-policy";
import { useMandoDesplegable } from "./use-mando-desplegable";

/** La descripción de cada papel vive en `messages/*`, pero su CLAVE no puede
 *  ser el papel a pelo: `visual_critic` lleva guión bajo y las claves de
 *  next-intl se leen mejor en camel. Un mapa explícito, y el compilador obliga a
 *  cubrir los dos. */
const CLAVE_DESC: Record<TurnWriter, string> = {
  reasoner: "reasonerDesc",
  visual_critic: "visualCriticDesc",
};

export function SelectorDeModelo({
  escritor,
  hasImages,
  onChange,
  abierto,
  onAbrir,
  disabled = false,
  t,
}: {
  /** Lo que la persona tiene FIJADO, o `null` = «Automático». */
  escritor: EscritorFijado;
  /** ¿Este turno lleva imágenes? Decide el «(ahora: …)» y qué fila se apaga. */
  hasImages: boolean;
  onChange: (e: EscritorFijado) => void;
  abierto: boolean;
  onAbrir: (v: boolean) => void;
  disabled?: boolean;
  /** El traductor del compositor (`marketing` → `heroPrompt.modelo.*`). Se pasa
   *  en vez de llamar a `useTranslations` aquí para que este componente no
   *  dependa del proveedor de next-intl y su prueba no tenga que montar uno.
   *  Mismo criterio que `MandoEsfuerzo`. */
  t: (clave: string, valores?: Record<string, string>) => string;
}) {
  // Quién escribe DE VERDAD ahora mismo: lo fijado si cabe en este turno, y si
  // no lo que mande la imagen. Es la misma función que usa el cable, así que la
  // etiqueta no puede desviarse de lo que va a correr.
  const efectivo = writerForTurn(hasImages, escritor);

  // El orden de Claude Code: el defecto primero, y las deshabilitadas al fondo.
  const filas = [...ESCRITORES_ELEGIBLES].sort(
    (a, b) =>
      Number(motivoNoDisponible(a, hasImages) !== null) -
      Number(motivoNoDisponible(b, hasImages) !== null),
  );

  const elegir = (e: EscritorFijado) => {
    onChange(e);
    onAbrir(false);
  };

  // Esc, clic fuera y flechas. El gancho es el mismo que usa el mando de
  // esfuerzo de Len: los dos son un disparador y una lista de `menuitemradio`.
  const { refContenedor, refDisparador, alPulsarTecla } = useMandoDesplegable({
    abierto,
    cerrar: () => onAbrir(false),
  });

  return (
    <div className="relative min-w-0" ref={refContenedor} onKeyDown={alPulsarTecla}>
      <button
        type="button"
        ref={refDisparador}
        aria-label={t("modelo.abrir")}
        aria-expanded={abierto}
        aria-haspopup="menu"
        onClick={() => onAbrir(!abierto)}
        disabled={disabled}
        className={`min-w-0 truncate rounded-md px-1 py-0.5 text-[11px] transition disabled:opacity-40 ${
          abierto || escritor !== null ? "fg" : "fg-faint hover:fg hover:bg-hover"
        }`}
      >
        {displayNameForRole(efectivo)}
      </button>
      {abierto && (
        <div
          role="menu"
          aria-label={t("modelo.titulo")}
          className="absolute bottom-full left-0 z-20 mb-1.5 w-72 overflow-hidden rounded-md bg-card ring-1 ring-[color:var(--border)] shadow-lg fade-in"
        >
          <div className="border-b border-[color:var(--border)] px-2.5 py-1.5">
            <p className="text-[11px] font-medium">{t("modelo.titulo")}</p>
            <p className="text-[10px] leading-tight fg-faint">{t("modelo.subtitulo")}</p>
          </div>
          {/* FILA 1: el defecto. Su descripción nombra quién escribiría hoy,
              que es lo que hace que «Automático» no sea una caja negra. */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={escritor === null}
            onClick={() => elegir(null)}
            className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left transition hover:bg-hover ${
              escritor === null ? "bg-accent-soft" : ""
            }`}
          >
            <span className={`text-[11px] font-medium ${escritor === null ? "text-accent" : ""}`}>
              {t("modelo.auto")}
            </span>
            <span className="text-[10px] leading-tight fg-faint">
              {t("modelo.autoDesc", {
                modelo: displayNameForRole(writerForTurn(hasImages)),
              })}
            </span>
          </button>
          {filas.map((papel) => {
            const motivo = motivoNoDisponible(papel, hasImages);
            const elegido = escritor === papel;
            return (
              <button
                key={papel}
                type="button"
                role="menuitemradio"
                aria-checked={elegido}
                disabled={motivo !== null}
                onClick={() => elegir(papel)}
                className={`flex w-full flex-col items-start gap-0.5 border-t border-[color:var(--border)] px-2.5 py-1.5 text-left transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${
                  elegido ? "bg-accent-soft" : ""
                }`}
              >
                <span className={`text-[11px] font-medium ${elegido ? "text-accent" : ""}`}>
                  {displayNameForRole(papel)}
                </span>
                {/* El motivo OCUPA el sitio de la descripción, no se añade
                    debajo: es la forma de Claude Code, y evita una fila de dos
                    alturas distintas según el turno. */}
                <span className="text-[10px] leading-tight fg-faint">
                  {motivo === null ? t(`modelo.${CLAVE_DESC[papel]}`) : t("modelo.sinVision")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
