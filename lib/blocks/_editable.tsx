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
// Server-renderable only. NO "use client" — every block consumes this
// component and the whole tree must run through renderToStaticMarkup.
// ─────────────────────────────────────────────────────────────────────────────

export interface EditorContextValue {
  /** Render text in edit mode (true: wrap in editable span, false: passthrough). */
  editorMode: boolean;
  /** Index of the block currently rendering; used to build the slot path. */
  blockIndex: number;
}

export const EditorContext = React.createContext<EditorContextValue>({
  editorMode: false,
  blockIndex: -1,
});

export interface EditableTextProps {
  /** Slot path WITHIN the block, e.g. `headline`, `features[2].title`. */
  slot: string;
  children: React.ReactNode;
}

export function EditableText({ slot, children }: EditableTextProps) {
  const { editorMode, blockIndex } = React.useContext(EditorContext);
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
