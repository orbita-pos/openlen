"use client";

// EL DETALLE DEL ASISTENTE — lo que el dueño le cuenta a la IA que contesta
// en su página: la información del negocio que la página no dice, y el tono.
//
// Viene de `workspace-v2/panels/assistant-panel.tsx`, que la Tarea 8 demuele.
// Se porta el cuerpo con TRES cambios:
//
// 1. Escribe por el EMBUDO (`PATCH /api/projects/{id}/settings` con
//    `{ assistant }`), no por `/assistant`: toda escritura de ajustes pasa por
//    `lib/projects/settings-patch.ts`, que comparten el botón y Len.
// 2. Habla los diez idiomas. El panel viejo estaba en español a piñón; sus
//    cadenas viven ahora en `burbuja.detalleAsistente`.
// 3. `enabled` NO se pinta aquí: el interruptor del asistente es el de la
//    franja (`franja-de-estado.tsx`, Tarea 6). «Activar asistente» /
//    «Activado» murieron con el panel viejo. El GET lo sigue devolviendo y se
//    ignora a propósito.
//
// Sigue LEYENDO `GET /api/projects/{id}/assistant` porque sirve lo único que
// el embudo no sirve: `used`/`cap`, el consumo mensual del plan.
//
// 🔴 GUARDA AL PERDER EL FOCO, no sólo con «Guardar». El cajón se cierra con
// Escape, con el aspa y con un clic en el velo; con sólo el botón, escribir
// 3.000 caracteres de información del negocio y rozar el velo los tiraba sin
// avisar (I5 de la revisión final). El cierre mueve el foco ANTES de desmontar
// (`cerrarDetalle` en la franja), así que el campo recibe su `blur` en los tres
// caminos. Misma forma que `ajustes-del-chat.tsx`: cola en orden, y un blur sin
// cambios no escribe.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import type { AssistantSettings } from "@/lib/projects/types";
import { useToast } from "@/components/workspace-v2/toast";
import type { OnAjustesGuardados } from "./franja-de-estado";

/** Lo que devuelve `GET /api/projects/{id}/assistant`. */
interface AsistenteLeido {
  enabled: boolean;
  facts: string;
  tone: string;
  used?: number;
  cap?: number;
}

/** El tope de los hechos: el mismo que recorta el embudo al escribir
 *  (`MAX_ASSISTANT_FACTS` en `settings-patch.ts`). */
const HECHOS_MAX = 4000;
/** El embudo recorta el tono a 40 (`settings-patch.ts`). El panel viejo dejaba
 *  escribir 80: el dueño escribía 80 y se guardaban 40 sin avisar. */
const TONO_MAX = 40;

type Textos = Pick<AssistantSettings, "facts" | "tone">;

