"use client";

// EL CÓDIGO DEL PROYECTO, COMO EN VS CODE (Jesús, 07/10: «que el tab del
// código sea como Visual Studio: que puedas agregar carpetas y trabajar ahí; no
// todo, pero lo que casi todo el mundo usa»).
//
// POR QUÉ EXISTE. OpenLen es para gente que no programa, pero también lo usan
// técnicos — y para un técnico una caja negra es una razón para no usarte. El
// artefacto YA es el código (un HTML plano, o el React de una app en /src): no
// hay nada que construir, sólo que enseñarlo y dejarlo tocar.
//
// LO QUE TIENE, lo de VS Code que casi todo el mundo usa:
//   · EL EXPLORADOR: el árbol con «Nuevo archivo», «Nueva carpeta», «Contraer»
//     y «Actualizar»; clic derecho (o «…») para crear dentro, renombrar,
//     borrar y copiar la ruta; el nombre se escribe en el propio árbol; F2
//     renombra y Supr borra lo elegido. Una carpeta son sus archivos: una
//     recién creada vive aquí hasta que tenga uno.
//   · LAS PESTAÑAS: varios archivos abiertos, un punto en el que tiene cambios
//     sin guardar, cerrar con la × o con el botón central.
//   · EL EDITOR (`editor-codigo.tsx`, CodeMirror): colores, Tab, cierre de
//     paréntesis, plegar, varios cursores, buscar y reemplazar (Ctrl+F),
//     Ctrl+S guarda; Ctrl+P lleva a buscar un archivo por nombre y Ctrl+Mayús+F
//     a buscar dentro de todos (la #11).
//   · Y lo de OpenLen: el número de una línea la comenta para el siguiente
//     mensaje a Len (la #8), y un punto en el árbol marca lo que cambió en esta
//     pestaña (la #19).
//
// TODO VA POR EL CAMINO DE TU TERMINAL (`/api/projects/[id]/ficheros`:
// `editar-a-mano.ts` para guardar y `operar-a-mano.ts` para crear, renombrar y
// borrar), con sus guardas y una versión a tu nombre. Guardar compara con lo que
// había al abrirlo: si Len (o el editor del lienzo, o tu terminal) lo cambió
// mientras tanto, no se pisa — se avisa. Las páginas se borran con su ruta de
// siempre y no se renombran (su dirección y sus enlaces dependen del nombre).
//
// Lo abierto y lo no guardado se recuerda por proyecto mientras dura la
// pestaña del navegador: mirar la app y volver no pierde nada.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { ChevronsDownUp, FilePlus, FolderPlus, MoreHorizontal, RefreshCw } from "lucide-react";
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
import { carpetaDe, carpetaDestino, estaDentro, moverRuta, nombreValido, paginaDe, rutaDentro } from "@/lib/workspace-v2/explorador";
import { colorearLineas, lenguajeDe, type Lenguaje } from "@/lib/workspace-v2/colorear";
import { notifyFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

import { copiar } from "./copiar";
import { DebajoDeLaLinea, claveDeLinea, useComentarLineas, type EtiquetasDeComentar } from "./comentar-linea";
import { LineaColoreada } from "./linea-coloreada";
import { Check, ChevronDown, ChevronRight, Copy, FileText, Search, X } from "./icons";
import { IconBtn } from "./ui";

// El editor carga CodeMirror: sólo cuando se abre un archivo, y nunca en el servidor.
const EditorCodigo = dynamic(() => import("./editor-codigo"), { ssr: false });

/** Guardar un archivo editado. */
export interface EtiquetasDelEditor {
  readonly guardar: string;
  readonly guardando: string;
  readonly cargando: string;
  /** Cambió mientras lo editabas; no se guardó nada. */
  readonly cambio: string;
  readonly cargarAhora: string;
  /** «No se guardó:», delante del motivo de la guarda. */
  readonly rechazado: string;
  readonly error: string;
  /** Se guarda como tu versión y Len lo ve en su próximo turno. */
  readonly nota: string;
}

/** El explorador y las pestañas, como en VS Code. */
export interface EtiquetasDelIde {
  readonly nuevoArchivo: string;
  readonly nuevaCarpeta: string;
  readonly contraer: string;
  readonly actualizar: string;
  readonly acciones: string;
  readonly renombrar: string;
  readonly borrar: string;
  readonly copiarRuta: string;
  readonly nombre: string;
  readonly nombreInvalido: string;
  readonly existe: (ruta: string) => string;
  readonly pagina: string;
  readonly portada: string;
  readonly confirmarBorrar: (ruta: string) => string;
  readonly confirmarBorrarCarpeta: (ruta: string) => string;
  readonly confirmarCerrar: (nombre: string) => string;
  readonly cerrarPestana: string;
  readonly sinGuardar: string;
  readonly vacio: string;
  readonly comentarAyuda: string;
  readonly carpetaVacia: string;
  readonly cerrarAviso: string;
  readonly noSeHizo: string;
  /** Las frases del editor (buscar y reemplazar, plegar), por su texto en inglés. */
  readonly frasesDelEditor?: Readonly<Record<string, string>>;
}

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
    /** Guardar lo editado (la #18). */
    readonly editar: EtiquetasDelEditor;
    readonly ide: EtiquetasDelIde;
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
  /** Cuándo se PIDIÓ (no cuándo llegó): ver `guardadoEn`. */
  readonly pedidaEn?: number;
}

type EstadoDelBuffer =
  | { readonly tipo: "listo" }
  | { readonly tipo: "guardando" }
  | { readonly tipo: "cambio"; readonly actual: string }
  | { readonly tipo: "rechazado"; readonly detalle: string }
  | { readonly tipo: "error" };

/** Un archivo abierto para editar: lo guardado (`base`), lo escrito y su estado. */
interface Buffer {
  readonly base: string;
  readonly texto: string;
  /** Sube cuando el texto cambia POR FUERA (ver `editor-codigo.tsx`). */
  readonly revision: number;
  readonly estado: EstadoDelBuffer;
}

/** Lo que se recuerda de un proyecto mientras dura la pestaña del navegador. */
interface Sesion {
  readonly pestanas: readonly string[];
  readonly activa: string | null;
  readonly buffers: Readonly<Record<string, Buffer>>;
  readonly carpetasVacias: readonly string[];
}
const SESIONES = new Map<string, Sesion>();

