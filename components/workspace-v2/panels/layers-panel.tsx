"use client";

// Layers panel — Figma/Webflow-style tree of every node in the Document.
// Lives in the LeftSidebar's "layers" tab, visible only in Canva-mode.
// Click a row to select. Shift/cmd-click toggles into multi-selection. The
// ✕ on hover removes the subtree.
//
// Search: an input at the top filters by labelForNode; when filled, the
// tree collapses to a FLAT filtered list (Figma pattern — easier to scan).
//
// Drag-to-reorder: drag any row, drop on/between rows. The row's vertical
// thirds split into intents: top = insert before (sibling above), bottom =
// insert after (sibling below), middle = nest INTO (only for Box/Page).
// Cross-parent allowed. Dispatches editMove with after-detach toIndex
// semantics.

import type { MouseEvent, DragEvent } from "react";
import { useMemo, useState } from "react";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import type { Document as DocModel, Node, NodeId } from "@/lib/doc/model";
import type { Op } from "@/lib/doc/ops";
import {
  editMove,
  editRemove,
  editSetProps,
  editSetStyle,
} from "@/lib/doc/edits";
import { labelForNode } from "../model/canva-inspector";
import { ChevronRight } from "../icons";

export interface LayersPanelProps {
  doc: DocModel;
  selectedIds: NodeId[];
  onSelect: (ids: NodeId[]) => void;
  onEdit: (ops: Op[]) => void;
}

type DropIntent = "before" | "after" | "inside";
interface DropState {
  id: NodeId;
  intent: DropIntent;
}

function isHiddenNode(n: Node): boolean {
  return n.style.base.display === "none";
}
function isLockedNode(n: Node): boolean {
  return (n.props as { __locked?: boolean }).__locked === true;
}

function isDescendant(
  doc: DocModel,
  ancestorId: NodeId,
  candidateId: NodeId,
): boolean {
  let cur = doc.nodes[candidateId];
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = doc.nodes[cur.parentId];
  }
  return false;
}

function canContain(node: Node | undefined): boolean {
  return !!node && (node.type === "Box" || node.type === "Page");
}

