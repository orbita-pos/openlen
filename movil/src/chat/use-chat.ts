// El chat de una página (pieza 2): la conversación guardada + lo de esta
// sesión (lo que mandas, tus notas, la llamada) + el turno que corre ahora.
// Vive en la principal y no en la pantalla del chat: Len sigue trabajando
// aunque cierres el chat, y la hoja enseña lo mismo. Habla por api/chat.ts;
// la forma del hilo la decide hilo.ts.
//
// Lo que le escribes con Len trabajando va como corrección («dirigir») sin
// pararlo; el servidor la escribe en la fila de ese turno, debajo de tu
// mensaje, con «↳» (`textoDelUsuario` en app/api/agent/route.ts).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { TarjetaDeLlamada } from "@/components/llamada/puente-a-len";
import { cleanVisualContext, VISUAL_STATES_MAX, visualStatesPayload } from "@/lib/agent/visuals/model-context";
import type { StoredChatTurn } from "@/lib/projects/types";
import { dirigirA, mandarALen, subirFoto, transcribir } from "../api/chat";
import { leerTurno } from "../api/proyectos";
import { achicarFoto } from "./foto";
import { subirArchivo, validarArchivos, tipoArchivo, type ArchivoAdjunto } from "./archivos";
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
import { pasosDelTrabajo } from "../entrega/progreso";
import { ultimoTurnoDeLen } from "../hoja";

export interface OpcionesDelChat {
  cliente: ClienteDeOpenLen;
  base: string;
  projectId: string | null;
  idioma: string;
  /** Debe ser la MISMA lista mientras no se relea la página (no `?? []` en cada render). */
  historial: StoredChatTurn[];
  /** Al acabar un turno: releer la página (conversación y vista previa). */
  alCambiarLaPagina: () => void;
  textoDeArchivoSolo: string;
  /** Talking with the person's own assistant instead of Len (phase 5): every message carries her id. */
  assistantId?: string;
  /** With her: the project on the phone's screen, sent with each message (spec local 2026-11-16-movil-es-tu-asistente,
   *  §5.3). */
  viewingProjectId?: string;
}

let contador = 0;
const nuevaClave = (p: string) => `${p}:${Date.now()}:${contador++}`;

