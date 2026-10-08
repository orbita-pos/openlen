"use client";

// EL SONDEO DEL CHAT DEL EQUIPO: con el proyecto compartido y el chat abierto,
// cada 10 s se mira la firma de la conversación y sólo si cambió se relee
// (`alCambiar`); releer el proyecto entero cada 10 s, y avisar a las otras
// pestañas, sería mucho.
//
// 🔴 Si el chat era de uno y pasa a compartido con la pestaña abierta (el
// invitado acaba de aceptar), lo que escribió entre medias ya va en la primera
// firma: tomarla como referencia lo escondería. Entonces se relee en seguida.

import { useEffect, useRef, type MutableRefObject } from "react";

export function useSondeoDelEquipo(p: {
  readonly compartido: boolean;
  /** La gente ya se leyó y el proyecto NO era compartido (no el «aún no sé»). */
  readonly soloConfirmado: boolean;
  readonly leerFirma: () => Promise<string | null>;
  readonly alCambiar: () => void;
  readonly ocupado: () => boolean;
  /** La firma que el panel ya conoce: tras enviar se fija aquí, y el sondeo no
   *  vuelve a releer por un cambio que acabamos de hacer nosotros. */
  readonly firmaRef: MutableRefObject<string | null>;
}): void {
  const { compartido, leerFirma, firmaRef } = p;
  const eraSolo = useRef(false);
  if (p.soloConfirmado) eraSolo.current = true;
  const alCambiarRef = useRef(p.alCambiar);
  alCambiarRef.current = p.alCambiar;
  const ocupadoRef = useRef(p.ocupado);
  ocupadoRef.current = p.ocupado;
  useEffect(() => {
    if (!compartido) return;
    firmaRef.current = null;
    if (eraSolo.current) {
      eraSolo.current = false;
      alCambiarRef.current();
    }
    const mirar = async () => {
      if (document.hidden || ocupadoRef.current()) return;
      const firma = await leerFirma();
      if (firma === null) return;
      if (firmaRef.current !== null && firma !== firmaRef.current) alCambiarRef.current();
      firmaRef.current = firma;
    };
    void mirar();
    const reloj = window.setInterval(() => void mirar(), 10_000);
    return () => window.clearInterval(reloj);
  }, [compartido, leerFirma, firmaRef]);
}
