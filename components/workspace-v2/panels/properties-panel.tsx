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

import { useMemo, useState } from "react";
import type { FormConfig } from "@/lib/projects/types";
import { checkSeo, type SeoIssue, type SeoFixField } from "@/lib/seo-check";
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
  };
}

export interface PageMeta {
  title: string;
  description: string;
  ogImage: string;
  favicon: string;
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
  onApplyElementProp: (path: string, name: string, value: string | null) => void;
  onApplyPageMeta: (field: keyof PageMeta, value: string) => void;
  onApplyFormConfig: (formIndex: number, patch: Partial<FormConfig>) => void;
  /** Set one inline-style property on the selected element (a CSS prop name
   *  + value; empty value removes it). */
  onApplyStyle: (path: string, prop: string, value: string) => void;
  /** Persist the analytics opt-out toggle. Omit to hide the Privacy
   *  section (e.g., on projects that can't be published yet). */
  onToggleAnalytics?: (disabled: boolean) => void;
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
  onApplyElementProp,
  onApplyPageMeta,
  onApplyFormConfig,
  onApplyStyle,
  onToggleAnalytics,
  onSendTestFormEmail,
  onClearSelection,
  onClose,
}: PropertiesPanelProps) {
  return (
    <aside className="h-full w-[300px] shrink-0 bg-side border-l bd flex flex-col fade-slide">
      <div className="flex items-center justify-between px-3 h-10 border-b bd shrink-0">
        <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          Inspector
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
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
            onApply={onApplyElementProp}
            onApplyFormConfig={onApplyFormConfig}
            onApplyStyle={onApplyStyle}
            onSendTestFormEmail={onSendTestFormEmail}
            onBack={onClearSelection}
          />
        ) : (
          <PageView
            pageMeta={pageMeta}
            html={html}
            analyticsDisabled={analyticsDisabled}
            onApply={onApplyPageMeta}
            onToggleAnalytics={onToggleAnalytics}
          />
        )}
      </div>
    </aside>
  );
}