export function AjustesDelAsistente(props: {
  projectId: string;
  onAjustesGuardados: OnAjustesGuardados;
}) {
  const { projectId, onAjustesGuardados } = props;
  const t = useTranslations("wsPage");
  const tc = useTranslations("common");
  const toast = useToast();
  const idHechos = useId();
  const idTono = useId();

  // `cargando` → `listo` | `fallo`. En `fallo` los campos NO se desbloquean:
  // guardar un campo vacío porque la lectura falló BORRARÍA los hechos que el
  // dueño ya escribió. El panel viejo lo permitía.
  const [lectura, setLectura] = useState<"cargando" | "listo" | "fallo">("cargando");
  const [intento, setIntento] = useState(0);
  const [facts, setFacts] = useState("");
  const [tone, setTone] = useState("");
  const [consumo, setConsumo] = useState<{ used: number; cap: number } | null>(null);
  const [enVuelo, setEnVuelo] = useState(0);
  const [guardado, setGuardado] = useState(false);
  const temporizador = useRef<number | null>(null);
  const montado = useRef(true);

  // LO QUE EL SERVIDOR TIENE, según lo último que se leyó o se guardó con
  // éxito, y LO QUE YA ESTÁ PEDIDO en la cola, campo a campo. Un guardado sólo
  // escribe lo que difiere de lo pedido o, si no hay nada pedido, de lo
  // confirmado: cada escritura le dice al taller «hay cambios sin publicar», y
  // entrar y salir de un campo no es un cambio.
  const confirmado = useRef<Textos>({ facts: "", tone: "" });
  const pedido = useRef<Partial<Textos>>({});
  // LA COLA: un guardado que llega con otro en vuelo va detrás, no se descarta.
  const cola = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelado = false;
    setLectura("cargando");
    fetch(`/api/projects/${projectId}/assistant`)
      .then((r) => (r.ok ? (r.json() as Promise<AsistenteLeido>) : Promise.reject(r.status)))
      .then((d) => {
        if (cancelado) return;
        confirmado.current = { facts: d.facts ?? "", tone: d.tone ?? "" };
        setFacts(d.facts ?? "");
        setTone(d.tone ?? "");
        if (typeof d.used === "number" && typeof d.cap === "number") {
          setConsumo({ used: d.used, cap: d.cap });
        }
        setLectura("listo");
      })
      .catch(() => {
        if (!cancelado) setLectura("fallo");
      });
    return () => {
      cancelado = true;
    };
  }, [projectId, intento]);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    };
  }, []);

  function marcarGuardado() {
    // El guardado que sale de un blur al cerrar el cajón termina con el
    // detalle ya desmontado: el aviso al taller sí va, el tic ya no tiene dónde.
    if (!montado.current) return;
    setGuardado(true);
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setGuardado(false), 2000);
  }

  /** Encola lo que haya cambiado de `campos`. Devuelve si encoló algo. */
  function guardar(campos: Partial<Textos>): boolean {
    if (lectura !== "listo") return false;
    const parche: Partial<Textos> = {};
    for (const k of Object.keys(campos) as (keyof Textos)[]) {
      const referencia = k in pedido.current ? pedido.current[k] : confirmado.current[k];
      if (campos[k] !== referencia) parche[k] = campos[k];
    }
    if (Object.keys(parche).length === 0) return false;
    Object.assign(pedido.current, parche);
    setEnVuelo((n) => n + 1);
    setGuardado(false);
    cola.current = cola.current.then(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assistant: parche }),
        });
        if (!r.ok) {
          toast.error(t("toast.saveError"));
          return;
        }
        Object.assign(confirmado.current, parche);
        // Los hechos y el tono se hornean al publicar: guardarlos es un cambio
        // sin publicar, y eso lo decide el taller con este aviso.
        onAjustesGuardados({ assistant: parche });
        marcarGuardado();
      } catch {
        toast.error(t("toast.saveError"));
      } finally {
        // Asentado, gane o pierda: la referencia vuelve a ser lo confirmado —
        // salvo que otro guardado del mismo campo haya entrado detrás. Si
        // falló, el siguiente blur lo reintenta.
        for (const k of Object.keys(parche) as (keyof Textos)[]) {
          if (pedido.current[k] === parche[k]) delete pedido.current[k];
        }
        if (montado.current) setEnVuelo((n) => n - 1);
      }
    });
    return true;
  }

  // Se compara y se envía el tono RECORTADO, como lo guarda el embudo: así el
  // parche con que se avisa al taller es la verdad del servidor.
  const guardarTodo = () => {
    // Pulsar «Guardar» sin nada pendiente no escribe, pero dice que está guardado.
    if (!guardar({ facts, tone: tone.trim() }) && enVuelo === 0) marcarGuardado();
  };

  const guardando = enVuelo > 0;
  const bloqueado = lectura !== "listo";

  return (
    <div className="space-y-4">
      {consumo && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] fg-faint">
            <span>{t("burbuja.detalleAsistente.consumo")}</span>
            <span className="font-mono tabular-nums">
              {consumo.used}/{consumo.cap}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--accent-strong)] transition-all"
              style={{
                width: `${Math.min(100, consumo.cap ? (consumo.used / consumo.cap) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>
      )}

      {lectura === "fallo" && (
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px] ring-1 ring-red-300 bg-red-50 text-red-700 dark:ring-red-500/30 dark:bg-red-500/5 dark:text-red-300">
          <span>{tc("error")}</span>
          <button
            type="button"
            onClick={() => setIntento((n) => n + 1)}
            className="shrink-0 rounded-md px-2 py-1 font-medium underline-offset-2 hover:underline"
          >
            {tc("retry")}
          </button>
        </div>
      )}

      <div>
        <label htmlFor={idHechos} className="mb-1 block text-[12px] font-medium fg">
          {t("burbuja.detalleAsistente.hechos")}
        </label>
        <p className="mb-1.5 text-[11px] leading-snug fg-faint">
          {t("burbuja.detalleAsistente.hechosAyuda")}
        </p>
        <textarea
          id={idHechos}
          value={facts}
          onChange={(e) => setFacts(e.target.value.slice(0, HECHOS_MAX))}
          onBlur={(e) => guardar({ facts: e.target.value.slice(0, HECHOS_MAX) })}
          maxLength={HECHOS_MAX}
          placeholder={t("burbuja.detalleAsistente.hechosEjemplo")}
          disabled={bloqueado}
          spellCheck
          className="nice-scroll min-h-[180px] w-full resize-y rounded-lg bg-app px-2.5 py-2 text-[12.5px] leading-relaxed fg ring-1 ring-[color:var(--border)] outline-none transition placeholder:fg-faint focus:ring-[color:var(--accent)] disabled:opacity-50"
        />
        <div className="mt-1 text-right text-[10.5px] font-mono tabular-nums fg-faint">
          {facts.length}/{HECHOS_MAX}
        </div>
      </div>

      <div>
        <label htmlFor={idTono} className="mb-1 block text-[12px] font-medium fg">
          {t("burbuja.detalleAsistente.tono")}
        </label>
        <input
          id={idTono}
          type="text"
          value={tone}
          onChange={(e) => setTone(e.target.value.slice(0, TONO_MAX))}
          onBlur={(e) => guardar({ tone: e.target.value.slice(0, TONO_MAX).trim() })}
          maxLength={TONO_MAX}
          placeholder={t("burbuja.detalleAsistente.tonoEjemplo")}
          disabled={bloqueado}
          className="h-9 w-full rounded-lg bg-app px-3 text-[13px] fg ring-1 ring-[color:var(--border)] outline-none transition placeholder:fg-faint focus:ring-[color:var(--accent)] disabled:opacity-50"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={guardarTodo}
          // No se deshabilita en vuelo: el blur del campo que se está dejando
          // ya encoló su guardado, y deshabilitar el botón en ese instante se
          // comería el clic que llega detrás (lo que le pasaba al hub viejo).
          disabled={bloqueado}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-strong)] text-[12.5px] font-medium text-white transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {guardando ? (
            <>
              <Loader2 size={13} className="animate-spin" aria-hidden />
              {t("burbuja.detalleAsistente.guardando")}
            </>
          ) : guardado ? (
            <>
              <Check size={13} aria-hidden />
              {t("burbuja.detalleAsistente.guardado")}
            </>
          ) : (
            t("burbuja.detalleAsistente.guardar")
          )}
        </button>
        <p className="mt-2 text-center text-[10.5px] leading-relaxed fg-faint">
          {t("burbuja.detalleAsistente.privacidad")}
        </p>
      </div>
    </div>
  );
}
