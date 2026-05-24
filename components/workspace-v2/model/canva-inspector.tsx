"use client";

// CanvaInspector — the right-sidebar Canva-mode editor surface (the spec
// from [[openlen-editor-motor-spec]]). Renders by selection count:
//
//   - selectedIds.length === 0  → Page panel (theme tokens + sections)
//   - length === 1, Section/Box → BoxPanel
//   - length === 1, leaf type   → per-type panel (Text/Image/Link/Button/Icon)
//   - length >= 2               → MultiSelectionPanel (group / bulk delete)
//
// Edits dispatch typed ops through the CanvaShell's `dispatch` controller.
// All controls are deterministic (no AI per-edit) — intent chips + AI inline
// composer arrive in Phase B.11 / B.12.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Box as BoxIcon,
  Copy,
  Heading1,
  Image as ImageIcon,
  Link2,
  Link2Off,
  Minus,
  Pipette,
  RectangleHorizontal,
  Sparkles,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type {
  Condition,
  Document as DocModel,
  ElementState,
  Json,
  Node,
  NodeId,
  Props,
  StyleProps,
} from "@/lib/doc/model";
import type { Op } from "@/lib/doc/ops";
import {
  editDuplicate,
  editGroup,
  editInsert,
  editMove,
  editRemove,
  editSetProps,
  editSetStyle,
  editSetToken,
  editUngroup,
} from "@/lib/doc/edits";
import { buildSubtree } from "@/lib/doc/build";
import type { NodeSpec } from "@/lib/doc/build";
import { SECTION_TEMPLATES } from "@/lib/section-templates";
import { ANIMATIONS } from "@/lib/doc/animations";
import { CURATED_ICONS } from "@/lib/lucide-curated";
import type { Palette } from "@/lib/palettes";
import { FONT_PRESETS, type FontPreset } from "@/lib/font-pairs";
import {
  generatePalettes,
  PALETTE_INTENTS,
  type PaletteIntent,
} from "@/lib/palette-gen";
import { Globe, GripDots, PaletteIcon, X } from "../icons";
import {
  ReplaceAssetModal,
  type ReplacePayload,
} from "../replace-asset-modal";

export interface CanvaInspectorProps {
  doc: DocModel;
  selectedIds: NodeId[];
  onEdit: (ops: Op[]) => void;
  onSelect: (ids: NodeId[]) => void;
  /** Project id, threaded to ReplaceAssetModal's Upload tab. Omit for the
   *  verify harness — the Upload tab then renders disabled. */
  projectId?: string | null;
  /** Current edit context. `null` = base (no @media, no state). A breakpoint
   *  condition writes to that media layer; a state condition writes to that
   *  pseudo-class layer. TopBar's chip strip drives the breakpoint case; the
   *  ElementPanel's state row drives the state case. */
  editCondition?: Condition | null;
  /** Pick a new edit context (or null to reset to base). Routed from the
   *  inspector's state picker. */
  onEditCondition?: (c: Condition | null) => void;
}

export function CanvaInspector({
  doc,
  selectedIds,
  onEdit,
  onSelect,
  projectId,
  editCondition = null,
  onEditCondition,
}: CanvaInspectorProps) {
  // Sub-panels were written before multi-select existed; they pass a single
  // id (or null to clear). Wrap so they keep their current API.
  const onSelectSingle = (id: NodeId | null) => onSelect(id ? [id] : []);

  const singleId = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = singleId ? doc.nodes[singleId] ?? null : null;
  const isMulti = selectedIds.length >= 2;
  const headerLabel = isMulti
    ? `Inspector · ${selectedIds.length} seleccionados`
    : "Inspector · Canva";

  return (
    <DocContext.Provider value={doc}>
    <OnEditContext.Provider value={onEdit}>
    <EditConditionContext.Provider value={editCondition}>
      <aside className="h-full w-[300px] shrink-0 bg-side border-l bd flex flex-col fade-slide">
        <div className="flex items-center justify-between px-3 h-10 border-b bd shrink-0 gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small truncate">
            {headerLabel}
          </span>
          <div className="flex items-center gap-1">
            {editCondition && (
              <button
                type="button"
                onClick={() => onEditCondition?.(null)}
                title="Volver al estilo base"
                className="inline-flex items-center gap-1 h-5 px-1.5 rounded bg-[color:var(--accent)]/15 text-[10px] font-mono font-semibold text-[color:var(--accent)] hover:bg-[color:var(--accent)]/25 transition"
              >
                {conditionLabel(editCondition)}
                <X size={9} />
              </button>
            )}
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => onSelect([])}
                aria-label="Limpiar selección"
                className="h-6 w-6 inline-flex items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
          {isMulti ? (
            <MultiSelectionPanel
              doc={doc}
              ids={selectedIds}
              onEdit={onEdit}
              onSelect={onSelect}
            />
          ) : node ? (
            <ElementPanel
              doc={doc}
              node={node}
              onEdit={onEdit}
              onSelect={onSelectSingle}
              projectId={projectId ?? null}
              onEditCondition={onEditCondition}
            />
          ) : (
            <PagePanel doc={doc} onEdit={onEdit} onSelect={onSelectSingle} />
          )}
        </div>
      </aside>
    </EditConditionContext.Provider>
    </OnEditContext.Provider>
    </DocContext.Provider>
  );
}

// ─── MULTI-SELECTION PANEL ────────────────────────────────────────────────

