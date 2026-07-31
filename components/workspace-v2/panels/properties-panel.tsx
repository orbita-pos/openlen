// Properties panel — the right-side contextual inspector.
//
// Deterministic, AI-free editing of an element's behaviour, metadata + style:
//   <a>            → href + "open in new tab"
//   <img>          → alt text
//   inside <form>  → submit config (notify email, success message, redirect)
//   every element  → Style: text color, background, corner radius
//   page           → SEO (<title>, description, OG image, favicon)
//
// Element/style edits flow through the iframe (openlen:apply-prop) and
// persist as HTML. Form config persists to ProjectData.settings.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import type { FormConfig, MusicSettings } from "@/lib/projects/types";
import { checkSeo, type SeoIssue, type SeoFixField } from "@/lib/seo-check";
import { defaultLogoDataUrl } from "@/lib/branding/default-logo";
import {
  THEME_PRESETS,
  THEME_CATEGORIES,
  type ThemePreset,
} from "@/lib/theme-presets";
import {
  buildCustomTematica,
  CUSTOM_TEMATICA_ID,
  readInlineToken,
  readTematicaBackdropUrl,
  TEMATICA_PRESETS,
  type TematicaPreset,
} from "@/lib/tematicas/presets";
import {
  deriveWorldFromFile,
  deriveWorldFromUrl,
  FALLBACK_ACCENT,
} from "@/lib/tematicas/derive-from-image";
import { imageFetchUrl } from "@/lib/image-fetch-url";
import { lookFromAccent } from "@/lib/palette-gen";
import { FACET_PROPS } from "../design-stash";
import { useToast } from "../toast";
import { normalizeHref } from "../normalize-href";
import { ReplaceAssetModal, type ImageTab } from "../replace-asset-modal";
import {
  ColorField,
  GradientControl,
  ProvenanceReset,
  RadiusField,
  Section,
  TextField,
  Toggle,
} from "../inspector-fields";
import {
  Activity,
  ExternalLink,
  Globe,
  ImageIcon,
  Inbox,
  Loader,
  MusicIcon,
  PaletteIcon,
  Pencil,
  Sparkles,
  WandSparkles,
  X,
} from "../icons";

export interface InspectSelection {
  path: string;
  tag: string;
  hint: string;
  props: {
    href?: string;
    target?: string;
    rel?: string;
    alt?: string;
    src?: string;
  };
  /** Document-order index of the enclosing <form>, or null when the
   *  selected element isn't inside a form. */
  formIndex?: number | null;
  /** The element's own cascade-safe style, read from getComputedStyle.
   *  Colors are #rrggbb (empty when transparent); borderRadius is an
   *  integer px string. */
  style?: {
    color?: string;
    backgroundColor?: string;
    borderRadius?: string;
    /** True when the element is painted by a gradient or image (which sits on
     *  top of background-color) — a solid color edit alone would be invisible. */
    hasBgImage?: boolean;
    hasGradient?: boolean;
    /** Raw CSS gradient when the fill is a PURE gradient (no url() layer) —
     *  round-trips into the gradient editor. */
    bgGradient?: string;
    /** The fill image url(), when the element's background is a picture. */
    bgImageUrl?: string;
    /** Border (top edge, assumed uniform): integer px width + hex color. */
    borderWidth?: string;
    borderColor?: string;
    /** Text styling: computed font-weight (e.g. "700"), font-style, text-align. */
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: string;
    /** True when the element carries data-ol-hidden (hidden in preview +
     *  published; shown dimmed + selectable while editing). */
    hidden?: boolean;
  };
  /** CSS properties currently stashed (data-ol-was) on this element — each
   *  entry has a pre-edit design value the reset affordance can restore. */
  wasProps?: string[];
}

export interface PageMeta {
  title: string;
  description: string;
  ogImage: string;
  favicon: string;
  /** Current light/dark mode of the page (the data-ol-mode attr on <html>).
   *  Drives the Looks-row Dark toggle. */
  mode?: "light" | "dark";
  /** True when the born-canonical engine lifted a model-designed :root.dark
   *  palette — the only case where flipping to dark stays coherent, so the
   *  deterministic Dark toggle is gated on it. */
  hasDark?: boolean;
}

interface PropertiesPanelProps {
  /** The currently selected element, or null for page-level editing. */
  selection: InspectSelection | null;
  /** Current <head> metadata mirrored from the iframe. */
  pageMeta: PageMeta | null;
  /** Config for the selected element's enclosing form, if any. */
  formConfig: FormConfig | null;
  /** Full HTML of the project — used to compute the live SEO health
   *  report rendered in the Page view. Omit when not available; the
   *  report section then hides itself. */
  html?: string;
  /** True when the user has opted out of the publish-time analytics
   *  snippet (ProjectData.settings.analyticsDisabled). The toggle in
   *  the Privacy section reflects + flips this. */
  analyticsDisabled?: boolean;
  /** Project ID — required for the Logo section (upload endpoint scopes
   *  by generationId). Omit on entry-mode panels with no real project. */
  projectId?: string;
  /** Project title — drives the "auto-generate" initial-letter logo. */
  projectTitle?: string;
  /** Current per-project logo URL (the projects.logoUrl column). Null
   *  when none is set; the Logo section then offers upload / paste /
   *  generate paths to populate it. */
  logoUrl?: string | null;
  onApplyElementProp: (path: string, name: string, value: string | null) => void;
  onApplyPageMeta: (field: keyof PageMeta, value: string) => void;
  onApplyFormConfig: (formIndex: number, patch: Partial<FormConfig>) => void;
  /** Set one inline-style property on the selected element (a CSS prop name
   *  + value; empty value removes it). */
  onApplyStyle: (path: string, prop: string, value: string) => void;
  /** Restore one or more CSS properties on the selected element from the
   *  data-ol-was stash (the pre-edit design value). No UI consumes this yet
   *  (Task 7 adds the reset affordance) — plumbing only. */
  onResetProps: (path: string, props: string[]) => void;
  /** Set the selected element's background: a solid color (replaces any
   *  gradient/image fill), an image fill (background-image, any element), a
   *  CSS gradient string, or clear the fill. */
  onApplyBg: (
    path: string,
    kind: "color" | "image" | "clear" | "gradient",
    value: string,
  ) => void;
  onApplyHide: (path: string, on: boolean) => void;
  /** Persist the analytics opt-out toggle. Omit to hide the Privacy
   *  section (e.g., on projects that can't be published yet). */
  onToggleAnalytics?: (disabled: boolean) => void;
  /** Persist the per-project logo. Pass null to clear it. Omit to hide
   *  the Logo section (entry-mode panels). */
  onApplyLogoUrl?: (logoUrl: string | null) => void;
  /** Apply a curated theme preset — a {token: value} bundle posted to the
   *  iframe as scope "theme-bundle", landing atomically. Omit to hide the
   *  Looks row (entry-mode panels with no real project). */
  onApplyLook?: (tokens: Record<string, string>) => void;
  /** Apply a Look in an EXPLICIT ink direction — used by "De tu logo", where
   *  the logo's own luminance decides light vs dark. */
  onApplyLookForMode?: (
    tokens: Record<string, string>,
    mode: "light" | "dark",
  ) => void;
  /** Flip the page's light/dark mode (deterministic; the panel only offers
   *  the toggle when pageMeta.hasDark — a designed dark palette exists). */
  onApplyThemeMode?: (mode: "light" | "dark") => void;
  /** Reset the page's theme to its original (as-loaded) tokens + mode.
   *  Omit to hide the reset affordance (no baseline captured yet). */
  onResetTheme?: () => void;
  /** The page's original accent hex — renders the "Original" bead's color. */
  originalAccent?: string;
  /** Motion Looks: the active preset ("calm" | "editorial" | "dramatic"),
   *  or undefined for none. Drives the Motion bead row's selected state. */
  motion?: string;
  /** Apply a motion preset (or "" to turn it off). Omit to hide the Motion
   *  row. Persists + previews live in the iframe. */
  onApplyMotion?: (preset: string) => void;
  /** Page music: the saved track, or undefined for none. Drives the Music
   *  section's state. */
  music?: MusicSettings;
  /** Persist the page-music track (null removes it). Omit to hide the Music
   *  section. Persists + previews live in the iframe. */
  onApplyMusic?: (music: MusicSettings | null) => void;
  /** Temática: the active kit id read off the document ("" = none). */
  tematica?: string;
  /** The active backdrop-variant id ("" = the kit's hero scene). */
  tematicaBg?: string;
  /** Install a full-page world (null removes it; backdropId picks a scene).
   *  Omit to hide the row. */
  onApplyTematica?: (kit: TematicaPreset | null, backdropId?: string) => void;
  /** Fire a test lead notification email to whichever address would
   *  receive the real one for this form. Resolves with the result so
   *  the FormView can render inline feedback. Omit to hide the button. */
  onSendTestFormEmail?: (
    formIndex: number,
  ) => Promise<{ ok: boolean; sentTo?: string; message?: string }>;
  /** Drop the element selection → back to page-level settings. */
  onClearSelection: () => void;
  /** Exit inspect mode entirely (closes the drawer). */
  onClose: () => void;
}