export function LayersPanel({
  doc,
  selectedIds,
  onSelect,
  onEdit,
}: LayersPanelProps) {
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<NodeId | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);

  const q = query.trim().toLowerCase();
  const flatMatches = useMemo(() => {
    if (!q) return null;
    return Object.values(doc.nodes).filter((n) =>
      labelForNode(n).toLowerCase().includes(q),
    );
  }, [doc.nodes, q]);

  const root = doc.nodes[doc.root];
  if (!root) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <p className="text-[11.5px] fg-faint leading-relaxed">
          Documento vacío.
        </p>
      </div>
    );
  }

  // ── Drag handlers, shared by tree + flat row variants ──────────────────

  const handleDragStart =
    (id: NodeId) => (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragId(id);
    };

  const handleDragOver =
    (id: NodeId) => (e: DragEvent<HTMLDivElement>) => {
      if (!dragId || dragId === id) return;
      // Block dropping a node into its own subtree.
      if (isDescendant(doc, dragId, id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;
      let intent: DropIntent;
      if (y < third) intent = "before";
      else if (y > rect.height - third) intent = "after";
      else intent = canContain(doc.nodes[id]) ? "inside" : "after";
      setDropState({ id, intent });
    };

  const handleDragLeave =
    (id: NodeId) => () => {
      setDropState((prev) => (prev?.id === id ? null : prev));
    };

  const handleDrop =
    (id: NodeId) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const src = e.dataTransfer.getData("text/plain") || dragId;
      const intent = dropState?.intent ?? "after";
      setDragId(null);
      setDropState(null);
      if (!src || src === id) return;
      if (isDescendant(doc, src, id)) return;

      const target = doc.nodes[id];
      if (!target) return;

      let parentId: NodeId;
      let index: number;
      if (intent === "inside") {
        if (!canContain(target)) return;
        parentId = target.id;
        index = target.childIds.length;
      } else {
        if (!target.parentId) return;
        const parent = doc.nodes[target.parentId];
        if (!parent) return;
        const tIdx = parent.childIds.indexOf(target.id);
        if (tIdx < 0) return;
        parentId = parent.id;
        index = intent === "after" ? tIdx + 1 : tIdx;
      }

      // editMove's toIndex is the index AFTER detach: same-parent + source
      // before target means the slot shifts left by 1.
      const sourceNode = doc.nodes[src];
      if (sourceNode?.parentId === parentId) {
        const parent = doc.nodes[parentId];
        const fromIdx = parent?.childIds.indexOf(src) ?? -1;
        if (fromIdx >= 0 && fromIdx < index) index -= 1;
        if (fromIdx === index) return;
      }

      const op = editMove(doc, src, parentId, index);
      if (op) onEdit([op]);
    };

  const handleDragEnd = () => {
    setDragId(null);
    setDropState(null);
  };

  const rowProps = (id: NodeId) => ({
    draggable: true,
    onDragStart: handleDragStart(id),
    onDragOver: handleDragOver(id),
    onDragLeave: handleDragLeave(id),
    onDrop: handleDrop(id),
    onDragEnd: handleDragEnd,
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
            Capas
          </div>
          <div className="text-[10px] fg-faint tabular ui-small">
            {Object.keys(doc.nodes).length} nodos
          </div>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar capas…"
          className="w-full h-7 rounded-md bg-elev border bd text-[11.5px] fg px-2 outline-none focus:border-[color:var(--accent)] placeholder:fg-faint"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-1 pb-2">
        {flatMatches ? (
          <FlatResults
            doc={doc}
            matches={flatMatches}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onEdit={onEdit}
            dragId={dragId}
            dropState={dropState}
            rowProps={rowProps}
          />
        ) : (
          <LayerRow
            node={root}
            doc={doc}
            depth={0}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onEdit={onEdit}
            dragId={dragId}
            dropState={dropState}
            rowProps={rowProps}
          />
        )}
      </div>
    </div>
  );
}

// ─── ROW (tree variant) ────────────────────────────────────────────────────

interface RowSharedProps {
  selectedIds: NodeId[];
  onSelect: (ids: NodeId[]) => void;
  onEdit: (ops: Op[]) => void;
  dragId: NodeId | null;
  dropState: DropState | null;
  rowProps: (id: NodeId) => Record<string, unknown>;
}

function LayerRow({
  node,
  doc,
  depth,
  ...shared
}: {
  node: Node;
  doc: DocModel;
  depth: number;
} & RowSharedProps) {
  const { selectedIds, onSelect, onEdit, dragId, dropState, rowProps } = shared;
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const isSelected = selectedIds.includes(node.id);
  const hasChildren = node.childIds.length > 0;
  const isRoot = node.id === doc.root;
  const isDragging = dragId === node.id;
  const drop = dropState?.id === node.id ? dropState.intent : null;
  const isHidden = isHiddenNode(node);
  const isLocked = isLockedNode(node);

  const handleClick = (e: MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = isSelected
        ? selectedIds.filter((x) => x !== node.id)
        : [...selectedIds, node.id];
      onSelect(next);
    } else {
      onSelect([node.id]);
    }
  };

  const toggleHidden = () => {
    const base = { ...node.style.base };
    if (isHidden) delete base.display;
    else base.display = "none";
    const op = editSetStyle(doc, node.id, null, base);
    if (op) onEdit([op]);
  };
  const toggleLocked = () => {
    const props = { ...node.props } as { __locked?: boolean } & typeof node.props;
    if (isLocked) delete props.__locked;
    else props.__locked = true;
    const op = editSetProps(doc, node.id, props);
    if (op) onEdit([op]);
  };

  return (
    <>
      <Row
        node={node}
        depth={depth}
        isSelected={isSelected}
        isRoot={isRoot}
        isDragging={isDragging}
        isHidden={isHidden}
        isLocked={isLocked}
        drop={drop}
        hasChildren={hasChildren}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onToggleHidden={toggleHidden}
        onToggleLocked={toggleLocked}
        onRowClick={handleClick}
        onRemove={() => {
          const op = editRemove(doc, node.id);
          if (op) {
            onEdit([op]);
            if (isSelected) onSelect(selectedIds.filter((x) => x !== node.id));
          }
        }}
        rowProps={rowProps(node.id)}
      />
      {hasChildren && !collapsed && (
        <div role="group">
          {node.childIds.map((cid) => {
            const child = doc.nodes[cid];
            if (!child) return null;
            return (
              <LayerRow
                key={cid}
                node={child}
                doc={doc}
                depth={depth + 1}
                {...shared}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── ROW (flat search results) ────────────────────────────────────────────

function FlatResults({
  doc,
  matches,
  ...shared
}: {
  doc: DocModel;
  matches: Node[];
} & RowSharedProps) {
  const { selectedIds, onSelect, onEdit, dragId, dropState, rowProps } = shared;
  if (matches.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] fg-faint">
        Nada coincide.
      </div>
    );
  }
  return (
    <>
      {matches.map((node) => {
        const isSelected = selectedIds.includes(node.id);
        const isHidden = isHiddenNode(node);
        const isLocked = isLockedNode(node);
        return (
          <Row
            key={node.id}
            node={node}
            depth={0}
            isSelected={isSelected}
            isRoot={node.id === doc.root}
            isDragging={dragId === node.id}
            isHidden={isHidden}
            isLocked={isLocked}
            drop={dropState?.id === node.id ? dropState.intent : null}
            hasChildren={false}
            collapsed={false}
            onToggleHidden={() => {
              const base = { ...node.style.base };
              if (isHidden) delete base.display;
              else base.display = "none";
              const op = editSetStyle(doc, node.id, null, base);
              if (op) onEdit([op]);
            }}
            onToggleLocked={() => {
              const props = { ...node.props } as { __locked?: boolean } &
                typeof node.props;
              if (isLocked) delete props.__locked;
              else props.__locked = true;
              const op = editSetProps(doc, node.id, props);
              if (op) onEdit([op]);
            }}
            onRowClick={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                const next = isSelected
                  ? selectedIds.filter((x) => x !== node.id)
                  : [...selectedIds, node.id];
                onSelect(next);
              } else {
                onSelect([node.id]);
              }
            }}
            onRemove={() => {
              const op = editRemove(doc, node.id);
              if (op) {
                onEdit([op]);
                if (isSelected)
                  onSelect(selectedIds.filter((x) => x !== node.id));
              }
            }}
            rowProps={rowProps(node.id)}
          />
        );
      })}
    </>
  );
}

// ─── SHARED ROW CHROME ────────────────────────────────────────────────────

function Row({
  node,
  depth,
  isSelected,
  isRoot,
  isDragging,
  isHidden,
  isLocked,
  drop,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onToggleHidden,
  onToggleLocked,
  onRowClick,
  onRemove,
  rowProps,
}: {
  node: Node;
  depth: number;
  isSelected: boolean;
  isRoot: boolean;
  isDragging: boolean;
  isHidden: boolean;
  isLocked: boolean;
  drop: DropIntent | null;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onRowClick: (e: MouseEvent) => void;
  onRemove: () => void;
  rowProps: Record<string, unknown>;
}) {
  const label = labelForNode(node);
  const ringClass = isSelected
    ? "bg-[color:var(--accent)]/15 fg ring-1 ring-[color:var(--accent)]/40"
    : "fg-muted hover:fg hover:bg-hover";
  const dropClass =
    drop === "before"
      ? "border-t-2 border-t-[color:var(--accent)]"
      : drop === "after"
        ? "border-b-2 border-b-[color:var(--accent)]"
        : drop === "inside"
          ? "bg-[color:var(--accent)]/20"
          : "";
  const dimClass = isHidden ? "opacity-50 italic" : "";
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? !collapsed : undefined}
      onClick={onRowClick}
      className={`group flex items-center gap-1 h-6 pr-1 rounded text-[11px] transition cursor-pointer ${ringClass} ${dropClass} ${dimClass} ${isDragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: depth * 12 + 4 }}
      {...rowProps}
    >
      {hasChildren && onToggleCollapse ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          aria-label={collapsed ? "Expandir" : "Colapsar"}
          className="h-4 w-4 inline-flex items-center justify-center fg-faint hover:fg transition"
        >
          <span
            className={`inline-block transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            <ChevronRight size={10} />
          </span>
        </button>
      ) : (
        <span className="w-4" />
      )}
      <span className="text-[8.5px] uppercase fg-faint font-mono">
        {node.type}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {!isRoot && (
        <>
          <button
            type="button"
            aria-label={isHidden ? "Mostrar" : "Ocultar"}
            title={isHidden ? "Mostrar" : "Ocultar"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleHidden();
            }}
            className={`h-4 w-4 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition ${isHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          >
            {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
          <button
            type="button"
            aria-label={isLocked ? "Desbloquear" : "Bloquear"}
            title={isLocked ? "Desbloquear" : "Bloquear"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLocked();
            }}
            className={`h-4 w-4 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition ${isLocked ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          >
            {isLocked ? <Lock size={10} /> : <LockOpen size={10} />}
          </button>
          <button
            type="button"
            aria-label="Borrar"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="h-4 w-4 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

