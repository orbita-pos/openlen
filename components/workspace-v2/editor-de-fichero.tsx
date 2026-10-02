"use client";

// EDITAR UN FICHERO A MANO en la lente «Código» (la #18 de
// plans/len-agente-2026/notas/fase-5-taller.md; Jesús, 02/10). Como el panel de
// fichero del escritorio de Claude Code: lo cambias, lo guardas, y si cambió por
// fuera mientras lo editabas te avisa en vez de pisarlo.
//
// Empieza por lo GUARDADO, pedido al servidor al abrirlo —no por lo que pinta el
// lienzo—, porque es con eso con lo que el servidor compara (`base`). Guarda con
// `PUT /api/projects/[id]/ficheros`, por el camino de tu terminal y con sus
// guardas (`lib/agent/terminal/editar-a-mano.ts`). Al guardar, el lienzo vuelve
// a leer el proyecto por `openlen-project-sync`, como con tu terminal.
//
// Ctrl/Cmd+S guarda. Escape NO cierra la lente con cambios a medias
// (`preventDefault`: en /new React escucha en el propio `document`).

import { useEffect, useRef, useState } from "react";

export interface EtiquetasDelEditor {
  readonly editar: string;
  readonly guardar: string;
  readonly guardando: string;
  readonly descartar: string;
  readonly cargando: string;
  /** Cambió mientras lo editabas; no se guardó nada. */
  readonly cambio: string;
  readonly cargarAhora: string;
  /** «No se guardó:», delante del motivo de la guarda. */
  readonly rechazado: string;
  readonly error: string;
  /** Debajo: se guarda como tu versión y Len lo ve en su próximo turno. */
  readonly nota: string;
}

type Estado =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "listo" }
  | { readonly tipo: "guardando" }
  | { readonly tipo: "cambio"; readonly actual: string }
  | { readonly tipo: "rechazado"; readonly detalle: string }
  | { readonly tipo: "error" };

export function EditorDeFichero({
  projectId,
  ruta,
  onGuardado,
  onCerrar,
  labels,
}: {
  projectId: string;
  ruta: string;
  /** Guardado: con lo que quedó (la plataforma pudo normalizarlo). */
  onGuardado: (contenido: string) => void;
  onCerrar: () => void;
  labels: EtiquetasDelEditor;
}) {
  const [base, setBase] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ ficheros?: { ruta: string; contenido: string }[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!vivo) return;
        const f = j.ficheros?.find((x) => x.ruta === ruta);
        if (!f) return setEstado({ tipo: "error" });
        setBase(f.contenido);
        setTexto(f.contenido);
        setEstado({ tipo: "listo" });
        requestAnimationFrame(() => area.current?.focus());
      })
      .catch(() => vivo && setEstado({ tipo: "error" }));
    return () => {
      vivo = false;
    };
  }, [projectId, ruta]);

  const guardar = async () => {
    if (base === null || estado.tipo === "guardando" || estado.tipo === "cargando") return;
    setEstado({ tipo: "guardando" });
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruta, contenido: texto, base }),
      });
      const j = (await r.json().catch(() => ({}))) as { contenido?: string; actual?: string; detalle?: string };
      if (r.ok && typeof j.contenido === "string") {
        if (typeof BroadcastChannel !== "undefined") {
          const canal = new BroadcastChannel("openlen-project-sync");
          canal.postMessage({ projectId });
          canal.close();
        }
        onGuardado(j.contenido);
        return;
      }
      if (r.status === 409 && typeof j.actual === "string") return setEstado({ tipo: "cambio", actual: j.actual });
      if (r.status === 422 && typeof j.detalle === "string") return setEstado({ tipo: "rechazado", detalle: j.detalle });
      setEstado({ tipo: "error" });
    } catch {
      setEstado({ tipo: "error" });
    }
  };

  const cargarAhora = (actual: string) => {
    setBase(actual);
    setTexto(actual);
    setEstado({ tipo: "listo" });
  };

  return (
    <div className="min-w-0" data-editor-de-fichero="">
      <div className="flex flex-wrap items-center gap-2 border-b bd px-3 py-1.5">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={base === null || estado.tipo === "guardando" || texto === base}
          className="rounded-md bg-[var(--accent-strong)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 ui-small"
        >
          {estado.tipo === "guardando" ? labels.guardando : labels.guardar}
        </button>
        <button type="button" onClick={onCerrar} className="rounded-md px-2 py-1 text-[11px] fg-muted hover:fg hover:bg-hover ui-small">
          {labels.descartar}
        </button>
        <span className="min-w-0 truncate text-[10.5px] fg-faint ui-small">{labels.nota}</span>
      </div>
      {estado.tipo === "cambio" && (
        <div className="flex flex-wrap items-center gap-2 border-b bd bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent ui-small">
          <span className="min-w-0 flex-1">{labels.cambio}</span>
          <button type="button" onClick={() => cargarAhora(estado.actual)} className="shrink-0 font-medium hover:underline">
            {labels.cargarAhora}
          </button>
        </div>
      )}
      {estado.tipo === "rechazado" && (
        <div className="border-b bd bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent ui-small">
          {labels.rechazado}
          <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10.5px]">{estado.detalle}</pre>
        </div>
      )}
      {estado.tipo === "error" && <p className="border-b bd px-3 py-1.5 text-[11.5px] text-accent ui-small">{labels.error}</p>}
      {estado.tipo === "cargando" ? (
        <p className="px-3 py-3 text-[11.5px] fg-faint ui-small">{labels.cargando}</p>
      ) : (
        base !== null && (
          <textarea
            ref={area}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void guardar();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label={ruta.replace(/^\/+/, "")}
            className="block min-h-[60vh] w-full resize-y bg-app p-3 font-mono text-[11.5px] leading-[1.55] fg focus:outline-none"
          />
        )
      )}
    </div>
  );
}
