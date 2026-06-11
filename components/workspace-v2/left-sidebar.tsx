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

import { useTranslations } from "next-intl";
import {
  BarChart3,
  ChatIcon,
  FileText,
  Grid3,
  HistoryIcon,
  Inbox,
  Layers,
  ListTree,
  Monitor,
  PanelLeft,
  PanelRight,
  Sparkles,
  X,
} from "./icons";
import type { Section } from "./mock-data";
import type { BriefFormState } from "@/components/workspace/types";
import type { StoredChatTurn } from "@/lib/projects/types";
import { AiBriefPanel } from "./panels/ai-brief-panel";
import { AssistantPanel } from "./panels/assistant-panel";
import { RailBusinessSwitcher } from "./business-switcher";
import type { BusinessProfile } from "@/lib/business-profiles/types";
import {
  ChatPanel,
  type ScopedSelection,
} from "./panels/chat-panel";
import { PastePanel } from "./panels/paste-panel";
import { SitePagesPanel } from "./panels/site-pages-panel";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { SectionsPanel } from "./panels/sections-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { VersionsPanel } from "./panels/versions-panel";
import type { SectionSpec } from "./sections-data";
import { Tooltip } from "./ui";

import type { ComponentType } from "react";

// The account-wide sections — the SAME nav as the dashboard, living inside the
// editor's existing sidebar (not a second rail) so you can jump anywhere from
// here. Links navigate away from the editor (the page auto-saves).
export type SectionView =
  | "page"
  | "projects"
  | "analytics"
  | "messages"
  | "business";

const GLOBAL_SECTIONS: ReadonlyArray<{
  view: SectionView;
  icon: typeof FileText;
  key: string;
}> = [
  { view: "page", icon: Monitor, key: "nav.page" },
  { view: "projects", icon: FileText, key: "nav.myPages" },
  { view: "analytics", icon: BarChart3, key: "nav.analytics" },
  { view: "messages", icon: Inbox, key: "nav.messages" },
  // "business" lives in the top RailBusinessSwitcher now (avatar → "Abrir
  // Negocio"), not as a generic section icon here.
];

