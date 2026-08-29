"use client";

// La pestaña de Datos: una VENTANA a lo que la página guarda, como el panel de
// Código lo es al HTML.
//
// NO es un panel que haya que atender. El Agente escribe; esto enseña. Por eso
// no hay ningún sitio aquí donde «configurar» un almacén ni activarlo: los
// declara la página, en su propio HTML, y esta vista sólo refleja lo que hay.
//
// LA FORMA ES LA DE UNA CONSOLA DE BASE DE DATOS —Neon, Supabase— y no por
// gusto: quien abre esto quiere leer filas, no admirar una tarjeta. De ahí el
// tipo bajo el nombre de la columna, la monoespaciada en los valores, la
// cabecera que no se va al hacer scroll, y el NULL explícito.
//
// Las etiquetas se inyectan en vez de llamar a `useTranslations` dentro, igual
// que hace CodeView: así el componente se prueba sin montar un proveedor de
// i18n, y quien lo usa decide de qué espacio de nombres salen.

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { IconBtn } from "./ui";

export interface DatosLabels {
  title: string;
  close: string;
  vacio: string;
  modoLectura: string;
  modoVisitante: string;
  error: string;
  /** El contador, YA FORMATEADO por quien tiene el traductor.
   *
   *  Es una función y no una cadena con `{count}` dentro a propósito: esa
   *  llave es sintaxis ICU, y next-intl devuelve la RUTA DE LA CLAVE si le
   *  pides el mensaje sin darle el valor. Hacer el `.replace()` aquí saltaría
   *  el formateo del idioma —el plural, el separador de miles— y además no
   *  funcionaba: en pantalla salía «wsPage.datos.filas». */
  filas: (n: number) => string;
  /** Lo que se pinta donde el documento no trae ese campo. */
  vacia: string;
}

interface Almacen {
  modo: "propio" | "lectura" | "añadir";
  campos: Record<string, string>;
  filas: { id: string; doc: Record<string, unknown> }[];
}

type Estado =
  | { fase: "cargando" }
  | { fase: "listo"; almacenes: Record<string, Almacen> }
  | { fase: "error" };

/** Ancho por defecto de una columna, en píxeles. El usuario puede arrastrarlo. */
const ANCHO_DEFECTO = 180;
const ANCHO_MIN = 72;

/** Una celda. El TIPO decide cómo se pinta, no el valor: un campo de texto que
 *  contenga "true" tiene que verse distinto de un booleano que valga `true`. */
function Celda({
  valor,
  tipo,
  vacia,
}: {
  valor: unknown;
  tipo: string;
  vacia: string;
}) {
  // Ausente ≠ vacío. Un blanco se lee como «está vacío»; esto dice «este
  // documento no trae ese campo», que es lo que de verdad pasa cuando el modelo
  // guarda filas desiguales.
  if (valor === undefined || valor === null) {
    return <span className="fg-faint italic select-none">{vacia}</span>;
  }
  if (tipo === "booleano") {
    return (
      <span data-valor="booleano" className="fg-muted">
        {String(valor)}
      </span>
    );
  }
  if (tipo === "numero") {
    return (
      <span data-valor="numero" className="tabular fg">
        {String(valor)}
      </span>
    );
  }
  if (tipo === "lista") {
    const n = Array.isArray(valor) ? valor.length : 0;
    return (
      <span data-valor="lista" className="fg-muted">
        [{n}]
      </span>
    );
  }
  return (
    <span data-valor={tipo} className="fg">
      {String(valor)}
    </span>
  );
}

