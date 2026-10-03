"use client";

// COMPARAR ANTES Y DESPUÉS (plans/new-chat/, del mock): la página de antes del
// turno y la de después, una encima de otra, y una barra que se arrastra.
//
// Sólo existe mientras la pestaña tiene las dos —el antes se guarda al mandar y
// el después llega por el stream—, la misma condición que Deshacer: un turno
// recargado no trae el antes, y para eso está Versiones.
//
// Los dos documentos se pintan en iframes SIN permisos (`sandbox=""`): son HTML
// del modelo y aquí sólo se miran, no se ejecutan.

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { ModalShell } from "../modal-shell";

export function CompareDialog({
  open,
  onClose,
  before,
  after,
}: {
  open: boolean;
  onClose: () => void;
  before: string;
  after: string;
}) {
  const t = useTranslations("panelsChat");
  const titleId = useId();
  const [split, setSplit] = useState(50);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      title={t("newChat.compare.title")}
      subtitle={t("newChat.compare.subtitle")}
      size="page"
      closeLabel={t("newChat.compare.close")}
    >
      <div className="nc relative h-[70vh] min-h-[320px] select-none overflow-hidden bg-app">
        <iframe
          title={t("newChat.compare.before")}
          srcDoc={before}
          sandbox=""
          className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-white"
        />
        <iframe
          title={t("newChat.compare.after")}
          srcDoc={after}
          sandbox=""
          className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-white"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        />
        <span className="absolute left-3 top-3 rounded-full bg-[#1E1612]/80 px-2.5 py-1 text-[11px] font-semibold text-white">
          {t("newChat.compare.before")}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-[var(--accent-strong)] px-2.5 py-1 text-[11px] font-semibold text-white">
          {t("newChat.compare.after")}
        </span>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--accent)] shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
          style={{ left: `${split}%` }}
        >
          <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bd-strong bg-elev text-[12px] fg shadow-elev">
            ⇆
          </span>
        </div>
        {/* La barra es un `range` de verdad encima de todo: se arrastra con el
            ratón o el dedo y se mueve con las flechas del teclado. */}
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label={t("newChat.compare.drag")}
          title={t("newChat.compare.drag")}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </ModalShell>
  );
}