function MultiSelectionPanel({
  doc,
  ids,
  onEdit,
  onSelect,
}: {
  doc: DocModel;
  ids: NodeId[];
  onEdit: (ops: Op[]) => void;
  onSelect: (ids: NodeId[]) => void;
}) {
  // Group only works on contiguous siblings under the same parent. Compute
  // both — disabled with a hint when either fails.
  const nodes = ids.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
  const parentIds = new Set(nodes.map((n) => n.parentId));
  const sameParent = parentIds.size === 1 && !parentIds.has(null);
  const canGroup = nodes.length >= 2 && sameParent;

  const doGroup = () => {
    const ops = editGroup(doc, ids);
    if (!ops || ops.length === 0) return;
    onEdit(ops);
    // The new Box's id lives in the insert_node op (first op).
    const first = ops[0];
    if (first.t === "insert_node") onSelect([first.rootId]);
  };

  return (
    <div className="fade-in">
      <Section label={`Selección (${ids.length})`}>
        <ul className="space-y-1">
          {nodes.map((n) => (
            <li
              key={n.id}
              className="flex items-center gap-1 h-7 px-2 rounded-md bg-elev border bd text-[11px]"
            >
              <span className="text-[8.5px] uppercase fg-faint font-mono">
                {n.type}
              </span>
              <span className="flex-1 truncate fg-muted">{labelForNode(n)}</span>
              <button
                type="button"
                aria-label="Quitar de la selección"
                onClick={() => onSelect(ids.filter((x) => x !== n.id))}
                className="h-5 w-5 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:fg hover:bg-hover transition"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section label="Acciones">
        <button
          type="button"
          onClick={() => {
            const r = editDuplicate(doc, ids);
            if (!r) return;
            onEdit(r.ops);
            onSelect(r.newIds);
          }}
          className="w-full h-8 rounded-md border bd bg-elev fg hover:bg-hover transition text-[11.5px] font-medium inline-flex items-center justify-center gap-1.5"
        >
          <Copy size={11} /> Duplicar ({ids.length})
        </button>
        <button
          type="button"
          disabled={!canGroup}
          onClick={doGroup}
          className="w-full h-8 rounded-md border bd bg-elev fg hover:bg-hover transition text-[11.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Agrupar en una caja
        </button>
        {!sameParent && (
          <p className="text-[10.5px] fg-faint leading-relaxed">
            Sólo se pueden agrupar elementos del mismo padre.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            const ops = ids
              .map((id) => editRemove(doc, id))
              .filter(Boolean) as Op[];
            if (ops.length) {
              onEdit(ops);
              onSelect([]);
            }
          }}
          className="w-full h-8 rounded-md border bd bg-elev text-red-500 hover:bg-red-500/10 transition text-[11.5px] font-medium"
        >
          Borrar todos ({ids.length})
        </button>
      </Section>
    </div>
  );
}

// ─── PAGE STATE (no selection) — theme tokens + SEO ────────────────────────

// Token-name matchers per role. The doc may name its tokens with the OL
// prefix (--ol-bg) OR plain (--bg, --background, …) depending on whether it
// came from the AI generator or a hand-authored fixture. We accept both.
const TOKEN_CANDIDATES: Record<string, string[]> = {
  bg: ["--ol-bg", "--bg", "--background", "--page", "--canvas"],
  surface: ["--ol-surface", "--surface", "--card", "--panel"],
  fg: ["--ol-fg", "--fg", "--text", "--foreground", "--ink"],
  border: ["--ol-border", "--border", "--line", "--hairline"],
  accent: ["--ol-accent", "--accent"],
  fontDisplay: [
    "--ol-font-display",
    "--font-display",
    "--font-heading",
    "--font",
  ],
  radius: ["--ol-r-scale", "--ol-radius-scale", "--radius-scale", "--radius"],
  density: ["--ol-space-scale", "--space-scale", "--density"],
};

function findTokenId(doc: DocModel, role: keyof typeof TOKEN_CANDIDATES): string | null {
  for (const id of TOKEN_CANDIDATES[role]) {
    if (doc.tokens.defs[id]) return id;
  }
  return null;
}

function PagePanel({
  doc,
  onEdit,
  onSelect,
}: {
  doc: DocModel;
  onEdit: (ops: Op[]) => void;
  onSelect: (id: NodeId | null) => void;
}) {
  const lightMode = doc.tokens.modes[0] ?? "light";
  const rootNode = doc.nodes[doc.root];

  // Resolve which tokens this doc actually has — show controls only for those.
  const tokenIds = {
    bg: findTokenId(doc, "bg"),
    surface: findTokenId(doc, "surface"),
    fg: findTokenId(doc, "fg"),
    border: findTokenId(doc, "border"),
    accent: findTokenId(doc, "accent"),
    fontDisplay: findTokenId(doc, "fontDisplay"),
    radius: findTokenId(doc, "radius"),
    density: findTokenId(doc, "density"),
  };

  const hasPalette =
    !!(tokenIds.bg || tokenIds.surface || tokenIds.fg || tokenIds.border || tokenIds.accent);
  const hasFont = !!tokenIds.fontDisplay;
  const hasRadius = !!tokenIds.radius;
  const hasDensity = !!tokenIds.density;

  // Currently-active values, for marking the selected option in pickers.
  const currentAccent = tokenIds.accent
    ? String(doc.tokens.defs[tokenIds.accent]?.values[lightMode] ?? "")
    : null;
  const currentFontCss = tokenIds.fontDisplay
    ? String(doc.tokens.defs[tokenIds.fontDisplay]?.values[lightMode] ?? "")
    : "";
  const currentRadius = tokenIds.radius
    ? Number(doc.tokens.defs[tokenIds.radius]?.values[lightMode] ?? 1)
    : null;
  const currentDensity = tokenIds.density
    ? Number(doc.tokens.defs[tokenIds.density]?.values[lightMode] ?? 1)
    : null;

  const applyPalette = (p: Palette) => {
    const ops: Op[] = [];
    const map: Array<[keyof typeof tokenIds, string]> = [
      ["bg", "--ol-bg"],
      ["surface", "--ol-surface"],
      ["fg", "--ol-fg"],
      ["border", "--ol-border"],
      ["accent", "--ol-accent"],
    ];
    for (const [role, paletteKey] of map) {
      const tid = tokenIds[role];
      if (!tid) continue;
      const value = p.tokens[paletteKey];
      if (!value) continue;
      const op = editSetToken(doc, tid, lightMode, value);
      if (op) ops.push(op);
    }
    onEdit(ops);
  };

  const applyFont = (f: FontPreset) => {
    if (!tokenIds.fontDisplay) return;
    const op = editSetToken(doc, tokenIds.fontDisplay, lightMode, f.displayCss);
    if (op) onEdit([op]);
  };

  const applyRadius = (scale: number) => {
    if (!tokenIds.radius) return;
    const op = editSetToken(doc, tokenIds.radius, lightMode, String(scale));
    if (op) onEdit([op]);
  };

  const applyDensity = (scale: number) => {
    if (!tokenIds.density) return;
    const op = editSetToken(doc, tokenIds.density, lightMode, String(scale));
    if (op) onEdit([op]);
  };

  return (
    <div className="fade-in">
      <Section label="Página" icon={<Globe size={11} />}>
        <p className="text-[12px] fg leading-relaxed">
          {doc.meta.title || "Untitled page"}
        </p>
        <p className="text-[10.5px] fg-faint leading-relaxed">
          Hacé click en cualquier elemento del canvas para editarlo.
        </p>
      </Section>

      <Section
        label={`Secciones${rootNode ? ` (${rootNode.childIds.length})` : ""}`}
      >
        {rootNode && rootNode.childIds.length > 0 && (
          <ChildrenList
            doc={doc}
            parent={rootNode}
            onSelect={onSelect}
            onEdit={onEdit}
          />
        )}
        <AddSectionPicker doc={doc} onEdit={onEdit} />
      </Section>

      {(hasPalette || hasFont || hasRadius || hasDensity) && (
        <Section label="Tema" icon={<PaletteIcon size={11} />}>
          {hasPalette && (
            <FieldGroup label="Paleta">
              <PalettePicker current={currentAccent} onApply={applyPalette} />
            </FieldGroup>
          )}
          {hasFont && (
            <FieldGroup label="Tipografía">
              <FontPicker current={currentFontCss} onApply={applyFont} />
            </FieldGroup>
          )}
          {hasRadius && currentRadius !== null && (
            <FieldGroup label="Esquinas">
              <ScalePicker
                value={currentRadius}
                onChange={applyRadius}
                options={[
                  { label: "Recto", value: 0 },
                  { label: "Suave", value: 1 },
                  { label: "Redondo", value: 1.5 },
                  { label: "Píldora", value: 2 },
                ]}
              />
            </FieldGroup>
          )}
          {hasDensity && currentDensity !== null && (
            <FieldGroup label="Densidad">
              <ScalePicker
                value={currentDensity}
                onChange={applyDensity}
                options={[
                  { label: "Compacto", value: 0.85 },
                  { label: "Cómodo", value: 1 },
                  { label: "Aireado", value: 1.2 },
                ]}
              />
            </FieldGroup>
          )}
        </Section>
      )}
    </div>
  );
}

// ─── ADD ELEMENT PICKER (inside a Section/Box) ─────────────────────────────

export interface ElementTemplate {
  id: string;
  name: string;
  Icon: LucideIcon;
  spec: NodeSpec;
}

export const ELEMENT_TEMPLATES: ElementTemplate[] = [
  {
    id: "text",
    name: "Texto",
    Icon: Type,
    spec: {
      type: "Text",
      tag: "p",
      props: { runs: [{ text: "Texto nuevo" }] },
      style: {
        base: { "font-size": "15px", "line-height": "1.6", margin: "0" },
      },
      children: [],
    },
  },
  {
    id: "heading",
    name: "Título",
    Icon: Heading1,
    spec: {
      type: "Text",
      tag: "h2",
      props: { runs: [{ text: "Título nuevo" }] },
      style: {
        base: {
          "font-size": "28px",
          "font-weight": "700",
          "line-height": "1.2",
          margin: "0 0 12px",
          "font-family": "var(--font-display)",
        },
      },
      children: [],
    },
  },
  {
    id: "image",
    name: "Imagen",
    Icon: ImageIcon,
    spec: {
      type: "Image",
      tag: "img",
      props: {
        src: "https://placehold.co/600x400/eee/333?text=Imagen",
        alt: "Imagen",
      },
      style: {
        base: { "max-width": "100%", "border-radius": "8px", display: "block" },
      },
      children: [],
    },
  },
  {
    id: "button",
    name: "Botón",
    Icon: RectangleHorizontal,
    spec: {
      type: "Button",
      tag: "a",
      props: { href: "#" },
      style: {
        base: {
          display: "inline-flex",
          "background-color": "var(--accent)",
          color: "#ffffff",
          padding: "10px 18px",
          "border-radius": "8px",
          "font-weight": "600",
          "text-decoration": "none",
        },
      },
      children: [
        {
          type: "Text",
          tag: "span",
          props: { runs: [{ text: "Botón" }] },
          style: { base: {} },
          children: [],
        },
      ],
    },
  },
  {
    id: "link",
    name: "Enlace",
    Icon: Link2,
    spec: {
      type: "Link",
      tag: "a",
      props: { href: "#" },
      style: {
        base: {
          color: "var(--accent)",
          "text-decoration": "underline",
          "font-weight": "500",
        },
      },
      children: [
        {
          type: "Text",
          tag: "span",
          props: { runs: [{ text: "Enlace" }] },
          style: { base: {} },
          children: [],
        },
      ],
    },
  },
  {
    id: "icon",
    name: "Ícono",
    Icon: Sparkles,
    spec: {
      type: "Icon",
      tag: "span",
      props: { name: "star" },
      style: {
        base: {
          display: "inline-block",
          "font-size": "24px",
          color: "var(--accent)",
        },
      },
      children: [],
    },
  },
  {
    id: "divider",
    name: "Divisor",
    Icon: Minus,
    spec: {
      type: "Box",
      tag: "div",
      props: {},
      style: {
        base: {
          height: "1px",
          "background-color": "var(--border)",
          margin: "16px 0",
        },
      },
      children: [],
    },
  },
  {
    id: "box",
    name: "Caja",
    Icon: BoxIcon,
    spec: {
      type: "Box",
      tag: "div",
      props: {},
      style: {
        base: {
          padding: "16px",
          "background-color": "var(--surface)",
          "border-radius": "8px",
          border: "1px solid var(--border)",
        },
      },
      children: [],
    },
  },
];

function AddElementPicker({
  doc,
  parentId,
  onEdit,
}: {
  doc: DocModel;
  parentId: NodeId;
  onEdit: (ops: Op[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const parent = doc.nodes[parentId];
  if (!parent) return null;

  const addElement = (tplId: string) => {
    const tpl = ELEMENT_TEMPLATES.find((e) => e.id === tplId);
    if (!tpl) return;
    const built = buildSubtree(tpl.spec);
    if ("err" in built) return;
    const op = editInsert(
      doc,
      parentId,
      parent.childIds.length,
      built.ok.rootId,
      built.ok.nodes,
    );
    if (op) onEdit([op]);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-8 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition text-[11.5px] font-medium"
      >
        + Agregar elemento
      </button>
    );
  }
  return (
    <div className="space-y-1.5 fade-in">
      <div className="grid grid-cols-4 gap-1">
        {ELEMENT_TEMPLATES.map((t) => {
          const Icon = t.Icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => addElement(t.id)}
              title={t.name}
              className="flex flex-col items-center justify-center gap-0.5 h-12 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover hover:border-[color:var(--accent)]/50 transition"
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden />
              <span className="text-[9px] truncate max-w-full px-0.5">
                {t.name}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full h-6 rounded-md text-[10.5px] fg-faint hover:fg transition"
      >
        Cerrar
      </button>
    </div>
  );
}

// ─── ADD SECTION PICKER ───────────────────────────────────────────────────

function AddSectionPicker({
  doc,
  onEdit,
}: {
  doc: DocModel;
  onEdit: (ops: Op[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootNode = doc.nodes[doc.root];
  const rootChildren = rootNode?.childIds ?? [];

  const addTemplate = (tplId: string) => {
    const tpl = SECTION_TEMPLATES.find((s) => s.id === tplId);
    if (!tpl) return;
    const built = buildSubtree(tpl.spec);
    if ("err" in built) return;
    const op = editInsert(
      doc,
      doc.root,
      rootChildren.length,
      built.ok.rootId,
      built.ok.nodes,
    );
    if (op) onEdit([op]);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-8 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition text-[11.5px] font-medium"
      >
        + Agregar sección
      </button>
    );
  }
  return (
    <div className="space-y-1.5 fade-in">
      <div className="grid grid-cols-2 gap-1">
        {SECTION_TEMPLATES.map((t) => {
          const Icon = t.Icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => addTemplate(t.id)}
              title={t.hint}
              className="flex items-center gap-1.5 h-8 px-2 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover hover:border-[color:var(--accent)]/50 transition text-[10.5px] text-left"
            >
              <Icon size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="truncate">{t.name}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full h-6 rounded-md text-[10.5px] fg-faint hover:fg transition"
      >
        Cerrar
      </button>
    </div>
  );
}

// ─── ELEMENT STATE (something selected) ────────────────────────────────────

function ElementPanel({
  doc,
  node,
  onEdit,
  onSelect,
  projectId,
  onEditCondition,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
  onSelect: (id: NodeId | null) => void;
  projectId: string | null;
  onEditCondition?: (c: Condition | null) => void;
}) {
  const crumbs = buildBreadcrumb(doc, node.id);
  const isRoot = node.id === doc.root;
  const editCondition = useContext(EditConditionContext);
  const duplicate = () => {
    const r = editDuplicate(doc, [node.id]);
    if (!r) return;
    onEdit(r.ops);
    onSelect(r.newIds[0] ?? null);
  };
  const remove = () => {
    const op = editRemove(doc, node.id);
    if (!op) return;
    onEdit([op]);
    onSelect(null);
  };
  return (
    <div className="fade-in">
      <Breadcrumb crumbs={crumbs} onSelect={onSelect} />
      <div className="px-3 py-2.5 border-b bd flex items-center gap-1.5">
        <span
          data-testid="canva-insp-type"
          className="inline-flex items-center h-4 px-1.5 rounded bg-elev border bd text-[9.5px] font-mono fg-muted uppercase"
        >
          {node.type}
        </span>
        {node.tag && (
          <span className="text-[11.5px] fg-muted truncate font-mono">
            {node.tag}
          </span>
        )}
        {!isRoot && (
          <>
            <button
              type="button"
              onClick={duplicate}
              title="Duplicar (⌘D)"
              aria-label="Duplicar"
              className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
            >
              <Copy size={11} />
            </button>
            <button
              type="button"
              onClick={remove}
              title="Borrar (Supr)"
              aria-label="Borrar"
              className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-red-500/10 transition"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
      {!isRoot && onEditCondition && (
        <StatePickerRow
          node={node}
          condition={editCondition}
          onChange={onEditCondition}
        />
      )}
      {node.type === "Text" && (
        <TextPanel doc={doc} node={node} onEdit={onEdit} />
      )}
      {node.type === "Image" && (
        <ImagePanel
          doc={doc}
          node={node}
          onEdit={onEdit}
          projectId={projectId}
        />
      )}
      {node.type === "Link" && (
        <LinkPanel doc={doc} node={node} onEdit={onEdit} />
      )}
      {node.type === "Button" && (
        <ButtonPanel doc={doc} node={node} onEdit={onEdit} />
      )}
      {node.type === "Icon" && (
        <IconPanel doc={doc} node={node} onEdit={onEdit} />
      )}
      {(node.type === "Box" || node.type === "Page") && (
        <BoxPanel doc={doc} node={node} onEdit={onEdit} onSelect={onSelect} />
      )}
      {(node.type === "Form" ||
        node.type === "Field" ||
        node.type === "Embed" ||
        node.type === "Slot" ||
        node.type === "Instance") && (
        <Section label="Próximamente">
          <p className="text-[11px] fg-muted leading-relaxed">
            Panel para {node.type} llega en una fase posterior.
          </p>
        </Section>
      )}
      {!isRoot && <AnimationSection node={node} />}
    </div>
  );
}

// ─── TEXT PANEL ────────────────────────────────────────────────────────────

function textContentOf(node: Node): string {
  const runs = node.props.runs;
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => {
      const run = r as { text?: unknown };
      return typeof run.text === "string" ? run.text : "";
    })
    .join("");
}

// Condition context — sub-panels read `editCondition` to decide which style
// layer their reads/writes target. `null` = `style.base` (no @media, no
// state). A `{kind:"breakpoint",bp}` or `{kind:"state",state}` condition
// = the matching layer with cascade reads (layer overrides base — mirrors
// what the CSS compile emits).
const EditConditionContext = createContext<Condition | null>(null);

function sameCondition(a: Condition, b: Condition): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "breakpoint" && b.kind === "breakpoint") return a.bp === b.bp;
  if (a.kind === "state" && b.kind === "state") return a.state === b.state;
  if (a.kind === "mode" && b.kind === "mode") return a.mode === b.mode;
  // 'and' (compound) conditions — supported by the model but no UI in v1.
  return false;
}

function findLayer(node: Node, cond: Condition) {
  return node.style.layers.find((l) => sameCondition(l.condition, cond));
}

// Cascade reader. `null` condition reads `style.base` directly. Otherwise
// the matching layer wins for keys it sets; everything else falls through
// to base.
function makeStyleReader(node: Node, condition: Condition | null) {
  const layer = condition ? findLayer(node, condition) : null;
  return (key: string): string => {
    if (layer && layer.props[key] !== undefined) return String(layer.props[key]);
    return String(node.style.base[key] ?? "");
  };
}

// Shared style-patch helper. `null` condition writes to `style.base`.
// Otherwise writes to the matching layer (creating it on first write).
// Removes keys whose value is empty (UX: empty input = clear).
function makeStyleSetter(
  doc: DocModel,
  node: Node,
  onEdit: (ops: Op[]) => void,
  condition: Condition | null,
) {
  return (patch: Record<string, string>) => {
    if (condition === null) {
      const next: StyleProps = { ...node.style.base, ...patch };
      for (const k of Object.keys(patch)) {
        if (patch[k] === "") delete next[k];
      }
      const op = editSetStyle(doc, node.id, null, next);
      if (op) onEdit([op]);
      return;
    }
    const layer = findLayer(node, condition);
    const next: StyleProps = { ...(layer?.props ?? {}), ...patch };
    for (const k of Object.keys(patch)) {
      if (patch[k] === "") delete next[k];
    }
    const op = editSetStyle(doc, node.id, condition, next);
    if (op) onEdit([op]);
  };
}

// Pretty label for the header chip + tooltips.
function conditionLabel(c: Condition): string {
  if (c.kind === "breakpoint") return `@ ${c.bp}`;
  if (c.kind === "state") return `:${c.state}`;
  if (c.kind === "mode") return `mode ${c.mode}`;
  return "(compound)";
}

// Inline chip row above the per-type panels. Picks which pseudo-state of the
// element the inspector writes to. "default" = no state override (clears
// condition). Each chip shows a small dot when that state already has a
// layer on the node — borrowed from Webflow's States picker.
const STATE_OPTIONS: Array<{ id: "default" | ElementState; label: string }> = [
  { id: "default", label: "default" },
  { id: "hover", label: ":hover" },
  { id: "focus", label: ":focus" },
  { id: "active", label: ":active" },
];

function StatePickerRow({
  node,
  condition,
  onChange,
}: {
  node: Node;
  condition: Condition | null;
  onChange: (c: Condition | null) => void;
}) {
  const stateLayers = new Set(
    node.style.layers
      .filter((l) => l.condition.kind === "state")
      .map((l) =>
        l.condition.kind === "state" ? l.condition.state : "",
      ),
  );
  const isDefaultActive = !condition || condition.kind !== "state";
  return (
    <div className="px-3 py-1.5 border-b bd flex items-center gap-1 bg-elev/30">
      <span className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold mr-1.5">
        State
      </span>
      {STATE_OPTIONS.map((s) => {
        const active =
          s.id === "default"
            ? isDefaultActive
            : condition?.kind === "state" && condition.state === s.id;
        const hasOverride = s.id !== "default" && stateLayers.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              onChange(
                s.id === "default"
                  ? null
                  : { kind: "state", state: s.id },
              )
            }
            className={`relative h-5 px-1.5 rounded text-[10px] font-medium transition ${
              active
                ? "bg-[color:var(--accent)] text-white"
                : "fg-faint hover:fg hover:bg-hover"
            }`}
          >
            {s.label}
            {hasOverride && !active && (
              <span
                className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function makePropsSetter(
  doc: DocModel,
  node: Node,
  onEdit: (ops: Op[]) => void,
) {
  return (patch: Record<string, Json | undefined>) => {
    const next: Props = { ...node.props };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    const op = editSetProps(doc, node.id, next);
    if (op) onEdit([op]);
  };
}

function TextPanel({
  doc,
  node,
  onEdit,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
}) {
  const text = textContentOf(node);
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  const currentFontFamily = r("font-family");
  const currentSize = r("font-size");
  const currentWeight = r("font-weight");
  const currentLineHeight = r("line-height");
  const currentLetterSpacing = r("letter-spacing");
  const currentTransform = r("text-transform");
  const currentAlign = r("text-align");
  const currentColor = r("color");
  const currentMargin = r("margin");
  const currentOpacity = r("opacity");
  const setProps = makePropsSetter(doc, node, onEdit);
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);

  const setText = (next: string) => setProps({ runs: [{ text: next }] });

  return (
    <>
      <Section label="Contenido">
        <textarea
          data-testid="canva-text-content"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Escribí el texto…"
          className="w-full rounded-md bg-elev border bd text-[12px] fg px-2.5 py-1.5 outline-none transition focus:border-[color:var(--accent)] resize-none leading-snug"
        />
      </Section>
      <Section label="Tipografía">
        <FieldGroup label="Fuente">
          <ElementFontPicker
            current={currentFontFamily}
            onApply={(css) => setStyle({ "font-family": css })}
          />
        </FieldGroup>
        <FieldGroup label="Tamaño">
          <ScalePickerString
            value={currentSize}
            onChange={(v) => setStyle({ "font-size": v })}
            options={[
              { label: "XS", value: "12px" },
              { label: "S", value: "14px" },
              { label: "M", value: "16px" },
              { label: "L", value: "20px" },
              { label: "XL", value: "28px" },
              { label: "2XL", value: "40px" },
            ]}
          />
          <input
            type="text"
            value={currentSize}
            onChange={(e) => setStyle({ "font-size": e.target.value })}
            placeholder="ej: 18px, 1.25rem"
            className="mt-1 w-full h-7 rounded-md bg-elev border bd text-[11px] fg font-mono px-2 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
          />
        </FieldGroup>
        <FieldGroup label="Peso">
          <ScalePickerString
            value={currentWeight}
            onChange={(v) => setStyle({ "font-weight": v })}
            options={[
              { label: "Light", value: "300" },
              { label: "Reg", value: "400" },
              { label: "Med", value: "500" },
              { label: "Semi", value: "600" },
              { label: "Bold", value: "700" },
              { label: "Black", value: "800" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Altura de línea">
          <ScalePickerString
            value={currentLineHeight}
            onChange={(v) => setStyle({ "line-height": v })}
            options={[
              { label: "Tight", value: "1.1" },
              { label: "Snug", value: "1.25" },
              { label: "Normal", value: "1.5" },
              { label: "Loose", value: "1.8" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Espaciado">
          <ScalePickerString
            value={currentLetterSpacing}
            onChange={(v) => setStyle({ "letter-spacing": v })}
            options={[
              { label: "−2", value: "-0.04em" },
              { label: "−1", value: "-0.02em" },
              { label: "0", value: "0" },
              { label: "+1", value: "0.04em" },
              { label: "+2", value: "0.08em" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Transform">
          <ScalePickerString
            value={currentTransform}
            onChange={(v) => setStyle({ "text-transform": v })}
            options={[
              { label: "Aa", value: "" },
              { label: "AA", value: "uppercase" },
              { label: "aa", value: "lowercase" },
              { label: "Cap.", value: "capitalize" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Alineación">
          <ScalePickerString
            value={currentAlign}
            onChange={(v) => setStyle({ "text-align": v })}
            options={[
              { label: "Izq.", value: "left" },
              { label: "Centro", value: "center" },
              { label: "Der.", value: "right" },
              { label: "Just.", value: "justify" },
            ]}
          />
        </FieldGroup>
      </Section>
      <Section label="Color">
        <FieldGroup label="Texto">
          <PaletteColorPicker
            doc={doc}
            value={currentColor}
            onChange={(v) => setStyle({ color: v })}
          />
        </FieldGroup>
      </Section>
      <Section label="Espaciado">
        <FieldGroup label="Margen">
          <BoxSidesEditor
            value={currentMargin}
            onChange={(v) => setStyle({ margin: v })}
          />
        </FieldGroup>
      </Section>
      <Section label="Efectos">
        <FieldGroup label="Opacidad">
          <OpacityRange
            value={currentOpacity}
            onChange={(v) => setStyle({ opacity: v })}
          />
        </FieldGroup>
      </Section>
    </>
  );
}

function ScalePickerString({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="inline-flex w-full gap-0.5 rounded-md border bd bg-elev p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${active ? "bg-app fg shadow-card" : "fg-faint hover:fg"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── IMAGE PANEL ───────────────────────────────────────────────────────────

function ImagePanel({
  doc,
  node,
  onEdit,
  projectId,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
  projectId: string | null;
}) {
  const src = String((node.props as { src?: unknown }).src ?? "");
  const alt = String((node.props as { alt?: unknown }).alt ?? "");
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  const currentFit = r("object-fit") || "cover";
  const currentRadius = r("border-radius");
  const currentShadow = r("box-shadow");
  const currentOpacity = r("opacity");
  const currentFilter = r("filter");
  const setProps = makePropsSetter(doc, node, onEdit);
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);
  const [pickerOpen, setPickerOpen] = useState(false);

  const onPick = (p: ReplacePayload) => {
    if (!p.url) return;
    // The Unsplash credit lives on `props.unsplashCredit` as a magic prop;
    // compile.ts wraps the <img> in a figure+figcaption when it's set.
    // Non-Unsplash picks pass credit=undefined which the props setter
    // deletes — so swapping a pasted URL onto an Unsplash slot clears the
    // attribution automatically.
    setProps({
      src: p.url,
      alt: p.alt ?? alt,
      unsplashCredit: (p.credit ?? undefined) as Json | undefined,
    });
    setPickerOpen(false);
  };

  return (
    <>
      <Section label="Imagen">
        <FieldGroup label="Vista previa">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group relative w-full aspect-video rounded-md overflow-hidden ring-1 ring-[color:var(--border)] bg-elev hover:ring-[color:var(--accent)]/50 transition"
            title="Cambiar imagen"
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-[11px] fg-faint">
                Sin imagen
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10.5px] font-medium text-white bg-black/60 opacity-0 group-hover:opacity-100 transition text-center">
              Cambiar imagen
            </span>
          </button>
        </FieldGroup>
        <FieldGroup label="Texto alternativo">
          <input
            type="text"
            value={alt}
            onChange={(e) => setProps({ alt: e.target.value })}
            placeholder="Describí la imagen"
            className="w-full h-8 rounded-md bg-elev border bd text-[12px] fg px-2.5 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
          />
        </FieldGroup>
        <FieldGroup label="URL (manual)">
          <input
            type="text"
            value={src}
            onChange={(e) => setProps({ src: e.target.value })}
            placeholder="https://…/image.jpg"
            className="w-full h-8 rounded-md bg-elev border bd text-[11px] fg font-mono px-2.5 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
          />
        </FieldGroup>
      </Section>
      <Section label="Estilo">
        <FieldGroup label="Ajuste">
          <ScalePickerString
            value={currentFit}
            onChange={(v) => setStyle({ "object-fit": v })}
            options={[
              { label: "Cubrir", value: "cover" },
              { label: "Contener", value: "contain" },
              { label: "Estirar", value: "fill" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Esquinas">
          <ScalePickerString
            value={currentRadius}
            onChange={(v) => setStyle({ "border-radius": v })}
            options={[
              { label: "Recto", value: "0" },
              { label: "Suave", value: "8px" },
              { label: "Redondo", value: "16px" },
              { label: "Círculo", value: "9999px" },
            ]}
          />
        </FieldGroup>
      </Section>
      <Section label="Efectos">
        <FieldGroup label="Sombra">
          <ShadowEditor
            value={currentShadow}
            onChange={(v) => setStyle({ "box-shadow": v })}
          />
        </FieldGroup>
        <FieldGroup label="Opacidad">
          <OpacityRange
            value={currentOpacity}
            onChange={(v) => setStyle({ opacity: v })}
          />
        </FieldGroup>
        <FieldGroup label="Desenfoque">
          <BlurRange
            value={currentFilter}
            onChange={(v) => setStyle({ filter: v })}
          />
        </FieldGroup>
      </Section>
      <ReplaceAssetModal
        open={pickerOpen}
        kind="image"
        currentSrc={src || null}
        projectId={projectId}
        onClose={() => setPickerOpen(false)}
        onPick={onPick}
      />
    </>
  );
}

// ─── LINK PANEL ────────────────────────────────────────────────────────────

function LinkPanel({
  doc,
  node,
  onEdit,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
}) {
  const href = String((node.props as { href?: unknown }).href ?? "");
  const target = String((node.props as { target?: unknown }).target ?? "");
  const isBlank = target === "_blank";
  const setProps = makePropsSetter(doc, node, onEdit);
  return (
    <>
      <Section label="Enlace">
        <FieldGroup label="Destino">
          <input
            type="text"
            value={href}
            onChange={(e) => setProps({ href: e.target.value })}
            placeholder="https://…  o  #seccion"
            className="w-full h-8 rounded-md bg-elev border bd text-[11px] fg font-mono px-2.5 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
          />
        </FieldGroup>
        <button
          type="button"
          onClick={() =>
            setProps({
              target: isBlank ? undefined : "_blank",
              rel: isBlank ? undefined : "noopener noreferrer",
            })
          }
          className="flex items-center justify-between w-full h-8 px-2.5 rounded-md bg-elev border bd transition hover:bg-hover"
        >
          <span className="text-[12px] fg">Abrir en nueva pestaña</span>
          <span
            className={`relative inline-block h-[16px] w-[28px] rounded-full transition-colors ${
              isBlank
                ? "bg-[color:var(--accent)]"
                : "bg-[color:var(--border-strong)]"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all ${
                isBlank ? "left-[14px]" : "left-[2px]"
              }`}
            />
          </span>
        </button>
      </Section>
    </>
  );
}

// ─── BUTTON PANEL ──────────────────────────────────────────────────────────

function ButtonPanel({
  doc,
  node,
  onEdit,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
}) {
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  const currentBg = r("background-color");
  const currentColor = r("color");
  const currentRadius = r("border-radius");
  const currentShadow = r("box-shadow");
  const currentOpacity = r("opacity");
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);
  return (
    <>
    <Section label="Botón">
      <p className="text-[10.5px] fg-faint leading-relaxed">
        Para cambiar el texto, hacé click en el texto del botón.
      </p>
      <FieldGroup label="Fondo">
        <PaletteColorPicker
          doc={doc}
          value={currentBg}
          onChange={(v) => setStyle({ "background-color": v })}
        />
      </FieldGroup>
      <FieldGroup label="Texto">
        <PaletteColorPicker
          doc={doc}
          value={currentColor}
          onChange={(v) => setStyle({ color: v })}
        />
      </FieldGroup>
      <FieldGroup label="Esquinas">
        <ScalePickerString
          value={currentRadius}
          onChange={(v) => setStyle({ "border-radius": v })}
          options={[
            { label: "Recto", value: "0" },
            { label: "Suave", value: "6px" },
            { label: "Redondo", value: "12px" },
            { label: "Píldora", value: "9999px" },
          ]}
        />
      </FieldGroup>
    </Section>
    <Section label="Efectos">
      <FieldGroup label="Sombra">
        <ShadowEditor
          value={currentShadow}
          onChange={(v) => setStyle({ "box-shadow": v })}
        />
      </FieldGroup>
      <FieldGroup label="Opacidad">
        <OpacityRange
          value={currentOpacity}
          onChange={(v) => setStyle({ opacity: v })}
        />
      </FieldGroup>
    </Section>
    </>
  );
}

// ─── ICON PANEL ────────────────────────────────────────────────────────────

function IconPanel({
  doc,
  node,
  onEdit,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
}) {
  const name = String((node.props as { name?: unknown }).name ?? "");
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  // Icons are sized by font-size — the inlined SVG uses width/height 1em.
  const currentSize = r("font-size");
  const currentColor = r("color");
  const currentOpacity = r("opacity");
  const setProps = makePropsSetter(doc, node, onEdit);
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);
  const [pickerOpen, setPickerOpen] = useState(false);

  const current = CURATED_ICONS.find((i) => i.name === name);
  const Preview = current?.Component;

  const onPick = (p: ReplacePayload) => {
    if (!p.iconName) return;
    setProps({ name: p.iconName });
    setPickerOpen(false);
  };

  return (
    <>
      <Section label="Ícono">
        <FieldGroup label="Vista previa">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group relative w-full h-16 rounded-md ring-1 ring-[color:var(--border)] bg-elev hover:ring-[color:var(--accent)]/50 transition flex items-center justify-center fg-muted hover:text-[color:var(--accent)]"
            title="Cambiar ícono"
          >
            {Preview ? (
              <Preview size={28} strokeWidth={2} aria-hidden />
            ) : (
              <span className="text-[11px] fg-faint">
                {name ? `Sin coincidencia: ${name}` : "Sin ícono"}
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10.5px] font-medium text-white bg-black/60 opacity-0 group-hover:opacity-100 transition text-center">
              Cambiar ícono
            </span>
          </button>
          <p className="text-[10.5px] fg-faint leading-relaxed mt-1.5">
            {name && <span className="font-mono">{name}</span>}
          </p>
        </FieldGroup>
      </Section>
      <Section label="Estilo">
        <FieldGroup label="Tamaño">
          <ScalePickerString
            value={currentSize}
            onChange={(v) => setStyle({ "font-size": v })}
            options={[
              { label: "S", value: "16px" },
              { label: "M", value: "24px" },
              { label: "L", value: "32px" },
              { label: "XL", value: "48px" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Color">
          <PaletteColorPicker
            doc={doc}
            value={currentColor}
            onChange={(v) => setStyle({ color: v })}
          />
        </FieldGroup>
      </Section>
      <Section label="Efectos">
        <FieldGroup label="Opacidad">
          <OpacityRange
            value={currentOpacity}
            onChange={(v) => setStyle({ opacity: v })}
          />
        </FieldGroup>
      </Section>
      <ReplaceAssetModal
        open={pickerOpen}
        kind="icon"
        onClose={() => setPickerOpen(false)}
        onPick={onPick}
      />
    </>
  );
}

// ─── CHILDREN LIST (sections / elements) ───────────────────────────────────
// Drag handle + click-to-select + ↑↓ + delete + HTML5 drag-and-drop reorder.
// Used by BoxPanel (selected box's children) AND PagePanel (root's sections).

function ChildrenList({
  doc,
  parent,
  onSelect,
  onEdit,
}: {
  doc: DocModel;
  parent: Node;
  onSelect: (id: NodeId | null) => void;
  onEdit: (ops: Op[]) => void;
}) {
  const [dragId, setDragId] = useState<NodeId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<NodeId | null>(null);

  const moveChild = (childId: NodeId, delta: -1 | 1) => {
    const idx = parent.childIds.indexOf(childId);
    if (idx < 0) return;
    const toIdx = idx + delta;
    if (toIdx < 0 || toIdx >= parent.childIds.length) return;
    const op = editMove(doc, childId, parent.id, toIdx);
    if (op) onEdit([op]);
  };

  const removeChild = (childId: NodeId) => {
    const op = editRemove(doc, childId);
    if (op) onEdit([op]);
  };

  const onDragStart =
    (childId: NodeId) => (e: React.DragEvent<HTMLLIElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", childId);
      setDragId(childId);
    };

  const onDragOver =
    (childId: NodeId) => (e: React.DragEvent<HTMLLIElement>) => {
      if (!dragId || dragId === childId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(childId);
    };

  const onDragLeave = (childId: NodeId) => () => {
    if (dropTargetId === childId) setDropTargetId(null);
  };

  const onDrop =
    (targetId: NodeId) => (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      const src = e.dataTransfer.getData("text/plain") || dragId || "";
      setDragId(null);
      setDropTargetId(null);
      if (!src || src === targetId) return;
      const fromIdx = parent.childIds.indexOf(src);
      const targetIdx = parent.childIds.indexOf(targetId);
      if (fromIdx < 0 || targetIdx < 0) return;
      // editMove toIndex is the index AFTER detach. Insert-before semantics.
      const toIdx = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
      if (toIdx === fromIdx) return;
      const op = editMove(doc, src, parent.id, toIdx);
      if (op) onEdit([op]);
    };

  const onDragEnd = () => {
    setDragId(null);
    setDropTargetId(null);
  };

  if (parent.childIds.length === 0) {
    return (
      <p className="text-[10.5px] fg-faint leading-relaxed">
        Vacío. Agregá un elemento abajo.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {parent.childIds.map((cid, idx) => {
        const child = doc.nodes[cid];
        if (!child) return null;
        const isDragging = dragId === cid;
        const isDropTarget = dropTargetId === cid;
        return (
          <li
            key={cid}
            draggable
            onDragStart={onDragStart(cid)}
            onDragOver={onDragOver(cid)}
            onDragLeave={onDragLeave(cid)}
            onDrop={onDrop(cid)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-0.5 h-7 px-1 rounded-md bg-elev border bd transition ${
              isDragging ? "opacity-40" : ""
            } ${
              isDropTarget
                ? "border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]"
                : ""
            }`}
          >
            <span
              aria-label="Arrastrar para reordenar"
              title="Arrastrar para reordenar"
              className="fg-faint hover:fg-muted cursor-grab active:cursor-grabbing px-0.5"
            >
              <GripDots size={11} />
            </span>
            <button
              type="button"
              onClick={() => onSelect(cid)}
              className="flex-1 text-left text-[11px] fg-muted hover:fg truncate"
            >
              <span className="inline-block text-[8.5px] uppercase fg-faint font-mono mr-1.5">
                {child.type}
              </span>
              {labelForNode(child)}
            </button>
            <button
              type="button"
              aria-label="Subir"
              disabled={idx === 0}
              onClick={() => moveChild(cid, -1)}
              className="h-5 w-5 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:fg hover:bg-hover transition disabled:opacity-25 disabled:cursor-not-allowed"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Bajar"
              disabled={idx === parent.childIds.length - 1}
              onClick={() => moveChild(cid, 1)}
              className="h-5 w-5 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:fg hover:bg-hover transition disabled:opacity-25 disabled:cursor-not-allowed"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Borrar"
              onClick={() => removeChild(cid)}
              className="h-5 w-5 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:text-red-500 hover:bg-red-500/10 transition"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── BOX / SECTION PANEL ───────────────────────────────────────────────────

function BoxPanel({
  doc,
  node,
  onEdit,
  onSelect,
}: {
  doc: DocModel;
  node: Node;
  onEdit: (ops: Op[]) => void;
  onSelect: (id: NodeId | null) => void;
}) {
  const isRoot = node.id === doc.root;
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  const currentBg = r("background-color");
  const currentPadding = r("padding");
  const currentMargin = r("margin");
  const currentGap = r("gap");
  const currentDisplay = r("display");
  const currentShadow = r("box-shadow");
  const currentOpacity = r("opacity");
  const currentFilter = r("filter");
  const currentBorder = r("border");
  const currentRadius = r("border-radius");
  const currentBgImage = r("background-image");
  const hasGap = currentDisplay === "flex" || currentDisplay === "grid";
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);

  return (
    <>
      <Section label={isRoot ? "Página (root)" : "Sección"}>
        <FieldGroup label="Fondo">
          <PaletteColorPicker
            doc={doc}
            value={currentBg}
            onChange={(v) => setStyle({ "background-color": v })}
          />
        </FieldGroup>
        <FieldGroup label="Gradiente">
          <GradientEditor
            value={currentBgImage}
            onChange={(v) => setStyle({ "background-image": v })}
          />
        </FieldGroup>
      </Section>
      <Section label="Espaciado">
        <FieldGroup label="Padding · rápido">
          <ScalePickerString
            value={currentPadding}
            onChange={(v) => setStyle({ padding: v })}
            options={[
              { label: "Mínimo", value: "16px" },
              { label: "Cómodo", value: "32px 24px" },
              { label: "Aireado", value: "64px 32px" },
              { label: "Máximo", value: "96px 32px" },
            ]}
          />
        </FieldGroup>
        <FieldGroup label="Padding">
          <BoxSidesEditor
            value={currentPadding}
            onChange={(v) => setStyle({ padding: v })}
          />
        </FieldGroup>
        <FieldGroup label="Margen">
          <BoxSidesEditor
            value={currentMargin}
            onChange={(v) => setStyle({ margin: v })}
          />
        </FieldGroup>
      </Section>
      <Section label="Layout">
        <FieldGroup label="Distribución">
          <ScalePickerString
            value={currentDisplay}
            onChange={(v) =>
              v === "grid-2"
                ? setStyle({
                    display: "grid",
                    "grid-template-columns": "repeat(2, 1fr)",
                    gap: currentGap || "24px",
                  })
                : v === "grid-3"
                  ? setStyle({
                      display: "grid",
                      "grid-template-columns": "repeat(3, 1fr)",
                      gap: currentGap || "24px",
                    })
                  : v === "flex"
                    ? setStyle({
                        display: "flex",
                        gap: currentGap || "16px",
                      })
                    : setStyle({
                        display: "",
                        "grid-template-columns": "",
                        gap: "",
                      })
            }
            options={[
              { label: "Vertical", value: "" },
              { label: "2 col", value: "grid-2" },
              { label: "3 col", value: "grid-3" },
              { label: "Flex", value: "flex" },
            ]}
          />
        </FieldGroup>
        {hasGap && (
          <FieldGroup label="Gap">
            <GapInput
              value={currentGap}
              onChange={(v) => setStyle({ gap: v })}
            />
          </FieldGroup>
        )}
      </Section>
      <Section label="Borde">
        <BorderEditor
          value={currentBorder}
          onChange={(v) => setStyle({ border: v })}
          doc={doc}
        />
        <FieldGroup label="Esquinas">
          <ScalePickerString
            value={currentRadius}
            onChange={(v) => setStyle({ "border-radius": v })}
            options={[
              { label: "Recto", value: "0" },
              { label: "Suave", value: "8px" },
              { label: "Medio", value: "16px" },
              { label: "Grande", value: "24px" },
              { label: "Píldora", value: "9999px" },
            ]}
          />
        </FieldGroup>
      </Section>
      <Section label="Efectos">
        <FieldGroup label="Sombra">
          <ShadowEditor
            value={currentShadow}
            onChange={(v) => setStyle({ "box-shadow": v })}
          />
        </FieldGroup>
        <FieldGroup label="Opacidad">
          <OpacityRange
            value={currentOpacity}
            onChange={(v) => setStyle({ opacity: v })}
          />
        </FieldGroup>
        <FieldGroup label="Desenfoque">
          <BlurRange
            value={currentFilter}
            onChange={(v) => setStyle({ filter: v })}
          />
        </FieldGroup>
      </Section>
      <Section label={`Elementos (${node.childIds.length})`}>
        <AddElementPicker doc={doc} parentId={node.id} onEdit={onEdit} />
        <ChildrenList
          doc={doc}
          parent={node}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      </Section>
      {!isRoot && (
        <Section label="Acciones">
          {node.childIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const ops = editUngroup(doc, node.id);
                if (ops && ops.length) {
                  onEdit(ops);
                  // Selection stays on the ungrouped children — clear since
                  // the box itself is gone.
                  onSelect(null);
                }
              }}
              className="w-full h-8 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition text-[11.5px] font-medium"
            >
              Desagrupar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const op = editRemove(doc, node.id);
              if (op) {
                onEdit([op]);
                onSelect(null);
              }
            }}
            className="w-full h-8 rounded-md border bd bg-elev text-red-500 hover:bg-red-500/10 transition text-[11.5px] font-medium"
          >
            Borrar sección
          </button>
        </Section>
      )}
    </>
  );
}

// ─── COLOR HELPERS ────────────────────────────────────────────────────────

const RECENTS_KEY = "openlen-color-recents";
const MAX_RECENTS = 16;

function isHex(s: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

function normalizeHex(s: string): string {
  const t = s.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    return (
      "#" +
      t
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return t;
}

function extractHex(value: string): string {
  return isHex(value) ? normalizeHex(value) : "";
}

function resolveTokenColor(doc: DocModel, value: string): string {
  const m = value.match(/^var\((--[\w-]+)\)$/);
  if (!m) return value;
  const def = doc.tokens.defs[m[1]];
  if (!def) return value;
  const mode = doc.tokens.modes[0] ?? "light";
  const v = def.values[mode];
  return typeof v === "string" ? v : value;
}

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string" && isHex(s))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function saveRecents(next: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private-mode */
  }
}

// Color picker that pulls the doc's current color tokens (fg, accent, bg,
// surface, border) and offers them as chips. Each chip's value is the var()
// reference, so inline-style writes follow the global palette. Below the
// chips: a hex input + native color picker + EyeDropper (when supported) +
// a localStorage-backed recents row shared across all inspectors.
function PaletteColorPicker({
  doc,
  value,
  onChange,
}: {
  doc: DocModel;
  value: string;
  onChange: (cssValue: string) => void;
}) {
  const lightMode = doc.tokens.modes[0] ?? "light";
  const roles: Array<{ key: keyof typeof TOKEN_CANDIDATES; label: string }> = [
    { key: "fg", label: "Texto" },
    { key: "accent", label: "Accent" },
    { key: "surface", label: "Surface" },
    { key: "border", label: "Borde" },
    { key: "bg", label: "Fondo" },
  ];

  const hexFromValue = extractHex(value);
  const [hexInput, setHexInput] = useState(hexFromValue);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());

  useEffect(() => {
    setHexInput(extractHex(value));
  }, [value]);

  const hasEyeDropper =
    typeof window !== "undefined" && "EyeDropper" in window;

  const commitHex = (raw: string) => {
    if (!isHex(raw)) return;
    const norm = normalizeHex(raw);
    onChange(norm);
    setRecents((prev) => {
      const without = prev.filter((c) => c !== norm);
      const next = [norm, ...without].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });
  };

  const onHexInputChange = (raw: string) => {
    setHexInput(raw);
    if (isHex(raw)) commitHex(raw);
  };

  const onNativePicker = (raw: string) => {
    setHexInput(raw);
    commitHex(raw);
  };

  const pickEyeDrop = async () => {
    const W = window as unknown as {
      EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
    };
    if (!W.EyeDropper) return;
    try {
      const r = await new W.EyeDropper().open();
      if (r?.sRGBHex) {
        setHexInput(r.sRGBHex);
        commitHex(r.sRGBHex);
      }
    } catch {
      /* user cancelled */
    }
  };

  // Native <input type=color> needs a hex; when the value is a token ref,
  // fall back to its resolved color so the swatch reflects reality.
  const swatchHex = hexInput || extractHex(resolveTokenColor(doc, value)) || "#000000";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {roles.map(({ key, label }) => {
          const tid = findTokenId(doc, key);
          if (!tid) return null;
          const swatch = String(
            doc.tokens.defs[tid]?.values[lightMode] ?? "#888",
          );
          const cssValue = `var(${tid})`;
          const active = value === cssValue;
          return (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onChange(cssValue)}
              className={`h-8 rounded-md border bd transition hover:scale-[1.04] ${active ? "ring-2 ring-[color:var(--accent)]" : ""}`}
              style={{ background: swatch }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label="Selector visual de color"
          value={swatchHex}
          onChange={(e) => onNativePicker(e.target.value)}
          className="h-7 w-7 shrink-0 rounded-md border bd cursor-pointer p-0 bg-transparent"
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => onHexInputChange(e.target.value)}
          onBlur={() => {
            if (isHex(hexInput)) commitHex(hexInput);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isHex(hexInput)) commitHex(hexInput);
          }}
          placeholder="#ffffff"
          spellCheck={false}
          className="flex-1 h-7 rounded-md bg-elev border bd text-[11px] fg font-mono px-2 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
        />
        {hasEyeDropper && (
          <button
            type="button"
            onClick={() => void pickEyeDrop()}
            title="Cuentagotas"
            aria-label="Cuentagotas"
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition"
          >
            <Pipette size={12} />
          </button>
        )}
      </div>

      {recents.length > 0 && (
        <div>
          <span className="block text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1">
            Recientes
          </span>
          <div className="grid grid-cols-8 gap-1">
            {recents.map((c) => {
              const active = hexInput.toLowerCase() === c;
              return (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={c}
                  onClick={() => {
                    setHexInput(c);
                    commitHex(c);
                  }}
                  style={{ background: c }}
                  className={`h-5 rounded border bd hover:scale-[1.1] transition ${active ? "ring-2 ring-[color:var(--accent)]" : ""}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BOX SIDES (padding / margin) ─────────────────────────────────────────

interface BoxSides {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

// Parse a CSS 1/2/3/4-value shorthand ("16px" / "16px 24px" / etc.) into four
// per-side strings. Empty input → all-empty (caller treats as "no value set").
function parseBox(css: string): BoxSides {
  const t = css.trim();
  if (!t) return { top: "", right: "", bottom: "", left: "" };
  const parts = t.split(/\s+/);
  if (parts.length === 1)
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2)
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3)
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

// Re-emit the shortest equivalent shorthand — Tailwind/CSS-idiomatic and easy
// to read in the generated HTML.
function serializeBox(b: BoxSides): string {
  const { top, right, bottom, left } = b;
  if (!top && !right && !bottom && !left) return "";
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && left === right) return `${top} ${left}`;
  if (left === right) return `${top} ${left} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

function allEqual(b: BoxSides): boolean {
  return b.top === b.right && b.right === b.bottom && b.bottom === b.left;
}

function BoxSidesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const sides = parseBox(value);
  const [linked, setLinked] = useState(allEqual(sides));

  const set = (side: keyof BoxSides, v: string) => {
    if (linked) onChange(v);
    else onChange(serializeBox({ ...sides, [side]: v }));
  };

  const cell =
    "h-6 rounded text-[10.5px] fg font-mono text-center bg-elev border bd outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint";

  return (
    <div>
      <div className="flex items-center justify-end -mt-1 mb-1">
        <button
          type="button"
          onClick={() => setLinked((l) => !l)}
          title={linked ? "Lados independientes" : "Lados iguales"}
          aria-label={linked ? "Desligar lados" : "Ligar lados"}
          className="h-5 w-5 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
        >
          {linked ? <Link2 size={11} /> : <Link2Off size={11} />}
        </button>
      </div>
      <div className="relative w-full rounded-md border border-dashed bd bg-app/40 py-7 px-10">
        <input
          type="text"
          value={sides.top}
          onChange={(e) => set("top", e.target.value)}
          placeholder="0"
          aria-label="Arriba"
          className={`${cell} absolute top-1 left-1/2 -translate-x-1/2 w-12`}
        />
        <input
          type="text"
          value={sides.right}
          onChange={(e) => set("right", e.target.value)}
          placeholder="0"
          aria-label="Derecha"
          className={`${cell} absolute right-1 top-1/2 -translate-y-1/2 w-12`}
        />
        <input
          type="text"
          value={sides.bottom}
          onChange={(e) => set("bottom", e.target.value)}
          placeholder="0"
          aria-label="Abajo"
          className={`${cell} absolute bottom-1 left-1/2 -translate-x-1/2 w-12`}
        />
        <input
          type="text"
          value={sides.left}
          onChange={(e) => set("left", e.target.value)}
          placeholder="0"
          aria-label="Izquierda"
          className={`${cell} absolute left-1 top-1/2 -translate-y-1/2 w-12`}
        />
        <div className="w-full h-8 rounded bg-elev/60 border bd flex items-center justify-center text-[9.5px] fg-faint">
          contenido
        </div>
      </div>
    </div>
  );
}

function GapInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <ScalePickerString
        value={value}
        onChange={onChange}
        options={[
          { label: "0", value: "0" },
          { label: "8", value: "8px" },
          { label: "16", value: "16px" },
          { label: "24", value: "24px" },
          { label: "32", value: "32px" },
          { label: "48", value: "48px" },
        ]}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ej: 20px"
        className="w-full h-7 rounded-md bg-elev border bd text-[11px] fg font-mono px-2 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
      />
    </div>
  );
}

// ─── BORDER (shorthand: <width> <style> <color>) ──────────────────────────

const BORDER_COLOR_TAIL =
  /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}|var\(--[\w-]+\)|currentColor|transparent)\s*$/;

function parseBorder(v: string): { width: string; style: string; color: string } {
  const t = v.trim();
  if (!t || t === "none") return { width: "", style: "solid", color: "" };
  const m = t.match(BORDER_COLOR_TAIL);
  const color = m ? m[0].trim() : "";
  const head = (m ? t.slice(0, m.index) : t).trim();
  const parts = head ? head.split(/\s+/) : [];
  return {
    width: parts[0] ?? "",
    style: parts[1] || "solid",
    color,
  };
}

function serializeBorder(b: {
  width: string;
  style: string;
  color: string;
}): string {
  if (!b.width || b.width === "0") return "";
  const style = b.style || "solid";
  const color = b.color || "currentColor";
  return `${b.width} ${style} ${color}`;
}

function BorderEditor({
  value,
  onChange,
  doc,
}: {
  value: string;
  onChange: (next: string) => void;
  doc: DocModel;
}) {
  const b = parseBorder(value);
  const set = (patch: Partial<typeof b>) =>
    onChange(serializeBorder({ ...b, ...patch }));
  return (
    <>
      <FieldGroup label="Ancho">
        <ScalePickerString
          value={b.width}
          onChange={(v) => set({ width: v })}
          options={[
            { label: "0", value: "" },
            { label: "1", value: "1px" },
            { label: "2", value: "2px" },
            { label: "3", value: "3px" },
            { label: "4", value: "4px" },
          ]}
        />
        <input
          type="text"
          value={b.width}
          onChange={(e) => set({ width: e.target.value })}
          placeholder="ej: 1px"
          className="mt-1 w-full h-7 rounded-md bg-elev border bd text-[11px] fg font-mono px-2 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
        />
      </FieldGroup>
      <FieldGroup label="Estilo">
        <ScalePickerString
          value={b.style}
          onChange={(v) => set({ style: v })}
          options={[
            { label: "Solid", value: "solid" },
            { label: "Dashed", value: "dashed" },
            { label: "Dotted", value: "dotted" },
            { label: "Double", value: "double" },
          ]}
        />
      </FieldGroup>
      <FieldGroup label="Color">
        <PaletteColorPicker
          doc={doc}
          value={b.color}
          onChange={(v) => set({ color: v })}
        />
      </FieldGroup>
    </>
  );
}

// ─── GRADIENT (background-image: linear/radial-gradient(...)) ─────────────

interface GradientStop {
  color: string;
  pos: string;
}
interface GradientValue {
  type: "linear" | "radial" | null;
  angle: number;
  stops: GradientStop[];
}

// CSS commas inside rgba()/var() must NOT split — walk char-by-char tracking
// paren depth instead of regex-splitting.
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const DIRECTION_TO_ANGLE: Record<string, number> = {
  "to top": 0,
  "to top right": 45,
  "to right": 90,
  "to bottom right": 135,
  "to bottom": 180,
  "to bottom left": 225,
  "to left": 270,
  "to top left": 315,
};

function parseGradient(css: string): GradientValue {
  const t = (css || "").trim();
  if (!t || t === "none") return { type: null, angle: 135, stops: [] };
  const m = t.match(/^(linear|radial)-gradient\((.*)\)\s*$/i);
  if (!m) return { type: null, angle: 135, stops: [] };
  const type = m[1].toLowerCase() as "linear" | "radial";
  const parts = splitTopLevel(m[2], ",").map((p) => p.trim());
  let angle = 135;
  let startIdx = 0;
  if (type === "linear" && parts.length > 0) {
    const first = parts[0];
    const ang = first.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (ang) {
      angle = parseFloat(ang[1]);
      startIdx = 1;
    } else if (DIRECTION_TO_ANGLE[first.toLowerCase()] !== undefined) {
      angle = DIRECTION_TO_ANGLE[first.toLowerCase()];
      startIdx = 1;
    }
  } else if (type === "radial" && parts.length > 0) {
    // Skip the "circle at center" prefix if present (not a color stop).
    const first = parts[0];
    if (!/^#|^rgb|^hsl|^var\(|^[a-z]+$/i.test(first.split(/\s+/)[0])) {
      // Looks like a position descriptor — skip.
      startIdx = 1;
    } else if (/^(circle|ellipse|closest|farthest)/i.test(first)) {
      startIdx = 1;
    }
  }
  const stops: GradientStop[] = parts.slice(startIdx).map((p) => {
    const posMatch = p.match(/\s+(-?\d+(?:\.\d+)?(?:%|px|em|rem))\s*$/);
    if (posMatch) {
      return {
        color: p.slice(0, posMatch.index).trim(),
        pos: posMatch[1],
      };
    }
    return { color: p, pos: "" };
  });
  return { type, angle, stops };
}

function serializeGradient(g: GradientValue): string {
  if (!g.type || g.stops.length === 0) return "";
  const stops = g.stops
    .map((s) => (s.pos ? `${s.color} ${s.pos}` : s.color))
    .join(", ");
  if (g.type === "linear") return `linear-gradient(${g.angle}deg, ${stops})`;
  return `radial-gradient(${stops})`;
}

const GRADIENT_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Sunset", value: "linear-gradient(135deg, #ff8a00, #e52e71)" },
  { label: "Ocean", value: "linear-gradient(135deg, #2193b0, #6dd5ed)" },
  { label: "Aurora", value: "linear-gradient(135deg, #4ca1af, #c4e0e5)" },
  { label: "Lava", value: "linear-gradient(135deg, #ff416c, #ff4b2b)" },
  { label: "Mint", value: "linear-gradient(135deg, #00b09b, #96c93d)" },
  { label: "Purple", value: "linear-gradient(135deg, #667eea, #764ba2)" },
];

function GradientEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const g = parseGradient(value);
  const has = g.type !== null && g.stops.length > 0;

  const set = (patch: Partial<GradientValue>) => {
    // Adopt a sensible default when we're flipping FROM "no gradient" to
    // having one (e.g., user clicks the Type toggle with no stops yet).
    const base: GradientValue =
      g.type === null
        ? { type: "linear", angle: 135, stops: [{ color: "#7c3aed", pos: "" }, { color: "#ec4899", pos: "" }] }
        : g;
    onChange(serializeGradient({ ...base, ...patch }));
  };

  const setStops = (next: GradientStop[]) => set({ stops: next });
  const updateStop = (i: number, patch: Partial<GradientStop>) => {
    setStops(g.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addStop = () => {
    const last = g.stops[g.stops.length - 1]?.color ?? "#000000";
    setStops([...g.stops, { color: last, pos: "" }]);
  };
  const removeStop = (i: number) => {
    if (g.stops.length <= 2) return;
    setStops(g.stops.filter((_, idx) => idx !== i));
  };

  const preview = has ? value : "";

  return (
    <div className="space-y-2">
      <div
        className="w-full h-14 rounded-md border bd"
        style={{
          background: preview || "var(--elev)",
        }}
        aria-label="Vista previa del gradiente"
      />
      <div className="grid grid-cols-6 gap-1">
        {GRADIENT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.label}
            aria-label={p.label}
            onClick={() => onChange(p.value)}
            className="h-7 rounded-md border bd transition hover:scale-[1.05]"
            style={{ background: p.value }}
          />
        ))}
      </div>
      <ScalePickerString
        value={g.type ?? ""}
        onChange={(v) => {
          if (v === "") {
            onChange("");
          } else {
            set({ type: v as "linear" | "radial" });
          }
        }}
        options={[
          { label: "None", value: "" },
          { label: "Linear", value: "linear" },
          { label: "Radial", value: "radial" },
        ]}
      />
      {g.type === "linear" && (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={360}
            step={5}
            value={g.angle}
            onChange={(e) => set({ angle: Number(e.target.value) })}
            className="flex-1 accent-[color:var(--accent)] cursor-pointer"
            aria-label="Ángulo"
          />
          <span className="text-[11px] fg-muted font-mono tabular w-10 text-right">
            {g.angle}°
          </span>
        </div>
      )}
      {has && (
        <>
          <div className="space-y-1">
            {g.stops.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="color"
                  value={s.color.startsWith("#") ? s.color : "#000000"}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  className="h-6 w-6 shrink-0 rounded border bd cursor-pointer p-0 bg-transparent"
                  aria-label={`Color stop ${i + 1}`}
                />
                <input
                  type="text"
                  value={s.color}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  placeholder="#000"
                  spellCheck={false}
                  className="flex-1 h-6 rounded bg-elev border bd text-[11px] fg font-mono px-1.5 outline-none transition focus:border-[color:var(--accent)]"
                />
                <input
                  type="text"
                  value={s.pos}
                  onChange={(e) => updateStop(i, { pos: e.target.value })}
                  placeholder="auto"
                  className="w-12 h-6 rounded bg-elev border bd text-[10.5px] fg font-mono text-center px-1 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
                />
                <button
                  type="button"
                  disabled={g.stops.length <= 2}
                  onClick={() => removeStop(i)}
                  aria-label="Quitar stop"
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-[11px] fg-faint hover:fg hover:bg-hover transition disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addStop}
            disabled={g.stops.length >= 5}
            className="w-full h-6 rounded-md text-[10.5px] fg-faint hover:fg hover:bg-hover transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Agregar stop
          </button>
        </>
      )}
    </div>
  );
}

// ─── EFFECTS (shadow / opacity / blur) ────────────────────────────────────

interface ShadowParts {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
}

// Match a trailing color: rgba(), rgb(), hex, hsl(), var(). Greedy on the
// color so the head split (X/Y/blur/spread) doesn't accidentally claim it.
const SHADOW_COLOR_TAIL =
  /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))\s*$/;

function parseShadow(css: string): ShadowParts {
  const t = css.trim();
  if (!t || t === "none") {
    return { x: "0", y: "0", blur: "0", spread: "0", color: "rgba(0,0,0,0.12)" };
  }
  const m = t.match(SHADOW_COLOR_TAIL);
  const color = m ? m[0].trim() : "rgba(0,0,0,0.12)";
  const head = (m ? t.slice(0, m.index) : t).trim();
  const parts = head ? head.split(/\s+/) : [];
  return {
    x: parts[0] ?? "0",
    y: parts[1] ?? "0",
    blur: parts[2] ?? "0",
    spread: parts[3] ?? "0",
    color,
  };
}

function serializeShadow(s: ShadowParts): string {
  if (
    s.x === "0" &&
    s.y === "0" &&
    s.blur === "0" &&
    s.spread === "0"
  ) {
    return "";
  }
  return `${s.x} ${s.y} ${s.blur} ${s.spread} ${s.color}`;
}

const SHADOW_PRESETS: Array<{ label: string; value: string }> = [
  { label: "None", value: "" },
  { label: "Sutil", value: "0 1px 2px rgba(0,0,0,0.06)" },
  { label: "Suave", value: "0 4px 12px rgba(0,0,0,0.08)" },
  { label: "Media", value: "0 8px 24px rgba(0,0,0,0.12)" },
  { label: "Fuerte", value: "0 16px 40px rgba(0,0,0,0.2)" },
  { label: "Glow", value: "0 0 28px rgba(99,102,241,0.35)" },
];

function ShadowEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parts = parseShadow(value);
  const set = (patch: Partial<ShadowParts>) => {
    onChange(serializeShadow({ ...parts, ...patch }));
  };

  const cell =
    "w-full h-7 rounded-md bg-elev border bd text-[11px] fg font-mono text-center px-1 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint";
  const label =
    "block text-[9.5px] uppercase tracking-[0.12em] fg-faint font-medium mb-0.5";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1">
        {SHADOW_PRESETS.map((p) => {
          const active = (value || "").trim() === p.value;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.value)}
              className={`h-6 rounded-md text-[10.5px] font-medium border bd transition ${
                active
                  ? "bg-[color:var(--accent)] text-white border-transparent"
                  : "bg-elev fg-muted hover:fg hover:bg-hover"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <div>
          <span className={label}>X</span>
          <input
            type="text"
            value={parts.x}
            onChange={(e) => set({ x: e.target.value })}
            placeholder="0"
            aria-label="Offset X"
            className={cell}
          />
        </div>
        <div>
          <span className={label}>Y</span>
          <input
            type="text"
            value={parts.y}
            onChange={(e) => set({ y: e.target.value })}
            placeholder="0"
            aria-label="Offset Y"
            className={cell}
          />
        </div>
        <div>
          <span className={label}>Blur</span>
          <input
            type="text"
            value={parts.blur}
            onChange={(e) => set({ blur: e.target.value })}
            placeholder="0"
            aria-label="Blur"
            className={cell}
          />
        </div>
        <div>
          <span className={label}>Spread</span>
          <input
            type="text"
            value={parts.spread}
            onChange={(e) => set({ spread: e.target.value })}
            placeholder="0"
            aria-label="Spread"
            className={cell}
          />
        </div>
      </div>
      <input
        type="text"
        value={parts.color}
        onChange={(e) => set({ color: e.target.value })}
        placeholder="rgba(0,0,0,0.12)"
        aria-label="Color de la sombra"
        className="w-full h-7 rounded-md bg-elev border bd text-[11px] fg font-mono px-2 outline-none transition focus:border-[color:var(--accent)] placeholder:fg-faint"
      />
    </div>
  );
}

function OpacityRange({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const num = parseFloat(value || "1");
  const safe = Number.isFinite(num) ? num : 1;
  const pct = Math.round(safe * 100);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const next = Number(e.target.value) / 100;
          onChange(next >= 1 ? "" : String(Math.round(next * 100) / 100));
        }}
        className="flex-1 accent-[color:var(--accent)] cursor-pointer"
        aria-label="Opacidad"
      />
      <span className="text-[11px] fg-muted font-mono tabular w-10 text-right">
        {pct}%
      </span>
    </div>
  );
}

function BlurRange({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const m = (value || "").match(/blur\((\d+(?:\.\d+)?)px\)/);
  const px = m ? Math.round(parseFloat(m[1])) : 0;
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={40}
        value={px}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v === 0 ? "" : `blur(${v}px)`);
        }}
        className="flex-1 accent-[color:var(--accent)] cursor-pointer"
        aria-label="Desenfoque"
      />
      <span className="text-[11px] fg-muted font-mono tabular w-10 text-right">
        {px}px
      </span>
    </div>
  );
}

// ─── ANIMATION SECTION (entrance / loop) ──────────────────────────────────

function parseMs(v: string): number {
  const t = v.trim().toLowerCase();
  if (!t) return 0;
  if (t.endsWith("ms")) return Math.max(0, Math.round(parseFloat(t) || 0));
  if (t.endsWith("s")) return Math.max(0, Math.round((parseFloat(t) || 0) * 1000));
  return Math.max(0, Math.round(parseFloat(t) || 0));
}

function AnimationSection({
  node,
}: {
  node: Node;
}) {
  const editCondition = useContext(EditConditionContext);
  const r = makeStyleReader(node, editCondition);
  const doc = useContext(DocContext);
  const onEdit = useContext(OnEditContext);
  const setStyle = makeStyleSetter(doc, node, onEdit, editCondition);

  const currentName = r("animation-name");
  const currentDuration = parseMs(r("animation-duration"));
  const currentDelay = parseMs(r("animation-delay"));
  const currentIter = r("animation-iteration-count") || "1";
  const hasAnimation = !!currentName;

  // Click an animation → set name + sensible defaults if empty.
  // Click None → clear every animation-* property in one op.
  const pickAnimation = (id: string) => {
    if (!id) {
      setStyle({
        "animation-name": "",
        "animation-duration": "",
        "animation-delay": "",
        "animation-iteration-count": "",
        "animation-timing-function": "",
        "animation-fill-mode": "",
      });
      return;
    }
    setStyle({
      "animation-name": id,
      "animation-duration": currentDuration ? `${currentDuration}ms` : "600ms",
      "animation-timing-function": "ease-out",
      "animation-fill-mode": "both",
    });
  };

  return (
    <Section label="Animación">
      <FieldGroup label="Tipo">
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => pickAnimation("")}
            className={`flex flex-col items-center justify-center gap-0.5 h-12 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition ${
              !hasAnimation ? "ring-2 ring-[color:var(--accent)]" : ""
            }`}
          >
            <span className="text-[13px] leading-none">—</span>
            <span className="text-[9px] truncate max-w-full px-0.5">None</span>
          </button>
          {ANIMATIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pickAnimation(a.id)}
              title={a.label}
              className={`flex flex-col items-center justify-center gap-0.5 h-12 rounded-md border bd bg-elev fg-muted hover:fg hover:bg-hover transition ${
                currentName === a.id
                  ? "ring-2 ring-[color:var(--accent)]"
                  : ""
              }`}
            >
              <span className="text-[14px] leading-none">{a.glyph}</span>
              <span className="text-[9px] truncate max-w-full px-0.5">
                {a.label}
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>
      {hasAnimation && (
        <>
          <FieldGroup label="Duración">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={3000}
                step={50}
                value={currentDuration || 600}
                onChange={(e) =>
                  setStyle({ "animation-duration": `${e.target.value}ms` })
                }
                className="flex-1 accent-[color:var(--accent)] cursor-pointer"
                aria-label="Duración"
              />
              <span className="text-[11px] fg-muted font-mono tabular w-14 text-right">
                {currentDuration || 600}ms
              </span>
            </div>
          </FieldGroup>
          <FieldGroup label="Retraso">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={3000}
                step={50}
                value={currentDelay}
                onChange={(e) =>
                  setStyle({
                    "animation-delay":
                      Number(e.target.value) === 0
                        ? ""
                        : `${e.target.value}ms`,
                  })
                }
                className="flex-1 accent-[color:var(--accent)] cursor-pointer"
                aria-label="Retraso"
              />
              <span className="text-[11px] fg-muted font-mono tabular w-14 text-right">
                {currentDelay}ms
              </span>
            </div>
          </FieldGroup>
          <FieldGroup label="Repetir">
            <ScalePickerString
              value={currentIter}
              onChange={(v) =>
                setStyle({
                  "animation-iteration-count": v === "1" ? "" : v,
                })
              }
              options={[
                { label: "Una vez", value: "1" },
                { label: "Infinito", value: "infinite" },
              ]}
            />
          </FieldGroup>
        </>
      )}
    </Section>
  );
}

// AnimationSection needs `doc` + `onEdit` but doesn't take them as props (to
// keep ElementPanel's render call short). These contexts forward them.
const DocContext = createContext<DocModel>(null as unknown as DocModel);
const OnEditContext = createContext<(ops: Op[]) => void>(() => undefined);

// ─── BREADCRUMB ────────────────────────────────────────────────────────────

interface Crumb {
  id: NodeId | null;
  label: string;
}

function buildBreadcrumb(doc: DocModel, selectedId: NodeId): Crumb[] {
  const chain: NodeId[] = [];
  let cur: NodeId | null = selectedId;
  while (cur && cur !== doc.root) {
    chain.unshift(cur);
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  const path: Crumb[] = [{ id: null, label: "Página" }];
  for (const id of chain) {
    const n = doc.nodes[id];
    if (!n) continue;
    path.push({ id, label: labelForNode(n) });
  }
  return path;
}

export function labelForNode(node: Node): string {
  if (node.type === "Text") {
    const runs = node.props.runs;
    if (Array.isArray(runs)) {
      const text = runs
        .map((r) => {
          const run = r as { text?: unknown };
          return typeof run.text === "string" ? run.text : "";
        })
        .join("")
        .trim();
      if (text) return text.length > 22 ? text.slice(0, 22) + "…" : text;
    }
  }
  return node.tag || node.type;
}

function Breadcrumb({
  crumbs,
  onSelect,
}: {
  crumbs: Crumb[];
  onSelect: (id: NodeId | null) => void;
}) {
  return (
    <nav
      data-testid="canva-breadcrumb"
      className="flex items-center gap-1 px-3 h-8 border-b bd text-[10.5px] fg-faint overflow-x-auto nice-scroll-h"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${c.id ?? "root"}-${i}`} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="fg-faint opacity-50">›</span>}
            {isLast ? (
              <span className="fg font-medium truncate max-w-[140px]">
                {c.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className="hover:fg transition truncate max-w-[100px]"
              >
                {c.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── PICKERS ───────────────────────────────────────────────────────────────

// Palette picker — Canva-mode UX (locked per canva-mode-decision + the
// "intent chips, not curated catalog" discussion):
//   - 8 intent chips at the top (Cálido / Frío / Sobrio / etc.) — pure
//     algorithmic generation, free + instant per click.
//   - 6 swatches below — the current batch. Click to apply.
//   - "Regenerar" → fresh batch from the same intent.
//   - AI composer at the bottom — free-form prompt → /api/inspector/intent.
//     Costs credits; the response replaces the swatches.
function PalettePicker({
  current,
  onApply,
}: {
  current: string | null;
  onApply: (p: Palette) => void;
}) {
  // Initial: show 6 vibrant palettes so the user sees options at a glance.
  const [intent, setIntent] = useState<PaletteIntent | "ai">("vibrant");
  const [swatches, setSwatches] = useState<Palette[]>(() =>
    generatePalettes("vibrant", 6),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiState, setAiState] = useState<"idle" | "loading">("idle");
  const [aiError, setAiError] = useState<string | null>(null);

  const matchedByPage = swatches.find(
    (p) =>
      !!current &&
      current.toLowerCase() === p.tokens["--ol-accent"].toLowerCase(),
  )?.id;
  const activeId = picked ?? matchedByPage ?? null;

  const pickIntent = (next: PaletteIntent) => {
    setIntent(next);
    setSwatches(generatePalettes(next, 6));
    setPicked(null);
    setAiError(null);
  };

  const regenerate = () => {
    if (intent === "ai") {
      // Re-run the last AI prompt
      if (aiPrompt.trim()) void runAi();
    } else {
      setSwatches(generatePalettes(intent, 6));
      setPicked(null);
    }
  };

  const runAi = async () => {
    const text = aiPrompt.trim();
    if (text.length < 2 || aiState === "loading") return;
    setAiState("loading");
    setAiError(null);
    try {
      const res = await fetch("/api/inspector/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ axis: "palette", prompt: text, count: 6 }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        palettes?: Palette[];
        message?: string;
      } | null;
      if (res.ok && data?.ok && Array.isArray(data.palettes)) {
        setSwatches(data.palettes);
        setIntent("ai");
        setPicked(null);
      } else {
        setAiError(data?.message ?? "La IA falló. Probá otra vez.");
      }
    } catch {
      setAiError("Sin red. Probá otra vez.");
    } finally {
      setAiState("idle");
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1 mb-1">
        {PALETTE_INTENTS.map((it) => {
          const active = intent === it.id;
          return (
            <button
              key={it.id}
              type="button"
              title={it.hint}
              onClick={() => pickIntent(it.id)}
              className={`h-6 rounded-md text-[10.5px] font-medium border bd transition ${
                active
                  ? "bg-[color:var(--accent)] text-white border-transparent"
                  : "bg-elev fg-muted hover:fg hover:bg-hover"
              }`}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {swatches.map((p) => {
          const active = activeId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              onClick={() => {
                setPicked(p.id);
                onApply(p);
              }}
              className={`group relative h-12 rounded-md border bd overflow-hidden transition hover:scale-[1.04] ${active ? "ring-2 ring-[color:var(--accent)] shadow-card scale-[1.02]" : ""}`}
              style={{ background: p.tokens["--ol-bg"] }}
            >
              <span
                className="absolute inset-1 rounded-sm"
                style={{
                  background: p.tokens["--ol-surface"],
                  border: `1px solid ${p.tokens["--ol-border"]}`,
                }}
              />
              <span
                className="absolute bottom-1 right-1 h-3 w-3 rounded-full ring-1 ring-white/50"
                style={{ background: p.tokens["--ol-accent"] }}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={regenerate}
        className="w-full h-6 rounded-md text-[10.5px] fg-faint hover:fg hover:bg-hover transition"
      >
        ↻ Regenerar
      </button>
      <div className="pt-2 border-t bd space-y-1.5">
        <span className="block text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold">
          O pedile a la IA
        </span>
        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="ej: paleta como un atardecer en Marruecos"
          rows={2}
          className="w-full rounded-md bg-elev border bd text-[11.5px] fg px-2 py-1.5 outline-none transition focus:border-[color:var(--accent)] resize-none leading-snug placeholder:fg-faint"
        />
        <button
          type="button"
          disabled={aiState === "loading" || aiPrompt.trim().length < 2}
          onClick={() => void runAi()}
          className="w-full h-7 rounded-md bg-[color:var(--accent)] text-white text-[11px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {aiState === "loading" ? "Generando…" : "Generar con IA · ~1 cr"}
        </button>
        {aiError && (
          <p className="text-[10.5px] text-red-500 leading-relaxed">{aiError}</p>
        )}
      </div>
    </div>
  );
}

// Per-element font picker (Text). Empty value = inherit from the page-level
// --ol-font-display token. Distinct from FontPicker, which writes the token
// for the whole document.
function ElementFontPicker({
  current,
  onApply,
}: {
  current: string;
  onApply: (css: string) => void;
}) {
  const currentName = current
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  const matchedId = FONT_PRESETS.find((f) => f.displayName === currentName)?.id;
  const isInherit = !current.trim();
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <button
        type="button"
        onClick={() => onApply("")}
        title="Heredar de la página"
        className={`h-12 rounded-md border bd bg-elev hover:bg-hover transition flex flex-col items-center justify-center gap-0 ${isInherit ? "ring-2 ring-[color:var(--accent)] scale-[1.04]" : ""}`}
      >
        <span className="text-[13px] fg leading-none">↑</span>
        <span className="text-[8.5px] fg-faint mt-0.5">Heredar</span>
      </button>
      {FONT_PRESETS.map((f) => {
        const active = matchedId === f.id;
        return (
          <button
            key={f.id}
            type="button"
            title={`${f.name} — ${f.hint}`}
            aria-label={f.name}
            onClick={() => onApply(f.displayCss)}
            className={`h-12 rounded-md border bd bg-elev hover:bg-hover transition flex flex-col items-center justify-center gap-0 ${active ? "ring-2 ring-[color:var(--accent)] scale-[1.04]" : ""}`}
          >
            <span
              style={{ fontFamily: f.displayCss }}
              className="text-[16px] fg leading-none"
            >
              {f.previewChar}
            </span>
            <span className="text-[8.5px] fg-faint mt-0.5 truncate max-w-full px-0.5">
              {f.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FontPicker({
  current,
  onApply,
}: {
  current: string;
  onApply: (f: FontPreset) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const currentName = current
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  const matchedByPage = FONT_PRESETS.find(
    (f) => f.displayName === currentName,
  )?.id;
  const activeId = picked ?? matchedByPage ?? null;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {FONT_PRESETS.map((f) => {
        const active = activeId === f.id;
        return (
          <button
            key={f.id}
            type="button"
            title={`${f.name} — ${f.hint}`}
            aria-label={f.name}
            onClick={() => {
              setPicked(f.id);
              onApply(f);
            }}
            className={`h-12 rounded-md border bd bg-elev hover:bg-hover transition flex flex-col items-center justify-center gap-0 ${active ? "ring-2 ring-[color:var(--accent)] scale-[1.04]" : ""}`}
          >
            <span
              style={{ fontFamily: f.displayCss }}
              className="text-[16px] fg leading-none"
            >
              {f.previewChar}
            </span>
            <span className="text-[8.5px] fg-faint mt-0.5 truncate max-w-full px-0.5">
              {f.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ScalePicker({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (n: number) => void;
  options: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="inline-flex w-full gap-0.5 rounded-md border bd bg-elev p-0.5">
      {options.map((o) => {
        const active = Math.abs(value - o.value) < 0.01;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${active ? "bg-app fg shadow-card" : "fg-faint hover:fg"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── SHARED PRIMITIVES ─────────────────────────────────────────────────────

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-3 py-3 border-b bd">
      <div className="flex items-center gap-1.5 mb-2.5 text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold">
        {icon && <span className="text-accent">{icon}</span>}
        {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
        {label}
      </span>
      {children}
    </div>
  );
}