/** ¿Algún proyecto tiene cambios sin guardar en el editor? (aviso al cerrar la pestaña) */
const hayCambiosSinGuardar = () =>
  [...SESIONES.values()].some((s) => Object.values(s.buffers).some((b) => b.texto !== b.base));

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

/** Avisa al taller (el lienzo, la barra de páginas) de que el proyecto cambió por aquí. */
function avisarAlTaller(projectId: string, rutas: readonly string[]): void {
  if (typeof BroadcastChannel !== "undefined") {
    const canal = new BroadcastChannel("openlen-project-sync");
    canal.postMessage({ projectId });
    canal.close();
  }
  // Un fichero de la carpeta (no una página) no cambia el documento: el
  // lienzo se recarga con el aviso (lib/lienzo/carpeta-cambiada.ts).
  if (rutas.some((r) => paginaDe(r) === undefined)) notifyFolderChanged(projectId);
}

const nombreDe = (ruta: string) => ruta.slice(ruta.lastIndexOf("/") + 1);

/** Lo que se está escribiendo en el árbol: un nombre nuevo, o el de algo que se renombra. */
type Edicion =
  | { readonly tipo: "nuevo"; readonly que: "fichero" | "carpeta"; readonly carpeta: string }
  | { readonly tipo: "renombrar"; readonly ruta: string; readonly que: "fichero" | "carpeta" };

/**
 * EL EXPLORADOR, como el de VS Code: el árbol a la izquierda (arriba en el
 * móvil), y a la derecha las pestañas con el editor. Los de `/.openlen`
 * (resultados, bandeja, catálogo y versiones) se piden al abrirlos —cuestan
 * consultas— y son de sólo lectura.
 */
