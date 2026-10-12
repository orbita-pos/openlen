"use client";
// EL PANEL DE DISEÑO (spec 2026-10-11-modo-diseno-de-apps): los controles de
// Design Mode de v0 para el elemento elegido en el lienzo de una app. No guarda
// nada: lleva los pendientes, y «Aplicar» (en la barra de encima del lienzo)
// los manda a Len.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Copy,
  CornerLeftUp,
  Image as ImageIcon,
  Loader2,
  MousePointerClick,
  MoveVertical,
  Palette as PaletteIcon,
  Pencil,
  Redo2,
  RotateCcw,
  Sparkles,
  Square,
  Type as TypeIcon,
  Undo2,
  X,
} from "lucide-react";
import { ProvenanceReset, Section } from "../inspector-fields";
import { IconBtn } from "../ui";
import { DESIGN_PROPERTIES, type DesignProperty, type EditableField } from "@/lib/apps/design/types";
import { antesDe, changesOf, type DesignEditsState, type PendingElement } from "./design-edits";

/** El ancho del panel: el lienzo reserva lo mismo a la derecha (`PreviewArea.reservaDerecha`). */
export const DESIGN_PANEL_WIDTH = 320;

export const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
  "Playfair Display", "Merriweather", "DM Sans", "Space Grotesk", "Nunito", "Raleway",
] as const;

type Campo =
  | { field: DesignProperty; kind: "length" | "number" | "color" | "free" }
  | { field: DesignProperty; kind: "select"; options: readonly string[] };

const GRUPOS: readonly { id: string; campos: readonly Campo[] }[] = [
  { id: "typography", campos: [
    { field: "font-family", kind: "free" },
    { field: "font-size", kind: "length" },
    { field: "font-weight", kind: "select", options: ["300", "400", "500", "600", "700", "800", "900"] },
    { field: "line-height", kind: "length" },
    { field: "letter-spacing", kind: "length" },
    { field: "text-align", kind: "select", options: ["left", "center", "right", "justify"] },
    { field: "text-decoration-line", kind: "select", options: ["none", "underline", "line-through"] },
  ] },
  { id: "color", campos: [{ field: "color", kind: "color" }, { field: "background-color", kind: "color" }] },
  { id: "spacing", campos: (["margin", "padding"] as const).flatMap((b) =>
    (["top", "right", "bottom", "left"] as const).map((l) => ({ field: `${b}-${l}` as DesignProperty, kind: "length" as const }))) },
  { id: "border", campos: [
    { field: "border-color", kind: "color" },
    { field: "border-style", kind: "select", options: ["none", "solid", "dashed", "dotted"] },
    { field: "border-width", kind: "length" },
    { field: "border-radius", kind: "length" },
  ] },
  { id: "effects", campos: [{ field: "opacity", kind: "number" }, { field: "box-shadow", kind: "free" }] },
];

// Cobertura: los grupos tienen que cubrir TODAS las propiedades de la spec.
const CUBIERTAS = new Set(GRUPOS.flatMap((g) => g.campos.map((c) => c.field)));
if (process.env.NODE_ENV !== "production" && DESIGN_PROPERTIES.some((p) => !CUBIERTAS.has(p))) {
  throw new Error("design-panel: falta un control para una propiedad de DESIGN_PROPERTIES");
}

