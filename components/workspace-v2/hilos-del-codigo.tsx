"use client";

// LOS HILOS EN EL CÓDIGO (lib/projects/hilos.ts), en la lente «Código»: bajo su
// línea, con sus mensajes, contestar y resolver; y el `@` que autocompleta a
// Len y a la gente del proyecto, que comparte la caja de comentar una línea.
//
// `@Len` en un hilo, como en Claude Tag: el turno arranca EN EL SERVIDOR al
// publicar (no depende del chat); el chat, si está abierto, lo sigue en vivo
// (lib/workspace-v2/turnos-del-hilo.ts), y Len contesta aquí al cerrar.
// Mientras tanto el hilo dice «Len está en ello» y se relee más a menudo.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { arrobaEnCurso, hayMencion, mencionesDe, opcionesDeMencion, ponerMencion, type PersonaMencionable } from "@/lib/workspace-v2/menciones";
import { turnosDelHilo } from "@/lib/workspace-v2/turnos-del-hilo";

export interface EtiquetasDeHilos {
  /** En la caja de comentar una línea, cuando hay gente o Len a quien mencionar. */
  readonly placeholder: string;
  /** El botón de la caja cuando lo escrito menciona a alguien: abre un hilo. */
  readonly comentar: string;
  readonly responder: string;
  readonly placeholderRespuesta: string;
  readonly resolver: string;
  readonly reabrir: string;
  readonly resuelto: string;
  readonly len: string;
  /** Mientras Len trabaja en lo que se le pidió desde el hilo. */
  readonly trabajando: string;
  readonly soloEditoresLen: string;
  readonly error: string;
}

interface MensajeDelHilo {
  readonly id: string;
  readonly autorId: string | null;
  readonly autor: string | null;
  readonly texto: string;
  readonly filaId: string | null;
  readonly createdAt: string;
}

export interface Hilo {
  readonly id: string;
  readonly ruta: string;
  readonly linea: number;
  readonly codigo: string;
  readonly estado: "abierto" | "resuelto";
  readonly creadoPor: string;
  readonly mensajes: readonly MensajeDelHilo[];
  readonly sinVer: number;
}

interface DatosDeHilos {
  readonly hilos: readonly Hilo[];
  readonly personas: readonly (PersonaMencionable & { readonly rol: string })[];
  readonly puedeLen: boolean;
  readonly yo: string;
}

/** Se emite al marcar menciones como vistas: quien pinta las «@» las relee. */
export const HILOS_VISTOS = "openlen:hilos-vistos";

/** ¿Espera el hilo una respuesta de Len? (lo último lo escribió alguien y nombra a Len) */
export const esperaALen = (h: Hilo) => {
  const ultimo = h.mensajes.at(-1);
  return h.estado === "abierto" && Boolean(ultimo?.autorId) && /(^|[^\w@])@len\b/i.test(ultimo?.texto ?? "");
};

/**
 * Los hilos de UN fichero, y cómo escribir en ellos. `null` mientras carga o
 * sin proyecto. Se releen cada 30 s, y cada 6 s mientras un hilo espera a Len.
 */