function Explorador({
  projectId,
  rutaActual,
  peticion,
  labels,
}: {
  projectId: string;
  rutaActual: string;
  peticion: PeticionDeCodigo | null;
  labels: CodeViewProps["labels"];
}) {
  const ide = labels.ide;
  const recordada = SESIONES.get(projectId);
  const [lista, setLista] = useState<ListaDeFicheros | "cargando" | "error">("cargando");
  const [perezosos, setPerezosos] = useState<Readonly<Record<string, string | "cargando" | "error">>>({});
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);
  // LAS PESTAÑAS y lo escrito en ellas. Al entrar, lo que se recordaba de este
  // proyecto; si no, la página abierta (o la que pidió el Chat).
  const [pestanas, setPestanas] = useState<readonly string[]>(() => {
    const base = recordada?.pestanas ?? [rutaActual];
    return peticion && !base.includes(peticion.ruta) ? [...base, peticion.ruta] : base;
  });
  const [activa, setActiva] = useState<string | null>(() => peticion?.ruta ?? recordada?.activa ?? rutaActual);
  const [buffers, setBuffers] = useState<Readonly<Record<string, Buffer>>>(() => recordada?.buffers ?? {});
  const [carpetasVacias, setCarpetasVacias] = useState<readonly string[]>(() => recordada?.carpetasVacias ?? []);
  useEffect(() => {
    SESIONES.set(projectId, { pestanas, activa, buffers, carpetasVacias });
  }, [projectId, pestanas, activa, buffers, carpetasVacias]);
  // Cerrar la pestaña del NAVEGADOR con algo sin guardar avisa, como VS Code.
  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => {
      if (!hayCambiosSinGuardar()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, []);

  // Lo elegido en el árbol (F2, Supr, y dónde nace lo nuevo), lo que se escribe
  // en él, el menú del clic derecho y el aviso de lo que no se pudo hacer.
  const [seleccion, setSeleccion] = useState<{ readonly ruta: string; readonly tipo: "carpeta" | "fichero" } | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [menu, setMenu] = useState<{ readonly nodo: NodoDelArbol; readonly x: number; readonly y: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // BUSCAR (la #11): lo escrito, cuál de los resultados está activo con las
  // flechas, y la línea a la que saltar al abrir un resultado de contenido.
  const [consulta, setConsulta] = useState("");
  const [activo, setActivo] = useState(0);
  const [salto, setSalto] = useState<{ readonly linea: number; readonly n: number } | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  // La lista se vuelve a pedir tras cada cambio de aquí, y cuando Len cambia algo.
  const [recarga, setRecarga] = useState(0);
  const turnosConCambios = useSyncExternalStore(
    cambiosEnVivo.subscribe,
    () => cambiosEnVivo.turnos(projectId),
    () => SIN_CAMBIOS,
  );
  // Cuándo se guardó cada archivo desde aquí: una lista pedida ANTES de ese
  // guardado y llegada después trae lo de antes, y no puede deshacerlo.
  const guardadoEn = useRef<Record<string, number>>({});
  useEffect(() => {
    let vivo = true;
    const pedidaEn = Date.now();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ListaDeFicheros>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => vivo && setLista({ ...j, pedidaEn }))
      .catch(() => vivo && setLista((l) => (typeof l === "string" ? "error" : l)));
    return () => {
      vivo = false;
    };
  }, [projectId, recarga, turnosConCambios]);

  const guardados = useMemo(
    () => new Map(typeof lista === "string" ? [] : lista.ficheros.map((f) => [f.ruta, f.contenido] as const)),
    [lista],
  );
  // LO QUE CAMBIÓ POR FUERA llega a las pestañas SIN cambios: las que tienen
  // algo escrito se quedan como están, y guardarlas avisará (`cambio`).
  useEffect(() => {
    if (typeof lista === "string") return;
    setBuffers((prev) => {
      let cambio = false;
      const nuevos: Record<string, Buffer> = { ...prev };
      for (const [ruta, b] of Object.entries(prev)) {
        const ahora = guardados.get(ruta);
        if (ahora === undefined || ahora === b.base || b.texto !== b.base || b.estado.tipo === "guardando") continue;
        if ((guardadoEn.current[ruta] ?? 0) >= (lista.pedidaEn ?? 0)) continue;
        nuevos[ruta] = { base: ahora, texto: ahora, revision: b.revision + 1, estado: { tipo: "listo" } };
        cambio = true;
      }
      return cambio ? nuevos : prev;
    });
  }, [lista, guardados]);

  const arbol = useMemo(
    () =>
      typeof lista === "string"
        ? arbolDeFicheros([{ ruta: rutaActual }])
        : arbolDeFicheros([
            ...lista.ficheros.map((f) => ({ ruta: f.ruta })),
            ...lista.perezosos.map((ruta) => ({ ruta, perezoso: true })),
            ...carpetasVacias.map((ruta) => ({ ruta, carpeta: true })),
          ]),
    [lista, rutaActual, carpetasVacias],
  );
  // Las carpetas abiertas se deciden UNA vez, al llegar la lista; luego mandan los clics.
  useEffect(() => {
    if (typeof lista !== "string" && abiertas === null) setAbiertas(abiertasAlEntrar(arbol, activa));
  }, [lista, arbol, abiertas, activa]);

  const pedirPerezoso = useCallback(
    (ruta: string) => {
      setPerezosos((p) => {
        if (p[ruta] !== undefined && p[ruta] !== "error") return p;
        fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros?ruta=${encodeURIComponent(ruta)}`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<{ contenido: string }>) : Promise.reject(new Error(String(r.status)))))
          // Sin `contenido`, error: si no, se quedaría sin valor y se volvería a pedir sin fin.
          .then((j) => setPerezosos((q) => ({ ...q, [ruta]: typeof j.contenido === "string" ? j.contenido : "error" })))
          .catch(() => setPerezosos((q) => ({ ...q, [ruta]: "error" })));
        return { ...p, [ruta]: "cargando" };
      });
    },
    [projectId],
  );

  const esPerezoso = (ruta: string) => typeof lista !== "string" && lista.perezosos.includes(ruta);

  /** Abrir en una pestaña (o ir a la suya), con sus carpetas desplegadas. */
  const abrir = useCallback((ruta: string, linea: number | null = null) => {
    setPestanas((p) => (p.includes(ruta) ? p : [...p, ruta]));
    setActiva(ruta);
    setSeleccion({ ruta, tipo: "fichero" });
    setSalto(linea === null ? null : { linea, n: Date.now() });
    setAbiertas(conCarpetasHasta(ruta));
  }, []);

  // UNA RUTA PULSADA EN EL CHAT con la lente ya abierta: ese fichero.
  const nPeticion = peticion?.n ?? 0;
  const atendida = useRef(nPeticion);
  useEffect(() => {
    if (!peticion || nPeticion <= atendida.current) return;
    atendida.current = nPeticion;
    abrir(peticion.ruta);
  }, [nPeticion, peticion, abrir]);
  // Un fichero de los que se calculan al abrirlos, en la pestaña activa: se pide.
  useEffect(() => {
    if (activa && esPerezoso(activa) && perezosos[activa] === undefined) pedirPerezoso(activa);
  });

  const cerrarPestana = (ruta: string) => {
    const b = buffers[ruta];
    if (b && b.texto !== b.base && !window.confirm(ide.confirmarCerrar(nombreDe(ruta)))) return;
    setPestanas((p) => {
      const i = p.indexOf(ruta);
      const quedan = p.filter((r) => r !== ruta);
      if (activa === ruta) setActiva(quedan[Math.min(i, quedan.length - 1)] ?? null);
      return quedan;
    });
    setBuffers((prev) => {
      const { [ruta]: _fuera, ...resto } = prev;
      void _fuera;
      return resto;
    });
  };

  // ── Lo que se ve de cada archivo ──────────────────────────────────────────
  const editable = (ruta: string) => guardados.has(ruta) && !esDeSoloLectura(ruta);
  const bufferDe = (ruta: string): Buffer | null => {
    if (buffers[ruta]) return buffers[ruta]!;
    const g = guardados.get(ruta);
    return g === undefined ? null : { base: g, texto: g, revision: 0, estado: { tipo: "listo" } };
  };
  const ponerBuffer = (ruta: string, f: (b: Buffer) => Buffer) =>
    setBuffers((prev) => {
      const b = prev[ruta] ?? bufferDe(ruta);
      return b ? { ...prev, [ruta]: f(b) } : prev;
    });

  const guardar = async (ruta: string) => {
    const b = bufferDe(ruta);
    if (!b || b.texto === b.base || b.estado.tipo === "guardando") return;
    const enviado = b.texto;
    ponerBuffer(ruta, (x) => ({ ...x, estado: { tipo: "guardando" } }));
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruta, contenido: enviado, base: b.base }),
      });
      const j = (await r.json().catch(() => ({}))) as { contenido?: string; actual?: string; detalle?: string };
      if (r.ok && typeof j.contenido === "string") {
        const guardado = j.contenido;
        guardadoEn.current[ruta] = Date.now();
        // Lo que se escribió MIENTRAS se guardaba se queda; si no, lo guardado
        // (la plataforma pudo normalizarlo) entra en el editor.
        ponerBuffer(ruta, (x) =>
          x.texto === enviado
            ? { base: guardado, texto: guardado, revision: guardado === enviado ? x.revision : x.revision + 1, estado: { tipo: "listo" } }
            : { ...x, base: guardado, estado: { tipo: "listo" } },
        );
        avisarAlTaller(projectId, [ruta]);
        setRecarga((n) => n + 1);
        return;
      }
      if (r.status === 409 && typeof j.actual === "string") {
        const actual = j.actual;
        return ponerBuffer(ruta, (x) => ({ ...x, estado: { tipo: "cambio", actual } }));
      }
      if (r.status === 422 && typeof j.detalle === "string") {
        const detalle = j.detalle;
        return ponerBuffer(ruta, (x) => ({ ...x, estado: { tipo: "rechazado", detalle } }));
      }
      ponerBuffer(ruta, (x) => ({ ...x, estado: { tipo: "error" } }));
    } catch {
      ponerBuffer(ruta, (x) => ({ ...x, estado: { tipo: "error" } }));
    }
  };

  // ── Crear, renombrar y borrar ─────────────────────────────────────────────
  const rutasDeLaLista = useMemo(
    () => (typeof lista === "string" ? [] : [...lista.ficheros.map((f) => f.ruta), ...lista.perezosos]),
    [lista],
  );
  const existe = (ruta: string) =>
    rutasDeLaLista.some((r) => estaDentro(r, ruta)) || carpetasVacias.some((c) => estaDentro(c, ruta));
  const desplegar = (ruta: string) =>
    setAbiertas((a) => {
      const nuevas = new Set(a ?? []);
      for (let i = ruta.indexOf("/", 1); i > 0; i = ruta.indexOf("/", i + 1)) nuevas.add(ruta.slice(0, i));
      nuevas.add(ruta);
      return nuevas;
    });
  const explicar = async (r: Response) => {
    const j = (await r.json().catch(() => ({}))) as { error?: string; rutas?: string[]; detalle?: string };
    if (j.error === "existe") return ide.existe(j.rutas?.[0] ?? "");
    if (j.error === "pagina") return ide.pagina;
    if (j.error === "rechazado" && j.detalle) return `${ide.noSeHizo} ${j.detalle}`;
    return labels.editar.error;
  };

  const crear = async (que: "fichero" | "carpeta", ruta: string) => {
    setAviso(null);
    if (existe(ruta)) return setAviso(ide.existe(ruta));
    if (que === "carpeta") {
      setCarpetasVacias((c) => [...c, ruta]);
      desplegar(ruta);
      setSeleccion({ ruta, tipo: "carpeta" });
      return;
    }
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ruta }),
    }).catch(() => null);
    if (!r?.ok) return setAviso(r ? await explicar(r) : labels.editar.error);
    // La carpeta vacía en la que nació ya existe de verdad.
    setCarpetasVacias((c) => c.filter((x) => !estaDentro(ruta, x)));
    avisarAlTaller(projectId, [ruta]);
    setRecarga((n) => n + 1);
    abrir(ruta);
  };

  const renombrar = async (de: string, a: string, que: "fichero" | "carpeta") => {
    setAviso(null);
    if (a === de) return;
    if (existe(a)) return setAviso(ide.existe(a));
    const soloVacia = que === "carpeta" && !rutasDeLaLista.some((r) => estaDentro(r, de));
    if (!soloVacia) {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ de, a }),
      }).catch(() => null);
      if (!r?.ok) return setAviso(r ? await explicar(r) : labels.editar.error);
      avisarAlTaller(projectId, [de, a]);
      setRecarga((n) => n + 1);
    }
    // Lo abierto, lo escrito y lo desplegado siguen a su ruta nueva.
    setCarpetasVacias((c) => c.map((x) => moverRuta(x, de, a)));
    setPestanas((p) => p.map((x) => moverRuta(x, de, a)));
    setActiva((x) => (x ? moverRuta(x, de, a) : x));
    setBuffers((prev) => Object.fromEntries(Object.entries(prev).map(([r, b]) => [moverRuta(r, de, a), b])));
    setAbiertas((s) => (s ? new Set([...s].map((x) => moverRuta(x, de, a))) : s));
    setSeleccion({ ruta: a, tipo: que });
  };

  const borrar = async (ruta: string, que: "fichero" | "carpeta") => {
    setAviso(null);
    if (ruta === "/index.html") return setAviso(ide.portada);
    if (!window.confirm(que === "carpeta" ? ide.confirmarBorrarCarpeta(ruta) : ide.confirmarBorrar(ruta))) return;
    const quitarDeAqui = () => {
      setCarpetasVacias((c) => c.filter((x) => !estaDentro(x, ruta)));
      setPestanas((p) => {
        const quedan = p.filter((x) => !estaDentro(x, ruta));
        setActiva((x) => (x && estaDentro(x, ruta) ? (quedan.at(-1) ?? null) : x));
        return quedan;
      });
      setBuffers((prev) => Object.fromEntries(Object.entries(prev).filter(([r]) => !estaDentro(r, ruta))));
      setSeleccion(null);
    };
    if (que === "carpeta" && !rutasDeLaLista.some((r) => estaDentro(r, ruta))) return quitarDeAqui();
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ficheros?ruta=${encodeURIComponent(ruta)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (r?.status === 409) {
      const j = (await r.json().catch(() => ({}))) as { error?: string; rutas?: string[] };
      if (j.error !== "pagina") return setAviso(labels.editar.error);
      // LAS PÁGINAS, con su ruta de siempre (que también limpia sus formularios).
      for (const p of j.rutas ?? []) {
        const slug = paginaDe(p);
        if (slug === null) {
          setAviso(ide.portada);
          continue;
        }
        if (slug === undefined) continue;
        const b = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(
          () => null,
        );
        if (!b?.ok) setAviso(labels.editar.error);
      }
    } else if (!r?.ok) {
      return setAviso(r ? await explicar(r) : labels.editar.error);
    }
    quitarDeAqui();
    avisarAlTaller(projectId, [ruta]);
    setRecarga((n) => n + 1);
  };

  const empezarNuevo = (que: "fichero" | "carpeta", donde: { readonly ruta: string; readonly tipo: "carpeta" | "fichero" } | null) => {
    const carpeta = carpetaDestino(donde);
    if (carpeta) desplegar(carpeta);
    setMenu(null);
    setEdicion({ tipo: "nuevo", que, carpeta });
  };
  const aceptarEdicion = (nombre: string) => {
    const e = edicion;
    setEdicion(null);
    if (!e) return;
    if (e.tipo === "nuevo") void crear(e.que, rutaDentro(e.carpeta, nombre));
    else void renombrar(e.ruta, rutaDentro(carpetaDe(e.ruta), nombre), e.que);
  };

  // ── Teclado ───────────────────────────────────────────────────────────────
  // Ctrl/Cmd+P busca un archivo por nombre y Ctrl/Cmd+Mayús+F dentro de todos, como en VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tecla = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && tecla === "f") || (!e.shiftKey && tecla === "p"))) {
        e.preventDefault();
        buscador.current?.focus();
        buscador.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // F2 renombra y Supr borra lo elegido en el árbol.
  const teclaEnElArbol = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (edicion || !seleccion || (e.target as HTMLElement).tagName === "INPUT") return;
    const nodo = buscarNodo(arbol, seleccion.ruta);
    if (!nodo || nodo.soloLectura || nodo.perezoso) return;
    if (e.key === "F2" && paginaDe(nodo.ruta) === undefined) {
      e.preventDefault();
      setEdicion({ tipo: "renombrar", ruta: nodo.ruta, que: nodo.tipo });
    } else if (e.key === "Delete" || ((e.metaKey || e.ctrlKey) && e.key === "Backspace")) {
      e.preventDefault();
      void borrar(nodo.ruta, nodo.tipo);
    }
  };

  // ── Buscar (la #11) ───────────────────────────────────────────────────────
  // Cada fichero con lo que tiene ahora (lo escrito en su pestaña, si lo hay);
  // los que se calculan al abrirlos, sólo si ya se abrieron.
  const buscables = useMemo<FicheroBuscable[]>(() => {
    if (typeof lista === "string") return [];
    return [
      ...lista.ficheros.map((f) => ({ ruta: f.ruta, contenido: buffers[f.ruta]?.texto ?? f.contenido })),
      ...lista.perezosos.map((ruta) => {
        const p = perezosos[ruta];
        return { ruta, contenido: p === undefined || p === "cargando" || p === "error" ? null : p };
      }),
    ];
  }, [lista, buffers, perezosos]);
  const resultados = useMemo(() => buscarEnFicheros(buscables, consulta), [buscables, consulta]);
  /** Los resultados en el orden de las flechas: primero los nombres, después las líneas. */
  const enOrden = useMemo(
    () => [
      ...resultados.porNombre.map((ruta) => ({ ruta, linea: null as number | null })),
      ...resultados.enFicheros.flatMap((f) => f.lineas.map((l) => ({ ruta: f.ruta, linea: l.linea as number | null }))),
    ],
    [resultados],
  );
  const teclaEnElBuscador = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (enOrden.length === 0) return;
      setActivo((a) => (a + (e.key === "ArrowDown" ? 1 : enOrden.length - 1)) % enOrden.length);
    } else if (e.key === "Enter") {
      const r = enOrden[Math.min(activo, enOrden.length - 1)];
      if (r) abrir(r.ruta, r.linea);
    } else if (e.key === "Escape" && consulta) {
      // Escape borra la búsqueda; sólo con el buscador vacío cierra la lente.
      e.preventDefault();
      e.stopPropagation();
      setConsulta("");
    }
  };

  // LO QUE CAMBIÓ EN ESTA PESTAÑA (la #19), con la misma foto que la lente
  // «Cambios»: un punto junto al fichero y, atenuado, junto a sus carpetas.
  const marcas = useMemo(() => marcasDeCambios(turnosConCambios), [turnosConCambios]);
  const carpetasMarcadas = useMemo(() => carpetasConMarca(marcas), [marcas]);

  const plegar = (ruta: string) =>
    setAbiertas((a) => {
      const nuevas = new Set(a ?? []);
      if (nuevas.has(ruta)) nuevas.delete(ruta);
      else nuevas.add(ruta);
      return nuevas;
    });

  const abrirMenu = (e: ReactMouseEvent, nodo: NodoDelArbol) => {
    e.preventDefault();
    setSeleccion({ ruta: nodo.ruta, tipo: nodo.tipo });
    const caja = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ nodo, x: e.type === "contextmenu" ? e.clientX : caja.right - 4, y: e.type === "contextmenu" ? e.clientY : caja.bottom });
  };

  const pintar = (nodos: readonly NodoDelArbol[], nivel: number, carpeta: string): ReactNode => {
    const sangria = { paddingLeft: 8 + nivel * 12 };
    const nueva =
      edicion?.tipo === "nuevo" && edicion.carpeta === carpeta ? (
        <li key="__nuevo">
          <EntradaDeNombre
            inicial=""
            sangria={8 + nivel * 12}
            carpeta={edicion.que === "carpeta"}
            labels={ide}
            onAceptar={aceptarEdicion}
            onCancelar={() => setEdicion(null)}
          />
        </li>
      ) : null;
    return (
      <ul>
        {nueva}
        {nodos.map((n) => {
          // Sin decisión todavía (la lista no llegó), abierta la que lleva a la activa.
          const abierta = abiertas?.has(n.ruta) ?? (activa ?? "").startsWith(`${n.ruta}/`);
          const elegida = seleccion?.ruta === n.ruta;
          if (edicion?.tipo === "renombrar" && edicion.ruta === n.ruta) {
            return (
              <li key={n.ruta}>
                <EntradaDeNombre
                  inicial={n.nombre}
                  sangria={8 + nivel * 12}
                  carpeta={n.tipo === "carpeta"}
                  labels={ide}
                  onAceptar={aceptarEdicion}
                  onCancelar={() => setEdicion(null)}
                />
                {n.tipo === "carpeta" && abierta && pintar(n.hijos, nivel + 1, n.ruta)}
              </li>
            );
          }
          const vacia = n.tipo === "carpeta" && carpetasVacias.includes(n.ruta) && n.hijos.length === 0;
          return (
            <li key={n.ruta}>
              <div
                className={`group relative flex items-center ${elegida ? "bg-hover" : "hover:bg-hover"}`}
                onContextMenu={(e) => abrirMenu(e, n)}
              >
                {n.tipo === "carpeta" ? (
                  <button
                    type="button"
                    aria-expanded={abierta}
                    onClick={() => {
                      plegar(n.ruta);
                      setSeleccion({ ruta: n.ruta, tipo: "carpeta" });
                    }}
                    style={sangria}
                    title={vacia ? ide.carpetaVacia : undefined}
                    className="flex min-w-0 flex-1 items-center gap-1 py-0.5 pr-7 text-left fg-muted hover:fg"
                  >
                    {abierta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className={`truncate${vacia ? " italic" : ""}`}>{n.nombre}</span>
                    {carpetasMarcadas.has(n.ruta) && (
                      <span aria-hidden className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] opacity-40" />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-current={n.ruta === activa ? "true" : undefined}
                    onClick={() => abrir(n.ruta)}
                    style={sangria}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-7 text-left ${n.ruta === activa ? "fg" : "fg-muted hover:fg"}`}
                  >
                    <FileText size={12} />
                    <span className="truncate">{n.nombre}</span>
                    {buffers[n.ruta] && buffers[n.ruta]!.texto !== buffers[n.ruta]!.base && (
                      <span aria-label={ide.sinGuardar} className="shrink-0 fg">
                        ●
                      </span>
                    )}
                    <MarcaDelFichero marca={marcas.get(n.ruta)} labels={labels} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`${ide.acciones}: ${n.nombre}`}
                  title={ide.acciones}
                  onClick={(e) => abrirMenu(e, n)}
                  className="absolute right-1 hidden h-5 w-5 place-items-center rounded fg-faint hover:fg group-hover:grid group-focus-within:grid"
                >
                  <MoreHorizontal size={12} />
                </button>
              </div>
              {n.tipo === "carpeta" && abierta && pintar(n.hijos, nivel + 1, n.ruta)}
            </li>
          );
        })}
      </ul>
    );
  };

  const nodoActivo = activa ? buscarNodo(arbol, activa) : null;
  const contenidoActivo: string | "cargando" | "error" | "no-esta" | null = !activa
    ? null
    : editable(activa)
      ? bufferDe(activa)!.texto
      : esPerezoso(activa)
        ? (perezosos[activa] ?? "cargando")
        : typeof lista === "string"
          ? lista
          : guardados.get(activa) ?? "no-esta";

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav
        aria-label={labels.files}
        onKeyDown={teclaEnElArbol}
        className="max-h-56 shrink-0 overflow-auto nice-scroll border-b bd py-1 text-[12px] md:max-h-none md:w-60 md:border-b-0 md:border-r"
      >
        <div className="flex items-center gap-0.5 px-3 py-1">
          <span className="text-[10.5px] uppercase tracking-wide fg-faint ui-small">{labels.files}</span>
          <span className="ml-auto flex items-center">
            <IconBtn label={ide.nuevoArchivo} size="sm" onClick={() => empezarNuevo("fichero", seleccion)}>
              <FilePlus size={13} />
            </IconBtn>
            <IconBtn label={ide.nuevaCarpeta} size="sm" onClick={() => empezarNuevo("carpeta", seleccion)}>
              <FolderPlus size={13} />
            </IconBtn>
            <IconBtn label={ide.actualizar} size="sm" onClick={() => setRecarga((n) => n + 1)}>
              <RefreshCw size={12} />
            </IconBtn>
            <IconBtn label={ide.contraer} size="sm" onClick={() => setAbiertas(new Set())}>
              <ChevronsDownUp size={13} />
            </IconBtn>
          </span>
        </div>
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
        {aviso && (
          <div role="alert" className="mx-2 mb-1.5 flex items-start gap-2 rounded-md bg-accent-soft px-2 py-1.5 text-[11.5px] text-accent ui-small">
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{aviso}</span>
            <button type="button" aria-label={ide.cerrarAviso} onClick={() => setAviso(null)} className="shrink-0 hover:opacity-70">
              <X size={10} />
            </button>
          </div>
        )}
        {consulta.trim() ? (
          <ResultadosDeLaBusqueda
            resultados={resultados}
            consulta={consulta.trim()}
            activo={enOrden[Math.min(activo, enOrden.length - 1)] ?? null}
            elegido={activa ?? ""}
            onAbrir={abrir}
            labels={labels}
          />
        ) : (
          <>
            {lista === "cargando" && <p className="px-3 py-1 fg-muted">{labels.loading}</p>}
            {lista === "error" && <p className="px-3 py-1 fg-muted">{labels.loadError}</p>}
            {pintar(arbol, 0, "")}
          </>
        )}
      </nav>
      {menu && (
        <MenuDelNodo
          nodo={menu.nodo}
          x={menu.x}
          y={menu.y}
          labels={ide}
          onCerrar={() => setMenu(null)}
          onNuevo={(que) => empezarNuevo(que, { ruta: menu.nodo.ruta, tipo: menu.nodo.tipo })}
          onRenombrar={() => {
            setMenu(null);
            setEdicion({ tipo: "renombrar", ruta: menu.nodo.ruta, que: menu.nodo.tipo });
          }}
          onBorrar={() => {
            setMenu(null);
            void borrar(menu.nodo.ruta, menu.nodo.tipo);
          }}
          onCopiarRuta={() => {
            setMenu(null);
            void copiar(menu.nodo.ruta);
          }}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Pestanas
          pestanas={pestanas}
          activa={activa}
          sucias={new Set(Object.entries(buffers).filter(([, b]) => b.texto !== b.base).map(([r]) => r))}
          labels={ide}
          onElegir={(r) => {
            setActiva(r);
            setSalto(null);
            setSeleccion({ ruta: r, tipo: "fichero" });
          }}
          onCerrar={cerrarPestana}
        />
        {!activa || contenidoActivo === null ? (
          <p className="p-4 text-[12px] fg-muted">{ide.vacio}</p>
        ) : contenidoActivo === "cargando" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loading}</p>
        ) : contenidoActivo === "error" ? (
          <p className="p-3 text-[12px] fg-muted">{labels.loadError}</p>
        ) : contenidoActivo === "no-esta" ? (
          <p className="p-3 text-[12px] fg-muted">
            <span className="font-mono">{activa.replace(/^\//, "")}</span> · {labels.noEsta}
          </p>
        ) : (
          <PanelDelArchivo
            key={activa}
            projectId={projectId}
            ruta={activa}
            texto={contenidoActivo}
            buffer={editable(activa) ? bufferDe(activa) : null}
            soloLectura={!editable(activa)}
            notaDeSoloLectura={nodoActivo?.perezoso || esDeSoloLectura(activa) ? labels.readOnly : null}
            salto={salto}
            labels={labels}
            onCambio={(texto) => ponerBuffer(activa, (b) => ({ ...b, texto }))}
            onGuardar={() => void guardar(activa)}
            onCargarAhora={(actual) =>
              ponerBuffer(activa, (b) => ({ base: actual, texto: actual, revision: b.revision + 1, estado: { tipo: "listo" } }))
            }
          />
        )}
      </div>
    </div>
  );
}

