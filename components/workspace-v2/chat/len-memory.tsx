"use client";

// LA MEMORIA DE LEN — las DOS mitades, en un solo sitio y siempre alcanzable.
//
// Len recuerda en dos sitios y hasta hoy no se veía NINGUNO:
//
//   · `users.agentMemory` — de la PERSONA, cruza todos sus proyectos. Es lo que
//     `recordar_preferencia` escribe por DEFECTO (alcance="siempre").
//     `forgetAboutUser` existía desde el principio diciendo «el borrado es del
//     dueño» y no tenía UN SOLO LLAMADOR en el repo.
//   · `projects.userBrief` — de ESTA página. Se le inyecta al Agente como
//     «PROJECT BRIEF (persistente — aplica a toda petición)». Sólo lo escribía
//     el modelo, sólo lo leía el modelo, y mandaba sobre cada petición del
//     usuario sin que él supiera que existe.
//
// POR QUÉ JUNTAS. Separarlas es exactamente lo que nos trajo aquí: había DOS
// paneles de brief (`panels/brief-panel.tsx` y `panels/ai-brief-panel.tsx`) y
// los dos acabaron con CERO importadores, invisibles, mientras el prompt seguía
// mandando al usuario a «la pestaña Brief». Una sola cosa, un solo sitio.
//
// POR QUÉ AQUÍ Y NO EN EL RAIL. El rail está podado a propósito —su historia
// entera es QUITAR iconos porque «un icono cobra un sitio permanente»— y no es
// mío re-decidirlo. El Chat es donde Len dice «guardé tu preferencia», así que
// es donde tiene sentido poder retirarla.
//
// POR QUÉ NO EN EL ESTADO VACÍO, que es donde estuvo primero: ahí sólo se ve
// con la conversación en blanco, y el momento en que el usuario NECESITA podar
// es cuando la herramienta le dice que el brief está lleno — a mitad de
// conversación, con el estado vacío ya fuera de pantalla.
//
// CERRADO por defecto y una línea de alto: alcanzable siempre, sin cobrar sitio.
//
// Vivía en `panels/chat-panel.tsx`; sale aquí para que los dos chats la
// usen (plans/new-chat/). La lectura y el «Quitar» van en `useAgentMemory`;
// el chat de hoy la pinta como cabecera plegable (`MemoriaDeLen`) y el nuevo
// como un cajón bajo la cabecera (`MemoryDrawer`).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { LenMark } from "../icons";
import { LenFace } from "./len-face";

/** Las preferencias que Len recuerda de esta persona, y quitar una. */
export function useAgentMemory() {
  const [lineas, setLineas] = useState<string[] | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Fail-soft: si la memoria no se puede leer, el Chat sigue entero. Es una
    // vista, no una puerta.
    fetch("/api/agent/memoria")
      .then((r) => (r.ok ? r.json() : { lineas: [] }))
      .then((d) => {
        if (vivo) setLineas(Array.isArray(d?.lineas) ? d.lineas : []);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const quitar = useCallback(async (preferencia: string) => {
    setQuitando(preferencia);
    try {
      const res = await fetch("/api/agent/memoria", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferencia }),
      });
      // Se pinta lo que VUELVE del servidor, no lo que creíamos tener: con dos
      // pestañas abiertas, el estado que manda es el suyo.
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d?.lineas)) setLineas(d.lineas);
      }
    } catch {
      // Silencio deliberado: la línea sigue ahí y el usuario puede reintentar.
    } finally {
      setQuitando(null);
    }
  }, []);

  return { lines: lineas, remove: quitar, removing: quitando };
}

