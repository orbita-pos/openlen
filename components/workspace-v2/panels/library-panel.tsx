"use client";

// Library panel — Canva-style left-rail of insertable elements + sections.
// Lives in the LeftSidebar's "library" tab, visible only in Canva-mode.
//
// Two insert paths:
//   • Click → inserts at a "smart target" (selected Box → inside; selected
//     leaf → sibling; nothing → end of page root). Best for click-once users.
//   • Drag → drop anywhere on the iframe at the exact 3-zone position
//     (before/after/inside). The iframe owns the drop handling; we just
//     tag the dataTransfer with our mime + JSON payload.
//
// Either way, after insert, page.tsx scrolls the iframe to the new node
// via onAfterInsert so the user sees what they just dropped.

import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import type { Document as DocModel, NodeId } from "@/lib/doc/model";
import type { Op } from "@/lib/doc/ops";
import { buildSubtree, type NodeSpec } from "@/lib/doc/build";
import { editInsert } from "@/lib/doc/edits";
import { SECTION_TEMPLATES } from "@/lib/section-templates";
import {
  ELEMENT_TEMPLATES,
  labelForNode,
} from "../model/canva-inspector";

const LIBRARY_MIME = "application/openlen-library";

export interface LibraryPanelProps {
  doc: DocModel;
  selectedIds: NodeId[];
  onSelect: (ids: NodeId[]) => void;
  onEdit: (ops: Op[]) => void;
  /** Fired after a successful click-insert with the new node's id, so the
   *  parent can scroll the iframe to the freshly-added element. Drop-insert
   *  goes through PreviewArea.onLibraryDrop → page.tsx, which handles its
   *  own scroll. */
  onAfterInsert?: (id: NodeId) => void;
}

// Where a click-insert should land. Single Box/Page selected → inside; single
// leaf selected → sibling; otherwise → root.
function targetParent(doc: DocModel, selectedIds: NodeId[]): NodeId {
  if (selectedIds.length === 1) {
    const sel = doc.nodes[selectedIds[0]];
    if (sel) {
      if (sel.type === "Box" || sel.type === "Page") return sel.id;
      if (sel.parentId) return sel.parentId;
    }
  }
  return doc.root;
}

// Human-readable "where will this land?" copy. Avoids HTML jargon by using
// labelForNode (which produces the Text content, or the type, instead of the
// raw tag) and describes the position relationally.
function targetCopy(doc: DocModel, selectedIds: NodeId[]): string {
  if (selectedIds.length === 1) {
    const sel = doc.nodes[selectedIds[0]];
    if (sel) {
      const label = labelForNode(sel);
      if (sel.type === "Page") return "al final de la página";
      if (sel.type === "Box") return `dentro de "${label}"`;
      return `al lado de "${label}"`;
    }
  }
  return "al final de la página";
}

export function LibraryPanel({
  doc,
  selectedIds,
  onSelect,
  onEdit,
  onAfterInsert,
}: LibraryPanelProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const elements = useMemo(
    () =>
      q
        ? ELEMENT_TEMPLATES.filter((t) => t.name.toLowerCase().includes(q))
        : ELEMENT_TEMPLATES,
    [q],
  );
  const sections = useMemo(
    () =>
      q
        ? SECTION_TEMPLATES.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.hint.toLowerCase().includes(q),
          )
        : SECTION_TEMPLATES,
    [q],
  );

  const insert = (spec: NodeSpec) => {
    const parentId = targetParent(doc, selectedIds);
    const parent = doc.nodes[parentId];
    if (!parent) return;
    const built = buildSubtree(spec);
    if ("err" in built) return;
    const op = editInsert(
      doc,
      parentId,
      parent.childIds.length,
      built.ok.rootId,
      built.ok.nodes,
    );
    if (op) {
      onEdit([op]);
      onSelect([built.ok.rootId]);
      onAfterInsert?.(built.ok.rootId);
    }
  };

  const dragStart =
    (kind: "element" | "section", id: string) =>
    (e: DragEvent<HTMLButtonElement>) => {
      try {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          LIBRARY_MIME,
          JSON.stringify({ kind, id }),
        );
      } catch {
        /* IE/old browsers — copy fallback */
      }
    };

  const empty = elements.length === 0 && sections.length === 0;
  const hint = targetCopy(doc, selectedIds);

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar elementos o secciones…"
          className="w-full h-8 rounded-md bg-elev border bd text-[12px] fg px-2.5 outline-none focus:border-[color:var(--accent)] placeholder:fg-faint"
        />
        <p className="text-[10.5px] fg-faint leading-snug">
          Click = se agrega {hint}. Arrastrá al canvas para soltar en un punto
          exacto.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-3 pb-3 space-y-3">
        {empty && (
          <div className="py-8 text-center text-[11.5px] fg-faint">
            Nada coincide con &ldquo;{query}&rdquo;.
          </div>
        )}
        {elements.length > 0 && (
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] fg-faint font-semibold mb-1.5">
              Elementos
            </div>
            <div className="grid grid-cols-4 gap-1">
              {elements.map((t) => {
                const Icon = t.Icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    draggable
                    onDragStart={dragStart("element", t.id)}
                    onClick={() => insert(t.spec)}
                    title={`${t.name} · arrastrá al canvas para soltar`}
                    className="flex flex-col items-center justify-center gap-1 h-14 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover hover:border-[color:var(--accent)]/50 transition cursor-grab active:cursor-grabbing"
                  >
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                    <span className="text-[9px] truncate max-w-full px-0.5">
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {sections.length > 0 && (
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] fg-faint font-semibold mb-1.5">
              Secciones
            </div>
            <ul className="space-y-1">
              {sections.map((t) => {
                const Icon = t.Icon;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={dragStart("section", t.id)}
                      onClick={() => insert(t.spec)}
                      title={`${t.hint} · arrastrá al canvas para soltar`}
                      className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover hover:border-[color:var(--accent)]/50 transition text-left cursor-grab active:cursor-grabbing"
                    >
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        className="shrink-0 mt-0.5"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11.5px] fg truncate font-medium">
                          {t.name}
                        </span>
                        <span className="block text-[10px] fg-faint truncate">
                          {t.hint}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