/** Un nodo del árbol por su ruta. */
function buscarNodo(nodos: readonly NodoDelArbol[], ruta: string): NodoDelArbol | null {
  for (const n of nodos) {
    if (n.ruta === ruta) return n;
    if (n.tipo === "carpeta" && ruta.startsWith(`${n.ruta}/`)) return buscarNodo(n.hijos, ruta);
  }
  return null;
}

/** El nombre que se escribe en el propio árbol, como en VS Code: Enter acepta, Escape cancela. */
function EntradaDeNombre({
  inicial,
  sangria,
  carpeta,
  labels,
  onAceptar,
  onCancelar,
}: {
  inicial: string;
  sangria: number;
  carpeta: boolean;
  labels: EtiquetasDelIde;
  onAceptar: (nombre: string) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial);
  const caja = useRef<HTMLInputElement>(null);
  const hecho = useRef(false);
  useEffect(() => {
    const c = caja.current;
    if (!c) return;
    c.focus();
    // Como VS Code: elegido el nombre sin la extensión.
    const punto = inicial.lastIndexOf(".");
    c.setSelectionRange(0, punto > 0 ? punto : inicial.length);
  }, [inicial]);
  const valido = nombreValido(nombre);
  const terminar = (aceptar: boolean) => {
    if (hecho.current) return;
    hecho.current = true;
    if (aceptar && valido && nombre.trim() !== inicial) onAceptar(nombre.trim());
    else onCancelar();
  };
  return (
    <div style={{ paddingLeft: sangria }} className="py-0.5 pr-2">
      <div className="flex items-center gap-1">
        {carpeta ? <ChevronRight size={12} className="fg-faint" /> : <FileText size={12} className="fg-faint" />}
        <input
          ref={caja}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (valido) terminar(true);
            } else if (e.key === "Escape") {
              // No cierra la lente: sólo deja de escribir.
              e.preventDefault();
              e.stopPropagation();
              terminar(false);
            }
          }}
          onBlur={() => terminar(nombre.trim() !== "" && valido)}
          aria-label={labels.nombre}
          aria-invalid={nombre.trim() !== "" && !valido}
          spellCheck={false}
          autoCapitalize="off"
          className={`min-w-0 flex-1 rounded-sm border bg-app px-1 py-px text-[12px] fg focus:outline-none ${
            nombre.trim() !== "" && !valido ? "border-[color:var(--danger,#e5484d)]" : "border-[color:var(--accent)]"
          }`}
        />
      </div>
      {nombre.trim() !== "" && !valido && <p className="mt-0.5 text-[10.5px] text-accent ui-small">{labels.nombreInvalido}</p>}
    </div>
  );
}

