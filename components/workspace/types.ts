// Shared state shape for the brief-input form — the AI entry panel
// (components/workspace-v2/panels/ai-brief-panel.tsx) and the left-sidebar
// wiring both consume it.
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
  /** Las fotos que el usuario adjunta al brief, ya reducidas, como `data:` URI.
   *  Viven aqui y no dentro del compositor porque quien manda el primer
   *  mensaje a Len es la pagina, y asi sobreviven a los cambios de panel.
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
  /** The PDFs attached on the start screen (26/10), uploaded with the first
   *  message like the photos. Without `setPdfs` the composer doesn't offer them. */
  pdfs?: readonly File[];
  setPdfs?: (v: readonly File[]) => void;
}