export function PropertiesPanel({
  selection,
  pageMeta,
  formConfig,
  html,
  analyticsDisabled,
  projectId,
  projectTitle,
  logoUrl,
  onApplyElementProp,
  onApplyPageMeta,
  onApplyFormConfig,
  onApplyStyle,
  onResetProps,
  onApplyBg,
  onApplyHide,
  onToggleAnalytics,
  onApplyLogoUrl,
  onApplyLook,
  onApplyLookForMode,
  onApplyThemeMode,
  onResetTheme,
  originalAccent,
  motion,
  onApplyMotion,
  music,
  onApplyMusic,
  tematica,
  tematicaBg,
  onApplyTematica,
  onSendTestFormEmail,
  onClearSelection,
  onClose,
}: PropertiesPanelProps) {
  const t = useTranslations("panelsProps");
  return (
    <aside className="h-full w-[300px] max-md:w-full shrink-0 bg-side border-l bd flex flex-col fade-slide">
      <div className="flex items-center justify-between px-3 h-10 border-b bd shrink-0">
        <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("header.inspector")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("header.closeInspector")}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
        {selection ? (
          // Keyed on path so the fields remount (and re-seed their draft
          // state) when the user picks a different element.
          <ElementView
            key={selection.path}
            selection={selection}
            formConfig={formConfig}
            projectId={projectId}
            accent={originalAccent}
            onApply={onApplyElementProp}
            onApplyFormConfig={onApplyFormConfig}
            onApplyStyle={onApplyStyle}
            onResetProps={onResetProps}
            onApplyBg={onApplyBg}
            onApplyHide={onApplyHide}
            onSendTestFormEmail={onSendTestFormEmail}
            onBack={onClearSelection}
          />
        ) : (
          <PageView
            pageMeta={pageMeta}
            html={html}
            analyticsDisabled={analyticsDisabled}
            projectId={projectId}
            projectTitle={projectTitle}
            logoUrl={logoUrl}
            onApply={onApplyPageMeta}
            onToggleAnalytics={onToggleAnalytics}
            onApplyLogoUrl={onApplyLogoUrl}
            onApplyLook={onApplyLook}
            onApplyLookForMode={onApplyLookForMode}
            onApplyThemeMode={onApplyThemeMode}
            onResetTheme={onResetTheme}
            originalAccent={originalAccent}
            motion={motion}
            onApplyMotion={onApplyMotion}
            music={music}
            onApplyMusic={onApplyMusic}
            tematica={tematica}
            tematicaBg={tematicaBg}
            onApplyTematica={onApplyTematica}
          />
        )}
      </div>
    </aside>
  );
}

function ElementView({
  selection,
  formConfig,
  projectId,
  accent,
  onApply,
  onApplyFormConfig,
  onApplyStyle,
  onResetProps,
  onApplyBg,
  onApplyHide,
  onSendTestFormEmail,
  onBack,
}: {
  selection: InspectSelection;
  formConfig: FormConfig | null;
  projectId?: string;
  /** The page's authored accent — seeds the gradient editor's presets. */
  accent?: string;
  onApply: (path: string, name: string, value: string | null) => void;
  onApplyFormConfig: (formIndex: number, patch: Partial<FormConfig>) => void;
  onApplyStyle: (path: string, prop: string, value: string) => void;
  onResetProps: (path: string, props: string[]) => void;
  onApplyBg: (
    path: string,
    kind: "color" | "image" | "clear" | "gradient",
    value: string,
  ) => void;
  onApplyHide: (path: string, on: boolean) => void;
  onSendTestFormEmail?: (
    formIndex: number,
  ) => Promise<{ ok: boolean; sentTo?: string; message?: string }>;
  onBack: () => void;
}) {
  const t = useTranslations("panelsProps");
  const { path, tag, hint, props, formIndex, style } = selection;
  return (
    <div className="fade-in">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 h-8 w-full text-[11px] fg-faint hover:fg hover:bg-hover transition border-b bd"
      >
        <Globe size={11} /> {t("element.pageSettings")}
      </button>
      <div className="px-3 py-2.5 border-b bd flex items-center gap-1.5">
        <span className="inline-flex items-center h-4 px-1.5 rounded bg-elev border bd text-[9.5px] font-mono fg-muted uppercase">
          {tag}
        </span>
        <span className="text-[11.5px] fg-muted truncate">{hint}</span>
      </div>
      {(selection.wasProps ?? []).length > 0 && (
        <button
          type="button"
          onClick={() => onResetProps(path, selection.wasProps ?? [])}
          className="mx-3 mt-2 inline-flex items-center gap-1.5 h-7 px-2 self-start rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]"
        >
          ↺ {t("was.resetElement")}
        </button>
      )}
      {tag === "a" && (
        <Section label={t("link.title")} icon={<ExternalLink size={11} />}>
          <TextField
            label={t("link.destination")}
            value={props.href ?? ""}
            placeholder={t("link.destinationPlaceholder")}
            mono
            onCommit={(v) => onApply(path, "href", normalizeHref(v))}
          />
          <Toggle
            label={t("link.openInNewTab")}
            on={(props.target ?? "") === "_blank"}
            onChange={(on) => onApply(path, "target", on ? "_blank" : null)}
          />
        </Section>
      )}
      {tag === "img" && (
        <Section label={t("image.title")} icon={<ImageIcon size={11} />}>
          <TextField
            label={t("image.altText")}
            value={props.alt ?? ""}
            placeholder={t("image.altPlaceholder")}
            onCommit={(v) => onApply(path, "alt", v)}
          />
          {props.src ? (
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1">
                {t("image.source")}
              </span>
              <p className="text-[10.5px] fg-faint font-mono break-all leading-snug">
                {props.src}
              </p>
            </div>
          ) : null}
        </Section>
      )}
      {typeof formIndex === "number" && (
        <FormView
          formIndex={formIndex}
          config={formConfig}
          onApply={onApplyFormConfig}
          onSendTestEmail={onSendTestFormEmail}
        />
      )}
      <StyleSection
        path={path}
        style={style}
        wasProps={selection.wasProps ?? []}
        projectId={projectId}
        accent={accent}
        onApply={onApplyStyle}
        onApplyBg={onApplyBg}
        onApplyHide={onApplyHide}
        onResetProps={onResetProps}
      />
    </div>
  );
}

