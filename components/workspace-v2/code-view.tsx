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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { esDeSoloLectura } from "@/lib/agent/terminal/ficheros";
import { abiertasAlEntrar, arbolDeFicheros, type NodoDelArbol } from "@/lib/workspace-v2/arbol-de-ficheros";

import { Check, ChevronDown, ChevronRight, Copy, FileText, X } from "./icons";
import { IconBtn } from "./ui";

interface CodeViewProps {
  /** El documento de la página abierta, tal como está en el lienzo. */
  readonly html: string;
  /** Con proyecto, el explorador de TODOS sus ficheros (los mismos que ve Len
   *  en su terminal). Sin él —la vista previa de una plantilla—, sólo `html`. */
  readonly projectId?: string | null;
  /** La ruta del fichero de la página abierta (`/index.html`, `/menu/index.html`). */
  readonly rutaActual?: string;
  readonly onClose: () => void;
  readonly labels: {
    readonly title: string;
    readonly close: string;
    readonly copy: string;
    readonly copied: string;
    readonly document: string;
    readonly lines: string;
    readonly files: string;
    readonly loading: string;
    readonly loadError: string;
    readonly readOnly: string;
  };
}

interface ListaDeFicheros {
  readonly ficheros: readonly { readonly ruta: string; readonly contenido: string }[];
  readonly perezosos: readonly string[];
}

/**
 * EL EXPLORADOR, como el de VS Code: el árbol a la izquierda (arriba en el
 * móvil) y el fichero elegido a la derecha. Sólo lectura, con copiar. Los de
 * `/resultados`, `/bandeja`, `/catalogo` y `/.versiones` se piden al abrirlos:
 * cuestan consultas. La página abierta se enseña como está en el lienzo, que es
 * lo que el usuario está viendo; lo demás, como está guardado.
 */
function Explorador({
  projectId,
  rutaActual,
  htmlActual,
  labels,
}: {
  projectId: string;
  rutaActual: string;
  htmlActual: string;
  labels: CodeViewProps["labels"];
}) {
  const [lista, setLista] = useState<ListaDeFicheros | "cargando" | "error">("cargando");
  const [elegido, setElegido] = useState(rutaActual);
  const [perezosos, setPerezosos] = useState<Readonly<Record<string, string | "cargando" | "error">>>({});
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);

  useEffect(() => {
    let vivo = true;
    setLista("cargando");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ListaDeFicheros>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => vivo && setLista(j))
      .catch(() => vivo && setLista("error"));
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const arbol = useMemo(
    () =>
      typeof lista === "string"
        ? []
        : arbolDeFicheros([...lista.ficheros.map((f) => ({ ruta: f.ruta })), ...lista.perezosos.map((ruta) => ({ ruta, perezoso: true }))]),
    [lista],
  );
  // Las carpetas abiertas se deciden UNA vez, al llegar la lista; luego mandan los clics.
  useEffect(() => {
    if (arbol.length > 0 && abiertas === null) setAbiertas(abiertasAlEntrar(arbol, elegido));
  }, [arbol, abiertas, elegido]);

  const pedirPerezoso = (ruta: string) => {
    const ya = perezosos[ruta];
    if (ya !== undefined && ya !== "error") return;
    setPerezosos((p) => ({ ...p, [ruta]: "cargando" }));
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros?ruta=${encodeURIComponent(ruta)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ contenido: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => setPerezosos((p) => ({ ...p, [ruta]: j.contenido })))
      .catch(() => setPerezosos((p) => ({ ...p, [ruta]: "error" })));
  };

  const elegir = (n: NodoDelArbol) => {
    setElegido(n.ruta);
    if (n.perezoso) pedirPerezoso(n.ruta);
  };
  const plegar = (ruta: string) =>
    setAbiertas((a) => {
      const nuevas = new Set(a ?? []);
      if (nuevas.has(ruta)) nuevas.delete(ruta);
      else nuevas.add(ruta);
      return nuevas;
    });

  const contenido: string | "cargando" | "error" =
    elegido === rutaActual
      ? htmlActual
      : typeof lista === "string"
        ? lista
        : (lista.ficheros.find((f) => f.ruta === elegido)?.contenido ?? perezosos[elegido] ?? "cargando");

  const pintar = (nodos: readonly NodoDelArbol[], nivel: number): ReactNode => (
    <ul>
      {nodos.map((n) => {
        const abierta = abiertas?.has(n.ruta) ?? false;
        const sangria = { paddingLeft: 8 + nivel * 12 };
        return (
          <li key={n.ruta}>
            {n.tipo === "carpeta" ? (
              <button
                type="button"
                aria-expanded={abierta}
                onClick={() => plegar(n.ruta)}
                style={sangria}
                className="flex w-full items-center gap-1 py-0.5 pr-2 text-left fg-muted hover:fg hover:bg-hover"
              >
                {abierta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="truncate">{n.nombre}</span>
              </button>
            ) : (
              <button
                type="button"
                aria-current={n.ruta === elegido ? "true" : undefined}
                onClick={() => elegir(n)}
                style={sangria}
                className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left ${
                  n.ruta === elegido ? "bg-hover fg" : "fg-muted hover:fg hover:bg-hover"
                }`}
              >
                <FileText size={12} />
                <span className="truncate">{n.nombre}</span>
              </button>
            )}
            {n.tipo === "carpeta" && abierta && pintar(n.hijos, nivel + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav
        aria-label={labels.files}
        className="max-h-44 shrink-0 overflow-auto nice-scroll border-b bd py-1 text-[12px] md:max-h-none md:w-56 md:border-b-0 md:border-r"
      >
        <div className="px-3 py-1 text-[10.5px] uppercase tracking-wide fg-faint ui-small">{labels.files}</div>
        {lista === "cargando" && <p className="px-3 py-1 fg-muted">{labels.loading}</p>}
        {lista === "error" && <p className="px-3 py-1 fg-muted">{labels.loadError}</p>}
        {pintar(arbol, 0)}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto nice-scroll">
        {contenido === "cargando" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loading}</p>
        ) : contenido === "error" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loadError}</p>
        ) : (
          <Bloque
            etiqueta={elegido.replace(/^\//, "")}
            {...(esDeSoloLectura(elegido) ? { nota: labels.readOnly } : {})}
            codigo={contenido}
            labels={labels}
          />
        )}
      </div>
    </div>
  );
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

export function CodeView({ html, projectId, rutaActual = "/index.html", onClose, labels }: CodeViewProps) {
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
      {projectId ? (
        <div className="min-h-0 flex-1">
          <Explorador projectId={projectId} rutaActual={rutaActual} htmlActual={html} labels={labels} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto nice-scroll">
          {/* UN SOLO BLOQUE. Enseñaba el documento y, aparte, «el script» —
              porque el JavaScript vivía en otra columna y el HTML que veías NO
              era lo que se publicaba. Desde el 2026-08-26 el `<script>` es parte
              del documento: lo que ves aquí es, byte a byte, lo que se guarda y
              lo que se sirve. */}
          <Bloque etiqueta={labels.document} codigo={html} labels={labels} />
        </div>
      )}
    </div>
  );
}
