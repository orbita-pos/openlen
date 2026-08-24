"use client";

// El código de la página, a la vista.
//
// POR QUÉ EXISTE. OpenLen es para gente que no programa, pero también lo miran
// técnicos — y para un técnico una caja negra es una razón para no usarte. El
// artefacto YA es el código: un HTML plano. No hay nada que construir, sólo que
// enseñarlo.
//
// LO QUE ENSEÑA es lo que el VISITANTE recibe, no lo que hay en la base de
// datos. `data.html` se guarda saneado —sin scripts— y el JavaScript vive
// aparte, así que enseñar sólo el documento escondería justo la mitad
// interesante. Aquí se muestran las dos, etiquetadas, y con la advertencia de
// que el script se injerta al publicar.
//
// SÓLO LECTURA a propósito. Editar código aquí sería otro producto: exige un
// editor, validación, y decidir qué gana cuando el usuario y el modelo tocan la
// misma línea. Copiar cubre el 90% de la razón por la que alguien lo abre.

import { useEffect, useRef, useState } from "react";

import { Check, Copy, X } from "./icons";
import { IconBtn } from "./ui";

interface CodeViewProps {
  /** El documento guardado, saneado. */
  readonly html: string;
  /** El JavaScript del modelo, si la página tiene. Null = no hay. */
  readonly runtime?: string | null;
  readonly onClose: () => void;
  readonly labels: {
    readonly title: string;
    readonly close: string;
    readonly copy: string;
    readonly copied: string;
    readonly document: string;
    readonly script: string;
    readonly scriptNote: string;
    readonly lines: string;
  };
}

/** Copiar al portapapeles con respaldo: `navigator.clipboard` no existe en
 *  contextos no seguros ni en navegadores viejos, y fallar en silencio al
 *  copiar es de las cosas que más molestan. */
async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cae al respaldo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function Bloque({
  etiqueta,
  nota,
  codigo,
  labels,
}: {
  etiqueta: string;
  nota?: string;
  codigo: string;
  labels: CodeViewProps["labels"];
}) {
  const [copiado, setCopiado] = useState(false);
  const lineas = codigo.split("\n");
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  return (
    <section className="min-w-0">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bd bg-elev px-3 py-1.5">
        <span className="text-[11px] font-medium fg-muted ui-small">{etiqueta}</span>
        <span className="text-[10.5px] fg-faint tabular ui-small">
          {lineas.length} {labels.lines}
        </span>
        {nota && (
          <span className="hidden md:block truncate text-[10.5px] fg-faint ui-small">{nota}</span>
        )}
        <button
          type="button"
          onClick={() => void copiar(codigo).then(setCopiado)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border bd px-2 py-1 text-[11px] fg-muted hover:fg hover:bg-hover transition ui-small"
        >
          {copiado ? <Check size={11} /> : <Copy size={11} />}
          {copiado ? labels.copied : labels.copy}
        </button>
      </header>
      {/* El código NUNCA se interpreta: va como texto dentro de <code>. Es la
          misma regla que el resto del taller — lo que el modelo escribe no se
          ejecuta fuera de su cápsula. */}
      <pre className="overflow-x-auto p-3 text-[11.5px] leading-[1.55]">
        <code className="block font-mono whitespace-pre">
          {lineas.map((linea, i) => (
            <span key={i} className="block">
              <span className="inline-block w-9 select-none pr-3 text-right fg-faint tabular">
                {i + 1}
              </span>
              {linea || " "}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}

export function CodeView({ html, runtime, onClose, labels }: CodeViewProps) {
  const cierreRef = useRef<HTMLDivElement>(null);

  // Escape cierra, como cualquier panel superpuesto. Se engancha al documento
  // porque el foco puede estar en el <pre> o en el botón de copiar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const js = runtime?.trim() ?? "";

  return (
    <div ref={cierreRef} className="absolute inset-0 z-30 flex flex-col bg-app">
      <div className="flex items-center gap-2 border-b bd px-3 py-2">
        <span className="text-[12px] font-medium fg ui-small">{labels.title}</span>
        <div className="ml-auto">
          <IconBtn label={labels.close} size="sm" onClick={onClose}>
            <X size={12} />
          </IconBtn>
        </div>
      </div>
      <div className="flex-1 overflow-auto nice-scroll">
        <Bloque etiqueta={labels.document} codigo={html} labels={labels} />
        {js.length > 0 && (
          <Bloque
            etiqueta={labels.script}
            nota={labels.scriptNote}
            codigo={js}
            labels={labels}
          />
        )}
      </div>
    </div>
  );
}
