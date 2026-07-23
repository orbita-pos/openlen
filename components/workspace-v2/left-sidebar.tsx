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
import { Grid3, Layers, PanelLeft, PanelRight, X } from "./icons";
import type { Section } from "./mock-data";
import type { StoredChatTurn } from "@/lib/projects/types";
import { RailBusinessSwitcher } from "./business-switcher";
import type { BusinessProfile } from "@/lib/business-profiles/types";
import {
  ChatPanel,
  type ScopedSelection,
} from "./panels/chat-panel";
import { ImagesPanel } from "./panels/images-panel";
import { InsightsPanel } from "./panels/insights-panel";
import type { DropAsset, MotionAsset } from "./drop-place-core";
import { useIsMobile } from "./use-is-mobile";
import { PastePanel } from "./panels/paste-panel";
import { SitePagesPanel } from "./panels/site-pages-panel";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { SectionsPanel, type ModuleCardState } from "./panels/sections-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { VersionsPanel } from "./panels/versions-panel";
import { ThreePanel } from "./panels/three-panel";
import type { SectionSpec } from "./sections-data";
import type {
  ContentModule,
  ModuleDestination,
} from "@/lib/workspace-v2/module-add-plan";
import { Tooltip } from "./ui";
import { useInboxBadge } from "@/components/inbox/use-inbox-badge";
import { formatBadge } from "@/components/inbox/badge-format";
// SectionView/SidebarMode are declared once in rail-model.ts (avoids a
// circular import between the rail and this sidebar). `export type {...}`
// only re-exports for other modules — it doesn't bind a local name — so we
// also import them as values-of-types below for use inside this file.
// rail-model's SectionView adds "explore" on top of what used to be declared
// locally here; SidebarMode is otherwise identical member-for-member to what
// this file declared before.
export type { SectionView, SidebarMode } from "./rail-model";
import {
  EDITAR_ITEMS,
  isBrowseView,
  NAVEGAR_ITEMS,
  type RailMode,
  type SectionView,
  type SidebarMode,
} from "./rail-model";

