"use client";
// EL PANEL DE DISEÑO (spec 2026-10-11-modo-diseno-de-apps): los controles de
// Design Mode de v0 para el elemento elegido en el lienzo de una app. No guarda
// nada: lleva los pendientes y «Aplicar» los manda a Len.
import { useTranslations } from "next-intl";
import { DESIGN_PROPERTIES, type DesignProperty, type EditableField } from "@/lib/apps/design/types";
import { changesOf, pendingCount, type DesignEditsState, type PendingElement } from "./design-edits";

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
  readonly onResetAll: () => void;
  readonly onSelectParent: () => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
}

function valorDe(el: PendingElement, field: EditableField): string {
  const v = el.values[field];
  if (v !== undefined) return v;
  if (field === "text") return el.selection.text;
  if (field === "alt") return el.selection.image?.alt ?? "";
  return el.selection.styles[field] ?? "";
}

export function DesignPanelView(p: DesignPanelViewProps) {
  const { t } = p;
  const el = p.selectedKey ? p.state.elements[p.selectedKey] : undefined;
  const pendientes = pendingCount(p.state);
  const cls = "w-full rounded-md border bd bg-elev px-2 py-1 text-[12.5px] fg";
  return (
    <aside className="workspace-v2 flex h-full w-[320px] flex-col bg-base fg" aria-label={t("designMode.title")}>
      <header className="flex items-center justify-between border-b bd px-3 py-2">
        <strong className="text-[13px]">{t("designMode.title")}</strong>
        <div className="flex gap-1">
          <button type="button" onClick={p.onUndo} disabled={p.state.past.length === 0}>{t("designMode.undo")}</button>
          <button type="button" onClick={p.onRedo} disabled={p.state.future.length === 0}>{t("designMode.redo")}</button>
          <button type="button" onClick={p.onClose} aria-label={t("designMode.close")}>×</button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-[12.5px]">
        {!el ? (
          <p className="fg-muted">{t("designMode.empty")}</p>
        ) : (
          <>
            <p className="mb-1 font-semibold">{`<${el.selection.tag}>`}{el.selection.text ? ` «${el.selection.text}»` : ""}</p>
            {el.selection.copies > 1 && <p className="mb-2 fg-muted">{t("designMode.copies", { n: String(el.selection.copies) })}</p>}
            <button type="button" className="mb-2 underline" onClick={p.onSelectParent}>{t("designMode.parent")}</button>
            <section className="mb-3">
              <h3 className="mb-1 text-[11px] uppercase fg-muted">{t("designMode.group.content")}</h3>
              {el.selection.textEditable && (
                <textarea name="text" className={cls} value={valorDe(el, "text")}
                  onChange={(e) => p.onChange(el.selection.key, "text", e.target.value)} />
              )}
              {el.selection.image && (
                <>
                  <label className="mt-1 block">{t("designMode.photo")}
                    <input type="file" accept="image/*" className="block"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onPhoto(el.selection.key, f); }} />
                  </label>
                  <input name="alt" className={cls} value={valorDe(el, "alt")} placeholder={t("designMode.alt")}
                    onChange={(e) => p.onChange(el.selection.key, "alt", e.target.value)} />
                </>
              )}
            </section>
            {GRUPOS.map((g) => (
              <section key={g.id} className="mb-3">
                <h3 className="mb-1 text-[11px] uppercase fg-muted">{t(`designMode.group.${g.id}`)}</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.campos.map((c) => {
                    const v = valorDe(el, c.field);
                    const set = (x: string) => p.onChange(el.selection.key, c.field, x);
                    return (
                      <label key={c.field} className="flex flex-col gap-0.5">
                        <span className="fg-muted">{t(`designMode.prop.${c.field}`)}</span>
                        {c.kind === "select" ? (
                          <select name={c.field} className={cls} value={v} onChange={(e) => set(e.target.value)}>
                            {[v, ...c.options.filter((o) => o !== v)].map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : c.kind === "color" ? (
                          <span className="flex gap-1">
                            <input type="color" aria-label={c.field} value={aHex(v)} onChange={(e) => set(e.target.value)} />
                            <input name={c.field} className={cls} value={v} onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                          </span>
                        ) : c.field === "font-family" ? (
                          <>
                            <input name={c.field} list="openlen-design-fonts" className={cls} value={v}
                              onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                            <datalist id="openlen-design-fonts">
                              {[...el.selection.fonts, ...GOOGLE_FONTS.filter((f) => !el.selection.fonts.includes(f))].map((f) => <option key={f} value={f} />)}
                            </datalist>
                          </>
                        ) : (
                          <input name={c.field} className={cls} value={v}
                            onInput={(e) => set((e.target as HTMLInputElement).value)} onChange={() => {}} />
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
            <label className="block">
              <span className="fg-muted">{t("designMode.noteElement")}</span>
              <textarea className={cls} maxLength={2000} value={el.note} onChange={(e) => p.onNote(el.selection.key, e.target.value)} />
            </label>
            {changesOf(el).length > 0 && (
              <button type="button" className="mt-1 underline" onClick={() => p.onResetElement(el.selection.key)}>{t("designMode.resetElement")}</button>
            )}
          </>
        )}
      </div>
      <footer className="border-t bd px-3 py-2">
        <label className="block">
          <span className="fg-muted">{t("designMode.noteGeneral")}</span>
          <textarea className={cls} maxLength={2000} value={p.generalNote} onChange={(e) => p.onGeneralNote(e.target.value)} />
        </label>
        {p.busy && <p className="mt-1 fg-muted">{t("designMode.busy")}</p>}
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={p.onResetAll} disabled={pendientes === 0}>{t("designMode.resetAll")}</button>
          <button type="button" data-testid="design-apply" onClick={p.onApply}
            disabled={p.busy || (pendientes === 0 && !p.generalNote.trim())}
            className="rounded-[10px] bg-[var(--accent-strong)] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {t("designMode.apply", { n: String(pendientes) })}
          </button>
        </div>
      </footer>
    </aside>
  );
}

export function DesignPanel(props: Omit<DesignPanelViewProps, "t">) {
  const tr = useTranslations("panelsProps");
  return <DesignPanelView {...props} t={(k, v) => tr(k, v)} />;
}
