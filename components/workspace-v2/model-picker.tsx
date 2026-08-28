"use client";

import { useCallback, useEffect, useState } from "react";
import type { AIModel } from "@/lib/ai-provider";

// EL COMPONENTE `ModelPicker` SE BORRÓ el 2026-08-28, y con él sus cadenas y
// su tabla `MODEL_META`.
//
// Ofrecía «Gemini 3.1 Pro» y «Gemini 3.5 Flash», y las dos cosas eran mentira:
// Gemini no corre por defecto en ninguna superficie desde ese día, y la
// elección NO viajaba —sólo la rama de Gemini pasa `model` al proveedor; la de
// Fireworks, que es la que corre, lo ignora—. Encima el modo Agente, que es el
// defecto, ni lo pintaba. Un control que nombra un proveedor apagado y no hace
// nada, en un repo público donde cualquiera lo comprueba.
//
// `useAIModel` SE QUEDA: `ai-design` sigue leyendo `body.model` para elegir la
// configuración de su rama de vuelta atrás a Gemini, que es el único sitio
// donde ese valor todavía significa algo. El fichero conserva su nombre para
// no mover el import de quien lo usa.
const STORAGE_KEY = "openlen:ai-model";

/** The model choice, backed by localStorage so it survives reloads and is
 *  shared across the chat + generation surfaces. */
export function useAIModel(): [AIModel, (m: AIModel) => void] {
  const [model, setModel] = useState<AIModel>("gemini-flash");
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "gemini-pro" || stored === "gemini-flash") setModel(stored);
  }, []);
  const choose = useCallback((m: AIModel) => {
    setModel(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* private mode — the choice still applies this session */
    }
  }, []);
  return [model, choose];
}

// EL COMPONENTE `ModelPicker` SE BORRÓ el 2026-08-28, y con él sus cadenas.
//
// Ofrecía «Gemini 3.1 Pro» y «Gemini 3.5 Flash», y las dos cosas eran mentira:
// Gemini no corre por defecto en ninguna superficie desde ese día, y la
// elección NO viajaba —sólo la rama de Gemini pasa `model` al proveedor; la de
// Fireworks, que es la que corre, lo ignora—. Encima el modo Agente, que es el
// defecto, ni lo pintaba. Un control que nombra un proveedor apagado y no hace
// nada, en un repo público donde cualquiera lo comprueba.
//
// `useAIModel` SE QUEDA: `ai-design` sigue leyendo `body.model` para elegir la
// configuración de su rama de vuelta atrás a Gemini, que es el único sitio
// donde ese valor todavía significa algo.
