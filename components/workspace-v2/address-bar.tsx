"use client";

// LA DIRECCIÓN DE LO QUE ESTÁS VIENDO, arriba del lienzo.
//
// POR QUÉ EXISTE. El sitio se navegaba en tres sitios que no se hablaban: el
// árbol de páginas escondido tras un icono del rail, el menú de tu propia página
// dentro del lienzo, y —desde hoy— los enlaces que de verdad cambian de página.
// Tres formas de responder a «¿dónde estoy?», y ninguna a la vista.
//
// Una barra de dirección las junta en la única respuesta que el visitante
// también entiende: la RUTA. Ves `/menu` porque eso es lo que él escribe. Y
// cuando pulsas «menú» en tu propia navegación, esto cambia — que es lo que
// vuelve visible algo que hasta ahora sólo pasaba.
//
// El desplegable NO reimplementa el panel de páginas: monta el MISMO
// `SitePagesPanel` que estaba en el rail, con su alta, su borrado con
// confirmación y sus errores traducidos. Lo que se mueve es dónde vive, no lo
// que hace.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Globe } from "lucide-react";

import type { SitePageSummary } from "@/lib/projects/site-pages";
import { SitePagesPanel } from "./panels/site-pages-panel";

export interface AddressBarProps {
  /** El subdominio publicado, si lo hay. Sin él se enseña sólo la ruta: no se
   *  inventa una dirección que todavía no es de nadie. */
  subdomain: string | null;
  /** Host publicado (`openlen.com`), inyectado para no atar este componente a
   *  una constante de publicación. */
  baseHost: string;
  pages: SitePageSummary[];
  /** null = la portada. */
  activePage: string | null;
  onSwitch: (slug: string | null) => void;
  onCreate: (slug: string) => Promise<string | null>;
  onDelete: (slug: string) => Promise<boolean>;
  /** Cuántos cambios hay sin aplicar. Con alguno, cambiar de página los aplica
   *  primero (lo hace el padre) — aquí sólo se dice, para que no sorprenda. */
  pendientes?: number;
}

export function AddressBar({
  subdomain,
  baseHost,
  pages,
  activePage,
  onSwitch,
  onCreate,
  onDelete,
}: AddressBarProps) {
  const [abierto, setAbierto] = useState(false);
  const cajaRef = useRef<HTMLDivElement | null>(null);

  // Cerrar al pulsar fuera o con Escape. El desplegable no atrapa el foco a
  // propósito: no es un diálogo, es un menú — y un menú que secuestra el teclado
  // se siente roto.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  // Cambiar de página cierra el menú: seguir abierto sobre un documento que ya
  // no es el que se listó deja la fila activa señalando a otra cosa.
  const cambiar = (slug: string | null) => {
    onSwitch(slug);
    setAbierto(false);
  };

  const ruta = activePage ? `/${activePage}` : "/";

  // VIVE DENTRO de la barra de herramientas del lienzo, no en una fila
  // propia: ocupa el sitio donde estaban las medidas «1280 × 800 · 50%», que
  // repetían lo que ya dicen el conmutador de dispositivo y los botones de
  // zoom a su izquierda. Una fila menos, y el dato que sobraba fuera.
  return (
    <div ref={cajaRef} className="relative w-full min-w-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="group w-full h-7 pl-2.5 pr-1.5 inline-flex items-center gap-1.5 rounded-full border bd bg-elev hover:bd-strong transition text-[12px] min-w-0"
      >
        <Globe size={12} className="shrink-0 fg-faint" />
        {/* EL HOST EN TENUE, LA RUTA EN FIRME. Lo que el dueño cambia es la
            ruta; el host es contexto. Sin publicar no se enseña ninguno — una
            dirección que todavía no existe leída como si existiera es la
            clase de mentira pequeña que este producto ya paga cara. */}
        {subdomain && (
          <span className="fg-faint truncate min-w-0 hidden sm:inline">
            {subdomain}.{baseHost}
          </span>
        )}
        <span className="fg font-medium truncate min-w-0 tabular">{ruta}</span>
        <ChevronDown
          size={13}
          className={`ml-auto shrink-0 fg-faint transition ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] rounded-xl border bd-strong bg-elev shadow-[0_16px_48px_-12px_rgba(0,0,0,0.35)] overflow-hidden fade-in">
          <SitePagesPanel
            pages={pages}
            activePage={activePage}
            onSwitch={cambiar}
            onCreate={onCreate}
            onDelete={onDelete}
          />
        </div>
    )}
    </div>
  );
}
