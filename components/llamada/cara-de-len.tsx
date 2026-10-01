"use client";
// La cara de Len en la llamada. `cara.js` toca `document` al cargarse, así que se
// importa dentro del efecto: en el servidor no existe. Estados que usa la
// llamada (de `LenCara.STATES`): saludando, escuchando, buscando, avisando,
// error, dormido.
import { useEffect, useRef } from "react";

export type EstadoDeLaCara = "saludando" | "escuchando" | "buscando" | "avisando" | "error" | "dormido";

export function CaraDeLen({ estado }: { estado: EstadoDeLaCara }) {
  const host = useRef<HTMLDivElement>(null);
  const cara = useRef<MotorDeCara | null>(null);

  useEffect(() => {
    let vivo = true;
    void import("@/brand/len-cara/cara.js").then(() => {
      if (!vivo || !host.current || !window.LenCara || cara.current) return;
      cara.current = window.LenCara.create(host.current, { props: "none" });
      cara.current.set(estado);
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

  return <div ref={host} className="size-44" aria-hidden />;
}
