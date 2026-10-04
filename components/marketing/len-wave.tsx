"use client";

// La cara viva de Len en el cierre de la portada: saluda cada vez que la
// tarjeta entra en pantalla y luego vuelve al reposo, siguiendo el cursor.
import { useEffect, useRef, useState } from "react";
import { CaraDeLen, type EstadoDeLaCara } from "@/components/llamada/cara-de-len";

const GREETING_MS = 2400;

export function LenWave({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<EstadoDeLaCara>("reposo");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setState("saludando");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setState("reposo"), GREETING_MS);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      <CaraDeLen estado={state} props="compact" className="size-full" />
    </div>
  );
}