function Tabla({
  almacen,
  labels,
}: {
  almacen: Almacen;
  labels: DatosLabels;
}) {
  const campos = Object.keys(almacen.campos);
  const [anchos, setAnchos] = useState<Record<string, number>>({});
  const arrastre = useRef<{ campo: string; x0: number; w0: number } | null>(null);

  // El arrastre se escucha en el DOCUMENTO, no en el tirador: si el ratón sale
  // de esos 5px —y sale siempre— los eventos dejarían de llegar a mitad.
  useEffect(() => {
    const mover = (e: MouseEvent) => {
      const a = arrastre.current;
      if (!a) return;
      const ancho = Math.max(ANCHO_MIN, a.w0 + (e.clientX - a.x0));
      setAnchos((prev) => ({ ...prev, [a.campo]: ancho }));
    };
    const soltar = () => {
      arrastre.current = null;
    };
    document.addEventListener("mousemove", mover);
    document.addEventListener("mouseup", soltar);
    return () => {
      document.removeEventListener("mousemove", mover);
      document.removeEventListener("mouseup", soltar);
    };
  }, []);

  const empezar = useCallback(
    (campo: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      arrastre.current = {
        campo,
        x0: e.clientX,
        w0: anchos[campo] ?? ANCHO_DEFECTO,
      };
    },
    [anchos],
  );

  return (
    // `max-h` + `overflow-auto` es lo que hace que la cabecera pegada sirva de
    // algo: sin un contenedor con altura, no hay scroll del que quedarse fija.
    <div className="max-h-[62vh] overflow-auto nice-scroll rounded-lg border bd">
      <table className="text-[12px]" style={{ tableLayout: "fixed" }}>
        <thead className="sticky top-0 z-10 bg-elev">
          <tr>
            {campos.map((c) => (
              <th
                key={c}
                scope="col"
                className="relative border-b border-r bd px-2.5 py-1.5 text-left align-top last:border-r-0"
                style={{ width: anchos[c] ?? ANCHO_DEFECTO }}
              >
                <div className="truncate font-medium fg">{c}</div>
                {/* El tipo declarado, no uno de Postgres: aquí no hay columna
                    de verdad, y escribir `int4` sería inventarse una. */}
                <div className="truncate font-mono text-[10.5px] fg-faint">
                  {almacen.campos[c]}
                </div>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={empezar(c)}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-hover"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {almacen.filas.map((f) => (
            <tr key={f.id} className="border-b bd last:border-0 hover:bg-hover">
              {campos.map((c) => (
                <td
                  key={c}
                  className="truncate border-r bd px-2.5 py-1.5 font-mono last:border-r-0"
                  style={{ width: anchos[c] ?? ANCHO_DEFECTO }}
                >
                  <Celda valor={f.doc[c]} tipo={almacen.campos[c]} vacia={labels.vacia} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DatosView({
  projectId,
  onClose,
  labels,
}: {
  projectId: string;
  onClose: () => void;
  labels: DatosLabels;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  // Escape cierra, como cualquier panel superpuesto de este taller.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let vivo = true;
    void fetch(`/api/projects/${projectId}/datos`)
      .then((r) => r.json())
      .then((d: { almacenes?: Record<string, Almacen> }) => {
        if (vivo) setEstado({ fase: "listo", almacenes: d.almacenes ?? {} });
      })
      .catch(() => {
        // Un fallo de red NO deja el panel en blanco: un blanco se lee como «no
        // tengo datos», que es una cosa distinta y falsa.
        if (vivo) setEstado({ fase: "error" });
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const nombres = estado.fase === "listo" ? Object.keys(estado.almacenes) : [];

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-app">
      <div className="flex items-center gap-2 border-b bd px-3 py-2">
        <span className="text-[12px] font-medium fg ui-small">{labels.title}</span>
        <div className="ml-auto">
          <IconBtn label={labels.close} size="sm" onClick={onClose}>
            <X size={12} />
          </IconBtn>
        </div>
      </div>

      <div className="flex-1 overflow-auto nice-scroll p-4">
        {estado.fase === "error" && (
          <p role="status" className="text-[12.5px] fg-muted">
            {labels.error}
          </p>
        )}

        {estado.fase === "listo" && nombres.length === 0 && (
          <p role="status" className="max-w-md text-[12.5px] leading-relaxed fg-muted">
            {labels.vacio}
          </p>
        )}

        {estado.fase === "listo" &&
          nombres.map((nombre) => {
            const a = estado.almacenes[nombre];
            return (
              <section key={nombre} className="mb-7">
                <header className="mb-2 flex items-baseline gap-2">
                  <h3 className="font-mono text-[13px] font-medium fg">{nombre}</h3>
                  <span className="text-[11px] fg-faint">
                    {a.modo === "lectura" ? labels.modoLectura : labels.modoVisitante}
                  </span>
                  <span className="ml-auto tabular text-[11px] fg-faint">
                    {labels.filas(a.filas.length)}
                  </span>
                </header>
                <Tabla almacen={a} labels={labels} />
              </section>
            );
          })}
      </div>
    </div>
  );
}