// A square active-state icon button (bold / italic / align toggles).
function ToggleBtn({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
        on
          ? "bg-[var(--accent-strong)] text-white border-transparent"
          : "bd bg-app fg-muted hover:fg hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

// Three-line align glyph; the middle line shifts to indicate the direction.
function AlignIcon({ dir }: { dir: "left" | "center" | "right" }) {
  const midX = dir === "left" ? 1 : dir === "right" ? 5 : 3;
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="1" y="2" width="12" height="1.6" rx="0.8" />
      <rect x={midX} y="6.2" width="8" height="1.6" rx="0.8" />
      <rect x="1" y="10.4" width="12" height="1.6" rx="0.8" />
    </svg>
  );
}

// Border — width (px) + color, emitted as the `border` shorthand so one inline
// declaration wins the cascade. Width 0 / empty → `none` (off).
function BorderControl({
  width,
  color,
  reset,
  onApply,
}: {
  width: string;
  color: string;
  reset?: { dirty: boolean; title: string; onReset: () => void };
  onApply: (border: string) => void;
}) {
  const t = useTranslations("panelsProps");
  const [w, setW] = useState(width);
  const [c, setC] = useState(color || "#e5e7eb");
  useEffect(() => setW(width), [width]);
  useEffect(() => {
    if (color) setC(color);
  }, [color]);
  const commit = (nextW: string, nextC: string) => {
    const n = parseInt(nextW, 10);
    onApply(!n || n <= 0 ? "none" : `${n}px solid ${nextC}`);
  };
  const safeC = /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#e5e7eb";
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">{t("style.border")}</span>
      {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      <input
        type="color"
        value={safeC}
        aria-label={t("style.borderColor")}
        onChange={(e) => {
          setC(e.target.value);
          commit(w, e.target.value);
        }}
        className="h-7 w-8 rounded border bd cursor-pointer p-0 focus:outline-none"
      />
      <input
        type="text"
        inputMode="numeric"
        value={w}
        placeholder="0"
        aria-label={t("style.borderWidth")}
        onChange={(e) => setW(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => commit(w, c)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-[54px] bg-app border bd rounded-md px-2 py-1 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
      />
      <span className="text-[10px] fg-faint">px</span>
    </label>
  );
}

// Text — bold / italic / alignment, cascade-safe inline edits.
function TextStyleControl({
  fontWeight,
  fontStyle,
  textAlign,
  onApply,
}: {
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  onApply: (prop: string, value: string) => void;
}) {
  const t = useTranslations("panelsProps");
  const bold = parseInt(fontWeight || "400", 10) >= 600;
  const italic = fontStyle === "italic";
  const align =
    textAlign === "center" || textAlign === "right" ? textAlign : "left";
  const aligns: Array<"left" | "center" | "right"> = ["left", "center", "right"];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] fg-faint">{t("style.text")}</span>
      <div className="flex items-center gap-1">
        <ToggleBtn
          on={bold}
          label={t("style.bold")}
          onClick={() => onApply("font-weight", bold ? "400" : "700")}
        >
          <span className="text-[12px] font-bold">B</span>
        </ToggleBtn>
        <ToggleBtn
          on={italic}
          label={t("style.italic")}
          onClick={() => onApply("font-style", italic ? "normal" : "italic")}
        >
          <span className="text-[12px] italic" style={{ fontFamily: "Georgia, serif" }}>
            I
          </span>
        </ToggleBtn>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[color:var(--border)]" />
        {aligns.map((a) => (
          <ToggleBtn
            key={a}
            on={align === a}
            label={t(`style.align.${a}`)}
            onClick={() => onApply("text-align", a)}
          >
            <AlignIcon dir={a} />
          </ToggleBtn>
        ))}
      </div>
    </div>
  );
}

function StyleSection({
  path,
  style,
  wasProps,
  projectId,
  accent,
  onApply,
  onApplyBg,
  onApplyHide,
  onResetProps,
}: {
  path: string;
  style: InspectSelection["style"];
  /** CSS properties currently stashed (data-ol-was) on this element — drives
   *  the provenance dots + resets below. */
  wasProps: string[];
  projectId?: string;
  accent?: string;
  onApply: (path: string, prop: string, value: string) => void;
  onApplyBg: (
    path: string,
    kind: "color" | "image" | "clear" | "gradient",
    value: string,
  ) => void;
  onApplyHide: (path: string, on: boolean) => void;
  onResetProps: (path: string, props: string[]) => void;
}) {
  const t = useTranslations("panelsProps");
  const s = style ?? {};
  const [picker, setPicker] = useState(false);
  // Which image tab the modal opens on: "edit" (crop / remove-bg / AI on the
  // current fill) vs "openlen" (gallery, to swap the image entirely).
  const [pickerTab, setPickerTab] = useState<ImageTab>("openlen");
  const hasImage = !!s.bgImageUrl;
  const openPicker = (tab: ImageTab) => {
    setPickerTab(tab);
    setPicker(true);
  };
  const dirty = (prop: string) => wasProps.includes(prop);
  const resetOf = (prop: string) => ({
    dirty: dirty(prop),
    title: t("was.resetControl"),
    onReset: () => onResetProps(path, [prop]),
  });
  return (
    <Section
      label={t("style.title")}
      icon={<PaletteIcon size={11} />}
      action={
        FACET_PROPS.estilo.some((p) => wasProps.includes(p)) ? (
          <button
            type="button"
            onClick={() =>
              onResetProps(
                path,
                wasProps.filter((p) =>
                  (FACET_PROPS.estilo as readonly string[]).includes(p),
                ),
              )
            }
            className="text-[10px] fg-faint hover:fg underline-offset-2 hover:underline transition normal-case tracking-normal"
          >
            ↺ {t("was.resetStyle")}
          </button>
        ) : null
      }
    >
      <ColorField
        label={t("style.textColor")}
        value={s.color ?? ""}
        reset={resetOf("color")}
        onCommit={(v) => onApply(path, "color", v)}
      />
      {/* Background — a solid colour REPLACES any gradient/image so the change
          is actually visible, or fill the element's box with an image. */}
      <ColorField
        label={t("style.background")}
        value={s.backgroundColor ?? ""}
        reset={{
          dirty: dirty("background-color") || dirty("background-image"),
          title: t("was.resetControl"),
          onReset: () =>
            onResetProps(path, [
              "background-color",
              "background-image",
              "background-size",
              "background-position",
              "background-repeat",
            ]),
        }}
        onCommit={(v) => onApplyBg(path, "color", v)}
      />
      <div className="flex items-center gap-2 flex-wrap">
        {hasImage && (
          <button
            type="button"
            onClick={() => openPicker("edit")}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]"
          >
            <Pencil size={12} />
            {t("style.editImage")}
          </button>
        )}
        <button
          type="button"
          onClick={() => openPicker("openlen")}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]"
        >
          <ImageIcon size={12} />
          {hasImage ? t("style.changeImage") : t("style.fillImage")}
        </button>
        {hasImage && (
          <button
            type="button"
            onClick={() => onApplyBg(path, "clear", "")}
            className="text-[10.5px] fg-faint hover:fg underline-offset-2 hover:underline transition"
          >
            {t("style.removeImage")}
          </button>
        )}
      </div>
      {!hasImage && (
        <GradientControl
          value={s.bgGradient ?? ""}
          accent={accent}
          onApply={(css) => onApplyBg(path, "gradient", css)}
          onClear={() => onApplyBg(path, "clear", "")}
        />
      )}
      <BorderControl
        width={s.borderWidth ?? ""}
        color={s.borderColor ?? ""}
        reset={resetOf("border")}
        onApply={(border) => onApply(path, "border", border)}
      />
      <RadiusField
        value={s.borderRadius ?? ""}
        reset={resetOf("border-radius")}
        onCommit={(v) => onApply(path, "border-radius", v)}
      />
      <TextStyleControl
        fontWeight={s.fontWeight ?? ""}
        fontStyle={s.fontStyle ?? ""}
        textAlign={s.textAlign ?? ""}
        onApply={(prop, value) => onApply(path, prop, value)}
      />
      <div className="pt-0.5">
        <Toggle
          label={t("style.hide")}
          on={!!s.hidden}
          onChange={(on) => onApplyHide(path, on)}
        />
        {s.hidden && (
          <p className="mt-1 text-[10px] fg-faint leading-snug">
            {t("style.hideHint")}
          </p>
        )}
      </div>
      <ReplaceAssetModal
        open={picker}
        kind={picker ? "image" : null}
        projectId={projectId ?? null}
        currentSrc={s.bgImageUrl ?? null}
        initialTab={pickerTab}
        onClose={() => setPicker(false)}
        onPick={(payload) => {
          if (payload.url) onApplyBg(path, "image", payload.url);
          setPicker(false);
        }}
      />
    </Section>
  );
}

