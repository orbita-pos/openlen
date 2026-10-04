"use client";
// La cara de Len (`brand/len-cara/cara.js`): en la llamada y, desde el chat nuevo
// (plans/new-chat/), en la barra viva y en la pantalla vacía del chat. `cara.js`
// toca `document` al cargarse, así que se importa dentro del efecto: en el
// servidor no existe. Los estados son los de `LenCara.STATES`; la llamada usa
// saludando, escuchando, buscando, avisando, error y dormido, y el chat los de
// trabajar (pensando, escribiendo, mirando, revisando, preguntando…).
import { useEffect, useRef } from "react";

export type EstadoDeLaCara =
  | "saludando"
  | "escuchando"
  | "buscando"
  | "avisando"
  | "error"
  | "dormido"
  | "reposo"
  | "pensando"
  | "escribiendo"
  | "mirando"
  | "revisando"
  | "preguntando"
  | "terminado"
  | "publicado";

export function CaraDeLen({
  estado,
  props = "none",
  className = "size-44",
}: {
  estado: EstadoDeLaCara;
  /** Los accesorios de cada estado: «none» sólo la cara (la llamada), «compact»
   *  encogidos junto al anillo (el chat). Se fija al crearse. */
  props?: "all" | "compact" | "none";
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cara = useRef<MotorDeCara | null>(null);
  const ultimo = useRef(estado);
  ultimo.current = estado;

  useEffect(() => {
    let vivo = true;
    void import("@/brand/len-cara/cara.js").then(() => {
      if (!vivo || !host.current || !window.LenCara || cara.current) return;
      cara.current = window.LenCara.create(host.current, { props });
      // El de AHORA, no el del primer render: la carga es asíncrona y el estado
      // pudo cambiar mientras tanto.
      cara.current.set(ultimo.current);
    });
    return () => {
      vivo = false;
    };
    // Se crea una vez; el estado lo mueve el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cara.current?.set(estado);
  }, [estado]);

  return <div ref={host} className={className} aria-hidden />;
}
