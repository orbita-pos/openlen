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
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const temporizador = useRef<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLectura("cargando");
    fetch(`/api/projects/${projectId}/assistant`)
      .then((r) => (r.ok ? (r.json() as Promise<AsistenteLeido>) : Promise.reject(r.status)))
      .then((d) => {
        if (cancelado) return;
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

  useEffect(
    () => () => {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    },
    [],
  );

  async function guardar() {
    if (guardando || lectura !== "listo") return;
    setGuardando(true);
    setGuardado(false);
    const parche: { assistant: Pick<AssistantSettings, "facts" | "tone"> } = {
      assistant: { facts, tone },
    };
    try {
      const r = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parche),
      });
      if (!r.ok) {
        toast.error(t("toast.saveError"));
        return;
      }
      // Los hechos y el tono se hornean al publicar: guardarlos es un cambio
      // sin publicar, y eso lo decide el taller con este aviso.
      onAjustesGuardados(parche);
      setGuardado(true);
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => setGuardado(false), 2000);
    } catch {
      toast.error(t("toast.saveError"));
    } finally {
      setGuardando(false);
    }
  }

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
          maxLength={TONO_MAX}
          placeholder={t("burbuja.detalleAsistente.tonoEjemplo")}
          disabled={bloqueado}
          className="h-9 w-full rounded-lg bg-app px-3 text-[13px] fg ring-1 ring-[color:var(--border)] outline-none transition placeholder:fg-faint focus:ring-[color:var(--accent)] disabled:opacity-50"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || bloqueado}
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