export function useChat(o: OpcionesDelChat) {
  const op = useRef(o);
  const [locales, setLocales] = useState<ElementoDelHilo[]>([]);
  const [vivo, setVivo] = useState<TurnoEnVivo | null>(null);
  const [reenganche, setReenganche] = useState<{ fila: string; turnoId: string | null; texto: string; acciones?: StoredChatTurn["actions"] } | null>(null);
  const epoca = useRef(0);
  const vivoRef = useRef(vivo);
  const reengancheRef = useRef(reenganche);
  const localesRef = useRef(locales);
  const visualStatesRef = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    op.current = o;
    vivoRef.current = vivo;
    reengancheRef.current = reenganche;
    localesRef.current = locales;
  });
  // Switching project OR agent (two agents in the person's space share projectId): runs AFTER the ref-sync effect so
  // live refs and visual states clear synchronously on the switch render before the reset effect commits.
  useLayoutEffect(() => {
    const contador = epoca;
    contador.current++;
    vivoRef.current = null;
    reengancheRef.current = null;
    visualStatesRef.current = new Map();
    return () => { contador.current++; };
  }, [o.projectId, o.assistantId]);
  const fotos = useRef(new Map<string, Blob>());
  const vistasFoto = useRef(new Map<string,string>());
  const fotosSubidas = useRef(new Map<string,string>());
  const archivos = useRef(new Map<string, readonly File[]>());
  const subidos = useRef(new Map<string, ArchivoAdjunto[]>());
  const subiendoRef = useRef(false);
  const [subiendo, setSubiendo] = useState(false);
  const notas = useRef(new Map<string, NotaGrabada>());
  // WHAT THE VISUALS SHARED (spec local 2026-11-22-visuales-de-verdad, §2): latest state per widget_id of THIS chat
  // (project or agent), capped at VISUAL_STATES_MAX dropping the oldest.
  const reportVisualState = useCallback((widgetId: string, state: string) => {
    const held = visualStatesRef.current;
    const clean = cleanVisualContext(state);
    held.delete(widgetId);
    if (!clean) return;
    held.set(widgetId, clean);
    while (held.size > VISUAL_STATES_MAX) held.delete(held.keys().next().value!);
  }, []);
  const visualStatesForBody = useCallback(() => {
    const list = visualStatesPayload(visualStatesRef.current);
    return list.length > 0 ? list : undefined;
  }, []);

  const limpiarAdjuntos = useCallback((k: string) => {
    const url=vistasFoto.current.get(k);if(url)URL.revokeObjectURL(url);
    vistasFoto.current.delete(k);fotos.current.delete(k);fotosSubidas.current.delete(k);archivos.current.delete(k);subidos.current.delete(k);
  }, []);
  useEffect(()=>()=>{
    for(const k of new Set([...fotos.current.keys(),...archivos.current.keys()]))limpiarAdjuntos(k);
  },[limpiarAdjuntos]);

  // Otra página u otro agente, otra conversación.
  useEffect(() => {
    setLocales([]);
    setVivo(null);
    setReenganche(null);
    for(const k of new Set([...fotos.current.keys(),...archivos.current.keys()]))limpiarAdjuntos(k);
    fotos.current.clear();
    archivos.current.clear(); subidos.current.clear(); subiendoRef.current = false; setSubiendo(false);
    notas.current.clear();
  }, [o.projectId, o.assistantId, limpiarAdjuntos]);

  // Releída la conversación (al acabar un turno): lo enviado que ya trae, lo
  // pinta ella.
  useEffect(() => {
    const guardados=new Set(o.historial.map(t=>t.id));
    for(const e of localesRef.current)if("fila" in e && e.fila && guardados.has(e.fila))limpiarAdjuntos(e.clave);
    setVivo((v) => (v?.terminado ? null : v));
    setLocales((ls) => sinLoEnviado(ls, o.historial));
  }, [o.historial, limpiarAdjuntos]);

  /** `opening`: her file's first message. "yaAbierto": the server says it was already sent elsewhere (the web, another
   *  phone) — not a failure. */
  const correr = useCallback(async (prompt: string, fila: string, foto?: string, goal?: "create" | "resume", documentos?: readonly ArchivoAdjunto[], opening = false): Promise<boolean | "yaAbierto"> => {
    const { cliente, projectId, assistantId, viewingProjectId } = op.current;
    if (!projectId) return false;
    const actual = epoca.current;
    const visualStates = visualStatesForBody();
    let estado = turnoNuevo(fila);
    vivoRef.current = estado;
    setVivo(estado);
    const fin = await mandarALen(cliente, { projectId, prompt, foto, archivos: documentos, turnId: fila, goal, ...(visualStates ? { visualStates } : {}), ...(assistantId ? { assistantId, ...(viewingProjectId ? { viewingProjectId } : {}), ...(opening ? { opening: true } : {}) } : {}) }, (e) => {
      if (actual !== epoca.current) return;
      estado = conEvento(estado, e);
      vivoRef.current = estado;
      setVivo(estado);
      if (e.nombre === "turno" && typeof (e.datos as { turnoId?: unknown } | null)?.turnoId === "string") {
        setLocales(ls => ls.map(x => (x.tipo === "tu" || x.tipo === "voz") && x.fila === fila && x.estado === "enviando" ? { ...x, estado: "ok" } : x));
      }
    });
    if (actual !== epoca.current) return true;
    if (typeof fin === "object" && fin.code === "already_opened") {
      setVivo(null);
      return "yaAbierto";
    }
    if (fin === "sinRed" || typeof fin === "object") {
      setVivo(null);
      return false;
    }
    // Sin «done», el turno sigue en el servidor (se cortó la conexión): se
    // relee la página y el reenganche lo sigue desde ahí.
    setVivo((v) => (v?.terminado ? v : null));
    op.current.alCambiarLaPagina();
    return true;
  }, [visualStatesForBody]);

  const enviar = useCallback(
    async (k: string, texto: string, foto?: Blob, goal?: "create" | "resume", documentos: readonly File[] = [], opening = false) => {
      const { cliente, base, projectId } = op.current;
      const actual = epoca.current;
      setLocales((ls) => marcar(ls, k, { estado: "enviando" }));
      if (!projectId || subiendoRef.current || validarArchivos(documentos)) { setLocales(ls => marcar(ls,k,{estado:"noSeEnvio"})); return; }
      const v = vivoRef.current;
      const r = reengancheRef.current;
      if ((v && !v.terminado) || r) {
        if (goal || foto || documentos.length) { setLocales((ls) => marcar(ls, k, { estado: "noSeEnvio" })); return; }
        // Len trabaja: lo que escribes le corrige el rumbo, sin pararlo.
        const turnoId = v?.turnoId ?? r?.turnoId ?? null;
        const fila = v?.fila ?? r?.fila;
        // Always include `visualStates` (even `[]`) so clearing the last visual on screen replaces stale state on the server.
        const visualStates = visualStatesForBody() ?? [];
        const ok = turnoId ? await dirigirA(cliente, turnoId, texto, visualStates) : false;
        if (actual !== epoca.current) return;
        setLocales((ls) => marcar(ls, k, ok ? { estado: "ok", fila, correccion: true } : { estado: "noSeEnvio" }));
        return;
      }
      let url = fotosSubidas.current.get(k);
      const enviados = subidos.current.get(k) ?? [];
      if (foto || documentos.length) {
        subiendoRef.current = true; setSubiendo(true);
        try {
          if (foto && !url) {
            url = await subirFoto(cliente, base, await achicarFoto(foto), projectId);
            if(actual!==epoca.current)return;
            fotosSubidas.current.set(k,url);
          }
          for (let i=enviados.length;i<documentos.length;i++) {
            if (actual !== epoca.current) return;
            const archivo = await subirArchivo(cliente,base,projectId,documentos[i]!);
            if (actual !== epoca.current) return;
            enviados.push(archivo); subidos.current.set(k,enviados);
          }
        } catch {
          if (actual === epoca.current) setLocales(ls=>marcar(ls,k,{estado:"noSeSubio"}));
          return;
        } finally {
          if (actual === epoca.current) { subiendoRef.current=false; setSubiendo(false); }
        }
      }
      if (actual !== epoca.current) return;
      // El id de la fila lo pone la app, como la web: así sabe cuándo la
      // conversación releída ya trae este mensaje.
      const fila = crypto.randomUUID();
      setLocales((ls) => marcar(ls, k, { estado: "enviando", fila }));
      const ok = await correr(texto, fila, url, goal, enviados, opening);
      if (actual !== epoca.current) return;
      // Her first message, already sent from the web: this bubble goes, and her conversation (with that one) is read.
      if (ok === "yaAbierto") {
        setLocales((ls) => ls.filter((x) => x.clave !== k));
        op.current.alCambiarLaPagina();
        return;
      }
      setLocales((ls) => marcar(ls, k, { estado: ok ? "ok" : "noSeEnvio" }));
    },
    [correr, visualStatesForBody],
  );

  const mandar = useCallback(
    (escrito: string, foto?: Blob, documentos: readonly File[] = []) => {
      const k = nuevaClave("tu");
      if (foto) fotos.current.set(k, foto);
      if(documentos.length) archivos.current.set(k,documentos);
      const vistaFoto=foto?URL.createObjectURL(foto):undefined;
      if(vistaFoto)vistasFoto.current.set(k,vistaFoto);
      const texto = escrito || (documentos.length ? op.current.textoDeArchivoSolo : "");
      setLocales((ls) => [...ls, { clave: k, t: Date.now(), tipo: "tu", texto, foto: vistaFoto, archivos: documentos.map(f=>({name:f.name,size:f.size,kind:tipoArchivo(f.name)??undefined})), estado: "enviando" }]);
      void enviar(k, texto, foto, undefined, documentos);
    },
    [enviar],
  );

  /** Her file's first message (spec local 2026-11-19-agentes-para-todos, §6.4), as the person's bubble, as her place on the
   *  web sends it: marked, so the server lets it go once. */
  const abrirCon = useCallback(
    (texto: string) => {
      // With one of her turns live her conversation has begun: there is no opening to send, and never as a correction.
      if ((vivoRef.current && !vivoRef.current.terminado) || reengancheRef.current) return;
      const k = nuevaClave("tu");
      setLocales((ls) => [...ls, { clave: k, t: Date.now(), tipo: "tu", texto, archivos: [], estado: "enviando" }]);
      void enviar(k, texto, undefined, undefined, [], true);
    },
    [enviar],
  );

  const mandarEncargo = useCallback(async (texto: string, modo: "create" | "resume") => {
    if (!op.current.projectId || (vivoRef.current && !vivoRef.current.terminado) || reengancheRef.current) return;
    const k = nuevaClave("encargo");
    setLocales((ls) => [...ls, { clave: k, t: Date.now(), tipo: "tu", texto, goal: modo, estado: "enviando" }]);
    await enviar(k, texto, undefined, modo);
  }, [enviar]);

  const transcribirYMandar = useCallback(
    async (k: string) => {
      const n = notas.current.get(k);
      const { cliente, projectId, idioma } = op.current;
      const actual = epoca.current;
      if (!n || !projectId) return;
      setLocales((ls) => marcar(ls, k, { estado: "transcribiendo" }));
      const r = await transcribir(cliente, { audio: n.audio, projectId, idioma, segundos: n.segundos });
      if (actual !== epoca.current) return;
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
      } else if (e?.tipo === "tu") void enviar(k, e.texto, fotos.current.get(k), e.goal, archivos.current.get(k));
    },
    [enviar, transcribirYMandar],
  );

  const borrar = useCallback((k: string) => {
    notas.current.delete(k);
    limpiarAdjuntos(k);
    setLocales((ls) => ls.filter((e) => e.clave !== k));
  }, [limpiarAdjuntos]);

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
  const ultimo = ultimoTurnoDeLen(o.historial);
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
          if (r.turno.enCurso) setReenganche({ fila: filaEnCurso, turnoId: r.turnoId ?? null, texto: r.turno.assistantReasoning, acciones: r.turno.actions });
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
  }, [filaEnCurso, hayVivo, o.projectId, o.assistantId]);

  const elementos = useMemo(() => {
    const ahora = Date.now();
    const delTurno = vivo
      ? elementosDelTurno(vivo, ahora)
      : reenganche
        ? elementosDelTurno({ ...turnoNuevo(reenganche.fila), texto: reenganche.texto, acciones: reenganche.acciones }, ahora)
        : [];
    return hiloCompleto([hiloDesdeElHistorial(o.historial, ahora), locales, delTurno], diaLocal);
  }, [o.historial, locales, vivo, reenganche]);

  // Para la llamada (use-llamada: seguirEncargo): si llamas con Len
  // trabajando, la voz sabe en qué, y lo que le pides corrige ese turno.
  const trabajando = (vivo !== null && !vivo.terminado) || reenganche !== null || subiendo;
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
    progreso: pasosDelTrabajo(vivo ? vivo.acciones ?? [] : reenganche ? reenganche.acciones ?? [] : ultimo?.actions ?? []),
    turnoId: turnoIdEnCurso,
    pregunta: vivo ? vivo.pregunta : terminaEnPregunta(o.historial),
    mandar,
    abrirCon,
    mandarEncargo,
    mandarNota,
    reintentar,
    borrar,
    agregarLlamada,
    avisar,
    reportVisualState,
  };
}

export type Chat = ReturnType<typeof useChat>;
