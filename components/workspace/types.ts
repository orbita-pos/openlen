// Shared state shape for the brief-input form — the AI entry panel
// (components/workspace-v2/panels/ai-brief-panel.tsx) and the left-sidebar
// wiring both consume it.
import type { StyleDirection } from "@/lib/style-match/direction-types";

export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
  /** The exact prefilled value whose suffix was discarded at the shared cap.
   *  Inputs consume it as a visible warning; the parent clears it on edits. */
  truncatedPrompt?: string | null;
  setTruncatedPrompt?: (value: string | null) => void;
  /** One-shot live-region token. The warning value may persist across mounts,
   *  but this event identity is consumed by the first input that announces it. */
  truncationAnnouncementToken?: string | null;
  setTruncationAnnouncementToken?: (token: string | null) => void;
  /** La referencia visual de "hazme una como esta", si el usuario pegó una URL.
   *  Vive aquí y no dentro del compositor porque quien llama a `/api/generate`
   *  es la página, y porque así sobrevive a los cambios de panel igual que el
   *  brief. `null` = sin referencia, y entonces el prompt sale como siempre. */
  reference: StyleDirection | null;
  setReference: (v: StyleDirection | null) => void;
  /** Las fotos que el usuario adjunta al brief, ya reducidas, como `data:` URI.
   *  Viven aqui por la MISMA razon que la referencia: quien llama a
   *  `/api/generate` es la pagina, y asi sobreviven a los cambios de panel.
   *
   *  Aqui NO se usa `sessionStorage` como en el heroe. Alli hacia falta porque
   *  las fotos tenian que cruzar una navegacion y un registro; aqui ya estamos
   *  en el taller y van directas a `generate`.
   *
   *  Hasta `MAX_REFERENCIAS` (4). El array vacio es el caso normal — se usa `[]`
   *  y no `null` para que quien lo pinta no tenga que distinguir «ninguna» de
   *  «todavia no»: las dos se recorren igual y las dos pintan nada. */
  fotos: readonly { dataUrl: string; nombre: string }[];
  setFotos: (v: readonly { dataUrl: string; nombre: string }[]) => void;
}