export function useHilos(projectId: string | null | undefined, ruta: string | null) {
  const [datos, setDatos] = useState<DatosDeHilos | null>(null);
  const [error, setError] = useState(false);
  const base = projectId ? `/api/projects/${encodeURIComponent(projectId)}/hilos` : null;
  const cargar = useCallback(async () => {
    if (!base || !ruta) return;
    const r = await fetch(`${base}?ruta=${encodeURIComponent(ruta)}`).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json().catch(() => null)) as DatosDeHilos | null;
    if (d && Array.isArray(d.hilos)) setDatos(d);
  }, [base, ruta]);
  useEffect(() => {
    setDatos(null);
    void cargar();
  }, [cargar]);
  const esperando = datos?.hilos.some(esperaALen) ?? false;
  useEffect(() => {
    if (!base || !ruta) return;
    const reloj = setInterval(() => void cargar(), esperando ? 6_000 : 30_000);
    return () => clearInterval(reloj);
  }, [base, ruta, esperando, cargar]);
  // Lo que se tiene delante, visto: las menciones dejan de contar «sin ver».
  const sinVer = useMemo(() => (datos?.hilos ?? []).filter((h) => h.sinVer > 0).map((h) => h.id), [datos]);
  useEffect(() => {
    if (!base || sinVer.length === 0) return;
    void fetch(`${base}/vistas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hilos: sinVer }) })
      // El explorador quita su «@» en el acto, sin esperar a su relectura.
      .then(() => window.dispatchEvent(new Event(HILOS_VISTOS)))
      .catch(() => {});
  }, [base, sinVer]);

  const idioma = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  const personas = useMemo(() => (datos ? datos.personas.filter((p) => p.userId !== datos.yo) : []), [datos]);

  const escribir = async (url: string, cuerpo: Record<string, unknown>, texto: string, dondeDe: (hiloId: string) => { ruta: string; linea: number }) => {
    const m = mencionesDe(texto, personas);
    setError(false);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...cuerpo, texto, menciones: m.personas, len: m.len, ...(idioma ? { idioma } : {}) }),
    }).catch(() => null);
    if (!r?.ok || !projectId) {
      setError(true);
      return false;
    }
    const j = (await r.json().catch(() => ({}))) as { hiloId?: string; filaId?: string | null };
    const hiloId = j.hiloId ?? (cuerpo.hiloId as string | undefined);
    // El servidor ya empezó el turno de Len: el chat, si está abierto, lo sigue.
    if (j.filaId && hiloId) turnosDelHilo.anunciar(projectId, { filaId: j.filaId, texto, origen: { hiloId, ...dondeDe(hiloId) } });
    await cargar();
    return true;
  };

  return {
    datos,
    personas,
    error,
    hilosDeLaLinea: (linea: number) => (datos?.hilos ?? []).filter((h) => h.linea === linea),
    lineas: [...new Set((datos?.hilos ?? []).map((h) => h.linea))],
    crear: (linea: number, codigo: string, texto: string) =>
      base && ruta
        ? escribir(base, { ruta, linea, codigo }, texto, () => ({ ruta, linea }))
        : Promise.resolve(false),
    responder: (hilo: Hilo, texto: string) =>
      base ? escribir(`${base}/${hilo.id}`, { hiloId: hilo.id }, texto, () => ({ ruta: hilo.ruta, linea: hilo.linea })) : Promise.resolve(false),
    cambiarEstado: async (hilo: Hilo, estado: "abierto" | "resuelto") => {
      if (!base) return;
      await fetch(`${base}/${hilo.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ estado }) }).catch(() => null);
      await cargar();
    },
  };
}

export type ContextoDeHilos = ReturnType<typeof useHilos>;