function FormView({
  formIndex,
  config,
  onApply,
  onSendTestEmail,
}: {
  formIndex: number;
  config: FormConfig | null;
  onApply: (formIndex: number, patch: Partial<FormConfig>) => void;
  onSendTestEmail?: (
    formIndex: number,
  ) => Promise<{ ok: boolean; sentTo?: string; message?: string }>;
}) {
  const t = useTranslations("panelsProps");
  return (
    <Section label={t("form.title")} icon={<Inbox size={11} />}>
      <TextField
        label={t("form.notifyEmail")}
        value={config?.notifyEmail ?? ""}
        placeholder={t("form.notifyEmailPlaceholder")}
        mono
        validate={(v) =>
          !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
            ? null
            : t("form.invalidEmail")
        }
        onCommit={(v) => onApply(formIndex, { notifyEmail: v })}
      />
      <TextField
        label={t("form.successMessage")}
        value={config?.successMessage ?? ""}
        placeholder={t("form.successMessagePlaceholder")}
        multiline
        onCommit={(v) => onApply(formIndex, { successMessage: v })}
      />
      <TextField
        label={t("form.redirect")}
        value={config?.redirectUrl ?? ""}
        placeholder={t("form.redirectPlaceholder")}
        mono
        validate={(v) =>
          !v.trim() || /^https?:\/\/\S+$/.test(v.trim())
            ? null
            : t("form.invalidUrl")
        }
        onCommit={(v) => onApply(formIndex, { redirectUrl: v })}
      />
      {onSendTestEmail && (
        <TestEmailButton formIndex={formIndex} onSend={onSendTestEmail} />
      )}
      <p className="text-[10.5px] fg-faint leading-relaxed pt-0.5">
        {t("form.applyNote")}
      </p>
    </Section>
  );
}

function TestEmailButton({
  formIndex,
  onSend,
}: {
  formIndex: number;
  onSend: (
    formIndex: number,
  ) => Promise<{ ok: boolean; sentTo?: string; message?: string }>;
}) {
  type State =
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent"; to: string }
    | { kind: "error"; message: string };
  const [state, setState] = useState<State>({ kind: "idle" });
  const t = useTranslations("panelsProps");

  const handleClick = async () => {
    setState({ kind: "sending" });
    try {
      const res = await onSend(formIndex);
      if (res.ok && res.sentTo) {
        setState({ kind: "sent", to: res.sentTo });
        window.setTimeout(() => setState({ kind: "idle" }), 6000);
      } else {
        setState({
          kind: "error",
          message: res.message ?? t("testEmail.sendFailed"),
        });
        window.setTimeout(() => setState({ kind: "idle" }), 8000);
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : t("testEmail.networkError"),
      });
      window.setTimeout(() => setState({ kind: "idle" }), 8000);
    }
  };

  return (
    <div className="pt-1">
      <button
        type="button"
        disabled={state.kind === "sending"}
        onClick={handleClick}
        className="w-full inline-flex items-center justify-center gap-1.5 h-7 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px] disabled:opacity-50"
      >
        {state.kind === "sending" ? t("testEmail.sending") : t("testEmail.send")}
      </button>
      {state.kind === "sent" && (
        <p className="mt-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 leading-relaxed">
          {t.rich("testEmail.sentTo", {
            to: state.to,
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
        </p>
      )}
      {state.kind === "error" && (
        <p className="mt-1 text-[10.5px] text-red-600 dark:text-red-400 leading-relaxed">
          {state.message}
        </p>
      )}
    </div>
  );
}

function PageView({
  pageMeta,
  html,
  analyticsDisabled,
  projectId,
  projectTitle,
  logoUrl,
  onApply,
  onToggleAnalytics,
  onApplyLogoUrl,
  onApplyLook,
  onApplyLookForMode,
  onApplyThemeMode,
  onResetTheme,
  originalAccent,
  motion,
  onApplyMotion,
  music,
  onApplyMusic,
  tematica,
  tematicaBg,
  onApplyTematica,
}: {
  pageMeta: PageMeta | null;
  html?: string;
  analyticsDisabled?: boolean;
  projectId?: string;
  projectTitle?: string;
  logoUrl?: string | null;
  onApply: (field: keyof PageMeta, value: string) => void;
  onToggleAnalytics?: (disabled: boolean) => void;
  onApplyLogoUrl?: (logoUrl: string | null) => void;
  onApplyLook?: (tokens: Record<string, string>) => void;
  onApplyLookForMode?: (
    tokens: Record<string, string>,
    mode: "light" | "dark",
  ) => void;
  onApplyThemeMode?: (mode: "light" | "dark") => void;
  onResetTheme?: () => void;
  originalAccent?: string;
  motion?: string;
  onApplyMotion?: (preset: string) => void;
  music?: MusicSettings;
  onApplyMusic?: (music: MusicSettings | null) => void;
  tematica?: string;
  tematicaBg?: string;
  onApplyTematica?: (kit: TematicaPreset | null, backdropId?: string) => void;
}) {
  // Recompute the SEO report on every HTML change. Cheap (DOMParser on
  // ~50-100KB), no debouncing needed — the parent only updates html when
  // the iframe has actually settled an edit.
  const report = useMemo(() => (html ? checkSeo(html) : null), [html]);
  const t = useTranslations("panelsProps");
  const rootRef = useRef<HTMLDivElement>(null);
  // Clicking an SEO issue jumps to (and focuses) the field that fixes it.
  const focusField = useCallback((field: SeoFixField) => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-meta-field="${field}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus();
    }
  }, []);

  if (!pageMeta) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[11.5px] fg-faint">{t("page.loading")}</p>
      </div>
    );
  }
  return (
    <div className="fade-in" ref={rootRef}>
      {onApplyTematica && (
        <TematicaSection
          active={tematica}
          activeBg={tematicaBg}
          onApply={onApplyTematica}
          projectId={projectId}
          html={html}
          mode={pageMeta?.mode ?? "light"}
        />
      )}
      {onApplyLook && (
        <ThemeSection
          mode={pageMeta.mode ?? "light"}
          hasDark={!!pageMeta.hasDark}
          onApplyLook={onApplyLook}
          onApplyLookForMode={onApplyLookForMode}
          onApplyMode={onApplyThemeMode}
          onReset={onResetTheme}
          originalAccent={originalAccent}
          logoUrl={logoUrl}
          projectId={projectId}
        />
      )}
      {onApplyMotion && <MotionSection motion={motion} onApply={onApplyMotion} />}
      {onApplyMusic && (
        <MusicSection projectId={projectId} music={music} onApply={onApplyMusic} />
      )}
      {report && <SeoHealthSection report={report} onFix={focusField} />}
      {onApplyLogoUrl && (
        <LogoSection
          projectId={projectId}
          projectTitle={projectTitle ?? ""}
          logoUrl={logoUrl ?? null}
          onApply={onApplyLogoUrl}
        />
      )}
      <Section label={t("page.title")} icon={<Globe size={11} />}>
        <TextField
          label={t("page.fieldTitle")}
          value={pageMeta.title}
          placeholder={t("page.fieldTitlePlaceholder")}
          dataField="title"
          onCommit={(v) => onApply("title", v)}
        />
        <TextField
          label={t("page.fieldDescription")}
          value={pageMeta.description}
          placeholder={t("page.fieldDescriptionPlaceholder")}
          multiline
          dataField="description"
          onCommit={(v) => onApply("description", v)}
        />
        <TextField
          label={t("page.fieldSocialImage")}
          value={pageMeta.ogImage}
          placeholder="https://…/cover.png"
          mono
          dataField="ogImage"
          onCommit={(v) => onApply("ogImage", v)}
        />
        <TextField
          label={t("page.fieldFavicon")}
          value={pageMeta.favicon}
          placeholder="https://…/icon.png"
          mono
          dataField="favicon"
          onCommit={(v) => onApply("favicon", v)}
        />
      </Section>
      {onToggleAnalytics && (
        <Section label={t("privacy.title")} icon={<Activity size={11} />}>
          <Toggle
            label={t("privacy.enableAnalytics")}
            on={!analyticsDisabled}
            onChange={(on) => onToggleAnalytics(!on)}
          />
          <p className="text-[10.5px] fg-faint leading-relaxed">
            {t("privacy.note")}
          </p>
        </Section>
      )}
      <p className="px-3 pt-3 pb-4 text-[10.5px] fg-faint leading-relaxed">
        {t("page.clickHint")}
      </p>
    </div>
  );
}

