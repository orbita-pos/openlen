import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mencionesDe } from "@/lib/workspace-v2/menciones";
import { accionEquipo, cargarEquipo, ErrorEquipo } from "./api";
import { leerTurno } from "../api/proyectos";
import type { AccionEquipo, DatosEquipo, HiloEquipo } from "./tipos";
export interface OpcionesEquipo { cliente: ClienteDeOpenLen; projectId: string | null; activo: boolean; idioma: string; alPedirLen: (texto: string) => void; alCambiar: (pagina?: boolean) => void }
export function useEquipo(o: OpcionesEquipo) {
  const ultimo = useRef(o);
  const montado = useRef(true);
  const epoca = useRef(0);
  const lectura = useRef(0);
  const carga = useRef<AbortController | null>(null);
  const escrituras = useRef(new Set<string>());
  const vistos = useRef(new Set<string>());
  const pendientes = useRef(new Map<string, { projectId: string; filaId: string; hiloId: string }>());
  const vivosVistos = useRef(new Set<string>());
  const respuestasVistas = useRef(new Map<string, Set<string>>());
  const [seguimiento, setSeguimiento] = useState(0);
  const [guardado, setGuardado] = useState<{ projectId: string; datos: DatosEquipo } | null>(null);
  const [fallo, setFallo] = useState<{ projectId: string; error: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [vistas, setVistas] = useState<Record<string, { pestana: "mensajes" | "hilos"; hiloId?: string }>>({});
  useLayoutEffect(() => { ultimo.current = o; });
  useLayoutEffect(() => { montado.current = true; return () => { montado.current = false; carga.current?.abort(); }; }, []);
  useLayoutEffect(() => { epoca.current++; carga.current?.abort(); }, [o.projectId, o.activo]);
  const projectId = o.projectId ?? "";
  const datos = guardado?.projectId === projectId ? guardado.datos : null;
  const pestana = vistas[projectId]?.pestana ?? "mensajes";
  const hiloId = pestana === "hilos" ? vistas[projectId]?.hiloId : undefined;
  const hilo = datos?.hilos.find(h => h.id === hiloId) ?? null;
  const clave = `${projectId}:${hiloId ?? "mensajes"}`;
  const texto = borradores[clave] ?? "";
  const error = fallo?.projectId === projectId ? fallo.error : null;
  const marcarError = (id: string, e: unknown) => {
    if (montado.current) setFallo({ projectId: id, error: e instanceof ErrorEquipo ? e.codigo : "error" });
  };
  const recargar = useCallback(async () => {
    if (!o.projectId || !o.activo) return;
    const id = o.projectId, turno = ++lectura.current, actual = epoca.current;
    carga.current?.abort();
    const abort = new AbortController(); carga.current = abort;
    setCargando(true);
    try {
      const datos = await cargarEquipo(o.cliente, id, abort.signal);
      if (!montado.current || abort.signal.aborted || turno !== lectura.current || actual !== epoca.current) return;
      const respuestas = new Set(datos.hilos.flatMap(h => h.mensajes.filter(m => m.autorId === null && m.filaId).map(m => m.filaId!)));
      const antes = respuestasVistas.current.get(id);
      if (antes && [...respuestas].some(fila => !antes.has(fila))) ultimo.current.alCambiar(true);
      respuestasVistas.current.set(id, respuestas);
      setGuardado({ projectId: id, datos }); setFallo(null);
    } catch (e) {
      if (montado.current && !abort.signal.aborted && turno === lectura.current && actual === epoca.current) marcarError(id, e);
    } finally {
      if (montado.current && turno === lectura.current && actual === epoca.current) setCargando(false);
    }
  }, [o.cliente, o.projectId, o.activo]);
  useEffect(() => {
    if (!o.activo || !o.projectId) return;
    void recargar();
    const mirar = () => { if (!document.hidden && !escrituras.current.has(o.projectId!)) void recargar(); };
    const timer = setInterval(mirar, 12000);
    document.addEventListener("visibilitychange", mirar);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", mirar); carga.current?.abort(); };
  }, [recargar, o.activo, o.projectId]);
  useEffect(() => {
    if (!projectId || ![...pendientes.current.values()].some(p => p.projectId === projectId)) return;
    let vigente = true, consultando = false;
    const mirar = async () => {
      if (document.hidden || consultando) return;
      consultando = true;
      try {
        for (const [key, p] of pendientes.current) {
          if (p.projectId !== projectId || !vigente) continue;
          try {
            const r = await leerTurno(o.cliente, p.filaId);
            if (!vigente || !montado.current || ultimo.current.projectId !== projectId) return;
            if (r.turno.enCurso) {
              if (!vivosVistos.current.has(key)) { vivosVistos.current.add(key); ultimo.current.alCambiar(false); }
            } else {
              pendientes.current.delete(key); vivosVistos.current.delete(key);
              const vistas = respuestasVistas.current.get(projectId) ?? new Set<string>();
              vistas.add(p.filaId); respuestasVistas.current.set(projectId, vistas);
              ultimo.current.alCambiar(r.turno.status === "applied" && !r.turno.noDocChange && !r.turno.cortado);
              if (ultimo.current.activo) void recargar();
              setSeguimiento(n => n + 1);
            }
          } catch { /* La fila puede seguir en cola; se intenta en el próximo ciclo. */ }
        }
      } finally { consultando = false; }
    };
    void mirar();
    const timer = setInterval(() => void mirar(), 4000);
    return () => { vigente = false; clearInterval(timer); };
  }, [projectId, seguimiento, o.cliente, recargar]);
  useEffect(() => {
    if (!o.activo || !datos || !projectId) return;
    const chat = pestana === "mensajes";
    if (!chat && !hilo) return;
    const key = `${projectId}:${chat ? "chat:" + (datos.mensajes.at(-1)?.id ?? "vacio") : hilo!.id + ":" + (hilo!.mensajes.at(-1)?.id ?? "vacio")}`;
    if (vistos.current.has(key)) return;
    vistos.current.add(key);
    void accionEquipo(o.cliente, projectId, chat ? { accion: "vistas", chat: true } : { accion: "vistas", hilos: [hilo!.id] }).catch(() => vistos.current.delete(key));
  }, [datos, hilo, o.activo, o.cliente, projectId, pestana]);

  const operar = async (accion: AccionEquipo, borrador?: { clave: string; texto: string }) => {
    const id = projectId;
    if (!datos || !id || escrituras.current.has(id)) return false;
    escrituras.current.add(id); setOcupados([...escrituras.current]);
    lectura.current++; carga.current?.abort(); setCargando(false); setFallo(null);
    try {
      const resultado = await accionEquipo(o.cliente, id, accion);
      if (!montado.current) return true;
      if (accion.accion === "respuesta" && resultado.filaId) {
        pendientes.current.set(`${id}:${resultado.filaId}`, { projectId: id, filaId: resultado.filaId, hiloId: accion.hiloId });
        setSeguimiento(n => n + 1);
      }
      if (borrador) setBorradores(bs => bs[borrador.clave] === borrador.texto ? { ...bs, [borrador.clave]: "" } : bs);
      if (ultimo.current.projectId === id) {
        ultimo.current.alCambiar(false);
        await recargar();
      }
      return true;
    } catch (e) {
      if (ultimo.current.projectId === id) marcarError(id, e);
      return false;
    } finally {
      escrituras.current.delete(id);
      if (montado.current) setOcupados([...escrituras.current]);
    }
  };
  const enviar = async () => {
    if (!datos || !texto.trim() || escrituras.current.has(projectId)) return false;
    const m = mencionesDe(texto, datos.personas);
    if (m.len && !datos.puedeLen) { setFallo({ projectId, error: "solo_lectura" }); return false; }
    if (pestana === "hilos" && !hilo) return false;
    if (!hilo && m.len) {
      setBorradores(bs => ({ ...bs, [clave]: "" }));
      o.alPedirLen(texto); return true;
    }
    const menciones = m.personas.filter(id => id !== datos.yo);
    if (!hilo && !menciones.length) { setFallo({ projectId, error: "sin_mencion" }); return false; }
    return operar(hilo
      ? { accion: "respuesta", hiloId: hilo.id, texto, menciones, len: m.len, idioma: o.idioma }
      : { accion: "mensaje", texto, menciones, idioma: o.idioma }, { clave, texto });
  };
  return {
    datos, texto, error, cargando, ocupado: ocupados.includes(projectId), pestana, hilo,
    esperandoLen: [...pendientes.current.values()].some(p => p.projectId === projectId && p.hiloId === hilo?.id),
    cambiarTexto: (t: string) => setBorradores(bs => ({ ...bs, [clave]: t })),
    cambiarPestana: (pestana: "mensajes" | "hilos") => setVistas(vs => ({ ...vs, [projectId]: { pestana } })),
    abrirHilo: (hiloId: string) => setVistas(vs => ({ ...vs, [projectId]: { pestana: "hilos", hiloId } })),
    cerrarHilo: () => setVistas(vs => ({ ...vs, [projectId]: { pestana: "hilos" } })),
    cambiarEstado: (estado: HiloEquipo["estado"]) => hilo ? operar({ accion: "estado", hiloId: hilo.id, estado }) : Promise.resolve(false),
    recargar, enviar,
  };
}
export type ControlEquipo = ReturnType<typeof useEquipo>;
