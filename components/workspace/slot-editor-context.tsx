"use client";

import { createContext, useContext } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SlotEditorContext — page-level state the deep slot-field tree needs to read
// without threading 6 levels of recursion. Currently just `generationId`,
// which the ImageField uses to scope uploaded files under
// `/uploads/<generationId>/…`.
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotEditorContextValue {
  /** The generation this editor instance is mutating. Used by ImageField to
   *  bucket uploads server-side. Falsy when the page is mid-generation and
   *  no id has been assigned yet (the editor isn't reachable in that state,
   *  so this is mostly a defensive default). */
  generationId: string | null;
}

const EditorContext = createContext<SlotEditorContextValue>({ generationId: null });

export function SlotEditorContextProvider({
  generationId,
  children,
}: {
  generationId: string | null;
  children: React.ReactNode;
}) {
  return (
    <EditorContext.Provider value={{ generationId }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditorContext(): SlotEditorContextValue {
  return useContext(EditorContext);
}