/** El menú del clic derecho (o del «…»): crear dentro, renombrar, borrar, copiar la ruta. */
function MenuDelNodo({
  nodo,
  x,
  y,
  labels,
  onCerrar,
  onNuevo,
  onRenombrar,
  onBorrar,
  onCopiarRuta,
}: {
  nodo: NodoDelArbol;
  x: number;
  y: number;
  labels: EtiquetasDelIde;
  onCerrar: () => void;
  onNuevo: (que: "fichero" | "carpeta") => void;
  onRenombrar: () => void;
  onBorrar: () => void;
  onCopiarRuta: () => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) onCerrar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Cierra el menú, no la lente.
      e.preventDefault();
      onCerrar();
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla, true);
    caja.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [onCerrar]);
  const fijo = nodo.soloLectura || nodo.perezoso;
  const pagina = paginaDe(nodo.ruta) !== undefined;
  const opcion = "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] fg hover:bg-hover focus:bg-hover focus:outline-none";
  return (
    <div
      ref={caja}
      role="menu"
      aria-label={labels.acciones}
      style={{ left: Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 200), top: y }}
      className="fixed z-50 w-48 rounded-lg border bd-strong bg-elev p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]"
    >
      {!fijo && nodo.tipo === "carpeta" && (
        <>
          <button type="button" role="menuitem" className={opcion} onClick={() => onNuevo("fichero")}>
            {labels.nuevoArchivo}
          </button>
          <button type="button" role="menuitem" className={opcion} onClick={() => onNuevo("carpeta")}>
            {labels.nuevaCarpeta}
          </button>
          <div className="my-1 h-px bg-[color:var(--border)]" />
        </>
      )}
      {!fijo && !pagina && (
        <button type="button" role="menuitem" className={opcion} onClick={onRenombrar}>
          {labels.renombrar}
          <span className="ml-auto text-[10.5px] fg-faint">F2</span>
        </button>
      )}
      {!fijo && nodo.ruta !== "/index.html" && (
        <button type="button" role="menuitem" className={opcion} onClick={onBorrar}>
          {labels.borrar}
          <span className="ml-auto text-[10.5px] fg-faint">Supr</span>
        </button>
      )}
      <button type="button" role="menuitem" className={opcion} onClick={onCopiarRuta}>
        {labels.copiarRuta}
      </button>
    </div>
  );
}

