// El chat de una página (pieza 2): la conversación guardada + lo de esta
// sesión (lo que mandas, tus notas, la llamada) + el turno que corre ahora.
// Vive en la principal y no en la pantalla del chat: Len sigue trabajando
// aunque cierres el chat, y la hoja enseña lo mismo. Habla por api/chat.ts;
// la forma del hilo la decide hilo.ts.
//
// Lo que le escribes con Len trabajando va como corrección («dirigir») y, como
// en la web, sólo se ve mientras el turno corre: el servidor no la guarda en
// la conversación.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { TarjetaDeLlamada } from "@/components/llamada/puente-a-len";
import type { StoredChatTurn } from "@/lib/projects/types";
import { dirigirA, mandarALen, subirFoto, transcribir } from "../api/chat";
import { leerTurno } from "../api/proyectos";
import { achicarFoto } from "./foto";
import {
  conEvento,
  diaLocal,
  elementosDelTurno,
  hiloCompleto,
  hiloDesdeElHistorial,
  marcar,
  sinLoEnviado,
  terminaEnPregunta,
  turnoNuevo,
  type ElementoDelHilo,
  type TurnoEnVivo,
} from "./hilo";
import type { NotaGrabada } from "./use-nota";

export interface OpcionesDelChat {
  cliente: ClienteDeOpenLen;
  base: string;
  projectId: string | null;
  idioma: string;
  /** Debe ser la MISMA lista mientras no se relea la página (no `?? []` en cada render). */
  historial: StoredChatTurn[];
  /** Al acabar un turno: releer la página (conversación y vista previa). */
  alCambiarLaPagina: () => void;
  /** Lo que se le manda a Len con una foto sin texto: que diga dónde la pondría antes de ponerla. */
  textoDeFotoSola: string;
}

let contador = 0;
const nuevaClave = (p: string) => `${p}:${Date.now()}:${contador++}`;