/** El `@` de una caja: el desplegable con Len y la gente, y las teclas para elegir. */
export function useArroba(
  texto: string,
  setTexto: (t: string) => void,
  ref: React.RefObject<HTMLTextAreaElement | null>,
  personas: readonly PersonaMencionable[],
  conLen: boolean,
) {
  const [cursor, setCursor] = useState(0);
  const [elegida, setElegida] = useState(0);
  // El cursor tras poner una mención: se coloca JUSTO después de pintar, antes
  // de la tecla siguiente. Con un `requestAnimationFrame` llegaba tarde y lo
  // tecleado en medio caía al final del texto (medido en el navegador).
  const porPoner = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (porPoner.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(porPoner.current, porPoner.current);
    porPoner.current = null;
  });
  const enCurso = arrobaEnCurso(texto, cursor);
  const opciones = enCurso && (personas.length > 0 || conLen) ? opcionesDeMencion(enCurso.busca, personas, conLen) : [];
  useEffect(() => setElegida(0), [enCurso?.busca]);
  const elegir = (etiqueta: string) => {
    if (!enCurso) return;
    const nuevo = ponerMencion(texto, enCurso.desde, cursor, etiqueta);
    porPoner.current = nuevo.cursor;
    setTexto(nuevo.texto);
    setCursor(nuevo.cursor);
  };
  /** `true` si la tecla era del desplegable (no hay que hacer nada más con ella). */
  const tecla = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (opciones.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setElegida((i) => (i + (e.key === "ArrowDown" ? 1 : opciones.length - 1)) % opciones.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      elegir(opciones[elegida]!.etiqueta);
      return true;
    }
    return false;
  };
  const menu: ReactNode =
    opciones.length > 0 ? (
      <span role="listbox" className="mt-1 block overflow-hidden rounded-md border bd bg-app shadow-sm" data-arroba="">
        {opciones.map((o, i) => (
          <button
            key={o.userId ?? "len"}
            type="button"
            role="option"
            aria-selected={i === elegida}
            onMouseDown={(e) => {
              e.preventDefault();
              elegir(o.etiqueta);
            }}
            className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11.5px] ${i === elegida ? "bg-hover fg" : "fg-muted"}`}
          >
            <span className={o.userId ? "" : "text-accent font-medium"}>@{o.etiqueta}</span>
          </button>
        ))}
      </span>
    ) : null;
  return { onSeleccion: (e: { currentTarget: HTMLTextAreaElement }) => setCursor(e.currentTarget.selectionStart ?? 0), tecla, menu };
}

/** Un hilo bajo su línea: sus mensajes, contestar y resolver. */
export function HiloEnLinea({ hilo, ctx, labels }: { hilo: Hilo; ctx: ContextoDeHilos; labels: EtiquetasDeHilos }) {
  const [abierto, setAbierto] = useState(hilo.estado === "abierto");
  const [respuesta, setRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const puedeLen = ctx.datos?.puedeLen ?? false;
  const arroba = useArroba(respuesta, setRespuesta, ref, ctx.personas, puedeLen);
  const resuelto = hilo.estado === "resuelto";
  const enviar = async () => {
    const texto = respuesta.trim();
    if (!texto || enviando) return;
    const m = mencionesDe(texto, ctx.personas);
    if (m.len && !puedeLen) return setAviso(labels.soloEditoresLen);
    setEnviando(true);
    const ok = await ctx.responder(hilo, texto);
    setEnviando(false);
    if (!ok) return setAviso(labels.error);
    setRespuesta("");
    setAviso(null);
  };
  return (
    <span
      className={`my-1 ml-9 mr-3 block rounded-md border bd bg-app px-2 py-1.5 font-sans text-[11.5px] whitespace-normal ${resuelto ? "opacity-70" : ""}`}
      data-hilo={hilo.id}
    >
      {resuelto && !abierto ? (
        <button type="button" onClick={() => setAbierto(true)} className="flex w-full items-center gap-1.5 text-left fg-faint">
          <span>✓ {labels.resuelto}</span>
          <span className="truncate">— {hilo.mensajes[0]?.texto}</span>
        </button>
      ) : (
        <>
          {hilo.mensajes.map((m) => (
            <span key={m.id} className="mb-1 block last:mb-0" data-mensaje-del-hilo={m.autorId ? "persona" : "len"}>
              <span className={`font-medium ${m.autorId ? "fg" : "text-accent"}`}>{m.autorId ? (m.autor ?? "?") : labels.len}</span>{" "}
              <span className="whitespace-pre-wrap break-words fg-muted">{m.texto}</span>
            </span>
          ))}
          <span className="mt-1.5 block">
            <textarea
              ref={ref}
              value={respuesta}
              rows={1}
              placeholder={labels.placeholderRespuesta}
              aria-label={labels.responder}
              onChange={(e) => {
                setRespuesta(e.target.value);
                arroba.onSeleccion(e);
              }}
              onSelect={arroba.onSeleccion}
              onKeyDown={(e) => {
                if (arroba.tecla(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setRespuesta("");
                }
              }}
              className="block w-full resize-none rounded border bd bg-elev px-1.5 py-1 text-[11.5px] leading-snug fg placeholder:fg-faint focus:outline-none"
            />
            {arroba.menu}
          </span>
          {esperaALen(hilo) && (
            <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-accent" data-len-trabajando="">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              {labels.trabajando}
            </span>
          )}
          {aviso && <span className="mt-1 block text-[10.5px] fg-faint">{aviso}</span>}
          <span className="mt-1 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => void ctx.cambiarEstado(hilo, resuelto ? "abierto" : "resuelto")}
              className="rounded-md px-2 py-0.5 text-[10.5px] fg-muted hover:fg hover:bg-hover"
            >
              {resuelto ? labels.reabrir : labels.resolver}
            </button>
            <button
              type="button"
              disabled={!respuesta.trim() || enviando}
              onClick={() => void enviar()}
              className="rounded-md bg-[var(--accent-strong)] px-2 py-0.5 text-[10.5px] font-medium text-white disabled:opacity-40"
            >
              {labels.responder}
            </button>
          </span>
        </>
      )}
    </span>
  );
}

export { hayMencion, mencionesDe };