/** La fila de pestañas: el nombre, un punto si tiene cambios sin guardar, la × para cerrar. */
function Pestanas({
  pestanas,
  activa,
  sucias,
  labels,
  onElegir,
  onCerrar,
}: {
  pestanas: readonly string[];
  activa: string | null;
  sucias: ReadonlySet<string>;
  labels: EtiquetasDelIde;
  onElegir: (ruta: string) => void;
  onCerrar: (ruta: string) => void;
}) {
  if (pestanas.length === 0) return null;
  return (
    <div role="tablist" className="flex shrink-0 overflow-x-auto nice-scroll border-b bd bg-elev">
      {pestanas.map((ruta) => {
        const es = ruta === activa;
        const sucia = sucias.has(ruta);
        return (
          <div
            key={ruta}
            className={`group flex shrink-0 items-center gap-1 border-r bd pl-3 pr-1 text-[12px] ${es ? "bg-app fg" : "fg-muted hover:fg"}`}
            title={ruta}
            onAuxClick={(e) => {
              if (e.button === 1) onCerrar(ruta);
            }}
          >
            <button type="button" role="tab" aria-selected={es} onClick={() => onElegir(ruta)} className="py-1.5">
              {nombreDe(ruta)}
            </button>
            <button
              type="button"
              aria-label={`${labels.cerrarPestana}: ${nombreDe(ruta)}${sucia ? ` (${labels.sinGuardar})` : ""}`}
              onClick={() => onCerrar(ruta)}
              className="grid h-5 w-5 place-items-center rounded hover:bg-hover"
            >
              {sucia ? (
                <>
                  <span aria-hidden className="group-hover:hidden">
                    ●
                  </span>
                  <X size={10} className="hidden group-hover:block" />
                </>
              ) : (
                <X size={10} className={es ? "" : "opacity-0 group-hover:opacity-100"} />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** El archivo de la pestaña activa: su barra (guardar, copiar), sus avisos, el editor y los comentarios para Len. */
function PanelDelArchivo({
  projectId,
  ruta,
  texto,
  buffer,
  soloLectura,
  notaDeSoloLectura,
  salto,
  labels,
  onCambio,
  onGuardar,
  onCargarAhora,
}: {
  projectId: string;
  ruta: string;
  texto: string;
  buffer: Buffer | null;
  soloLectura: boolean;
  notaDeSoloLectura: string | null;
  salto: { readonly linea: number; readonly n: number } | null;
  labels: CodeViewProps["labels"];
  onCambio: (texto: string) => void;
  onGuardar: () => void;
  onCargarAhora: (actual: string) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);
  const comentar = useComentarLineas(projectId, ruta);
  const lineas = useMemo(() => texto.split("\n"), [texto]);
  // Las líneas con algo que enseñar debajo: las comentadas y la que se está comentando.
  const comentadas: number[] = [];
  for (let i = 1; i <= lineas.length; i++) if (comentar.deLaLinea(i, false).length > 0) comentadas.push(i);
  // La misma lista, la misma referencia: el editor sólo repinta el margen si cambia.
  const claveComentadas = comentadas.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const conComentario = useMemo(() => comentadas, [claveComentadas]);
  const abiertaN = comentar.abierta?.startsWith("d") ? Number(comentar.abierta.slice(1)) : null;
  const paraEnsenar = [...new Set([...conComentario, ...(abiertaN ? [abiertaN] : [])])].sort((a, b) => a - b);
  const sucio = buffer !== null && buffer.texto !== buffer.base;
  const estado = buffer?.estado ?? { tipo: "listo" as const };
  const ed = labels.editar;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      // Escape dentro del editor cierra SU buscador o su autocompletar, nunca la lente.
      onKeyDown={(e) => {
        if (e.key === "Escape" && (e.target as HTMLElement).closest?.(".cm-editor")) e.preventDefault();
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b bd bg-elev px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] fg-muted">{ruta.replace(/^\//, "")}</span>
        <span className="shrink-0 text-[10.5px] fg-faint tabular ui-small">
          {lineas.length} {labels.lines}
        </span>
        {notaDeSoloLectura ? (
          <span className="hidden truncate text-[10.5px] fg-faint ui-small md:block">{notaDeSoloLectura}</span>
        ) : (
          <span className="hidden truncate text-[10.5px] fg-faint ui-small lg:block">{labels.ide.comentarAyuda}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {!soloLectura && (
            <button
              type="button"
              onClick={onGuardar}
              disabled={!sucio || estado.tipo === "guardando"}
              title={`${ed.guardar} (Ctrl+S)`}
              className="rounded-md bg-[var(--accent-strong)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 ui-small"
            >
              {estado.tipo === "guardando" ? ed.guardando : ed.guardar}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copiar(texto).then(setCopiado)}
            className="inline-flex items-center gap-1 rounded-md border bd px-2 py-1 text-[11px] fg-muted hover:fg hover:bg-hover transition ui-small"
          >
            {copiado ? <Check size={11} /> : <Copy size={11} />}
            {copiado ? labels.copied : labels.copy}
          </button>
        </span>
      </header>
      {estado.tipo === "cambio" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bd bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent ui-small">
          <span className="min-w-0 flex-1">{ed.cambio}</span>
          <button type="button" onClick={() => onCargarAhora(estado.actual)} className="shrink-0 font-medium hover:underline">
            {ed.cargarAhora}
          </button>
        </div>
      )}
      {estado.tipo === "rechazado" && (
        <div className="shrink-0 border-b bd bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent ui-small">
          {ed.rechazado}
          <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10.5px]">{estado.detalle}</pre>
        </div>
      )}
      {estado.tipo === "error" && <p className="shrink-0 border-b bd px-3 py-1.5 text-[11.5px] text-accent ui-small">{ed.error}</p>}
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorCodigo
          ruta={ruta}
          valor={texto}
          revision={buffer?.revision ?? 0}
          soloLectura={soloLectura}
          onCambio={onCambio}
          onGuardar={onGuardar}
          onNumero={(n) => comentar.abrir(claveDeLinea(n, false))}
          lineasComentadas={conComentario}
          salto={salto}
          etiqueta={ruta.replace(/^\/+/, "")}
          {...(labels.ide.frasesDelEditor ? { frases: labels.ide.frasesDelEditor } : {})}
        />
      </div>
      {paraEnsenar.length > 0 && (
        <div className="max-h-[40%] shrink-0 overflow-auto nice-scroll border-t bd bg-elev px-3 py-2 text-[12px]">
          {paraEnsenar.map((n) => (
            <div key={n} className="mb-1.5 last:mb-0">
              <div className="mb-0.5 font-mono text-[10.5px] fg-faint">
                {n} · <span className="whitespace-pre">{(lineas[n - 1] ?? "").trim().slice(0, 80)}</span>
              </div>
              <DebajoDeLaLinea comentar={comentar} linea={n} deAntes={false} codigo={lineas[n - 1] ?? ""} labels={labels.comentar} />
            </div>
          ))}
        </div>
      )}
      {!soloLectura && <p className="shrink-0 border-t bd px-3 py-1 text-[10.5px] fg-faint ui-small">{ed.nota}</p>}
    </section>
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

/** Un documento de sólo lectura, con sus colores y copiar: la vista previa de una plantilla, que no es de nadie todavía. */
function Bloque({ etiqueta, codigo, lenguaje, labels }: { etiqueta: string; codigo: string; lenguaje: Lenguaje | null; labels: CodeViewProps["labels"] }) {
  const [copiado, setCopiado] = useState(false);
  const lineas = useMemo(() => colorearLineas(codigo, lenguaje), [codigo, lenguaje]);
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
        <button
          type="button"
          onClick={() => void copiar(codigo).then(setCopiado)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border bd px-2 py-1 text-[11px] fg-muted hover:fg hover:bg-hover transition ui-small"
        >
          {copiado ? <Check size={11} /> : <Copy size={11} />}
          {copiado ? labels.copied : labels.copy}
        </button>
      </header>
      {/* El código NUNCA se interpreta: va como texto dentro de <code>. */}
      <pre className="p-3 text-[11.5px] leading-[1.55]">
        <code className="block font-mono">
          {lineas.map((linea, i) => (
            <span key={i} data-linea={i + 1} className="flex">
              <span className="w-9 shrink-0 select-none pr-3 text-right fg-faint tabular">{i + 1}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                <LineaColoreada trozos={linea} />
              </span>
            </span>
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
          <Explorador projectId={projectId} rutaActual={rutaActual} peticion={peticion} labels={labels} />
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