/** `rgb(29, 78, 216)` → `#1d4ed8`, para <input type="color">; lo demás, tal cual. */
function aHex(v: string): string {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  if (!m) return /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000";
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

export interface DesignPanelViewProps {
  readonly state: DesignEditsState;
  readonly selectedKey: string | null;
  readonly generalNote: string;
  readonly busy: boolean;
  readonly t: (key: string, values?: Record<string, string>) => string;
  readonly onChange: (key: string, field: EditableField, value: string) => void;
  readonly onPhoto: (key: string, file: File) => void;
  readonly onNote: (key: string, note: string) => void;
  readonly onGeneralNote: (note: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onResetElement: (key: string) => void;
  readonly onSelectParent: () => void;
  readonly onClose: () => void;
}

function valorDe(el: PendingElement, field: EditableField): string {
  const v = el.values[field];
  if (v !== undefined) return v;
  if (field === "text") return el.selection.text;
  if (field === "alt") return el.selection.image?.alt ?? "";
  return el.selection.styles[field] ?? "";
}

// LOS CONTROLES, con las clases del inspector de las páginas
// (`inspector-fields.tsx`), para que los dos paneles se lean como uno. Los
// campos de aquí siguen cambiando en cada tecla: la vista previa es del lienzo
// y no se guarda nada hasta «Aplicar».
const CAMPO =
  "min-w-0 bg-app border bd rounded-md px-2 py-1 text-[11.5px] fg transition placeholder:fg-faint " +
  "focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30";
const CAMPO_MONO = `${CAMPO} font-mono text-[11px]`;
const AREA = `${CAMPO} nice-scroll w-full py-1.5 text-[12px] leading-snug resize-y min-h-[52px]`;
const ETIQUETA = "text-[10.5px] fg-faint";
const SECUNDARIO =
  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]";

const ICONO_DEL_GRUPO: Record<string, ReactNode> = {
  typography: <TypeIcon size={11} />,
  color: <PaletteIcon size={11} />,
  spacing: <MoveVertical size={11} />,
  border: <Square size={11} />,
  effects: <Sparkles size={11} />,
};

export function DesignPanelView(p: DesignPanelViewProps) {
  const { t } = p;
  const el = p.selectedKey ? p.state.elements[p.selectedKey] : undefined;
  // El punto ámbar del inspector: «esto lo cambiaste»; encima, ↺ lo devuelve.
  const cambiados = new Set(el ? changesOf(el).map((c) => c.property) : []);
  const punto = (field: EditableField) =>
    el && (
      <ProvenanceReset dirty={cambiados.has(field)} title={t("was.resetControl")}
        onReset={() => p.onChange(el.selection.key, field, antesDe(el.selection, field))} />
    );
  return (
    <aside className="workspace-v2 flex h-full flex-col bg-side border-l bd fg" style={{ width: DESIGN_PANEL_WIDTH }} aria-label={t("designMode.title")}>
      {/* La cabecera del inspector de las páginas: iconos, no palabras sueltas. */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b bd px-3">
        <strong className="text-[13px]">{t("designMode.title")}</strong>
        <div className="flex items-center gap-0.5">
          <IconBtn size="sm" label={t("designMode.undo")} onClick={p.onUndo} disabled={p.state.past.length === 0}>
            <Undo2 size={14} />
          </IconBtn>
          <IconBtn size="sm" label={t("designMode.redo")} onClick={p.onRedo} disabled={p.state.future.length === 0}>
            <Redo2 size={14} />
          </IconBtn>
          {/* Sin tooltip: centrado bajo el último botón se saldría por el borde
              de la ventana, como el cerrar del inspector. */}
          <button type="button" onClick={p.onClose} aria-label={t("designMode.close")} title={t("designMode.close")}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md fg-muted transition hover:bg-hover hover:fg">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
        {!el ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <MousePointerClick size={18} className="fg-faint" />
            <p className="text-[12px] fg-muted leading-snug">{t("designMode.empty")}</p>
          </div>
        ) : (
          <>
            {/* Qué está elegido, como la ficha del inspector: la etiqueta y su texto. */}
            <div className="flex flex-col gap-2 border-b bd px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="inline-flex h-4 shrink-0 items-center rounded border bd bg-elev px-1.5 font-mono text-[9.5px] uppercase fg-muted">
                  {el.selection.tag}
                </span>
                {el.selection.text && <span className="truncate text-[11.5px] fg-muted">{el.selection.text}</span>}
              </div>
              {el.selection.copies > 1 && (
                <p className="flex items-start gap-1.5 text-[10.5px] leading-snug fg-faint">
                  <Copy size={11} className="mt-px shrink-0" />
                  {t("designMode.copies", { n: String(el.selection.copies) })}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className={SECUNDARIO} onClick={p.onSelectParent}>
                  <CornerLeftUp size={12} />
                  {t("designMode.parent")}
                </button>
                {changesOf(el).length > 0 && (
                  <button type="button" className={SECUNDARIO} onClick={() => p.onResetElement(el.selection.key)}>
                    <RotateCcw size={12} />
                    {t("designMode.resetElement")}
                  </button>
                )}
              </div>
            </div>
            {(el.selection.textEditable || el.selection.image) && (
              <Section label={t("designMode.group.content")} icon={<Pencil size={11} />}>
                {el.selection.textEditable && (
                  <textarea name="text" aria-label={t("designMode.prop.text")} rows={2} className={AREA} value={valorDe(el, "text")}
                    onChange={(e) => p.onChange(el.selection.key, "text", e.target.value)} />
                )}
                {el.selection.image && (
                  <>
                    {/* El selector de ficheros del navegador, escondido tras un botón como los del inspector. */}
                    <label className={`${SECUNDARIO} self-start cursor-pointer`}>
                      <ImageIcon size={12} />
                      {t("designMode.photo")}
                      <input type="file" accept="image/*" className="sr-only"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onPhoto(el.selection.key, f); }} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5"><span className={`${ETIQUETA} flex-1`}>{t("designMode.alt")}</span>{punto("alt")}</span>
                      <input name="alt" className={`${CAMPO} w-full`} value={valorDe(el, "alt")}
                        onChange={(e) => p.onChange(el.selection.key, "alt", e.target.value)} />
                    </label>
                  </>
                )}
              </Section>
            )}
            {GRUPOS.map((g) => (
              <Section key={g.id} label={t(`designMode.group.${g.id}`)} icon={ICONO_DEL_GRUPO[g.id]}>
                <div className="grid grid-cols-2 gap-2">
                  {g.campos.map((c) => {
                    const v = valorDe(el, c.field);
                    const set = (x: string) => p.onChange(el.selection.key, c.field, x);
                    const etiqueta = t(`designMode.prop.${c.field}`);
                    // Un color ocupa la fila, como el ColorField del inspector: muestra + valor.
                    if (c.kind === "color") {
                      return (
                        <label key={c.field} className="col-span-2 flex items-center gap-2">
                          <span className={`${ETIQUETA} flex-1`}>{etiqueta}</span>
                          {punto(c.field)}
                          <input type="color" aria-label={c.field} value={aHex(v)} onChange={(e) => set(e.target.value)}
                            className="h-7 w-8 shrink-0 cursor-pointer rounded border bd p-0 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30" />
                          <input name={c.field} className={`${CAMPO_MONO} w-[150px]`} value={v}
                            onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                        </label>
                      );
                    }
                    return (
                      <label key={c.field} className={`flex min-w-0 flex-col gap-1 ${c.field === "font-family" || c.field === "box-shadow" ? "col-span-2" : ""}`}>
                        <span className="flex min-w-0 items-center gap-1.5"><span className={`${ETIQUETA} flex-1 truncate`}>{etiqueta}</span>{punto(c.field)}</span>
                        {c.kind === "select" ? (
                          <span className="relative">
                            <select name={c.field} className={`${CAMPO} w-full appearance-none pr-6`} value={v} onChange={(e) => set(e.target.value)}>
                              {[v, ...c.options.filter((o) => o !== v)].map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 fg-faint" />
                          </span>
                        ) : c.field === "font-family" ? (
                          <>
                            <input name={c.field} list="openlen-design-fonts" className={`${CAMPO} w-full`} value={v}
                              onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                            <datalist id="openlen-design-fonts">
                              {[...el.selection.fonts, ...GOOGLE_FONTS.filter((f) => !el.selection.fonts.includes(f))].map((f) => <option key={f} value={f} />)}
                            </datalist>
                          </>
                        ) : (
                          <input name={c.field} className={`${CAMPO_MONO} w-full`} value={v}
                            onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                        )}
                      </label>
                    );
                  })}
                </div>
              </Section>
            ))}
            <div className="px-3 py-3">
              <label className="flex flex-col gap-1">
                <span className={ETIQUETA}>{t("designMode.noteElement")}</span>
                <textarea rows={2} className={AREA} maxLength={2000} value={el.note} onChange={(e) => p.onNote(el.selection.key, e.target.value)} />
              </label>
            </div>
          </>
        )}
      </div>
      <footer className="flex shrink-0 flex-col gap-1.5 border-t bd px-3 py-2.5">
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>{t("designMode.noteGeneral")}</span>
          <textarea rows={2} className={AREA} maxLength={2000} value={p.generalNote} onChange={(e) => p.onGeneralNote(e.target.value)} />
        </label>
        {/* «Descartar» y «Aplicar» van en la barra de encima del lienzo, la
            misma de los cambios sin aplicar de una página. */}
        {p.busy && (
          <p className="flex items-center gap-1.5 text-[10.5px] fg-faint">
            <Loader2 size={11} className="animate-spin" />
            {t("designMode.busy")}
          </p>
        )}
      </footer>
    </aside>
  );
}

export function DesignPanel(props: Omit<DesignPanelViewProps, "t">) {
  const tr = useTranslations("panelsProps");
  return <DesignPanelView {...props} t={(k, v) => tr(k, v)} />;
}