// A glossy 3D "bead" rendered from a single accent color — layered
// specular highlight + satin shimmer + radial body shading (light center →
// saturated → dark rim), with an inner highlight/shadow for depth. Lightened
// and darkened stops are derived from the accent via color-mix.
function orbStyle(accent: string): CSSProperties {
  const light = `color-mix(in srgb, ${accent} 26%, #ffffff)`;
  const dark = `color-mix(in srgb, ${accent} 64%, #000000)`;
  const deep = `color-mix(in srgb, ${accent} 46%, #000000)`;
  return {
    background: [
      // sharp specular hotspot — small, so the colour gradient dominates
      "radial-gradient(circle at 34% 26%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 17%)",
      // soft secondary sheen
      "radial-gradient(circle at 30% 23%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 33%)",
      // iridescent satin streaks (pearly shimmer)
      "conic-gradient(from 15deg at 50% 48%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.20) 55deg, rgba(255,255,255,0) 120deg, rgba(255,255,255,0.12) 180deg, rgba(255,255,255,0) 240deg, rgba(255,255,255,0.18) 310deg, rgba(255,255,255,0) 360deg)",
      // body shading — strong light → saturated → dark → deep rim
      `radial-gradient(circle at 42% 40%, ${light} 0%, ${accent} 42%, ${dark} 84%, ${deep} 100%)`,
    ].join(", "),
    boxShadow:
      "inset 0 2px 3px rgba(255,255,255,0.55), inset 0 -6px 10px rgba(0,0,0,0.38), inset 0 0 0 1px rgba(0,0,0,0.12), 0 2px 5px -1px rgba(0,0,0,0.30)",
  };
}

// The thin dark arc drawn around the picked bead (≈73% of the ring, gap at the
// lower-right) — the "selected" affordance.
function SelectedArc() {
  return (
    <svg
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden
      className="absolute -inset-[3px] pointer-events-none"
    >
      <circle
        cx="26"
        cy="26"
        r="24"
        stroke="var(--fg)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="112 151"
        transform="rotate(-118 26 26)"
        opacity="0.8"
      />
    </svg>
  );
}

// How many preset beads the compact inline row shows collapsed; the rest
// reveal inline when the "+" is expanded. Keeps the row tidy by default.
const INLINE_PRESET_MAX = 4;

// A glossy accent bead button + label — shared by presets, Original, and the
// generator preview.
function Bead({
  accent,
  label,
  title,
  selected,
  badge,
  onClick,
}: {
  accent: string;
  label: string;
  title?: string;
  selected?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={onClick}
      className="group flex w-10 flex-col items-center gap-1.5 focus:outline-none"
    >
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--accent-ring)]/60">
        <span
          className="absolute inset-0 rounded-full transition-transform duration-150 group-hover:scale-[1.08] group-active:scale-95"
          style={orbStyle(accent)}
        />
        {badge && (
          <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-app border bd text-[8px] leading-none fg-muted shadow-sm">
            {badge}
          </span>
        )}
        {selected && <SelectedArc />}
      </span>
      <span className="text-[9.5px] fg-faint leading-none truncate max-w-full">
        {label}
      </span>
    </button>
  );
}

// The dashed "+" / "−" bead that expands / collapses the full picker.
function ExpandBead({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex w-10 flex-col items-center gap-1.5">
      <button
        type="button"
        title={label}
        aria-expanded={expanded}
        onClick={onClick}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed bd bg-elev fg-faint transition hover:bg-hover hover:fg focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]/60"
      >
        <span className="text-[16px] leading-none -mt-px">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <span className="text-[9.5px] fg-faint leading-none truncate max-w-full">
        {label}
      </span>
    </div>
  );
}

// Seed generator — pick one color, get a coherent, contrast-guaranteed recolor
// (light + dark derived from the accent). Live preview bead; click to apply.
function LookGenerator({ onApply }: { onApply: (accent: string) => void }) {
  const t = useTranslations("panelsProps");
  const [seed, setSeed] = useState("#6d5efc");
  const previewAccent = useMemo(
    () => lookFromAccent(seed).light["--ol-accent"],
    [seed],
  );
  return (
    <div className="flex flex-col gap-2 border-t bd pt-3">
      <span className="text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold">
        {t("theme.generator")}
      </span>
      <div className="flex items-center gap-2.5">
        <input
          type="color"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          aria-label={t("theme.customColor")}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-full border bd bg-transparent p-0 overflow-hidden"
        />
        <Bead
          accent={previewAccent}
          label={t("theme.apply")}
          title={t("theme.apply")}
          onClick={() => onApply(seed)}
        />
        <p className="flex-1 text-[10px] fg-faint leading-snug">
          {t("theme.generatorHint")}
        </p>
      </div>
    </div>
  );
}

