// Unified left sidebar — 6 modes (chat, content, templates, pages, versions,
// brief). Collapsible to a 48px icon-rail. The artifact replaced separate
// left+right sidebars with this single panel; we keep that decision.
//
// "Design" used to be a tab with palette/typography/layout swatches; it was
// removed once Chat became the sole design surface for flat projects and the
// slot-based design controls for rich projects never made it into V2 in
// practice. If/when rich-project design controls land here, fold them into
// Chat as quick-prompts rather than re-adding a separate tab.
//
// "Brief" used to be a multi-user Comments mock; pivoted to a per-project
// AI-injected context field (Claude.ai "Project instructions" equivalent).

"use client";

import {
  BarChart3,
  ChatIcon,
  FileText,
  Grid3,
  HistoryIcon,
  Inbox,
  Layers,
  PanelLeft,
  PanelRight,
  Sparkles,
} from "./icons";
import type { Section } from "./mock-data";
import { BriefPanel } from "./panels/brief-panel";
import { InsightsPanel } from "./panels/insights-panel";
import type { BriefFormState } from "@/components/workspace/types";
import type { AIModel } from "@/lib/ai-provider";
import type { StoredChatTurn } from "@/lib/projects/types";
import { AiBriefPanel } from "./panels/ai-brief-panel";
import {
  ChatPanel,
  type ScopedSelection,
} from "./panels/chat-panel";
import { PagesPanel } from "./panels/pages-panel";
import { PastePanel } from "./panels/paste-panel";
import { SectionsPanel } from "./panels/sections-panel";
import { SubmissionsPanel } from "./panels/submissions-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { VersionsPanel } from "./panels/versions-panel";
import type { SectionSpec } from "./sections-data";
import { IconBtn, Tooltip } from "./ui";

import type { ComponentType } from "react";

export type SidebarMode =
  | "chat"
  | "templates"
  | "library"
  | "pages"
  | "leads"
  | "insights"
  | "versions"
  | "brief";

interface ModeTab {
  id: SidebarMode;
  icon: ComponentType<{ size?: number }>;
  label: string;
  title: string;
}

const MODE_TABS: ModeTab[] = [
  { id: "chat", icon: ChatIcon, label: "Chat", title: "Chat with Orchestra" },
  { id: "templates", icon: Grid3, label: "Templates", title: "Start from a template" },
  { id: "library", icon: Layers, label: "Library", title: "Insert a section" },
  { id: "pages", icon: FileText, label: "Pages", title: "Recent projects" },
  { id: "leads", icon: Inbox, label: "Leads", title: "Form submissions" },
  { id: "insights", icon: BarChart3, label: "Insights", title: "Page analytics" },
  { id: "versions", icon: HistoryIcon, label: "Versions", title: "Version history" },
  { id: "brief", icon: Sparkles, label: "Brief", title: "Project brief (AI context)" },
];