function ElementView({
  selection,
  formConfig,
  onApply,
  onApplyFormConfig,
  onApplyStyle,
  onSendTestFormEmail,
  onBack,
}: {
  selection: InspectSelection;
  formConfig: FormConfig | null;
  onApply: (path: string, name: string, value: string | null) => void;
  onApplyFormConfig: (formIndex: number, patch: Partial<FormConfig>) => void;
  onApplyStyle: (path: string, prop: string, value: string) => void;
  onSendTestFormEmail?: (
    formIndex: number,
  ) => Promise<{ ok: boolean; sentTo?: string; message?: string }>;
  onBack: () => void;
}) {
  const { path, tag, hint, props, formIndex, style } = selection;
  return (
    <div className="fade-in">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 h-8 w-full text-[11px] fg-faint hover:fg hover:bg-hover transition border-b bd"
      >
        <Globe size={11} /> Page settings
      </button>
      <div className="px-3 py-2.5 border-b bd flex items-center gap-1.5">
        <span className="inline-flex items-center h-4 px-1.5 rounded bg-elev border bd text-[9.5px] font-mono fg-muted uppercase">
          {tag}
        </span>
        <span className="text-[11.5px] fg-muted truncate">{hint}</span>
      </div>
      {tag === "a" && (
        <Section label="Link" icon={<ExternalLink size={11} />}>
          <TextField
            label="Destination"
            value={props.href ?? ""}
            placeholder="https://…  or  #section"
            mono
            onCommit={(v) => onApply(path, "href", v)}
          />
          <Toggle
            label="Open in new tab"
            on={(props.target ?? "") === "_blank"}
            onChange={(on) => onApply(path, "target", on ? "_blank" : null)}
          />
        </Section>
      )}
      {tag === "img" && (
        <Section label="Image" icon={<ImageIcon size={11} />}>
          <TextField
            label="Alt text"
            value={props.alt ?? ""}
            placeholder="Describe the image"
            onCommit={(v) => onApply(path, "alt", v)}
          />
          {props.src ? (
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1">
                Source
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
      <StyleSection path={path} style={style} onApply={onApplyStyle} />
    </div>
  );
}

function StyleSection({
  path,
  style,
  onApply,
}: {
  path: string;
  style: InspectSelection["style"];
  onApply: (path: string, prop: string, value: string) => void;
}) {
  const s = style ?? {};
  return (
    <Section label="Style" icon={<PaletteIcon size={11} />}>
      <ColorField
        label="Text color"
        value={s.color ?? ""}
        onCommit={(v) => onApply(path, "color", v)}
      />
      <ColorField
        label="Background"
        value={s.backgroundColor ?? ""}
        onCommit={(v) => onApply(path, "background-color", v)}
      />
      <RadiusField
        value={s.borderRadius ?? ""}
        onCommit={(v) => onApply(path, "border-radius", v)}
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
  return (
    <Section label="Form" icon={<Inbox size={11} />}>
      <TextField
        label="Notify email"
        value={config?.notifyEmail ?? ""}
        placeholder="Default: your account email"
        mono
        onCommit={(v) => onApply(formIndex, { notifyEmail: v })}
      />
      <TextField
        label="Success message"
        value={config?.successMessage ?? ""}
        placeholder="✓ Thanks — we got your message."
        multiline
        onCommit={(v) => onApply(formIndex, { successMessage: v })}
      />
      <TextField
        label="Redirect after submit"
        value={config?.redirectUrl ?? ""}
        placeholder="https://…/thank-you  (optional)"
        mono
        onCommit={(v) => onApply(formIndex, { redirectUrl: v })}
      />
      {onSendTestEmail && (
        <TestEmailButton formIndex={formIndex} onSend={onSendTestEmail} />
      )}
      <p className="text-[10.5px] fg-faint leading-relaxed pt-0.5">
        Form changes apply on your next deploy.
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
          message: res.message ?? "Couldn't send the test email.",
        });
        window.setTimeout(() => setState({ kind: "idle" }), 8000);
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error.",
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
        {state.kind === "sending" ? "Sending…" : "Send test email"}
      </button>
      {state.kind === "sent" && (
        <p className="mt-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 leading-relaxed">
          ✓ Test sent to <span className="font-mono">{state.to}</span>. Check
          inbox + spam folder.
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
  onApply,
  onToggleAnalytics,
}: {
  pageMeta: PageMeta | null;
  html?: string;
  analyticsDisabled?: boolean;
  onApply: (field: keyof PageMeta, value: string) => void;
  onToggleAnalytics?: (disabled: boolean) => void;
}) {
  // Recompute the SEO report on every HTML change. Cheap (DOMParser on
  // ~50-100KB), no debouncing needed — the parent only updates html when
  // the iframe has actually settled an edit.
  const report = useMemo(() => (html ? checkSeo(html) : null), [html]);

  if (!pageMeta) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[11.5px] fg-faint">Loading page settings…</p>
      </div>
    );
  }
  return (
    <div className="fade-in">
      {report && <SeoHealthSection report={report} />}
      <Section label="Page" icon={<Globe size={11} />}>
        <TextField
          label="Title"
          value={pageMeta.title}
          placeholder="Page title"
          onCommit={(v) => onApply("title", v)}
        />
        <TextField
          label="Description"
          value={pageMeta.description}
          placeholder="Short description for search results"
          multiline
          onCommit={(v) => onApply("description", v)}
        />
        <TextField
          label="Social image (OG)"
          value={pageMeta.ogImage}
          placeholder="https://…/cover.png"
          mono
          onCommit={(v) => onApply("ogImage", v)}
        />
        <TextField
          label="Favicon"
          value={pageMeta.favicon}
          placeholder="https://…/icon.png"
          mono
          onCommit={(v) => onApply("favicon", v)}
        />
      </Section>
      {onToggleAnalytics && (
        <Section label="Privacy" icon={<Activity size={11} />}>
          <Toggle
            label="Enable analytics"
            on={!analyticsDisabled}
            onChange={(on) => onToggleAnalytics(!on)}
          />
          <p className="text-[10.5px] fg-faint leading-relaxed">
            Anonymous pageviews + outbound clicks. No cookies, no IP storage,
            no consent banner. Applies on next publish.
          </p>
        </Section>
      )}
      <p className="px-3 pt-3 pb-4 text-[10.5px] fg-faint leading-relaxed">
        Hacé click en cualquier elemento de la página para editarlo.
      </p>
    </div>
  );
}

function SeoHealthSection({
  report,
}: {
  report: { score: number; total: number; issues: SeoIssue[] };
}) {
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
    <Section label="Page health" icon={<Activity size={11} />}>
      <div className="flex items-center gap-2">
        <ScoreRing score={score} total={total} tone={tone} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] fg">
            <strong className="font-semibold tabular-nums">
              {score}/{total}
            </strong>{" "}
            <span className="fg-muted">passing</span>
          </div>
          <div className="text-[10.5px] fg-faint mt-0.5">
            {passing
              ? "Page looks healthy."
              : issues.length === 1
                ? "1 issue to address."
                : `${issues.length} issues to address.`}
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <SeoIssueRow key={issue.code} issue={issue} />
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

function SeoIssueRow({ issue }: { issue: SeoIssue }) {
  const dotColor =
    issue.level === "error" ? "bg-red-500" : "bg-amber-500";
  return (
    <li
      data-fix-field={issue.fixField ?? undefined}
      className="flex items-start gap-1.5 px-1 py-0.5 text-[10.5px] fg-muted leading-relaxed"
    >
      <span
        className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${dotColor}`}
        aria-hidden
      />
      <span className="flex-1">{issue.message}</span>
    </li>
  );
}

// Tiny re-export so callers that pass an issue around without importing
// the lib don't have to dig for the type. Kept here to centralize the
// PropertiesPanel's outward API surface.
export type { SeoFixField };


