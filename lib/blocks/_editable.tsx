import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EditableText — the inline-edit wrapper for text-bearing slots.
//
// Off (the default for publish, zip export, and any non-workspace render):
//   <EditableText slot="headline">Hi</EditableText>  →  "Hi"
// On (only inside the workspace iframe when the user toggles Edit mode):
//   <EditableText slot="headline">Hi</EditableText>
//     →  <span data-slot-path="blocks.2.slots.headline"
//              contenteditable="plaintext-only">Hi</span>
//
// The `data-slot-path` attribute is the inline editor's API surface. The
// path is `blocks.<index>.slots.<slot-within-block>`, where the block index
// is supplied by `EditorContext` so block components don't have to know
// their position. Array indices use bracket notation, e.g. `features[3].title`.
//
// Why the createContext call is deferred:
// React 19 / Next 15 forbid `React.createContext` at MODULE-LOAD inside an
// RSC bundle (the bundler tags the module as a Server Component and throws
// before any caller can use the context). The orchestrator path
// (`lib/orchestrator/assemble.ts`) — and the new template renderer
// (`components/templates/render.ts`) — invoke `renderToStaticMarkup` from
// react-dom/server which DOES support createContext at runtime, so we only
// need to dodge the module-load check. Wrapping the call in a function
// (`getEditorContext()`) achieves that: the import succeeds; the context is
// created the first time render code reads it.
// ─────────────────────────────────────────────────────────────────────────────

export interface EditorContextValue {
  /** Render text in edit mode (true: wrap in editable span, false: passthrough). */
  editorMode: boolean;
  /** Index of the block currently rendering; used to build the slot path. */
  blockIndex: number;
}

const DEFAULT_EDITOR_CONTEXT: EditorContextValue = {
  editorMode: false,
  blockIndex: -1,
};

// Internal cache: the context is created on first access, then reused for
// every subsequent caller (same module instance = same context object).
let _editorContext: React.Context<EditorContextValue> | undefined;

/** Lazy accessor for the editor context. Callers do
 *  `<getEditorContext().Provider value={...}>` and
 *  `useContext(getEditorContext())`. */
export function getEditorContext(): React.Context<EditorContextValue> {
  if (!_editorContext) {
    _editorContext = React.createContext<EditorContextValue>(
      DEFAULT_EDITOR_CONTEXT,
    );
    _editorContext.displayName = "EditorContext";
  }
  return _editorContext;
}

export interface EditableTextProps {
  /** Slot path WITHIN the block, e.g. `headline`, `features[2].title`. */
  slot: string;
  children: React.ReactNode;
}

export function EditableText({ slot, children }: EditableTextProps) {
  const { editorMode, blockIndex } = React.useContext(getEditorContext());
  if (!editorMode) return <>{children}</>;
  const path = `blocks.${blockIndex}.slots.${slot}`;
  return (
    <span
      data-slot-path={path}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      suppressHydrationWarning
    >
      {children}
    </span>
  );
}