export function useChat(o: OpcionesDelChat) {
  const op = useRef(o);
  const [locales, setLocales] = useState<ElementoDelHilo[]>([]);
  const [vivo, setVivo] = useState<TurnoEnVivo | null>(null);
  const [reenganche, setReenganche] = useState<{ turnoId: string | null; texto: string } | null>(null);
  const vivoRef = useRef(vivo);
  const reengancheRef = useRef(reenganche);
  const localesRef = useRef(locales);
  useLayoutEffect(() => {
    op.current = o;
    vivoRef.current = vivo;
    reengancheRef.current = reenganche;
    localesRef.current = locales;
  });
  const fotos = useRef(new Map<string, Blob>());
  const notas = useRef(new Map<string, NotaGrabada>());

  // Otra página, otra conversación.
  useEffect(() => {
    setLocales([]);
    setVivo(null);
    setReenganche(null);
    fotos.current.clear();
    notas.current.clear();
  }, [o.projectId]);

  // Releída la conversación (al acabar un turno), lo enviado ya está en ella.
  useEffect(() => {
    setVivo((v) => (v?.terminado ? null : v));
    setLocales(sinLoEnviado);
  }, [o.historial]);

  const correr = useCallback(async (prompt: string, foto?: string): Promise<boolean> => {
    const { cliente, projectId } = op.current;
    if (!projectId) return false;
    setVivo(turnoNuevo());
    const fin = await mandarALen(cliente, { projectId, prompt, foto }, (e) => setVivo((v) => (v ? conEvento(v, e) : v)));
    if (fin === "sinRed" || typeof fin === "object") {
      setVivo(null);
      return false;
    }
    // Sin «done», el turno sigue en el servidor (se cortó la conexión): se
    // relee la página y el reenganche lo sigue desde ahí.
    setVivo((v) => (v?.terminado ? v : null));
    op.current.alCambiarLaPagina();
    return true;
  }, []);

  const enviar = useCallback(
    async (k: string, texto: string, foto?: Blob) => {
      const { cliente, base, textoDeFotoSola } = op.current;
      setLocales((ls) => marcar(ls, k, { estado: "enviando" }));
      const v = vivoRef.current;
      const r = reengancheRef.current;
      if ((v && !v.terminado) || r) {
        // Len trabaja: lo que escribes le corrige el rumbo, sin pararlo.
        const turnoId = v?.turnoId ?? r?.turnoId ?? null;
        const ok = turnoId ? await dirigirA(cliente, turnoId, texto) : false;
        setLocales((ls) => marcar(ls, k, { estado: ok ? "ok" : "noSeEnvio" }));
        return;
      }
      let url: string | undefined;
      if (foto) {
        try {
          url = await subirFoto(cliente, base, await achicarFoto(foto));
        } catch {
          setLocales((ls) => marcar(ls, k, { estado: "noSeSubio" }));
          return;
        }
      }
      setLocales((ls) => marcar(ls, k, { estado: "ok" }));
      if (!(await correr(texto || textoDeFotoSola, url))) setLocales((ls) => marcar(ls, k, { estado: "noSeEnvio" }));
    },
    [correr],
  );

  const mandar = useCallback(
    (escrito: string, foto?: Blob) => {
      const k = nuevaClave("tu");
      if (foto) fotos.current.set(k, foto);
      // La foto sola va con lo que la app le pide a Len de tu parte («¿dónde
      // la pondrías?…»), y tu burbuja lo enseña ya: es lo que el servidor
      // guarda como tu mensaje, y al releer no cambia.
      const texto = escrito || (foto ? op.current.textoDeFotoSola : "");
      setLocales((ls) => [...ls, { clave: k, t: Date.now(), tipo: "tu", texto, foto: foto ? URL.createObjectURL(foto) : undefined, estado: "enviando" }]);
      void enviar(k, texto, foto);
    },
    [enviar],
  );

  const transcribirYMandar = useCallback(
    async (k: string) => {
      const n = notas.current.get(k);
      const { cliente, projectId, idioma } = op.current;
      if (!n || !projectId) return;
      setLocales((ls) => marcar(ls, k, { estado: "transcribiendo" }));
      const r = await transcribir(cliente, { audio: n.audio, projectId, idioma, segundos: n.segundos });
      if ("error" in r) {
        const aviso: ElementoDelHilo[] = r.error === "tope" ? [{ clave: nuevaClave("aviso"), t: Date.now(), tipo: "aviso", aviso: "tope" }] : [];
        setLocales((ls) => [...marcar(ls, k, { estado: "noSeEntendio" }), ...aviso]);
        return;
      }
      setLocales((ls) => marcar(ls, k, { transcripcion: r.texto }));
      await enviar(k, r.texto);
    },
    [enviar],
  );

  const mandarNota = useCallback(
    (n: NotaGrabada) => {
      const k = nuevaClave("voz");
      notas.current.set(k, n);
      setLocales((ls) => [...ls, { clave: k, t: Date.now(), tipo: "voz", url: n.url, barras: n.barras, segundos: n.segundos, transcripcion: null, estado: "transcribiendo" }]);
      void transcribirYMandar(k);
    },
    [transcribirYMandar],
  );

  const reintentar = useCallback(
    (k: string) => {
      const e = localesRef.current.find((x) => x.clave === k);
      if (e?.tipo === "voz") {
        if (e.transcripcion) void enviar(k, e.transcripcion);
        else void transcribirYMandar(k);
      } else if (e?.tipo === "tu") void enviar(k, e.texto, fotos.current.get(k));
    },
    [enviar, transcribirYMandar],
  );

  const borrar = useCallback((k: string) => {
    notas.current.delete(k);
    fotos.current.delete(k);
    setLocales((ls) => ls.filter((e) => e.clave !== k));
  }, []);

  const agregarLlamada = useCallback((segundos: number | null, tarjetas: TarjetaDeLlamada[]) => {
    const t = Date.now();
    const nuevos: ElementoDelHilo[] = tarjetas.map((tarjeta, i): ElementoDelHilo => ({ clave: nuevaClave(`tarjeta${i}`), t, tipo: "tarjeta", tarjeta }));
    if (segundos !== null) nuevos.unshift({ clave: nuevaClave("llamada"), t, tipo: "llamada", segundos });
    setLocales((ls) => [...ls, ...nuevos]);
  }, []);

  const avisar = useCallback((aviso: "sinMicro" | "tope") => {
    setLocales((ls) => [...ls, { clave: nuevaClave("aviso"), t: Date.now(), tipo: "aviso", aviso }]);
  }, []);

  // Volver con Len trabajando (cerraste la app, se cortó la red): el turno
  // sigue en el servidor y su fila se va llenando. Cada 4 s, como la hoja.
  const ultimo = o.historial.at(-1);
  const filaEnCurso = ultimo?.enCurso ? ultimo.id : null;
  const hayVivo = vivo !== null;
  useEffect(() => {
    if (!filaEnCurso || hayVivo) {
      setReenganche(null);
      return;
    }
    let vigente = true;
    const mirar = () => {
      void leerTurno(op.current.cliente, filaEnCurso)
        .then((r) => {
          if (!vigente) return;
          if (r.turno.enCurso) setReenganche({ turnoId: r.turnoId ?? null, texto: r.turno.assistantReasoning });
          else {
            setReenganche(null);
            op.current.alCambiarLaPagina();
          }
        })
        .catch(() => {});
    };
    mirar();
    const reloj = setInterval(mirar, 4000);
    return () => {
      vigente = false;
      clearInterval(reloj);
    };
  }, [filaEnCurso, hayVivo]);

  const elementos = useMemo(() => {
    const ahora = Date.now();
    const delTurno = vivo ? elementosDelTurno(vivo, ahora) : reenganche ? elementosDelTurno({ ...turnoNuevo(), texto: reenganche.texto }, ahora) : [];
    return hiloCompleto([hiloDesdeElHistorial(o.historial, ahora), locales, delTurno], diaLocal);
  }, [o.historial, locales, vivo, reenganche]);

  // Para la llamada (use-llamada: seguirEncargo): si llamas con Len
  // trabajando, la voz sabe en qué, y lo que le pides corrige ese turno.
  const trabajando = (vivo !== null && !vivo.terminado) || reenganche !== null;
  const turnoIdEnCurso = vivo?.turnoId ?? reenganche?.turnoId ?? null;
  const pedido = useMemo(() => {
    for (let i = elementos.length - 1; i >= 0; i--) {
      const e = elementos[i];
      if (e.tipo === "tu") return e.texto;
      if (e.tipo === "voz") return e.transcripcion ?? "";
    }
    return "";
  }, [elementos]);
  const encargo = useMemo(() => (trabajando ? { turnoId: turnoIdEnCurso, pedido } : null), [trabajando, turnoIdEnCurso, pedido]);
  // Lo último que dijo Len en el turno: al terminar, la llamada lo cuenta. Se
  // guarda aparte porque al acabar un turno reenganchado su texto se va antes
  // de que llegue la conversación releída.
  const ultimoTexto = useRef("");
  useLayoutEffect(() => {
    const t = vivo?.texto || reenganche?.texto;
    if (t) ultimoTexto.current = t;
  });
  const dichoAlTerminar = useCallback(() => ultimoTexto.current, []);

  return {
    elementos,
    trabajando,
    encargo,
    dichoAlTerminar,
    avance: vivo?.avance ?? null,
    pregunta: vivo ? vivo.pregunta : terminaEnPregunta(o.historial),
    mandar,
    mandarNota,
    reintentar,
    borrar,
    agregarLlamada,
    avisar,
  };
}

export type Chat = ReturnType<typeof useChat>;
