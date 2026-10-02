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

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { esDeSoloLectura } from "@/lib/agent/terminal/ficheros";
import type { PeticionDeCodigo } from "@/lib/workspace-v2/abrir-fichero";
import {
  abiertasAlEntrar,
  arbolDeFicheros,
  carpetasConMarca,
  marcasDeCambios,
  type MarcaDeCambio,
  type NodoDelArbol,
} from "@/lib/workspace-v2/arbol-de-ficheros";
import { cambiosEnVivo, type CambiosDeUnTurno } from "@/lib/workspace-v2/cambios-en-vivo";
import { buscarEnFicheros, type FicheroBuscable, type ResultadosDeBusqueda } from "@/lib/workspace-v2/buscar-en-ficheros";

import { colorearLineas, lenguajeDe, type Lenguaje } from "@/lib/workspace-v2/colorear";

import { copiar } from "./copiar";
import { claveDeLinea, DebajoDeLaLinea, NumeroComentable, useComentarLineas, type EtiquetasDeComentar } from "./comentar-linea";
import { EditorDeFichero, type EtiquetasDelEditor } from "./editor-de-fichero";
import { LineaColoreada } from "./linea-coloreada";
import { Check, ChevronDown, ChevronRight, Copy, FileText, Pencil, Search, X } from "./icons";
import { IconBtn } from "./ui";

interface CodeViewProps {
  /** El documento de la página abierta, tal como está en el lienzo. */
  readonly html: string;
  /** Con proyecto, el explorador de TODOS sus ficheros (los mismos que ve Len
   *  en su terminal). Sin él —la vista previa de una plantilla—, sólo `html`. */
  readonly projectId?: string | null;
  /** La ruta del fichero de la página abierta (`/index.html`, `/menu/index.html`). */
  readonly rutaActual?: string;
  /** Una ruta pulsada en el Chat (la #9): la lente se abre con ese fichero elegido. */
  readonly peticion?: PeticionDeCodigo | null;
  readonly onClose: () => void;
  readonly labels: {
    /** Comentar una línea para el siguiente mensaje (la #8). */
    readonly comentar: EtiquetasDeComentar;
    /** Editar el fichero a mano (la #18). */
    readonly editar: EtiquetasDelEditor;
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
    readonly noEsta: string;
    // Buscar (la #11).
    readonly buscar: string;
    readonly limpiar: string;
    readonly porNombre: string;
    readonly enFicheros: string;
    readonly sinResultados: (consulta: string) => string;
    readonly masCoincidencias: (n: number) => string;
    readonly sinContenido: (n: number) => string;
    // La marca del árbol (la #19).
    readonly marcaNuevo: string;
    readonly marcaCambiado: string;
  };
}

/** Sin turnos con cambios (y en el servidor, donde el almacén no existe). */
const SIN_CAMBIOS: readonly CambiosDeUnTurno[] = [];

interface ListaDeFicheros {
  readonly ficheros: readonly { readonly ruta: string; readonly contenido: string }[];
  readonly perezosos: readonly string[];
}

/** Abiertas, además, las carpetas que llevan a un fichero elegido sin pasar por
 *  el árbol (desde el Chat o desde una búsqueda). */
