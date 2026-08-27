"use client";

// EL CAPARAZÓN DE UN DIÁLOGO DEL TALLER, en un sitio.
//
// Estaba escrito TRES veces —reemplazar imagen, autorrelleno, Mi negocio— con
// las mismas cadenas copiadas: el velo, el panel, la cabecera, el botón de
// cerrar, la trampa de foco y el `Escape`. Copiado no es compartido: el
// 2026-08-27, arreglando el diálogo de imágenes («el bg blanco se me hace
// feísimo»), el mismo arreglo hubo que aplicarlo a mano tres veces, y el
// próximo retoque los habría separado.
//
// Lo que decide el llamador es sólo lo que de verdad cambia entre ellos: el
// título, el subtítulo, el ancho, y si en este momento se puede cerrar. Lo
// demás —incluido POR QUÉ va en un portal, y por qué la cabecera lleva el tono
// recesivo— vive aquí y se arregla una vez.

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useFocusTrap } from "./use-focus-trap";

export interface ModalShellProps {
  open: boolean;
  /** Se llama al pulsar el aspa, el velo o `Escape` — y NUNCA cuando
   *  `dismissable` es falso. */
  onClose: () => void;
  /** Id del título, para `aria-labelledby`. Cada diálogo tiene el suyo porque
   *  puede haber más de uno montado. */
  titleId: string;
  title: ReactNode;
  /** Debajo del título, en tono tenue. Ausente = sólo título. */
  subtitle?: ReactNode;
  /**
   * ¿Se puede cerrar AHORA?
   *
   * Falso mientras el diálogo está trabajando —subiendo, autorrellenando,
   * guardando un perfil—. Apaga las TRES salidas a la vez: el aspa, el clic en
   * el velo y `Escape`. Antes cada diálogo se acordaba de las tres por su
   * cuenta, y bastaba olvidar una para que el usuario abortara a media
   * escritura sin saberlo.
   */
  dismissable?: boolean;
  /** El ancho del panel. `lg` es un formulario; `xl`, una rejilla de imágenes. */
  size?: "lg" | "xl";
  /** Texto del `aria-label` del aspa — cada superficie tiene el suyo traducido. */
  closeLabel: string;
  children: ReactNode;
}

const ANCHOS = { lg: "max-w-lg", xl: "max-w-2xl" } as const;

export function ModalShell({
  open,
  onClose,
  titleId,
  title,
  subtitle,
  dismissable = true,
  size = "xl",
  closeLabel,
  children,
}: ModalShellProps) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const cerrar = () => {
    if (dismissable) onClose();
  };

  // AL <body>, SIEMPRE. El velo es `fixed`, y `fixed` no se resuelve contra la
  // ventana sino contra el ancestro transformado más cercano: montado dentro
  // de la barra lateral, el diálogo quedaba encajado en ella. Sólo uno de los
  // tres portaba; los otros dos tenían el mismo fallo latente y no había
  // salido todavía.
  return createPortal(
    <div
      // 🔴 EL VELO SE PINTA DESDE `ol-scrim`, NO CON UNA UTILIDAD.
      //
      // `.workspace-v2` pinta su propio fondo, y el velo necesita esa clase para
      // que sus hijos vean las variables. Misma especificidad que `bg-black/55`,
      // y `tokens.css` lo importa la página —o sea, después de las utilidades—:
      // ganaba el fondo del taller y el velo se pintaba del color de la página.
      //
      // Los DOCE diálogos llevaban sin scrim desde siempre. El modal flotaba
      // sobre un plano uniforme y no se veía dónde acababa; se leía como «el bg
      // blanco» y no lo era, era la página entera encima del velo. `ol-scrim`
      // son dos clases, y dos ganan a una. Ver tokens.css.
      className="workspace-v2 ol-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in overflow-y-auto"
      onClick={cerrar}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Borde FUERTE: sobre el velo oscuro, un borde al 0,6 de opacidad
        // desaparece y el panel pierde su canto.
        className={`relative w-full ${ANCHOS[size]} sm:mx-4 rounded-t-2xl sm:rounded-3xl bg-elev border bd-strong shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)] overflow-hidden slide-down my-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* LA CABECERA VA EN EL TONO RECESIVO, no en el del cuerpo.
            Cabecera y cuerpo eran el mismo blanco con una raya en medio, y por
            eso el diálogo se leía plano. `--bg-sidebar` es el tono de chrome que
            la paleta YA tiene (97% claro, 13% oscuro) — no hace falta ningún
            token nuevo, sólo usar el que hay. */}
        <div className="bg-side px-4 sm:px-5 py-3 sm:py-3.5 border-b bd flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              id={titleId}
              className="text-[15px] sm:text-[16px] font-semibold fg font-display"
            >
              {title}
            </div>
            {subtitle && (
              <div className="text-[12px] fg-faint mt-0.5 leading-snug">{subtitle}</div>
            )}
          </div>
          {/* Un aspa de TEXTO («✕») hereda la tipografía de la interfaz, no
              cuadra ópticamente en su caja y a este tamaño se ve torcida. Es el
              detalle que delata una pantalla sin terminar. */}
          <button
            type="button"
            onClick={cerrar}
            disabled={!dismissable}
            aria-label={closeLabel}
            className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg fg-faint hover:fg hover:bg-hover transition disabled:opacity-30"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