// Navegar: the account-wide sections (same nav as the dashboard), rendered
// full-time on bare /new and behind the "App" button while editing. Every
// item just swaps the workspace's center view in place — including Explore,
// which opens ExploreView in-workspace (?view=explore) rather than
// navigating to the standalone /explore route.
function NavegarGroup({
  vertical,
  active,
  onSelect,
  inboxBadge = 0,
}: {
  vertical: boolean;
  active: SectionView;
  onSelect: (v: SectionView) => void;
  inboxBadge?: number;
}) {
  const t = useTranslations("projects");
  const tInbox = useTranslations("inbox");
  return (
    <>
      {NAVEGAR_ITEMS.map((s) => {
        const I = s.icon;
        // The unified "Explorar" item (view: "templates") stays highlighted
        // while on either browse tab (Plantillas or Comunidad) — see BrowseTabs.
        const isActive =
          s.view === "templates"
            ? isBrowseView(active)
            : active === s.view;
        const badgeLabel =
          s.view === "messages" ? formatBadge(inboxBadge) : null;
        const label =
          badgeLabel !== null
            ? `${t(s.key)} — ${tInbox("badge.count", { count: inboxBadge })}`
            : t(s.key);
        const className = `${vertical ? "h-8 w-8" : "h-7 w-8"} relative inline-flex items-center justify-center rounded-md transition ${
          isActive ? "bg-elev fg shadow-card border bd" : "fg-muted hover:fg hover:bg-hover"
        }`;
        return (
          <Tooltip key={s.view} label={label} side={vertical ? "right" : undefined}>
            <button
              type="button"
              onClick={() => onSelect(s.view)}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={className}
            >
              <I size={vertical ? 14 : 13} />
              {badgeLabel !== null && (
                <span
                  aria-hidden
                  data-testid="inbox-badge"
                  className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-coral-500 text-white text-[10px] font-semibold leading-4 text-center"
                >
                  {badgeLabel}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

// Editar: tools that act on the currently loaded page. Only ever rendered
// while editing (railMode==="editar"), so — unlike the old MODE_TABS map —
// there's no entryMode gate here; the caller only shows this group once a
// project is loaded.
function EditarGroup({
  mode,
  onSelect,
  lockedTabs,
  lockReason,
}: {
  mode: SidebarMode;
  onSelect: (id: SidebarMode) => void;
  lockedTabs?: SidebarMode[];
  lockReason?: string;
}) {
  const t = useTranslations("wsChrome");
  const lockedSet = new Set(lockedTabs ?? []);
  return (
    <>
      {EDITAR_ITEMS.map((tab) => {
        const active = mode === tab.id;
        const locked = lockedSet.has(tab.id);
        const I = tab.icon;
        const plainLabel = t(`sidebar.tabs.${tab.id}.label`);
        const label = locked
          ? (lockReason ?? t("sidebar.tabLocked", { label: plainLabel }))
          : plainLabel;
        return (
          <Tooltip key={tab.id} label={label} side="right">
            <button
              type="button"
              disabled={locked}
              aria-label={label}
              onClick={() => {
                if (locked) return;
                onSelect(tab.id);
              }}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors duration-150 ease-out ${
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
    </>
  );
}

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
  /** Module cards (collections/bookings/comments) shown atop the Library
   *  panel's section filters. Omitted entirely when not passed. */
  moduleCards?: ModuleCardState[];
  /** Fired when a Library module card's action button is clicked. */
  onAddModule?: (module: ContentModule, destination: ModuleDestination) => void;
  /** Readable name of the destination page ("inicio" or "/<slug>") for the
   *  Library module cards — forwarded to SectionsPanel unchanged. */
  activePageLabel?: string;
  /** One-shot: open the Library on its Módulos view (hub deep-link). */
  openModulesView?: boolean;
  onModulesViewConsumed?: () => void;
  onManageCollections?: () => void;
  /** Home label for the Módulos destination selector ("inicio"). */
  homePageLabel?: string;
  siteName?: string | null;
  /** Tabs that are visually locked + non-interactive. Used when the
   *  workspace is in a guided entry flow (e.g. user picked "AI" — only
   *  the chat tab is active until the page has been generated). */
  lockedTabs?: SidebarMode[];
  /** Shown as a tooltip on locked tabs. */
  lockReason?: string;
  /** When set, the panel rendered in the active slot is overridden by the
   *  matching entry-mode component (PastePanel for `paste`, etc). The
   *  default mode-based panel rendering only applies in `editing` mode. */
  entryMode?: "ai" | "template" | "paste" | "editing";
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
  /** Page Coach "Apply with AI" (Insights tab) — the parent loads the
   *  instruction into the Chat composer and switches to the Chat tab. */
  onApplyCoachTip?: (instruction: string) => void;
  /** The account section shown in the workspace CENTER ("page" = the canvas).
   *  The global-section rail icons set this; the parent renders the section. */
  activeSection?: SectionView;
  onSelectSection?: (v: SectionView) => void;
  /** Which rail group to render — Navegar (app sections) or Editar (page
   *  tools). Derived by the parent from hasProject/navigating state via
   *  `railModeFor`. */
  railMode: RailMode;
  /** "App" button (only shown in the Editar group) — opens the Navegar
   *  section list without leaving the loaded project. */
  onOpenApp: () => void;
  /** Active-business switcher (top of the rail). The active business scopes the
   *  Páginas/Analytics/Mensajes sections + is the default for new pages. */
  businesses?: BusinessProfile[];
  activeBusinessId?: string;
  onPickBusiness?: (id: string) => void;
  onAddBusiness?: () => void;
  /** True while the parent is still fetching profiles — the rail shows a
   *  pulsing avatar skeleton in the switcher slot so it doesn't pop in. */
  businessesLoading?: boolean;
  /** Click-to-place from the Images tab — enters the same placement mode
   *  paste uses (the parent owns the lifecycle). Drag needs no callback:
   *  the cards carry their payload on the dataTransfer. */
  onPickImage?: (asset: DropAsset) => void;
  /** Insert a curated animated hero from the Images → Motion source. */
  onInsertMotion?: (a: MotionAsset) => void;
  /** Multi-page site tree (Site tab) — owned by the parent. */
  sitePages?: SitePageSummary[];
  activeSitePage?: string | null;
  onSwitchSitePage?: (slug: string | null) => void;
  onCreateSitePage?: (slug: string) => Promise<string | null>;
  onDeleteSitePage?: (slug: string) => Promise<boolean>;
  /** Members-only page toggle, used by the Site (page tree) panel. The module
   *  settings/handlers themselves now live in ModulesView (the center view). */
  onToggleMembersOnly?: (slug: string, next: boolean) => Promise<boolean>;
  /** Members door on → the page tree shows the auto /cuenta access page. */
  membersDoorOn?: boolean;
  /** 3D scene settings for the active project. */
  scene3d?: { enabled?: boolean; spec?: unknown };
  /** Called when the user applies or removes a 3D scene. */
  onApplyScene3d?: (next: { enabled: boolean; spec: unknown } | null) => void;
  /** Page accent color (--ol-accent) if available — used by ThreePanel for brand-match. */
  accent?: string;
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
  moduleCards,
  onAddModule,
  activePageLabel,
  openModulesView,
  onModulesViewConsumed,
  onManageCollections,
  homePageLabel,
  siteName,
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
  onApplyCoachTip,
  businesses = [],
  activeBusinessId = "",
  onPickBusiness,
  onAddBusiness,
  businessesLoading = false,
  onPickImage,
  onInsertMotion,
  sitePages = [],
  activeSitePage = null,
  onSwitchSitePage,
  onCreateSitePage,
  onDeleteSitePage,
  onToggleMembersOnly,
  membersDoorOn = false,
  scene3d,
  onApplyScene3d,
  accent,
  railMode,
  onOpenApp,
}: LeftSidebarProps) {
  const showBusinessSwitcher = businesses.length > 0 && !!onPickBusiness;
  const t = useTranslations("wsChrome");
  const { counts: inboxCounts } = useInboxBadge();
  const inboxBadge = inboxCounts ? inboxCounts.chat + inboxCounts.leads : 0;
  const isFlatProject = flatProjectId !== undefined;
  const tabTitle = (id: SidebarMode) => t(`sidebar.tabs.${id}.title`);
  // After a click-to-place pick on mobile the panel overlays the canvas —
  // collapse it so the user can aim the placement click.
  const isMobileLayout = useIsMobile();

  if (collapsed) {
    return (
      <aside className="h-full w-12 shrink-0 bg-side border-r bd flex flex-col items-center pt-2 gap-1">
        <BusinessRailEntry
          loading={businessesLoading}
          show={showBusinessSwitcher}
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          onPick={onPickBusiness}
          onAdd={onAddBusiness}
          onSelectSection={onSelectSection}
        />
        {railMode === "navegar" ? (
          <NavegarGroup
            vertical
            active={activeSection}
            onSelect={onSelectSection ?? (() => {})}
            inboxBadge={inboxBadge}
          />
        ) : (
          <>
            <Tooltip label={t("sidebar.appButton")} side="right">
              <button
                type="button"
                onClick={onOpenApp}
                aria-label={t("sidebar.appButton")}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
              >
                <Grid3 size={14} />
              </button>
            </Tooltip>
            <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
            <EditarGroup
              mode={mode}
              onSelect={(id) => {
                setMode(id);
                onToggleCollapse();
              }}
              lockedTabs={lockedTabs}
              lockReason={lockReason}
            />
          </>
        )}
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
        <BusinessRailEntry
          loading={businessesLoading}
          show={showBusinessSwitcher}
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          onPick={onPickBusiness}
          onAdd={onAddBusiness}
          onSelectSection={onSelectSection}
        />
        {railMode === "navegar" ? (
          <NavegarGroup
            vertical
            active={activeSection}
            onSelect={onSelectSection ?? (() => {})}
            inboxBadge={inboxBadge}
          />
        ) : (
          <>
            <Tooltip label={t("sidebar.appButton")} side="right">
              <button
                type="button"
                onClick={onOpenApp}
                aria-label={t("sidebar.appButton")}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition"
              >
                <Grid3 size={14} />
              </button>
            </Tooltip>
            <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
            <EditarGroup
              mode={mode}
              onSelect={setMode}
              lockedTabs={lockedTabs}
              lockReason={lockReason}
            />
          </>
        )}
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
          {tabTitle(mode)}
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
        {entryMode === "paste" ? (
          <PastePanel />
        ) : entryMode === "ai" ? (
          // Bare /new (no page): the AI brief lives in the center (StartLanding),
          // so the sidebar shows the gallery here — never a duplicate composer.
          // The sidebar AI/chat is reserved for editing an existing page.
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
        ) : (
          <>
            {mode === "site" && (
              <SitePagesPanel
                pages={sitePages}
                activePage={activeSitePage}
                onSwitch={onSwitchSitePage ?? (() => {})}
                onCreate={onCreateSitePage ?? (async () => "errInvalid")}
                onDelete={onDeleteSitePage ?? (async () => false)}
                onToggleMembersOnly={onToggleMembersOnly}
                membersDoorOn={membersDoorOn}
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
                sitePages={sitePages}
                onSwitchSitePage={onSwitchSitePage}
              />
            )}
            {mode === "insights" && (
              <InsightsPanel
                currentProjectId={currentProjectId}
                onApplyTip={onApplyCoachTip}
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
            {mode === "images" && (
              <ImagesPanel
                projectId={currentProjectId}
                activeProfile={(() => {
                  const p =
                    businesses.find((b) => b.id === activeBusinessId) ??
                    businesses.find((b) => b.isDefault) ??
                    null;
                  return p
                    ? {
                        name: p.name,
                        logoUrl: p.data.brand?.logoUrl ?? null,
                        photos: p.data.photos ?? [],
                      }
                    : null;
                })()}
                onPick={(asset) => {
                  onPickImage?.(asset);
                  if (isMobileLayout) onToggleCollapse();
                }}
                onInsertMotion={
                  onInsertMotion
                    ? (a) => {
                        onInsertMotion(a);
                        if (isMobileLayout) onToggleCollapse();
                      }
                    : undefined
                }
              />
            )}
            {mode === "library" && (
              <SectionsPanel
                onPreview={onPreviewSection ?? (() => {})}
                moduleCards={moduleCards}
                onAddModule={onAddModule}
                activePageLabel={activePageLabel}
                openModulesView={openModulesView}
                onModulesViewConsumed={onModulesViewConsumed}
                onManageCollections={onManageCollections}
                sitePages={sitePages}
                activeSitePage={activeSitePage}
                onSwitchPage={onSwitchSitePage}
                homeLabel={homePageLabel}
                siteName={siteName}
              />
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
            {mode === "3d" && (
              <ThreePanel
                currentProjectId={currentProjectId}
                scene3d={scene3d}
                accent={accent}
                onApplyScene3d={onApplyScene3d ?? (() => {})}
              />
            )}
          </>
        )}
      </div>
      </div>
    </aside>
  );
}

// Rail slot for the active-business switcher. While the parent is still
// fetching profiles, a pulsing avatar skeleton holds the slot (same h-7/w-7
// footprint as the real avatar) so the rail doesn't jump when the switcher
// pops in — and the slot reads as "something loads here", not an empty gap.
//
// WHY this stays separate from the Navegar "business" item (rail-model.ts):
// NAVEGAR_ITEMS' `business` icon is a plain nav button — it just opens the
// Business section view, same as every other Navegar item. This entry is a
// SWITCHER: clicking the avatar opens a dropdown to change which business is
// active (scoping Páginas/Analytics/Mensajes + the default for new pages),
// add a new business, or jump to "Todos" across 2+ businesses — none of
// which the Navegar item does. Collapsing them into one would either lose
// the switcher (users with multiple businesses couldn't change the active
// one from the rail) or turn every Navegar click into a dropdown (wrong for
// the other 7 items). Kept both: this avatar is workspace chrome (always
// visible, top of rail, in both Navegar and Editar rail modes), the Navegar
// item is one more destination in the app-sections list.
function BusinessRailEntry({
  loading,
  show,
  businesses,
  activeBusinessId,
  onPick,
  onAdd,
  onSelectSection,
}: {
  loading: boolean;
  show: boolean;
  businesses: BusinessProfile[];
  activeBusinessId: string;
  onPick?: (id: string) => void;
  onAdd?: () => void;
  onSelectSection?: (v: SectionView) => void;
}) {
  if (loading) {
    return (
      <>
        <div
          className="h-9 w-9 inline-flex items-center justify-center"
          aria-hidden
        >
          <div className="h-7 w-7 rounded-lg ring-1 ring-black/5 dark:ring-white/10 bg-black/5 dark:bg-white/10 animate-pulse" />
        </div>
        <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
      </>
    );
  }
  if (!show) return null;
  return (
    <>
      <RailBusinessSwitcher
        businesses={businesses}
        activeId={activeBusinessId}
        onPick={onPick ?? (() => {})}
        onAdd={onAdd ?? (() => {})}
        onOpenBusiness={() => onSelectSection?.("business")}
      />
      <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
    </>
  );
}

// re-export the Layers icon so callers that want a fallback section icon
// don't have to dig into ./icons just for this.
export { Layers };
