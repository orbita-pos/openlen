"use client";

// El campo de "hazme una como esta" dentro del compositor.
//
// Pega una URL, se mira esa página y de ahí sale una DIRECCIÓN visual —paleta
// medida del render y el carácter que Qwen vio— que se antepone al brief. El
// HTML ajeno no entra nunca: lo que viaja son colores, tipografía y prosa.
//
// DOS COSAS QUE SON EL DISEÑO, NO UN DETALLE:
//   · La referencia se VE y se QUITA antes de generar. Si no se puede quitar,
//     el usuario descubre que sigue puesta cuando ya pagó una generación.
//   · Traerla no genera nada. Son dos gestos, y el segundo sigue siendo suyo.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { StyleDirection } from "@/lib/style-match/direction-types";
import { Link, Loader, X } from "./icons";
import {
  normalizeReferenceUrl,
  referenceErrorCode,
  swatches,
  type ReferenceErrorCode,
} from "./reference-input";

export function ReferenceField({
  reference,
  onChange,
  disabled = false,
}: {
  reference: StyleDirection | null;
  onChange: (d: StyleDirection | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("panelsA");
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<ReferenceErrorCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function traer() {
    const url = normalizeReferenceUrl(valor);
    if (!url) {
      setError("blocked");
      return;
    }
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
      setAbierto(false);
      setValor("");
    } catch {
      setError("network");
    } finally {
      setCargando(false);
    }
  }

  // Puesta: la pastilla con los colores MEDIDOS y la equis para quitarla.
  if (reference) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-hover pl-2 pr-1 py-1 max-w-[62%]">
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

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          setError(null);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-[11.5px] fg-faint hover:bg-hover hover:fg-muted transition disabled:opacity-50"
      >
        <Link size={13} />
        <span>{t("aiBrief.reference.add")}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1 mr-2">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!cargando) void traer();
            } else if (e.key === "Escape") {
              setAbierto(false);
              setValor("");
              setError(null);
            }
          }}
          disabled={cargando}
          placeholder={t("aiBrief.reference.placeholder")}
          maxLength={300}
          aria-label={t("aiBrief.reference.add")}
          className="min-w-0 flex-1 h-8 px-2 rounded-lg border bd bg-elev text-[11.5px] fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void traer()}
          disabled={cargando || valor.trim() === ""}
          className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11.5px] font-medium bg-hover fg-muted hover:fg transition disabled:opacity-50"
        >
          {cargando ? <Loader size={12} className="animate-spin" /> : null}
          <span>{cargando ? t("aiBrief.reference.looking") : t("aiBrief.reference.use")}</span>
        </button>
      </div>
      {error ? (
        <span role="status" className="text-[11px] text-[color:var(--danger,#dc2626)]">
          {t(`aiBrief.reference.error.${error}`)}
        </span>
      ) : null}
    </div>
  );
}
