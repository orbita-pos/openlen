"use client";

// «Hazme una como ésta» — SIN campo aparte.
//
// Escribes la dirección DENTRO de tu brief y la referencia aparece sola. Se mira
// esa página y de ahí sale una DIRECCIÓN visual —paleta medida del render y el
// carácter que Qwen vio— que se antepone al brief. El HTML ajeno no entra nunca:
// lo que viaja son colores, tipografía y prosa.
//
// ANTES ERA UN BOTÓN DE CADENA: lo pulsabas, se abría un campo, pegabas, traías,
// y sólo entonces escribías. Cuatro gestos y un widget que había que descubrir.
// Jesús, 2026-08-27: «quita eso de un input, que sea más tipo v0». Y no es sólo
// comodidad — una dirección dentro de una frase («hazme una como
// https://linear.app pero para un estudio de tatuajes») dice ADEMÁS para qué la
// quieres. El campo aparte perdía esa mitad.
//
// TRES COSAS QUE SON EL DISEÑO, NO UN DETALLE:
//   · La referencia se VE y se QUITA antes de generar. Si no se puede quitar,
//     el usuario descubre que sigue puesta cuando ya pagó una generación.
//   · Traerla no genera nada. Siguen siendo dos gestos, y el segundo —generar—
//     sigue siendo suyo.
//   · Cada dirección se trae UNA vez. Mirar una página cuesta un render y una
//     llamada con visión; volver a traer la misma mientras el usuario termina de
//     escribir su frase sería cobrarle por teclear.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { StyleDirection } from "@/lib/style-match/direction-types";
import { Link, Loader, X } from "./icons";
import {
  referenceErrorCode,
  swatches,
  type ReferenceErrorCode,
} from "./reference-input";
import { urlEnElBrief } from "./url-en-el-brief";

/** Un respiro antes de mirar la página. El usuario está ESCRIBIENDO: sin esto,
 *  cada tecla después de pegar la dirección dispararía una petición. */
const RESPIRO_MS = 700;

export function ReferenceField({
  brief,
  reference,
  onChange,
  disabled = false,
}: {
  /** Lo que el usuario lleva escrito. De aquí sale la dirección. */
  brief: string;
  reference: StyleDirection | null;
  onChange: (d: StyleDirection | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("panelsA");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<ReferenceErrorCode | null>(null);
  /** Las que ya se intentaron en esta sesión — traídas o fallidas. Sin esto, un
   *  fallo de red se reintentaría en bucle a cada tecla. */
  const vistas = useRef<Set<string>>(new Set());
  /** La que el usuario quitó a mano. Volver a traerla porque su dirección sigue
   *  escrita sería discutirle. */
  const descartadas = useRef<Set<string>>(new Set());

  const encontrada = urlEnElBrief(brief);

  useEffect(() => {
    if (disabled || reference || !encontrada) return;
    const url = encontrada.url;
    if (vistas.current.has(url) || descartadas.current.has(url)) return;
    const id = window.setTimeout(() => {
      vistas.current.add(url);
      void traer(url);
    }, RESPIRO_MS);
    return () => window.clearTimeout(id);
    // `traer` se re-crea en cada render y meterlo en las deps reiniciaría el
    // respiro con cada tecla, que es justo lo que el respiro evita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encontrada?.url, reference, disabled]);

  async function traer(url: string) {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/style-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json().catch(() => null)) as { direction?: StyleDirection } | null;
      if (!res.ok || !body?.direction) {
        setError(referenceErrorCode(res.status, body));
        return;
      }
      onChange(body.direction);
    } catch {
      setError("network");
    } finally {
      setCargando(false);
    }
  }

  // Puesta: la pastilla con los colores MEDIDOS y la equis para quitarla.
  if (reference) {
    return (
      <div className="me-auto flex items-center gap-1.5 rounded-lg bg-hover pl-2 pr-1 py-1 max-w-[62%]">
        <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
          {swatches(reference).map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className="h-3 w-3 rounded-[3px] ring-1 ring-black/10"
              style={{ background: hex }}
            />
          ))}
        </span>
        <span className="truncate text-[11.5px] fg-muted">{reference.hostname}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={t("aiBrief.reference.remove")}
          className="shrink-0 grid place-items-center h-5 w-5 rounded fg-faint hover:bg-elev hover:fg transition disabled:opacity-50"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  // TRAYÉNDOLA. Sale sola de lo que el usuario escribió, así que hay que decir
  // qué está pasando: un hueco que tarda dos segundos sin explicarse se lee como
  // que la aplicación se colgó.
  if (cargando && encontrada) {
    return (
      <span className="me-auto inline-flex items-center gap-1.5 h-8 px-2 text-[11.5px] fg-faint">
        <Loader size={12} className="animate-spin" />
        <span className="truncate max-w-[220px]">
          {t("aiBrief.reference.lookingAt", { host: hostDe(encontrada.url) })}
        </span>
      </span>
    );
  }

  // NO SE PUDO. Se dice y no se reintenta: la dirección sigue escrita en el
  // brief, así que un reintento automático sería un bucle a cada tecla. Y no
  // impide generar — el brief del usuario vale por sí solo.
  if (error) {
    return (
      <span
        role="status"
        className="me-auto inline-flex items-center gap-1.5 h-8 px-2 text-[11px] fg-faint"
      >
        <Link size={12} />
        <span className="truncate max-w-[260px]">{t(`aiBrief.reference.error.${error}`)}</span>
      </span>
    );
  }

  // Sin dirección escrita no hay nada que enseñar. Ni un botón: el gesto es
  // escribir, y un botón que no hace falta es una cosa más que descubrir.
  return null;
}

/** El host, para decirlo corto. La URL completa en una pastilla de 220px se
 *  trunca justo por donde está el nombre. */
function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
