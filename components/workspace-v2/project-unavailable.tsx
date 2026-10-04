"use client";

// EL PROYECTO NO SE PUDO ABRIR (plans/new-chat/inventory.md, N31). Ocupa el
// centro del taller donde antes se quedaba «Cargando proyecto…» para siempre.
//
// Cada motivo lleva su salida, y sólo la suya: a una página que no existe no se
// le ofrece «Reintentar» (no va a aparecer), y a un fallo pasajero no se le dice
// que la página no está. `role="alert"`: el cambio de «cargando» a esto lo tiene
// que oír también quien no lo ve.

import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { ProjectLoadFailure } from "@/lib/workspace-v2/project-load-failure";

const PRIMARY =
  "inline-flex items-center h-8 px-4 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium hover:brightness-105 transition";
const SECONDARY =
  "inline-flex items-center h-8 px-4 rounded-md border bd bg-elev fg text-[12px] font-medium hover:bg-hover transition";

export function ProjectUnavailable({
  failure,
  projectId,
  onRetry,
}: {
  failure: ProjectLoadFailure;
  projectId: string;
  onRetry: () => void;
}) {
  const t = useTranslations("wsPage.editing.unavailable");
  const locale = useLocale();
  const title =
    failure === "not_found" ? t("notFoundTitle") : failure === "signed_out" ? t("signedOutTitle") : t("failedTitle");
  const body =
    failure === "not_found" ? t("notFoundBody") : failure === "signed_out" ? t("signedOutBody") : t("failedBody");
  return (
    <div className="flex-1 flex items-center justify-center bg-preview-a px-6">
      <div role="alert" className="max-w-[340px] text-center">
        <h2 className="text-[15px] font-semibold fg">{title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed fg-muted">{body}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {failure === "signed_out" ? (
            // `next` lo honra el login (y el middleware, `sanitizeNext`): vuelves
            // aquí. Navegación COMPLETA a propósito: con un `Link`, si la cookie
            // sigue ahí el middleware devuelve a esta MISMA URL, la página no se
            // vuelve a montar y la tarjeta se quedaba (visto en el taller).
            <a href={`/${locale}/login?next=${encodeURIComponent(`/new?project=${projectId}`)}`} className={PRIMARY}>
              {t("signIn")}
            </a>
          ) : failure === "failed" ? (
            <>
              <button type="button" onClick={onRetry} className={PRIMARY}>
                {t("retry")}
              </button>
              <Link href="/new?view=projects" className={SECONDARY}>
                {t("myPages")}
              </Link>
            </>
          ) : (
            <Link href="/new?view=projects" className={PRIMARY}>
              {t("myPages")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