function GlobalSections({
  vertical,
  active,
  onSelect,
}: {
  vertical: boolean;
  active: SectionView;
  onSelect: (v: SectionView) => void;
}) {
  const t = useTranslations("projects");
  return (
    <>
      {GLOBAL_SECTIONS.map((s) => {
        const I = s.icon;
        const isActive = active === s.view;
        return (
          <Tooltip key={s.view} label={t(s.key)} side={vertical ? "right" : undefined}>
            <button
              type="button"
              onClick={() => onSelect(s.view)}
              aria-label={t(s.key)}
              aria-current={isActive ? "page" : undefined}
              className={`${vertical ? "h-8 w-8" : "h-7 w-8"} inline-flex items-center justify-center rounded-md transition ${
                isActive
                  ? "bg-elev fg shadow-card border bd"
                  : "fg-muted hover:fg hover:bg-hover"
              }`}
            >
              <I size={vertical ? 14 : 13} />
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

export type SidebarMode =
  | "site"
  | "chat"
  | "templates"
  | "library"
  | "pages"
  | "assistant"
  | "versions";

interface ModeTab {
  id: SidebarMode;
  icon: ComponentType<{ size?: number }>;
}

const MODE_TABS: ModeTab[] = [
  { id: "site", icon: ListTree },
  { id: "chat", icon: ChatIcon },
  { id: "templates", icon: Grid3 },
  { id: "library", icon: Layers },
  { id: "assistant", icon: Sparkles },
  { id: "versions", icon: HistoryIcon },
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
  /** Open the preview dialog for a library section (Library tab). The actual
   *  match-then-insert happens from the dialog's "Use on my page" action. */
  onPreviewSection?: (s: SectionSpec) => void;
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
  /** Multi-page: slug of the site page the canvas is editing (null = home).
   *  Forwarded to ChatPanel so chat edits land in the right document. */
  flatProjectPage?: string | null;
  /** Write a document's html into the parent's project state. `page` pins
   *  the slot (null = home); undefined = whatever page is active (legacy
   *  single-arg callers). */
  onFlatHtmlUpdate?: (html: string, page?: string | null) => void;
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
  /** Called after a version restore succeeds, with the restored HTML, the
   *  page scope it landed on (null = home) and the server's new updatedAt
   *  (ms) so the parent can refresh the right document + the preview iframe. */
  onRestoreApplied?: (
    html: string,
    page: string | null,
    updatedAtMs?: number,
  ) => void;
  /** Flush any pending canvas autosave (resolving once it settled) before
   *  VersionsPanel asks the server to snapshot the current document. */
  onPrepareSnapshot?: () => Promise<void>;
  /** Section-select state owned by the parent and threaded into ChatPanel
   *  so the iframe (in PreviewArea) and the chat composer stay in sync. */
  sectionSelectMode?: boolean;
  onToggleSectionSelect?: (active: boolean) => void;
  scopedSelection?: ScopedSelection | null;
  onClearScope?: () => void;
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
  /** Generation mode — "quick" (curated, free) vs "scratch" (bespoke, Pro). */
  aiMode?: "quick" | "scratch";
  aiOnModeChange?: (m: "quick" | "scratch") => void;
  /** "Mi negocio" picker state — seeds the curation flow from a saved profile. */
  aiProfiles?: { id: string; name: string }[];
  aiSelectedProfileId?: string | null;
  aiOnSelectProfile?: (id: string | null) => void;
  aiOnManageProfiles?: () => void;
  /** Whether any saved profile holds real info — drives the brief screen's
   *  cold-start import CTA vs the switch picker. */
  aiHasBusinessInfo?: boolean;
  /** The account section shown in the workspace CENTER ("page" = the canvas).
   *  The global-section rail icons set this; the parent renders the section. */
  activeSection?: SectionView;
  onSelectSection?: (v: SectionView) => void;
  /** Active-business switcher (top of the rail). The active business scopes the
   *  Páginas/Analytics/Mensajes sections + is the default for new pages. */
  businesses?: BusinessProfile[];
  activeBusinessId?: string;
  onPickBusiness?: (id: string) => void;
  onAddBusiness?: () => void;
  /** Multi-page site tree (Site tab) — owned by the parent. */
  sitePages?: SitePageSummary[];
  activeSitePage?: string | null;
  onSwitchSitePage?: (slug: string | null) => void;
  onCreateSitePage?: (slug: string) => Promise<string | null>;
  onDeleteSitePage?: (slug: string) => Promise<boolean>;
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
  onPreviewSection,
  lockedTabs,
  lockReason,
  entryMode = "editing",
  activeSection = "page",
  onSelectSection,
  flatProjectHtml,
  flatProjectId,
  flatProjectPage = null,
  onFlatHtmlUpdate,
  flatProjectChat,
  onChatChange,
  onRedesigningChange,
  projectLoading = false,
  savingStatus = null,
  currentProjectId = null,
  onRestoreApplied,
  onPrepareSnapshot,
  sectionSelectMode = false,
  onToggleSectionSelect,
  scopedSelection = null,
  onClearScope,
  pendingDraft = null,
  onPendingDraftConsumed,
  aiBriefState,
  aiOnGenerate,
  aiGenerating = false,
  aiMode = "quick",
  aiOnModeChange,
  aiProfiles = [],
  aiSelectedProfileId = null,
  aiOnSelectProfile,
  aiOnManageProfiles,
  aiHasBusinessInfo = false,
  businesses = [],
  activeBusinessId = "",
  onPickBusiness,
  onAddBusiness,
  sitePages = [],
  activeSitePage = null,
  onSwitchSitePage,
  onCreateSitePage,
  onDeleteSitePage,
}: LeftSidebarProps) {
  const showBusinessSwitcher = businesses.length > 0 && !!onPickBusiness;
  const t = useTranslations("wsChrome");
  const isFlatProject = flatProjectId !== undefined;
  const lockedSet = new Set(lockedTabs ?? []);
  const isLocked = (id: SidebarMode) => lockedSet.has(id);
  const tabLabel = (id: SidebarMode) => t(`sidebar.tabs.${id}.label`);
  const tabTitle = (id: SidebarMode) => t(`sidebar.tabs.${id}.title`);
  const activeMeta = MODE_TABS.find((tab) => tab.id === mode) ?? MODE_TABS[0];

  // Tab visibility rules:
  // Templates stays visible while editing (the panel is browse-only on an
  // existing page — you can't swap a page for a template). Library and Site
  // (the project's page tree) are editing-only — both operate on the
  // currently loaded project.
  const visibleTabs = MODE_TABS.filter((tab) => {
    if (
      entryMode !== "editing" &&
      (tab.id === "library" || tab.id === "site" || tab.id === "assistant")
    )
      return false;
    return true;
  });

  if (collapsed) {
    return (
      <aside className="h-full w-12 shrink-0 bg-side border-r bd flex flex-col items-center pt-2 gap-1">
        {showBusinessSwitcher && (
          <>
            <RailBusinessSwitcher
              businesses={businesses}
              activeId={activeBusinessId}
              onPick={onPickBusiness ?? (() => {})}
              onAdd={onAddBusiness ?? (() => {})}
              onOpenBusiness={() => onSelectSection?.("business")}
            />
            <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
          </>
        )}
        <GlobalSections
          vertical
          active={activeSection}
          onSelect={onSelectSection ?? (() => {})}
        />
        <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
        {visibleTabs.map((tab) => {
          const active = mode === tab.id;
          const locked = isLocked(tab.id);
          const I = tab.icon;
          const label = locked
            ? (lockReason ?? t("sidebar.tabLocked", { label: tabLabel(tab.id) }))
            : tabLabel(tab.id);
          return (
            <Tooltip key={tab.id} label={label} side="right">
              <button
                type="button"
                disabled={locked}
                aria-label={label}
                onClick={() => {
                  if (locked) return;
                  setMode(tab.id);
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
        <Tooltip label={t("sidebar.expandPanel")} side="right">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={t("sidebar.expandPanel")}
            className="mt-auto mb-3 h-8 w-8 inline-flex items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
          >
            <PanelRight size={14} />
          </button>
        </Tooltip>
      </aside>
    );
  }

  return (
    // On mobile (< md) the expanded panel can't share the row with the canvas
    // (272px of a 390px screen leaves nothing) — it overlays the whole row
    // instead, rail included, and the header grows a close button.
    <aside className="h-full shrink-0 flex bg-side border-r bd max-md:absolute max-md:inset-0 max-md:z-40 max-md:border-r-0">
      {/* The icon rail stays vertical + fixed — identical to collapsed; the
          panel just opens to its right (it never reflows into a top row). */}
      <div className="h-full w-12 shrink-0 flex flex-col items-center pt-2 gap-1 border-r bd">
        {showBusinessSwitcher && (
          <>
            <RailBusinessSwitcher
              businesses={businesses}
              activeId={activeBusinessId}
              onPick={onPickBusiness ?? (() => {})}
              onAdd={onAddBusiness ?? (() => {})}
              onOpenBusiness={() => onSelectSection?.("business")}
            />
            <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
          </>
        )}
        <GlobalSections
          vertical
          active={activeSection}
          onSelect={onSelectSection ?? (() => {})}
        />
        <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
        {visibleTabs.map((tab) => {
          const active = mode === tab.id;
          const locked = isLocked(tab.id);
          const I = tab.icon;
          const label = locked
            ? (lockReason ?? t("sidebar.tabLocked", { label: tabLabel(tab.id) }))
            : tabLabel(tab.id);
          return (
            <Tooltip key={tab.id} label={label} side="right">
              <button
                type="button"
                disabled={locked}
                aria-label={label}
                onClick={() => {
                  if (locked) return;
                  setMode(tab.id);
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
        <Tooltip label={t("sidebar.collapsePanel")} side="right">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={t("sidebar.collapsePanel")}
            className="mt-auto mb-3 h-8 w-8 inline-flex items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
          >
            <PanelLeft size={14} />
          </button>
        </Tooltip>
      </div>
      <div className="w-[272px] max-md:w-auto max-md:flex-1 shrink-0 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bd shrink-0">
        <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {tabTitle(activeMeta.id)}
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t("sidebar.collapsePanel")}
          className="md:hidden -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
        >
          <X size={13} />
        </button>
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
            mode={aiMode}
            onModeChange={aiOnModeChange ?? (() => {})}
            profiles={aiProfiles}
            selectedProfileId={aiSelectedProfileId}
            onSelectProfile={aiOnSelectProfile}
            onManageProfiles={aiOnManageProfiles}
            hasBusinessInfo={aiHasBusinessInfo}
          />
        ) : (
          <>
            {mode === "site" && (
              <SitePagesPanel
                pages={sitePages}
                activePage={activeSitePage}
                onSwitch={onSwitchSitePage ?? (() => {})}
                onCreate={onCreateSitePage ?? (async () => "errInvalid")}
                onDelete={onDeleteSitePage ?? (async () => false)}
              />
            )}
            {mode === "chat" && (
              <ChatPanel
                flatProjectId={flatProjectId}
                flatProjectHtml={flatProjectHtml}
                flatProjectPage={flatProjectPage}
                onFlatHtmlUpdate={onFlatHtmlUpdate}
                flatProjectChat={flatProjectChat}
                onChatChange={onChatChange}
                onRedesigningChange={onRedesigningChange}
                projectLoading={projectLoading}
                sectionSelectMode={sectionSelectMode}
                onToggleSectionSelect={onToggleSectionSelect}
                scopedSelection={scopedSelection}
                onClearScope={onClearScope}
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
              <SectionsPanel onPreview={onPreviewSection ?? (() => {})} />
            )}
            {mode === "assistant" && (
              <AssistantPanel currentProjectId={currentProjectId} />
            )}
            {mode === "versions" && (
              <VersionsPanel
                currentProjectId={currentProjectId}
                activeSitePage={activeSitePage}
                sitePages={sitePages}
                onRestoreApplied={onRestoreApplied}
                onPrepareSnapshot={onPrepareSnapshot}
              />
            )}
          </>
        )}
      </div>
      </div>
    </aside>
  );
}

// Placeholder shown in the sidebar panel area while the workspace is in
// "choosing" entry mode. Every sidebar tab is locked, the empty state is
// taking up the main area to the right — the panel is essentially idle, so
// we explain that with a small visual rather than rendering a stale panel.
function ChoosingPlaceholder() {
  const t = useTranslations("wsChrome");
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[200px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
          <Layers size={15} />
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">
          {t("sidebar.choosing.title")}
        </p>
        <p className="mt-2 text-[10.5px] fg-faint leading-relaxed">
          {t("sidebar.choosing.hint")}
        </p>
      </div>
    </div>
  );
}

// re-export the Layers icon so callers that want a fallback section icon
// don't have to dig into ./icons just for this.
export { Layers };
