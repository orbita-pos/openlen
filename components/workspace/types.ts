// Shared state shape for the brief-input form — the AI entry panel
// (components/workspace-v2/panels/ai-brief-panel.tsx) and the left-sidebar
// wiring both consume it.
import type { StyleDirection } from "@/lib/style-match/direction-types";

export interface BriefFormState {
  prompt: string;
  setPrompt: (v: string) => void;
  /** La referencia visual de "hazme una como esta", si el usuario pegó una URL.
   *  Vive aquí y no dentro del compositor porque quien llama a `/api/generate`
   *  es la página, y porque así sobrevive a los cambios de panel igual que el
   *  brief. `null` = sin referencia, y entonces el prompt sale como siempre. */
  reference: StyleDirection | null;
  setReference: (v: StyleDirection | null) => void;
}