interface LeftSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mode: SidebarMode;
  setMode: (m: SidebarMode) => void;
  sections: Section[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onUpdateSection: (id: string, fields: Section["fields"]) => void;
  /** Called when the user clicks a template card — sets the previewed
   *  template in the parent so PreviewArea loads its URL. */
  onPreviewTemplate?: (t: {
    id: string;
    name: string;
    previewUrl: string;
  }) => void;
  /** ID of the currently previewed template (highlights the matching card). */
  previewingTemplateId?: string | null;
  /** Insert a library section into the current project (Library tab). */
  onInsertSection?: (s: SectionSpec) => void;
  /** Section id currently being inserted — shows a pending state on its card. */
  insertingSectionId?: string | null;
  /** Tabs that are visually locked + non-interactive. Used when the
   *  workspace is in a guided entry flow (e.g. user picked "AI" — only
   *  the chat tab is active until the page has been generated). */
  lockedTabs?: SidebarMode[];
  /** Shown as a tooltip on locked tabs. */
  lockReason?: string;
  /** When set, the panel rendered in the active slot is overridden by the
   *  matching entry-mode component (PastePanel for `paste`, etc). The
   *  default mode-based panel rendering only applies in `editing` mode. */
  entryMode?: "choosing" | "ai" | "template" | "paste" | "editing";
  /** Raw HTML of the currently loaded flat project (template-clone or paste).
   *  When present, ChatPanel switches from the mock Orchestra round-trip to
   *  the real Gemini design surface, and ContentPanel renders a hint card
   *  pointing the user at the iframe (instead of the slot form). */
  flatProjectHtml?: string;
  flatProjectId?: string;
  onFlatHtmlUpdate?: (html: string) => void;
  /** Persisted Chat-tab transcript — seeds the chat so a reload / tab
   *  switch restores the conversation instead of an empty composer. */
  flatProjectChat?: StoredChatTurn[];
  /** Fired after the chat panel persists a turn — the parent refetches so
   *  its mirror, and other tabs (via BroadcastChannel), converge. */
  onChatChange?: () => void;
  /** Forwarded to ChatPanel — fires with the chat's streaming state so the
   *  parent can overlay the page-building loader on the preview. */
  onRedesigningChange?: (active: boolean) => void;
  /** True while the parent is mid-fetch on /api/projects/<id>. Forwarded
   *  to ChatPanel so reloads show a skeleton instead of the empty state. */
  projectLoading?: boolean;
  /** Save indicator mirrored from the parent — surfaced inside the
   *  flat-project ContentPanel hint card so the user knows their iframe
   *  edits are persisting. */
  savingStatus?: "idle" | "saving" | "saved" | null;
  /** ID of the currently loaded project (any kind) — used by PagesPanel
   *  to highlight the active card and no-op its click, and by VersionsPanel
   *  to fetch the project's snapshot timeline. */
  currentProjectId?: string | null;
  /** Called after a version restore succeeds, with the restored HTML so
   *  the parent can refresh `loadedProject.html` and the preview iframe. */
  onRestoreApplied?: (html: string) => void;
  /** The persistent AI-context the user wrote in the Brief tab. Loaded
   *  alongside the project; mirror updates back via `onBriefSaved`. */
  initialBrief?: string;
  onBriefSaved?: (brief: string) => void;
  /** Section-select state owned by the parent and threaded into ChatPanel
   *  so the iframe (in PreviewArea) and the chat composer stay in sync. */
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
  /** Open the Autofill modal (Sparkles icon in chat composer). */
  onAutofill?: () => void;
  /** When set, ChatPanel applies this string to its draft on the next
   *  effect run. Used by the post-swap "Update copy?" chip to push a
   *  context-aware prompt into the composer. The parent must clear via
   *  `onPendingDraftConsumed` so the same draft isn't reapplied. */
  pendingDraft?: string | null;
  onPendingDraftConsumed?: () => void;
  /** AI generation brief form state — only used when entryMode === "ai".
   *  Rendered in the sidebar panel slot so the brief input lives next
   *  to the empty preview, like the other entry modes. */
  aiBriefState?: BriefFormState;
  aiOnGenerate?: () => void;
  aiGenerating?: boolean;
  /** Model choice (Pro / Flash) for generation — forwarded to AiBriefPanel. */
  aiModel?: AIModel;
  aiOnModelChange?: (m: AIModel) => void;
}

