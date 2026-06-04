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
import type { FormConfig } from "@/lib/projects/types";
import { checkSeo, type SeoIssue, type SeoFixField } from "@/lib/seo-check";
import { defaultLogoDataUrl } from "@/lib/branding/default-logo";
import {
  THEME_PRESETS,
  THEME_CATEGORIES,
  type ThemePreset,
} from "@/lib/theme-presets";
import { lookFromAccent } from "@/lib/palette-gen";
import { ReplaceAssetModal } from "../replace-asset-modal";
import {
  ColorField,
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
  PaletteIcon,
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
    /** The fill image url(), when the element's background is a picture. */
    bgImageUrl?: string;
    /** Border (top edge, assumed uniform): integer px width + hex color. */
    borderWidth?: string;
    borderColor?: string;
    /** Text styling: computed font-weight (e.g. "700"), font-style, text-align. */
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: string;
  };
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
  /** Set the selected element's background: a solid color (replaces any
   *  gradient/image fill), an image fill (background-image, any element), or
   *  clear the fill. */
  onApplyBg: (path: string, kind: "color" | "image" | "clear", value: string) => void;
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
  /** Flip the page's light/dark mode (deterministic; the panel only offers
   *  the toggle when pageMeta.hasDark — a designed dark palette exists). */
  onApplyThemeMode?: (mode: "light" | "dark") => void;
  /** Reset the page's theme to its original (as-loaded) tokens + mode.
   *  Omit to hide the reset affordance (no baseline captured yet). */
  onResetTheme?: () => void;
  /** The page's original accent hex — renders the "Original" bead's color. */
  originalAccent?: string;
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
  onApplyBg,
  onToggleAnalytics,
  onApplyLogoUrl,
  onApplyLook,
  onApplyThemeMode,
  onResetTheme,
  originalAccent,
  onSendTestFormEmail,
  onClearSelection,
  onClose,
}: PropertiesPanelProps) {
  const t = useTranslations("panelsProps");
  return (
    <aside className="h-full w-[300px] shrink-0 bg-side border-l bd flex flex-col fade-slide">
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
            onApply={onApplyElementProp}
            onApplyFormConfig={onApplyFormConfig}
            onApplyStyle={onApplyStyle}
            onApplyBg={onApplyBg}
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
            onApplyThemeMode={onApplyThemeMode}
            onResetTheme={onResetTheme}
            originalAccent={originalAccent}
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
  onApply,
  onApplyFormConfig,
  onApplyStyle,
  onApplyBg,
  onSendTestFormEmail,
  onBack,
}: {
  selection: InspectSelection;
  formConfig: FormConfig | null;
  projectId?: string;
  onApply: (path: string, name: string, value: string | null) => void;
  onApplyFormConfig: (formIndex: number, patch: Partial<FormConfig>) => void;
  onApplyStyle: (path: string, prop: string, value: string) => void;
  onApplyBg: (path: string, kind: "color" | "image" | "clear", value: string) => void;
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
      {tag === "a" && (
        <Section label={t("link.title")} icon={<ExternalLink size={11} />}>
          <TextField
            label={t("link.destination")}
            value={props.href ?? ""}
            placeholder={t("link.destinationPlaceholder")}
            mono
            onCommit={(v) => onApply(path, "href", v)}
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
        projectId={projectId}
        onApply={onApplyStyle}
        onApplyBg={onApplyBg}
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
  onApply,
}: {
  width: string;
  color: string;
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
  projectId,
  onApply,
  onApplyBg,
}: {
  path: string;
  style: InspectSelection["style"];
  projectId?: string;
  onApply: (path: string, prop: string, value: string) => void;
  onApplyBg: (path: string, kind: "color" | "image" | "clear", value: string) => void;
}) {
  const t = useTranslations("panelsProps");
  const s = style ?? {};
  const [picker, setPicker] = useState(false);
  const hasImage = !!s.bgImageUrl;
  return (
    <Section label={t("style.title")} icon={<PaletteIcon size={11} />}>
      <ColorField
        label={t("style.textColor")}
        value={s.color ?? ""}
        onCommit={(v) => onApply(path, "color", v)}
      />
      {/* Background — a solid colour REPLACES any gradient/image so the change
          is actually visible, or fill the element's box with an image. */}
      <ColorField
        label={t("style.background")}
        value={s.backgroundColor ?? ""}
        onCommit={(v) => onApplyBg(path, "color", v)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPicker(true)}
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
      {s.hasGradient && !hasImage && (
        <p className="text-[10px] fg-faint leading-snug">
          {t("style.gradientHint")}
        </p>
      )}
      <BorderControl
        width={s.borderWidth ?? ""}
        color={s.borderColor ?? ""}
        onApply={(border) => onApply(path, "border", border)}
      />
      <RadiusField
        value={s.borderRadius ?? ""}
        onCommit={(v) => onApply(path, "border-radius", v)}
      />
      <TextStyleControl
        fontWeight={s.fontWeight ?? ""}
        fontStyle={s.fontStyle ?? ""}
        textAlign={s.textAlign ?? ""}
        onApply={(prop, value) => onApply(path, prop, value)}
      />
      <ReplaceAssetModal
        open={picker}
        kind={picker ? "image" : null}
        projectId={projectId ?? null}
        currentSrc={s.bgImageUrl ?? null}
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
  onApplyThemeMode,
  onResetTheme,
  originalAccent,
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
  onApplyThemeMode?: (mode: "light" | "dark") => void;
  onResetTheme?: () => void;
  originalAccent?: string;
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
      {onApplyLook && (
        <ThemeSection
          mode={pageMeta.mode ?? "light"}
          hasDark={!!pageMeta.hasDark}
          onApplyLook={onApplyLook}
          onApplyMode={onApplyThemeMode}
          onReset={onResetTheme}
          originalAccent={originalAccent}
        />
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
  onApplyMode,
  onReset,
}: {
  mode: "light" | "dark";
  hasDark: boolean;
  originalAccent?: string;
  onApplyLook: (tokens: Record<string, string>) => void;
  onApplyMode?: (mode: "light" | "dark") => void;
  onReset?: () => void;
}) {
  const t = useTranslations("panelsProps");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hasMore = THEME_PRESETS.length > INLINE_PRESET_MAX;

  const applyPreset = (preset: ThemePreset) => {
    onApplyLook(preset.tokens);
    setSelectedId(preset.id);
  };
  const applyGenerated = (accent: string) => {
    onApplyLook(lookFromAccent(accent).light);
    setSelectedId(null);
  };
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


