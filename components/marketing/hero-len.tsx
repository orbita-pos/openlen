"use client";

// LEN EN LA PORTADA (04/10): la cara viva arriba del titular, atenta a la caja
// de prompt de debajo. Saluda al llegar, sigue el cursor en reposo, te escucha
// mientras escribes o dictas y se pone a pensar al enviar.
//
// La caja y la cara viven en ramas distintas del héroe (la cara arriba del
// titular, la caja debajo), así que se hablan por contexto: la caja REPORTA lo
// que pasa y aquí se decide el estado. Fuera del proveedor el reporte es un
// no-op, y `HeroPromptInput` sigue funcionando sola donde se monte.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CaraDeLen, type EstadoDeLaCara } from "@/components/llamada/cara-de-len";

type Signals = {
  focused: boolean;
  hasText: boolean;
  listening: boolean;
  sent: boolean;
  /** La caja está tecleando sola un encargo de ejemplo. */
  ghost: boolean;
};

const INITIAL: Signals = { focused: false, hasText: false, listening: false, sent: false, ghost: false };
// Lo que dura el saludo antes de volver al reposo.
const GREETING_MS = 2400;

const ReportContext = createContext<(patch: Partial<Signals>) => void>(() => {});
const StateContext = createContext<EstadoDeLaCara>("reposo");

export function HeroLenProvider({ children }: { children: ReactNode }) {
  const [signals, setSignals] = useState(INITIAL);
  const [greeting, setGreeting] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), GREETING_MS);
    return () => window.clearTimeout(id);
  }, []);

  const report = useCallback((patch: Partial<Signals>) => {
    setSignals((prev) => {
      const next = { ...prev, ...patch };
      return (Object.keys(next) as (keyof Signals)[]).some((k) => next[k] !== prev[k]) ? next : prev;
    });
  }, []);

  const state = useMemo<EstadoDeLaCara>(() => {
    if (signals.sent) return "pensando";
    if (signals.listening) return "escuchando";
    if (signals.focused && signals.hasText) return "escuchando";
    if (greeting) return "saludando";
    if (signals.ghost) return "escuchando";
    return "reposo";
  }, [signals, greeting]);

  return (
    <ReportContext.Provider value={report}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ReportContext.Provider>
  );
}

export function useHeroLenReport() {
  return useContext(ReportContext);
}

export function HeroLenFace({ className }: { className?: string }) {
  const state = useContext(StateContext);
  return <CaraDeLen estado={state} props="compact" className={className} />;
}