export function MemoriaDeLen({ projectId }: { projectId: string | null }) {
  const t = useTranslations("panelsChat");
  const [abierto, setAbierto] = useState(false);
  const { lines: lineas, remove: quitar, removing: quitando } = useAgentMemory();
  const cuantas = lineas?.length ?? 0;

  return (
    <div className="shrink-0 border-b bd">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] fg-faint hover:fg-muted ui-small"
      >
        <LenMark size={10} className="text-accent" />
        <span>{t("memoria.title")}</span>
        {cuantas > 0 && <span className="tabular">({cuantas})</span>}
        <span className="ml-auto" aria-hidden>
          {abierto ? "−" : "+"}
        </span>
      </button>

      {abierto && (
        <div className="px-3 pb-2.5 space-y-2.5">
          {cuantas > 0 && (
            <div>
              <div className="text-[10.5px] fg-faint mb-1 leading-relaxed">
                {t("memoria.description")}
              </div>
              <ul className="flex flex-col gap-1">
                {lineas?.map((linea) => (
                  <li key={linea} className="flex items-start gap-2">
                    <span className="flex-1 text-[11.5px] leading-relaxed fg">{linea}</span>
                    <button
                      type="button"
                      onClick={() => void quitar(linea)}
                      disabled={quitando === linea}
                      className="shrink-0 text-[10.5px] fg-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 ui-small"
                    >
                      {t("memoria.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <BriefDeLaPagina projectId={projectId} />
        </div>
      )}
    </div>
  );
}

/** Tope del servidor (`PatchSchema` en app/api/projects/[id]/route.ts). Se
 *  repite aquí para poder AVISAR antes de que el guardado falle — no para
 *  decidir: quien rechaza sigue siendo el servidor. */
const BRIEF_MAX = 4000;

/**
 * Las notas de ESTA página: `projects.userBrief`.
 *
 * Se LEE por su propia ruta en vez de enhebrarse como prop desde la página
 * porque el Agente puede escribirlo a mitad de sesión —`recordar_preferencia`
 * con alcance="esta_pagina"—, que es justo cuando el usuario querrá mirarlo;
 * una prop quedaría rancia. Se ESCRIBE por el `PATCH` que ya existía: dos
 * escritores del mismo campo es como se separan.
 */
export function BriefDeLaPagina({ projectId }: { projectId: string | null }) {
  const t = useTranslations("panelsChat");
  const [texto, setTexto] = useState<string | null>(null);
  const [estado, setEstado] = useState<"idle" | "guardando" | "guardado" | "error">("idle");
  const timerRef = useRef<number | null>(null);
  const cargadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let vivo = true;
    fetch(`/api/projects/${projectId}/brief`)
      .then((r) => (r.ok ? r.json() : { brief: "" }))
      .then((d) => {
        if (!vivo) return;
        const v = typeof d?.brief === "string" ? d.brief : "";
        cargadoRef.current = v;
        setTexto(v);
      })
      .catch(() => {
        if (vivo) setTexto("");
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const guardar = useCallback(
    (valor: string) => {
      if (!projectId) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        // No se guarda lo que no cambió: evita un PATCH por cada vez que el
        // usuario abre el desplegable y lo vuelve a cerrar.
        if (valor === cargadoRef.current) return;
        setEstado("guardando");
        fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userBrief: valor }),
        })
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            cargadoRef.current = valor;
            setEstado("guardado");
          })
          .catch(() => setEstado("error"));
      }, 700);
    },
    [projectId],
  );

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  if (!projectId || texto === null) return null;
  const quedan = BRIEF_MAX - texto.length;

  return (
    <div>
      <div className="text-[10.5px] fg-faint mb-1 leading-relaxed">{t("memoria.briefHint")}</div>
      <textarea
        value={texto}
        onChange={(e) => {
          const v = e.target.value.slice(0, BRIEF_MAX);
          setTexto(v);
          guardar(v);
        }}
        rows={4}
        spellCheck={false}
        placeholder={t("memoria.briefPlaceholder")}
        className="w-full resize-y rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint text-[11.5px] leading-relaxed px-2 py-1.5 focus:outline-none focus:ring-[color:var(--border-strong)] nice-scroll"
      />
      <div className="flex items-center justify-between text-[10px] fg-faint ui-small mt-0.5">
        <span>
          {estado === "guardando" && t("memoria.saving")}
          {estado === "guardado" && t("memoria.saved")}
          {estado === "error" && t("memoria.saveFailed")}
        </span>
        {/* El contador sólo aparece cerca del tope: el usuario tiene que VER
            venir el «brief lleno» que hoy le llega como un error del modelo. */}
        {quedan < 400 && (
          <span className="tabular">
            {texto.length} / {BRIEF_MAX}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * LA MEMORIA EN EL CHAT NUEVO (plans/new-chat/, del mock): un cajón bajo la
 * cabecera, abierto con el icono de la memoria. Lo mismo que `MemoriaDeLen` —lo
 * que Len recuerda de ti, con su «Quitar», y las notas de esta página— con la
 * piel del mock.
 */
export function MemoryDrawer({
  projectId,
  memory,
}: {
  projectId: string;
  memory: ReturnType<typeof useAgentMemory>;
}) {
  const t = useTranslations("panelsChat");
  const lines = memory.lines ?? [];
  return (
    <div className="bg-elev px-4 pb-3.5 pt-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <LenFace size={18} className="shrink-0" />
        {t("memoria.title")}
      </div>
      {lines.length > 0 ? (
        <>
          <p className="mb-2 mt-0.5 text-[11.5px] fg-muted">{t("memoria.description")}</p>
          <ul className="mb-2.5 grid list-none gap-[5px] p-0">
            {lines.map((line) => (
              <li
                key={line}
                className="nc-up flex items-center gap-2 rounded-[9px] border bd bg-side py-1.5 pl-2.5 pr-2 text-[12.5px]"
              >
                <span className="flex-1">{line}</span>
                <button
                  type="button"
                  onClick={() => void memory.remove(line)}
                  disabled={memory.removing === line}
                  className="shrink-0 text-[11.5px] fg-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                >
                  {t("memoria.remove")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-2.5 mt-0.5 text-[11.5px] fg-muted">{t("newChat.memory.empty")}</p>
      )}
      <BriefDeLaPagina projectId={projectId} />
    </div>
  );
}