export function LeftSidebar({
  collapsed,
  onToggleCollapse,
  mode,
  setMode,
  sections,
  expanded,
  setExpanded,
  onUpdateSection,
  onPreviewTemplate,
  previewingTemplateId,
  onInsertSection,
  insertingSectionId = null,
  lockedTabs,
  lockReason,
  entryMode = "editing",
  flatProjectHtml,
  flatProjectId,
  onFlatHtmlUpdate,
  flatProjectChat,
  onChatChange,
  onRedesigningChange,
  projectLoading = false,
  savingStatus = null,
  currentProjectId = null,
  onRestoreApplied,
  initialBrief = "",
  onBriefSaved,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  onAutofill,
  pendingDraft = null,
  onPendingDraftConsumed,
  aiBriefState,
  aiOnGenerate,
  aiGenerating = false,
  aiModel = "gemini-flash",
  aiOnModelChange,
}: LeftSidebarProps) {
  const isFlatProject = flatProjectId !== undefined;
  const lockedSet = new Set(lockedTabs ?? []);
  const isLocked = (id: SidebarMode) => lockedSet.has(id);
  const activeMeta = MODE_TABS.find((t) => t.id === mode) ?? MODE_TABS[0];

  // Tab visibility rules:
  // - Templates is an entry-flow surface only — once a project is open there's
  //   nothing to commit to, so we drop it in editing mode.
  // - Insights is editing-only — there's no project to read analytics for in
  //   the entry flows (the project doesn't exist yet).
  const visibleTabs = MODE_TABS.filter((t) => {
    if (entryMode === "editing" && t.id === "templates") return false;
    if (entryMode !== "editing" && t.id === "insights") return false;
    // Library inserts into the current project — editing-only, like Insights.
    if (entryMode !== "editing" && t.id === "library") return false;
    return true;
  });

  if (collapsed) {
    return (
      <aside className="h-full w-12 shrink-0 bg-side border-r bd flex flex-col items-center pt-2 gap-1">
        {visibleTabs.map((t) => {
          const active = mode === t.id;
          const locked = isLocked(t.id);
          const I = t.icon;
          return (
            <Tooltip
              key={t.id}
              label={locked ? (lockReason ?? `${t.label} — locked`) : t.label}
              side="right"
            >
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  setMode(t.id);
                  onToggleCollapse();
                }}
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-all duration-150 ease-out ${
                  locked
                    ? "fg-faint opacity-50 cursor-not-allowed"
                    : active
                      ? "bg-elev fg shadow-card border bd"
                      : "fg-muted hover:fg hover:bg-hover"
                }`}
              >
                <I size={14} />
              </button>
            </Tooltip>
          );
        })}
        <Tooltip label="Expand panel" side="right">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mt-auto mb-3 h-8 w-8 inline-flex items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
          >
            <PanelRight size={14} />
          </button>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside className="h-full w-[320px] shrink-0 bg-side border-r bd flex flex-col">
      <div className="flex items-center justify-between px-2 pt-2 pb-1.5 border-b bd shrink-0">
        <div className="inline-flex items-center gap-0.5">
          {visibleTabs.map((t) => {
            const active = mode === t.id;
            const locked = isLocked(t.id);
            const I = t.icon;
            return (
              <Tooltip
                key={t.id}
                label={locked ? (lockReason ?? `${t.label} — locked`) : t.label}
              >
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (locked) return;
                    setMode(t.id);
                  }}
                  className={`h-7 w-8 inline-flex items-center justify-center rounded-md transition-all duration-150 ease-out ${
                    locked
                      ? "fg-faint opacity-50 cursor-not-allowed"
                      : active
                        ? "bg-elev fg shadow-card border bd"
                        : "fg-muted hover:fg hover:bg-hover"
                  }`}
                >
                  <I size={13} />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <IconBtn label="Collapse panel" size="sm" onClick={onToggleCollapse}>
          <PanelLeft size={13} />
        </IconBtn>
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 border-b bd shrink-0">
        <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {activeMeta.title}
        </span>
      </div>
      <div key={`${entryMode}:${mode}`} className="flex-1 min-h-0 fade-slide">
        {entryMode === "choosing" ? (
          <ChoosingPlaceholder />
        ) : entryMode === "paste" ? (
          <PastePanel />
        ) : entryMode === "ai" && aiBriefState ? (
          <AiBriefPanel
            state={aiBriefState}
            onGenerate={aiOnGenerate ?? (() => {})}
            generating={aiGenerating}
            model={aiModel}
            onModelChange={aiOnModelChange ?? (() => {})}
          />
        ) : (
          <>
            {mode === "chat" && (
              <ChatPanel
                flatProjectId={flatProjectId}
                flatProjectHtml={flatProjectHtml}
                onFlatHtmlUpdate={onFlatHtmlUpdate}
                flatProjectChat={flatProjectChat}
                onChatChange={onChatChange}
                onRedesigningChange={onRedesigningChange}
                projectLoading={projectLoading}
                sectionSelectMode={sectionSelectMode}
                onToggleSectionSelect={onToggleSectionSelect}
                scopedSelection={scopedSelection}
                onClearScope={onClearScope}
                onAutofill={onAutofill}
                pendingDraft={pendingDraft}
                onPendingDraftConsumed={onPendingDraftConsumed}
              />
            )}
            {mode === "templates" && (
              <TemplatesPanel
                onPreview={(t) =>
                  onPreviewTemplate?.({
                    id: t.id,
                    name: t.name,
                    previewUrl: t.previewUrl,
                  })
                }
                previewingId={previewingTemplateId ?? null}
              />
            )}
            {mode === "library" && (
              <SectionsPanel
                onInsert={onInsertSection ?? (() => {})}
                insertingId={insertingSectionId}
              />
            )}
            {mode === "pages" && (
              <PagesPanel currentProjectId={currentProjectId} />
            )}
            {mode === "leads" && (
              <SubmissionsPanel currentProjectId={currentProjectId} />
            )}
            {mode === "insights" && (
              <InsightsPanel currentProjectId={currentProjectId} />
            )}
            {mode === "versions" && (
              <VersionsPanel
                currentProjectId={currentProjectId}
                onRestoreApplied={onRestoreApplied}
              />
            )}
            {mode === "brief" && (
              <BriefPanel
                currentProjectId={currentProjectId}
                initialBrief={initialBrief}
                onSaved={onBriefSaved}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// Placeholder shown in the sidebar panel area while the workspace is in
// "choosing" entry mode. Every sidebar tab is locked, the empty state is
// taking up the main area to the right — the panel is essentially idle, so
// we explain that with a small visual rather than rendering a stale panel.
function ChoosingPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[200px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
          <Layers size={15} />
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">
          Tools live here once you&apos;ve started.
        </p>
        <p className="mt-2 text-[10.5px] fg-faint leading-relaxed">
          Pick a starting point from the right →
        </p>
      </div>
    </div>
  );
}

// re-export the Layers icon so callers that want a fallback section icon
// don't have to dig into ./icons just for this.
export { Layers };
