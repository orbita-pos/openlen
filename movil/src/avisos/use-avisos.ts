import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { crearControlDeAvisos, type EstadoAvisos } from "./controlador";
import { nativoAvisos } from "./nativo";

const controles = new Map<ClienteDeOpenLen, ReturnType<typeof crearControlDeAvisos>>();
/** Llamar y esperar ANTES de revocar/borrar la llave. La FK también borra al revocarla. */
export async function cerrarAvisos(cliente: ClienteDeOpenLen): Promise<void> {
  const control = controles.get(cliente);
  controles.delete(cliente);
  if (control) await control.cerrar();
}
/** Un 401: ya no se puede dar de baja con esa llave. La revocación borra por FK. */
export function abandonarAvisos(cliente: ClienteDeOpenLen): void {
  const control = controles.get(cliente);
  controles.delete(cliente);
  control?.abandonar();
  if (Capacitor.getPlatform() === "android" && import.meta.env.VITE_ANDROID_PUSH_CONFIGURED === "true") {
    void Promise.allSettled([nativoAvisos.desregistrar(), nativoAvisos.limpiar()]);
  }
}
export function useAvisos({ cliente, onAbrirProyecto }: { cliente: ClienteDeOpenLen; onAbrirProyecto(id: string, destino?: "equipo"): void }) {
  const abrir = useRef(onAbrirProyecto);
  abrir.current = onAbrirProyecto;
  const ref = useRef<ReturnType<typeof crearControlDeAvisos> | null>(null);
  const [estado, setEstado] = useState<EstadoAvisos>({ estado: "cargando", recibido: null });
  useEffect(() => {
    const control = crearControlDeAvisos({ cliente, nativo: nativoAvisos, configurado: Capacitor.getPlatform() === "android" && import.meta.env.VITE_ANDROID_PUSH_CONFIGURED === "true", onEstado: setEstado, onAbrirProyecto: (id, destino) => abrir.current(id, destino) });
    ref.current = control;
    controles.set(cliente, control);
    void control.iniciar();
    return () => { control.abandonar(); if (controles.get(cliente) === control) controles.delete(cliente); if (ref.current === control) ref.current = null; };
  }, [cliente]);
  return { ...estado, activar: async () => { await ref.current?.activar(); }, desactivar: async () => { await ref.current?.desactivar(); }, abrirRecibido: async () => { await ref.current?.abrirRecibido(); } };
}
export type Avisos = ReturnType<typeof useAvisos>;