// Looks — the deterministic theme picker. Original (the page's own theme) is
// the first bead; curated presets are glossy accent beads; "+" expands the row
// inline (no modal) to the full categorized library + a seed generator. The
// picked bead gets a thin arc ring. Dark per look: applying a look in dark mode
// (or toggling dark) swaps in a contrast-guaranteed dark palette derived from
// the accent. The Dark toggle shows only where a designed dark exists (hasDark).
function ThemeSection({
  mode,
  hasDark,
  originalAccent,
  onApplyLook,
  onApplyLookForMode,
  onApplyMode,
  onReset,
  logoUrl,
  projectId,
}: {
  mode: "light" | "dark";
  hasDark: boolean;
  originalAccent?: string;
  onApplyLook: (tokens: Record<string, string>) => void;
  onApplyLookForMode?: (
    tokens: Record<string, string>,
    mode: "light" | "dark",
  ) => void;
  onApplyMode?: (mode: "light" | "dark") => void;
  onReset?: () => void;
  logoUrl?: string | null;
  projectId?: string;
}) {
  const t = useTranslations("panelsProps");
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const hasMore = THEME_PRESETS.length > INLINE_PRESET_MAX;

  const applyPreset = (preset: ThemePreset) => {
    onApplyLook(preset.tokens);
    setSelectedId(preset.id);
  };
  const applyGenerated = (accent: string) => {
    onApplyLook(lookFromAccent(accent).light);
    setSelectedId(null);
  };
  // "De tu logo" — read the logo's pixels (proxied when cross-origin), let
  // its dominant hue seed the AA-walked palette and its luminance pick the
  // ink direction: a black-and-orange logo yields a dark page with orange
  // accents, readable by construction.
  const applyFromLogo = async () => {
    if (!logoUrl || !onApplyLookForMode || logoBusy) return;
    setLogoError(false);
    setLogoBusy(true);
    try {
      const derived = await deriveWorldFromUrl(imageFetchUrl(logoUrl, projectId));
      onApplyLookForMode(lookFromAccent(derived.accent).light, derived.mode);
      setSelectedId("__logo__");
      toast.success(t("toast.themeFromLogo"));
    } catch {
      setLogoError(true);
      toast.error(t("toast.themeFromLogoError"));
    } finally {
      setLogoBusy(false);
    }
  };
  const logoBead =
    logoUrl && onApplyLookForMode ? (
      <button
        type="button"
        title={t("theme.fromLogoHint")}
        aria-pressed={selectedId === "__logo__"}
        onClick={() => void applyFromLogo()}
        className="group flex w-10 flex-col items-center gap-1.5 focus:outline-none"
      >
        <span
          className={
            "relative inline-flex h-8 w-8 items-center justify-center rounded-full border bd bg-elev overflow-hidden transition-transform duration-150 group-hover:scale-[1.08] group-active:scale-95 " +
            (selectedId === "__logo__"
              ? "ring-2 ring-[var(--accent-strong)]"
              : "")
          }
        >
          {logoBusy ? (
            <Loader size={12} className="animate-spin" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
          )}
          <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-app border bd text-[8px] leading-none fg-muted shadow-sm">
            ✨
          </span>
        </span>
        <span className="text-[9.5px] fg-faint leading-none truncate max-w-full">
          {t("theme.fromLogo")}
        </span>
      </button>
    ) : null;
  const originalBead = onReset ? (
    <Bead
      accent={originalAccent || "#9ca3af"}
      label={t("theme.reset")}
      title={t("theme.reset")}
      badge="↺"
      selected={selectedId === "__original__"}
      onClick={() => {
        onReset();
        setSelectedId("__original__");
      }}
    />
  ) : null;

  return (
    <Section label={t("theme.title")} icon={<PaletteIcon size={11} />}>
      {!expanded ? (
        <div className="flex flex-wrap gap-x-1.5 gap-y-3 pt-0.5">
          {originalBead}
          {logoBead}
          {THEME_PRESETS.slice(0, INLINE_PRESET_MAX).map((p) => (
            <Bead
              key={p.id}
              accent={p.tokens["--ol-accent"] ?? "#888888"}
              label={p.name}
              title={p.hint}
              selected={selectedId === p.id}
              onClick={() => applyPreset(p)}
            />
          ))}
          {hasMore && (
            <ExpandBead
              expanded={false}
              label={t("theme.more")}
              onClick={() => setExpanded(true)}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 pt-0.5">
          <div className="flex flex-wrap items-start gap-x-1.5 gap-y-3">
            {originalBead}
            {logoBead}
            <ExpandBead
              expanded
              label={t("theme.less")}
              onClick={() => setExpanded(false)}
            />
          </div>
          {THEME_CATEGORIES.map((cat) => {
            const inCat = THEME_PRESETS.filter((p) => p.category === cat);
            if (inCat.length === 0) return null;
            return (
              <div key={cat}>
                <span className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
                  {t(`theme.cat.${cat}`)}
                </span>
                <div className="flex flex-wrap gap-x-1.5 gap-y-3">
                  {inCat.map((p) => (
                    <Bead
                      key={p.id}
                      accent={p.tokens["--ol-accent"] ?? "#888888"}
                      label={p.name}
                      title={p.hint}
                      selected={selectedId === p.id}
                      onClick={() => applyPreset(p)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <LookGenerator onApply={applyGenerated} />
        </div>
      )}
      {hasDark && onApplyMode ? (
        <Toggle
          label={t("theme.darkMode")}
          on={mode === "dark"}
          onChange={(on) => onApplyMode(on ? "dark" : "light")}
        />
      ) : (
        <p className="text-[10.5px] fg-faint leading-relaxed">
          {t("theme.noDark")}
        </p>
      )}
      {logoError && (
        <p className="text-[10.5px] text-red-500 mt-2">{t("theme.fromLogoError")}</p>
      )}
    </Section>
  );
}

// Motion Looks — a second bead row under the Looks orbs. A different axis
// (movement, not color), so these are labeled pills rather than colour orbs:
// Off + Calm / Editorial / Dramatic. Picking one previews live in the iframe
// (motion-preview injector) and persists to data.settings.motion; the page
// looks identical frozen — the choreography only shows on scroll.
function MotionSection({
  motion,
  onApply,
}: {
  motion?: string;
  onApply: (preset: string) => void;
}) {
  const t = useTranslations("panelsProps");
  const PRESETS = ["calm", "editorial", "dramatic"] as const;
  const Pill = ({ value, label, hint }: { value: string; label: string; hint: string }) => {
    const on = (motion ?? "") === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        title={hint}
        onClick={() => onApply(value)}
        className={
          "h-7 px-2.5 rounded-full text-[11px] font-medium ring-1 transition " +
          (on
            ? "bg-[var(--accent-strong)] text-white ring-transparent"
            : "bg-elev fg-muted bd hover:fg")
        }
      >
        {label}
      </button>
    );
  };
  return (
    <Section label={t("motion.title")} icon={<Sparkles size={11} />}>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Pill value="" label={t("motion.off")} hint={t("motion.hint.off")} />
        {PRESETS.map((p) => (
          <Pill key={p} value={p} label={t(`motion.preset.${p}`)} hint={t(`motion.hint.${p}`)} />
        ))}
      </div>
      <p className="text-[10.5px] fg-faint leading-relaxed mt-2">{t("motion.note")}</p>
    </Section>
  );
}

// Temática — full-page worlds (the guns.lol / Carrd aesthetic). Image tiles
// rather than orbs: each kit IS its backdrop. Clicking the active tile turns
// the world off; "Ninguna" resets to the page's own baseline. The kit lands
// in the document (style + font link + html attr) via the inspect script and
// its tokens ride the Looks channel — see lib/tematicas/presets.ts.
function TematicaSection({
  active,
  activeBg,
  onApply,
  projectId,
  html,
  mode = "light",
}: {
  active?: string;
  activeBg?: string;
  onApply: (kit: TematicaPreset | null, backdropId?: string) => void;
  projectId?: string;
  html?: string;
  mode?: "light" | "dark";
}) {
  const t = useTranslations("panelsProps");
  const toast = useToast();
  const none = !active;
  const activeKit = TEMATICA_PRESETS.find((k) => k.id === active);
  const currentBg = activeBg || activeKit?.backdrops[0]?.id;
  const isCustom = active === CUSTOM_TEMATICA_ID;
  const customUrl = isCustom ? readTematicaBackdropUrl(html ?? "") : "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Tu foto" — upload the image + derive its world in parallel. The derived
  // accent/luminance feed lookFromAccent, whose AA walk makes the ink
  // readable no matter what the photo looks like.
  const pickCustom = useCallback(
    async (file: File | null) => {
      if (!file || !projectId) return;
      setError(null);
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const [res, derived] = await Promise.all([
          fetch(`/api/projects/${projectId}/assets`, { method: "POST", body: fd }),
          deriveWorldFromFile(file).catch(() => ({
            mode: "light" as const,
            accent: FALLBACK_ACCENT,
          })),
        ]);
        const data = (await res.json().catch(() => ({}))) as { url?: string };
        if (!res.ok || !data.url) throw new Error("upload failed");
        const tokens = lookFromAccent(derived.accent)[derived.mode];
        onApply(buildCustomTematica(data.url, { mode: derived.mode, tokens }));
        toast.success(t("toast.worldApplied"));
      } catch {
        setError(t("tematica.uploadError"));
        toast.error(t("toast.worldError"));
      } finally {
        setBusy(false);
      }
    },
    [projectId, onApply, t, toast],
  );

  // Manual ink-direction override for the custom world — rebuilds the same
  // backdrop with the AA-walked palette of the other mode.
  const flipCustom = useCallback(
    (nextMode: "light" | "dark") => {
      const url = readTematicaBackdropUrl(html ?? "");
      if (!url) return;
      const accent = readInlineToken(html ?? "", "--ol-accent") || FALLBACK_ACCENT;
      const tokens = lookFromAccent(accent)[nextMode];
      onApply(buildCustomTematica(url, { mode: nextMode, tokens }));
    },
    [html, onApply],
  );

  return (
    <Section label={t("tematica.title")} icon={<WandSparkles size={11} />}>
      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        <button
          type="button"
          aria-pressed={none}
          title={t("tematica.off")}
          onClick={() => onApply(null)}
          className={
            "h-14 rounded-lg text-[10px] font-medium transition flex items-center justify-center " +
            (none
              ? "ring-2 ring-[var(--accent-strong)] bg-elev fg"
              : "ring-1 bd border-dashed bg-elev fg-muted hover:fg")
          }
        >
          {t("tematica.off")}
        </button>
        {TEMATICA_PRESETS.map((k) => {
          const on = active === k.id;
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              title={`${k.name} — ${k.hint}`}
              onClick={() => onApply(on ? null : k)}
              className={
                "relative h-14 rounded-lg overflow-hidden transition text-left " +
                (on
                  ? "ring-2 ring-[var(--accent-strong)]"
                  : "ring-1 bd hover:ring-2")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={k.backdrops[0].thumb}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 px-1.5 pb-0.5 pt-2 text-[9.5px] font-semibold text-white truncate bg-gradient-to-t from-black/60 to-transparent">
                {k.name}
              </span>
            </button>
          );
        })}
        {isCustom && customUrl && (
          <button
            type="button"
            aria-pressed
            title={t("tematica.custom")}
            onClick={() => onApply(null)}
            className="relative h-14 rounded-lg overflow-hidden transition text-left ring-2 ring-[var(--accent-strong)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={customUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 px-1.5 pb-0.5 pt-2 text-[9.5px] font-semibold text-white truncate bg-gradient-to-t from-black/60 to-transparent">
              {t("tematica.custom")}
            </span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void pickCustom(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy || !projectId}
          title={t("tematica.custom")}
          onClick={() => fileRef.current?.click()}
          className="h-14 rounded-lg text-[10px] font-medium transition flex flex-col items-center justify-center gap-1 ring-1 bd border-dashed bg-elev fg-muted hover:fg disabled:opacity-50"
        >
          {busy ? (
            <Loader size={13} className="animate-spin" />
          ) : (
            <ImageIcon size={13} />
          )}
          {busy ? t("tematica.uploading") : t("tematica.custom")}
        </button>
      </div>
      {isCustom && (
        <div className="mt-2 flex items-center gap-1.5">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => flipCustom(m)}
              className={
                "h-7 px-2.5 rounded-full text-[11px] font-medium ring-1 transition " +
                (mode === m
                  ? "bg-[var(--accent-strong)] text-white ring-transparent"
                  : "bg-elev fg-muted bd hover:fg")
              }
            >
              {t(`tematica.${m}`)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[10.5px] text-red-500 mt-2">{error}</p>}
      {activeKit && activeKit.backdrops.length > 1 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
            {t("tematica.bg")}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {activeKit.backdrops.map((b) => {
              const on = currentBg === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  title={b.id}
                  onClick={() => onApply(activeKit, b.id)}
                  className={
                    "relative h-10 rounded-md overflow-hidden transition " +
                    (on
                      ? "ring-2 ring-[var(--accent-strong)]"
                      : "ring-1 bd hover:ring-2")
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-[10.5px] fg-faint leading-relaxed mt-2">
        {t("tematica.note")}
      </p>
    </Section>
  );
}

// Page music — the floating tap-to-play player (guns.lol-style page song).
// Upload a track (audio goes through the project-assets endpoint, stored
// as-is), optionally retitle it + add a cover. The player previews live in
// the iframe (music-preview injector) and persists to data.settings.music;
// it reaches the published page via the publish-time bake, skinned by the
// page's own --ol-* tokens.
function MusicSection({
  projectId,
  music,
  onApply,
}: {
  projectId?: string;
  music?: MusicSettings;
  onApply: (music: MusicSettings | null) => void;
}) {
  const t = useTranslations("panelsProps");
  const [busy, setBusy] = useState<"track" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File): Promise<string> => {
      if (!projectId) throw new Error("no project");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/assets`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!res.ok || !data.url) throw new Error(data.message || "upload failed");
      return data.url;
    },
    [projectId],
  );

  const pickTrack = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      setBusy("track");
      try {
        const url = await upload(file);
        const base = file.name.replace(/\.[^.]+$/, "").slice(0, 120).trim();
        onApply({
          src: url,
          title: music?.title || base || undefined,
          cover: music?.cover,
        });
      } catch {
        setError(t("music.uploadError"));
      } finally {
        setBusy(null);
      }
    },
    [upload, onApply, music?.title, music?.cover, t],
  );

  const pickCover = useCallback(
    async (file: File | null) => {
      if (!file || !music) return;
      setError(null);
      setBusy("cover");
      try {
        const url = await upload(file);
        onApply({ ...music, cover: url });
      } catch {
        setError(t("music.uploadError"));
      } finally {
        setBusy(null);
      }
    },
    [upload, onApply, music, t],
  );

  return (
    <Section label={t("music.title")} icon={<MusicIcon size={11} />}>
      <input
        ref={trackInputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav"
        className="hidden"
        onChange={(e) => {
          void pickTrack(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void pickCover(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {!music ? (
        <>
          <button
            type="button"
            disabled={busy !== null || !projectId}
            onClick={() => trackInputRef.current?.click()}
            className="w-full h-8 rounded-lg border border-dashed bd text-[11.5px] fg-muted hover:fg transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {busy === "track" ? (
              <>
                <Loader size={12} className="animate-spin" />
                {t("music.uploading")}
              </>
            ) : (
              t("music.upload")
            )}
          </button>
          <p className="text-[10.5px] fg-faint">{t("music.formats")}</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title={music.cover ? t("music.changeCover") : t("music.addCover")}
              disabled={busy !== null}
              onClick={() => coverInputRef.current?.click()}
              className="w-9 h-9 shrink-0 rounded-lg overflow-hidden bg-elev bd ring-1 flex items-center justify-center fg-muted hover:fg transition disabled:opacity-50"
            >
              {busy === "cover" ? (
                <Loader size={12} className="animate-spin" />
              ) : music.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={music.cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <MusicIcon size={14} />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <TextField
                label={t("music.trackTitle")}
                value={music.title ?? ""}
                onCommit={(v) =>
                  onApply({ ...music, title: v.trim().slice(0, 120) || undefined })
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => trackInputRef.current?.click()}
              className="h-7 px-2.5 rounded-full text-[11px] font-medium ring-1 bg-elev fg-muted bd hover:fg transition disabled:opacity-50"
            >
              {busy === "track" ? t("music.uploading") : t("music.replace")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onApply(null)}
              className="h-7 px-2.5 rounded-full text-[11px] font-medium ring-1 bg-elev fg-muted bd hover:fg transition disabled:opacity-50"
            >
              {t("music.remove")}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[10.5px] text-red-500">{error}</p>}
      <p className="text-[10.5px] fg-faint leading-relaxed mt-1">{t("music.note")}</p>
    </Section>
  );
}

function SeoHealthSection({
  report,
  onFix,
}: {
  report: { score: number; total: number; issues: SeoIssue[] };
  onFix?: (field: SeoFixField) => void;
}) {
  const t = useTranslations("panelsProps");
  const { score, total, issues } = report;
  const passing = score === total;
  const ratio = total > 0 ? score / total : 0;
  const tone =
    ratio >= 0.9
      ? "ok"
      : ratio >= 0.7
        ? "warn"
        : "bad";
  return (
    <Section label={t("health.title")} icon={<Activity size={11} />}>
      <div className="flex items-center gap-2">
        <ScoreRing score={score} total={total} tone={tone} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] fg">
            <strong className="font-semibold tabular-nums">
              {score}/{total}
            </strong>{" "}
            <span className="fg-muted">{t("health.passing")}</span>
          </div>
          <div className="text-[10.5px] fg-faint mt-0.5">
            {passing
              ? t("health.healthy")
              : t("health.issuesToAddress", { count: issues.length })}
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <SeoIssueRow key={issue.code} issue={issue} onFix={onFix} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ScoreRing({
  score,
  total,
  tone,
}: {
  score: number;
  total: number;
  tone: "ok" | "warn" | "bad";
}) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? score / total : 0;
  const stroke = c * (1 - pct);
  const color =
    tone === "ok"
      ? "#22C55E"
      : tone === "warn"
        ? "#F59E0B"
        : "#EF4444";
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" className="shrink-0">
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth="3"
      />
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={stroke}
        transform="rotate(-90 17 17)"
      />
      <text
        x="17"
        y="20"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {score}
      </text>
    </svg>
  );
}

// Logo — the per-project favicon / brand mark. Three input modes
// (upload / paste / auto-generate) feed a single onApply callback that
// PATCHes /api/projects/[id] with the resolved URL. Live preview at 64x64.
function LogoSection({
  projectId,
  projectTitle,
  logoUrl,
  onApply,
}: {
  projectId?: string;
  projectTitle: string;
  logoUrl: string | null;
  onApply: (logoUrl: string | null) => void;
}) {
  const t = useTranslations("panelsProps");
  const [mode, setMode] = useState<"upload" | "url" | "auto">("upload");
  const [urlDraft, setUrlDraft] = useState(
    logoUrl && !logoUrl.startsWith("data:") ? logoUrl : "",
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (logoUrl && !logoUrl.startsWith("data:")) setUrlDraft(logoUrl);
  }, [logoUrl]);

  const preview = logoUrl || defaultLogoDataUrl(projectTitle || "Page");

  const onUploadClick = () => fileInputRef.current?.click();
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!projectId) {
      setError(t("logo.errorSaveFirst"));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("generationId", projectId);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.url) {
        setError(data?.error ?? t("logo.errorUploadStatus", { status: res.status }));
        return;
      }
      onApply(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logo.errorUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const onPasteCommit = () => {
    const v = urlDraft.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) {
      setError(t("logo.errorFullUrl"));
      return;
    }
    setError(null);
    onApply(v);
  };

  const onAutoGenerate = () => {
    setError(null);
    onApply(defaultLogoDataUrl(projectTitle || "Page"));
  };

  return (
    <Section label={t("logo.title")} icon={<ImageIcon size={11} />}>
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 h-16 w-16 rounded-lg overflow-hidden bg-elev border bd flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={t("logo.previewAlt")}
            className="w-full h-full object-contain"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] fg leading-snug">
            {logoUrl ? t("logo.custom") : t("logo.default")}
          </div>
          <div className="text-[10.5px] fg-faint leading-snug truncate">
            {logoUrl
              ? logoUrl.startsWith("data:")
                ? t("logo.inlineSvg")
                : new URL(logoUrl, "https://x").pathname.split("/").pop() ||
                  logoUrl
              : t("logo.usedAs")}
          </div>
        </div>
      </div>

      <div className="inline-flex items-center gap-0.5 rounded-md bg-elev border bd p-0.5 text-[10.5px]">
        {(["upload", "url", "auto"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`h-6 px-2 rounded transition focus-visible:ring-1 focus-visible:ring-[color:var(--accent-ring)]/40 focus:outline-none ${
              mode === m
                ? "bg-app fg shadow-sm"
                : "fg-muted hover:fg"
            }`}
          >
            {m === "upload"
              ? t("logo.tabUpload")
              : m === "url"
                ? t("logo.tabPasteUrl")
                : t("logo.tabAuto")}
          </button>
        ))}
      </div>

      {mode === "upload" && (
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
            onChange={onFileChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading || !projectId}
            onClick={onUploadClick}
            className="w-full inline-flex items-center justify-center gap-1.5 h-7 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px] disabled:opacity-50"
          >
            {uploading ? t("logo.uploading") : t("logo.chooseImage")}
          </button>
          <p className="text-[10.5px] fg-faint leading-relaxed">
            {t("logo.uploadHint")}
          </p>
        </div>
      )}

      {mode === "url" && (
        <div className="flex flex-col gap-1.5">
          <input
            type="url"
            value={urlDraft}
            placeholder="https://yourdomain.com/logo.png"
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={onPasteCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-full bg-app border bd rounded-md px-2 py-1.5 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 placeholder:fg-faint"
          />
          <p className="text-[10.5px] fg-faint leading-relaxed">
            {t("logo.urlHint")}
          </p>
        </div>
      )}

      {mode === "auto" && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onAutoGenerate}
            className="w-full inline-flex items-center justify-center gap-1.5 h-7 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]"
          >
            {t("logo.generateFromTitle")}
          </button>
          <p className="text-[10.5px] fg-faint leading-relaxed">
            {t("logo.autoHint", { title: projectTitle || t("logo.defaultTitleFallback") })}
          </p>
        </div>
      )}

      {error && (
        <p className="text-[10.5px] text-red-600 dark:text-red-400 leading-relaxed">
          {error}
        </p>
      )}

      {logoUrl && (
        <button
          type="button"
          onClick={() => {
            setUrlDraft("");
            setError(null);
            onApply(null);
          }}
          className="self-start text-[10.5px] fg-faint hover:fg underline-offset-2 hover:underline transition"
        >
          {t("logo.clear")}
        </button>
      )}
    </Section>
  );
}

function SeoIssueRow({
  issue,
  onFix,
}: {
  issue: SeoIssue;
  onFix?: (field: SeoFixField) => void;
}) {
  const dotColor = issue.level === "error" ? "bg-red-500" : "bg-amber-500";
  const dot = (
    <span
      className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${dotColor}`}
      aria-hidden
    />
  );
  const field = issue.fixField;
  if (field && onFix) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onFix(field)}
          className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-[10.5px] fg-muted hover:fg hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--accent-ring)]/40 focus:outline-none transition leading-relaxed"
        >
          {dot}
          <span className="flex-1">{issue.message}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-1.5 px-1 py-0.5 text-[10.5px] fg-muted leading-relaxed">
      {dot}
      <span className="flex-1">{issue.message}</span>
    </li>
  );
}

// Tiny re-export so callers that pass an issue around without importing
// the lib don't have to dig for the type. Kept here to centralize the
// PropertiesPanel's outward API surface.
export type { SeoFixField };