const conCarpetasHasta =
  (ruta: string) =>
  (a: Set<string> | null): Set<string> | null => {
    if (a === null) return a;
    const nuevas = new Set(a);
    for (let i = ruta.indexOf("/", 1); i > 0; i = ruta.indexOf("/", i + 1)) nuevas.add(ruta.slice(0, i));
    return nuevas;
  };

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
  peticion,
  labels,
}: {
  projectId: string;
  rutaActual: string;
  htmlActual: string;
  peticion: PeticionDeCodigo | null;
  labels: CodeViewProps["labels"];
}) {
  const [lista, setLista] = useState<ListaDeFicheros | "cargando" | "error">("cargando");
  const [elegido, setElegido] = useState(peticion?.ruta ?? rutaActual);
  const [perezosos, setPerezosos] = useState<Readonly<Record<string, string | "cargando" | "error">>>({});
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);
  // BUSCAR (la #11): lo escrito, cuál de los resultados está activo con las
  // flechas, y la línea a la que saltar al abrir un resultado de contenido.
  const [consulta, setConsulta] = useState("");
  const [activo, setActivo] = useState(0);
  const [salto, setSalto] = useState<{ readonly linea: number; readonly n: number } | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  // Tras guardar a mano (la #18) se vuelve a pedir, sin pasar por «cargando».
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (recarga === 0) setLista("cargando");
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ListaDeFicheros>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => vivo && setLista(j))
      .catch(() => vivo && recarga === 0 && setLista("error"));
    return () => {
      vivo = false;
    };
  }, [projectId, recarga]);

  // Mientras llega la lista, o si no llega, el árbol enseña al menos la página
  // abierta: ésa ya la tenemos, y la lente nunca enseña menos que antes.
  const arbol = useMemo(
    () =>
      typeof lista === "string"
        ? arbolDeFicheros([{ ruta: rutaActual }])
        : arbolDeFicheros([...lista.ficheros.map((f) => ({ ruta: f.ruta })), ...lista.perezosos.map((ruta) => ({ ruta, perezoso: true }))]),
    [lista, rutaActual],
  );
  // Las carpetas abiertas se deciden UNA vez, al llegar la lista; luego mandan los clics.
  // Al llegar la lista DE VERDAD, no con el árbol provisional de una sola página.
  useEffect(() => {
    if (typeof lista !== "string" && abiertas === null) setAbiertas(abiertasAlEntrar(arbol, elegido));
  }, [lista, arbol, abiertas, elegido]);

  const pedirPerezoso = (ruta: string) => {
    const ya = perezosos[ruta];
    if (ya !== undefined && ya !== "error") return;
    setPerezosos((p) => ({ ...p, [ruta]: "cargando" }));
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros?ruta=${encodeURIComponent(ruta)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ contenido: string }>) : Promise.reject(new Error(String(r.status)))))
      // Sin `contenido`, error: si no, se quedaría sin valor y se volvería a pedir sin fin.
      .then((j) => setPerezosos((p) => ({ ...p, [ruta]: typeof j.contenido === "string" ? j.contenido : "error" })))
      .catch(() => setPerezosos((p) => ({ ...p, [ruta]: "error" })));
  };

  const elegir = (n: NodoDelArbol) => {
    setElegido(n.ruta);
    setSalto(null);
    if (n.perezoso) pedirPerezoso(n.ruta);
  };

  const abrirCarpetasHasta = (ruta: string) => setAbiertas(conCarpetasHasta(ruta));

  // UNA RUTA PULSADA EN EL CHAT con la lente ya abierta: ese fichero, y abiertas
  // las carpetas que llevan a él. (Si la lente se abre con ella, ya la trae el
  // estado inicial.)
  const nPeticion = peticion?.n ?? 0;
  const atendida = useRef(nPeticion);
  useEffect(() => {
    if (!peticion || nPeticion <= atendida.current) return;
    atendida.current = nPeticion;
    setElegido(peticion.ruta);
    setSalto(null);
    setAbiertas(conCarpetasHasta(peticion.ruta));
  }, [nPeticion, peticion]);

  // LO QUE SE BUSCA: cada fichero con lo que se enseña de él (la página abierta,
  // como está en el lienzo); los que se calculan al abrirlos, sólo si ya se abrieron.
  const buscables = useMemo<FicheroBuscable[]>(() => {
    if (typeof lista === "string") return [{ ruta: rutaActual, contenido: htmlActual }];
    return [
      ...lista.ficheros.map((f) => ({ ruta: f.ruta, contenido: f.ruta === rutaActual ? htmlActual : f.contenido })),
      ...lista.perezosos.map((ruta) => {
        const p = perezosos[ruta];
        return { ruta, contenido: p === undefined || p === "cargando" || p === "error" ? null : p };
      }),
    ];
  }, [lista, rutaActual, htmlActual, perezosos]);
  const resultados = useMemo(() => buscarEnFicheros(buscables, consulta), [buscables, consulta]);

  // LO QUE CAMBIÓ EN ESTA PESTAÑA (la #19), con la misma foto que la lente
  // «Cambios»: un punto junto al fichero y, atenuado, junto a sus carpetas.
  const turnosConCambios = useSyncExternalStore(
    cambiosEnVivo.subscribe,
    () => cambiosEnVivo.turnos(projectId),
    () => SIN_CAMBIOS,
  );
  const marcas = useMemo(() => marcasDeCambios(turnosConCambios), [turnosConCambios]);
  const carpetasMarcadas = useMemo(() => carpetasConMarca(marcas), [marcas]);
  /** Los resultados en el orden de las flechas: primero los nombres, después las líneas. */
  const enOrden = useMemo(
    () => [
      ...resultados.porNombre.map((ruta) => ({ ruta, linea: null as number | null })),
      ...resultados.enFicheros.flatMap((f) => f.lineas.map((l) => ({ ruta: f.ruta, linea: l.linea as number | null }))),
    ],
    [resultados],
  );
  const abrirResultado = (ruta: string, linea: number | null) => {
    setElegido(ruta);
    setSalto(linea === null ? null : { linea, n: Date.now() });
    abrirCarpetasHasta(ruta);
    if (typeof lista !== "string" && lista.perezosos.includes(ruta)) pedirPerezoso(ruta);
  };
  // Ctrl/Cmd+Mayús+F lleva al buscador, como en VS Code y en Lovable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        buscador.current?.focus();
        buscador.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const teclaEnElBuscador = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (enOrden.length === 0) return;
      setActivo((a) => (a + (e.key === "ArrowDown" ? 1 : enOrden.length - 1)) % enOrden.length);
    } else if (e.key === "Enter") {
      const r = enOrden[Math.min(activo, enOrden.length - 1)];
      if (r) abrirResultado(r.ruta, r.linea);
    } else if (e.key === "Escape" && consulta) {
      // Escape borra la búsqueda; sólo con el buscador vacío cierra la lente.
      e.preventDefault();
      e.stopPropagation();
      setConsulta("");
    }
  };
  // Un fichero de los que se calculan al abrirlos, elegido sin pasar por el
  // árbol (desde el Chat): se pide igual que con un clic.
  const esperaPerezoso =
    typeof lista !== "string" && lista.perezosos.includes(elegido) && perezosos[elegido] === undefined;
  useEffect(() => {
    if (esperaPerezoso) pedirPerezoso(elegido);
  });
  const plegar = (ruta: string) =>
    setAbiertas((a) => {
      const nuevas = new Set(a ?? []);
      if (nuevas.has(ruta)) nuevas.delete(ruta);
      else nuevas.add(ruta);
      return nuevas;
    });

  const contenido: string | "cargando" | "error" | "no-esta" =
    elegido === rutaActual
      ? htmlActual
      : typeof lista === "string"
        ? lista
        : (lista.ficheros.find((f) => f.ruta === elegido)?.contenido ??
          perezosos[elegido] ??
          // Pedido desde el Chat y ya no está (una página borrada después): se dice.
          (lista.perezosos.includes(elegido) ? "cargando" : "no-esta"));

  const pintar = (nodos: readonly NodoDelArbol[], nivel: number): ReactNode => (
    <ul>
      {nodos.map((n) => {
        // Sin decisión todavía (la lista no llegó), abierta la que lleva a la elegida.
        const abierta = abiertas?.has(n.ruta) ?? elegido.startsWith(`${n.ruta}/`);
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
                {carpetasMarcadas.has(n.ruta) && (
                  <span aria-hidden className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] opacity-40" />
                )}
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
                <MarcaDelFichero marca={marcas.get(n.ruta)} labels={labels} />
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
        <div className="px-2 pb-1.5">
          <label className="flex items-center gap-1.5 rounded-md border bd bg-app px-2 py-1 focus-within:border-[color:var(--accent)]">
            <Search size={11} className="shrink-0 fg-faint" />
            <input
              ref={buscador}
              type="text"
              value={consulta}
              onChange={(e) => {
                setConsulta(e.target.value);
                setActivo(0);
              }}
              onKeyDown={teclaEnElBuscador}
              placeholder={labels.buscar}
              aria-label={labels.buscar}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[12px] fg placeholder:fg-faint focus:outline-none"
            />
            {consulta && (
              <button
                type="button"
                aria-label={labels.limpiar}
                onClick={() => {
                  setConsulta("");
                  buscador.current?.focus();
                }}
                className="shrink-0 fg-faint hover:fg"
              >
                <X size={10} />
              </button>
            )}
          </label>
        </div>
        {consulta.trim() ? (
          <ResultadosDeLaBusqueda
            resultados={resultados}
            consulta={consulta.trim()}
            activo={enOrden[Math.min(activo, enOrden.length - 1)] ?? null}
            elegido={elegido}
            onAbrir={abrirResultado}
            labels={labels}
          />
        ) : (
          <>
            {lista === "cargando" && <p className="px-3 py-1 fg-muted">{labels.loading}</p>}
            {lista === "error" && <p className="px-3 py-1 fg-muted">{labels.loadError}</p>}
            {pintar(arbol, 0)}
          </>
        )}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto nice-scroll">
        {contenido === "cargando" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loading}</p>
        ) : contenido === "error" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loadError}</p>
        ) : contenido === "no-esta" ? (
          <p className="p-3 text-[12px] fg-muted">
            <span className="font-mono">{elegido.replace(/^\//, "")}</span> · {labels.noEsta}
          </p>
        ) : (
          <Bloque
            // Otro fichero, otro bloque: lo que se editaba era del anterior.
            key={elegido}
            comentar={{ projectId, ruta: elegido }}
            // A mano sólo lo que se guarda (la #18): no lo que se calcula al abrirlo.
            {...(typeof lista !== "string" && !esDeSoloLectura(elegido) && lista.ficheros.some((f) => f.ruta === elegido)
              ? { editar: { projectId, ruta: elegido, onGuardado: () => setRecarga((n) => n + 1) } }
              : {})}
            etiqueta={elegido.replace(/^\//, "")}
            {...(esDeSoloLectura(elegido) ? { nota: labels.readOnly } : {})}
            codigo={contenido}
            lenguaje={lenguajeDe(elegido)}
            salto={salto}
            labels={labels}
          />
        )}
      </div>
    </div>
  );
}

/** El punto de un fichero que cambió en esta pestaña: verde si es nuevo, del
 *  acento si cambió. El color no basta: lleva su texto (título y lector). */
function MarcaDelFichero({ marca, labels }: { marca: MarcaDeCambio | undefined; labels: CodeViewProps["labels"] }) {
  if (!marca) return null;
  const texto = marca === "nuevo" ? labels.marcaNuevo : labels.marcaCambiado;
  return (
    <span title={texto} className="ml-auto flex shrink-0 items-center">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${marca === "nuevo" ? "bg-emerald-500" : "bg-[var(--accent)]"}`}
      />
      <span className="sr-only">{texto}</span>
    </span>
  );
}

/**
 * LOS RESULTADOS, en el sitio del árbol mientras hay algo escrito: primero los
 * ficheros cuyo nombre casa y después las líneas, agrupadas por fichero (la
 * cabecera de cada grupo abre el fichero en su primera coincidencia). Lo que
 * casó va resaltado; el activo de las flechas, marcado.
 */
function ResultadosDeLaBusqueda({
  resultados,
  consulta,
  activo,
  elegido,
  onAbrir,
  labels,
}: {
  resultados: ResultadosDeBusqueda;
  consulta: string;
  activo: { readonly ruta: string; readonly linea: number | null } | null;
  elegido: string;
  onAbrir: (ruta: string, linea: number | null) => void;
  labels: CodeViewProps["labels"];
}) {
  const esActivo = (ruta: string, linea: number | null) => activo?.ruta === ruta && activo.linea === linea;
  const fila = (marcada: boolean) =>
    `flex w-full items-center gap-1.5 py-0.5 pr-2 text-left ${marcada ? "bg-hover fg" : "fg-muted hover:fg hover:bg-hover"}`;
  const titulo = "px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide fg-faint ui-small";
  const nada = resultados.porNombre.length === 0 && resultados.enFicheros.length === 0;
  return (
    <div className="pb-1">
      {nada && <p className="px-3 py-1 fg-muted">{labels.sinResultados(consulta)}</p>}
      {resultados.porNombre.length > 0 && (
        <>
          <div className={titulo}>{labels.porNombre}</div>
          <ul>
            {resultados.porNombre.map((ruta) => (
              <li key={ruta}>
                <button
                  type="button"
                  aria-current={ruta === elegido ? "true" : undefined}
                  onClick={() => onAbrir(ruta, null)}
                  className={`${fila(esActivo(ruta, null))} pl-3`}
                >
                  <FileText size={12} />
                  <span className="truncate">{ruta.replace(/^\//, "")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {resultados.enFicheros.length > 0 && (
        <>
          <div className={titulo}>{labels.enFicheros}</div>
          <ul>
            {resultados.enFicheros.map((f) => (
              <li key={f.ruta}>
                <button type="button" onClick={() => onAbrir(f.ruta, f.lineas[0]!.linea)} className={`${fila(false)} pl-3`}>
                  <FileText size={12} />
                  <span className="truncate">{f.ruta.replace(/^\//, "")}</span>
                  <span className="ml-auto shrink-0 tabular-nums fg-faint">{f.lineas.length}</span>
                </button>
                <ul>
                  {f.lineas.map((l) => (
                    <li key={l.linea}>
                      <button
                        type="button"
                        onClick={() => onAbrir(f.ruta, l.linea)}
                        className={`${fila(esActivo(f.ruta, l.linea))} pl-4 font-mono text-[11px]`}
                      >
                        <span className="w-7 shrink-0 select-none text-right tabular-nums fg-faint">{l.linea}</span>
                        <span className="min-w-0 truncate whitespace-pre">
                          {l.antes}
                          <mark className="rounded-sm bg-accent-soft text-accent">{l.casa}</mark>
                          {l.despues}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {resultados.mas > 0 && <p className="px-3 pt-1 text-[11px] fg-faint ui-small">{labels.masCoincidencias(resultados.mas)}</p>}
      {resultados.sinContenido > 0 && (
        <p className="px-3 pt-1 text-[11px] fg-faint ui-small">{labels.sinContenido(resultados.sinContenido)}</p>
      )}
    </div>
  );
}

function Bloque({
  etiqueta,
  nota,
  codigo,
  lenguaje,
  salto = null,
  comentar: donde = null,
  editar = null,
  labels,
}: {
  /** El fichero de un proyecto: sus líneas se pueden comentar (la #8). */
  comentar?: { readonly projectId: string; readonly ruta: string } | null;
  /** Y se puede editar a mano (la #18). */
  editar?: { readonly projectId: string; readonly ruta: string; readonly onGuardado: () => void } | null;
  etiqueta: string;
  nota?: string;
  codigo: string;
  /** Con qué colores se pinta (la #15); null, sin color. */
  lenguaje: Lenguaje | null;
  /** Una línea a la que ir (un resultado de la búsqueda): se centra y se resalta. */
  salto?: { readonly linea: number; readonly n: number } | null;
  labels: CodeViewProps["labels"];
}) {
  const [copiado, setCopiado] = useState(false);
  const lineas = useMemo(() => colorearLineas(codigo, lenguaje), [codigo, lenguaje]);
  const crudas = useMemo(() => codigo.split("\n"), [codigo]);
  const comentar = useComentarLineas(donde?.projectId, donde?.ruta ?? null);
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);
  // A la línea del resultado, UNA vez por salto: si el contenido llega después
  // (un fichero que se calcula al abrirlo), cuando llegue. Y no otra vez cada vez
  // que el lienzo cambie mientras se mira.
  const seccion = useRef<HTMLElement>(null);
  const saltado = useRef<number | null>(null);
  useEffect(() => {
    if (!salto || saltado.current === salto.n) return;
    const el = seccion.current?.querySelector(`[data-linea="${salto.linea}"]`);
    if (!el) return;
    saltado.current = salto.n;
    el.scrollIntoView?.({ block: "center" });
  }, [salto, codigo]);

  return (
    <section ref={seccion} className="min-w-0">
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
        {editar && !editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="inline-flex items-center gap-1 rounded-md border bd px-2 py-1 text-[11px] fg-muted hover:fg hover:bg-hover transition ui-small"
          >
            <Pencil size={11} />
            {labels.editar.editar}
          </button>
        )}
      </header>
      {editar && editando && (
        <EditorDeFichero
          projectId={editar.projectId}
          ruta={editar.ruta}
          labels={labels.editar}
          onCerrar={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            editar.onGuardado();
          }}
        />
      )}
      {/* El código NUNCA se interpreta: va como texto dentro de <code>. Es la
          misma regla que el resto del taller — lo que el modelo escribe no se
          ejecuta fuera de su cápsula. */}
      {/* LAS LÍNEAS BAJAN, no se van a la derecha (Jesús, 02/10): el «ajuste
          de línea» de VS Code. Una línea larga —un HTML en una sola fila— se
          parte por donde haga falta, y su número queda en la primera fila. */}
      <pre className={`p-3 text-[11.5px] leading-[1.55]${editando ? " hidden" : ""}`}>
        <code className="block font-mono">
          {lineas.map((linea, i) => (
            <Fragment key={i}>
              <span data-linea={i + 1} className={`flex${salto?.linea === i + 1 ? " bg-accent-soft" : ""}`}>
                {comentar.activo ? (
                  <NumeroComentable
                    n={i + 1}
                    conComentario={comentar.deLaLinea(i + 1, false).length > 0}
                    onComentar={() => comentar.abrir(claveDeLinea(i + 1, false))}
                    label={labels.comentar.comentarLinea(i + 1)}
                    className="w-9 pr-3"
                  />
                ) : (
                  <span className="w-9 shrink-0 select-none pr-3 text-right fg-faint tabular">{i + 1}</span>
                )}
                <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <LineaColoreada trozos={linea} />
                </span>
              </span>
              {comentar.activo && (
                <DebajoDeLaLinea comentar={comentar} linea={i + 1} deAntes={false} codigo={crudas[i] ?? ""} labels={labels.comentar} />
              )}
            </Fragment>
          ))}
        </code>
      </pre>
    </section>
  );
}

export function CodeView({ html, projectId, rutaActual = "/index.html", peticion = null, onClose, labels }: CodeViewProps) {
  const cierreRef = useRef<HTMLDivElement>(null);

  // Escape cierra, como cualquier panel superpuesto. Se engancha al documento
  // porque el foco puede estar en el <pre> o en el botón de copiar. Un Escape
  // que ya atendió el buscador (`preventDefault`) no cierra: en /new React
  // escucha en el propio `document`, y su `stopPropagation` no frena a este
  // oyente, que está en el mismo nodo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
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
          <Explorador projectId={projectId} rutaActual={rutaActual} htmlActual={html} peticion={peticion} labels={labels} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto nice-scroll">
          {/* UN SOLO BLOQUE. Enseñaba el documento y, aparte, «el script» —
              porque el JavaScript vivía en otra columna y el HTML que veías NO
              era lo que se publicaba. Desde el 2026-08-26 el `<script>` es parte
              del documento: lo que ves aquí es, byte a byte, lo que se guarda y
              lo que se sirve. */}
          <Bloque etiqueta={labels.document} codigo={html} lenguaje="html" labels={labels} />
        </div>
      )}
    </div>
  );
}
