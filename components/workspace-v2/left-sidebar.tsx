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
import { Layers, PanelLeft, PanelRight, X } from "./icons";
import type { Section } from "./mock-data";
import type { StoredChatTurn } from "@/lib/projects/types";
import { RailBusinessSwitcher } from "./business-switcher";
import type { BusinessProfile } from "@/lib/business-profiles/types";
import {
  ChatPanel,
  type ScopedSelection,
} from "./panels/chat-panel";
import { useIsMobile } from "./use-is-mobile";
import { PastePanel } from "./panels/paste-panel";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { TemplatesPanel } from "./panels/templates-panel";
import { VersionsPanel } from "./panels/versions-panel";
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
  RAIL_CREAR,
  RAIL_OPERAR,
  railActiveKey,
  railItemKey,
  type RailItemDef,
  type SectionView,
  type SidebarMode,
} from "./rail-model";

// Rail único: one permanent, site-scoped icon rail — CREAR (page-editing
// tools) then a divider then OPERAR (site-level sections). Replaces the old
// NavegarGroup/EditarGroup swap + the "App" button (spec
// un-rail-navegacion-unificada, 2026-07-22).
function UnifiedRail({
  activeKey,
  onPagina,
  onPanel,
  onView,
  lockedTabs,
  lockReason,
  badges,
}: {
  activeKey: string;
  onPagina: () => void;
  onPanel: (id: SidebarMode) => void;
  onView: (v: SectionView) => void;
  lockedTabs?: SidebarMode[];
  lockReason?: string;
  badges: { leads: number; chat: number };
}) {
  const t = useTranslations("wsChrome");
  const tInbox = useTranslations("inbox");
  const lockedSet = new Set(lockedTabs ?? []);
  const render = (item: RailItemDef) => {
    const key = railItemKey(item);
    const active = key === activeKey;
    const locked = item.kind === "panel" && lockedSet.has(item.id);
    const badgeCount =
      item.kind === "view" && item.badge ? badges[item.badge] : 0;
    const plainLabel = t(`rail.${key}`);
    const label = locked
      ? (lockReason ?? t("sidebar.tabLocked", { label: plainLabel }))
      : badgeCount > 0
        ? `${plainLabel} — ${tInbox("badge.count", { count: badgeCount })}`
        : plainLabel;
    const I = item.icon;
    return (
      <Tooltip key={key} label={label} side="right">
        <button
          type="button"
          disabled={locked}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            if (locked) return;
            if (item.kind === "action") onPagina();
            else if (item.kind === "panel") onPanel(item.id);
            else onView(item.view);
          }}
          className={`h-8 w-8 relative inline-flex items-center justify-center rounded-md transition ${
            locked
              ? "fg-faint opacity-50 cursor-not-allowed"
              : active
                ? "bg-elev fg shadow-card border bd"
                : "fg-muted hover:fg hover:bg-hover"
          }`}
        >
          <I size={14} />
          {badgeCount > 0 && (
            <span
              aria-hidden
              data-testid={`rail-badge-${key}`}
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-coral-500 text-white text-[10px] font-semibold leading-4 text-center"
            >
              {formatBadge(badgeCount)}
            </span>
          )}
        </button>
      </Tooltip>
    );
  };
  return (
    <>
      {RAIL_CREAR.map(render)}
      <div className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
      {RAIL_OPERAR.map(render)}
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
  /** Readable name of the destination page ("inicio" or "/<slug>"). */
  activePageLabel?: string;
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
  onFlatHtmlUpdate?: (
    html: string,
    page?: string | null,
    untrusted?: boolean,
  ) => void;
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
  /** True while the parent is still fetching profiles — the rail shows a
   *  pulsing avatar skeleton in the switcher slot so it doesn't pop in. */
  businessesLoading?: boolean;
  /** Multi-page site tree (Site tab) — owned by the parent. */
  sitePages?: SitePageSummary[];
  activeSitePage?: string | null;
  onSwitchSitePage?: (slug: string | null) => void;
  /** Members-only page toggle, used by the Site (page tree) panel. The module
   *  settings/handlers themselves now live in ModulesView (the center view). */
  /** Members door on → the page tree shows the auto /cuenta access page. */
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
  activePageLabel,
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
  businesses = [],
  activeBusinessId = "",
  onPickBusiness,
  onAddBusiness,
  businessesLoading = false,
  sitePages = [],
  activeSitePage = null,
  onSwitchSitePage,
}: LeftSidebarProps) {
  const showBusinessSwitcher = businesses.length > 0 && !!onPickBusiness;
  const t = useTranslations("wsChrome");
  const { counts: inboxCounts } = useInboxBadge();
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
        <UnifiedRail
          activeKey={railActiveKey(activeSection, mode)}
          onPagina={() => onSelectSection?.("page")}
          onPanel={(id) => {
            setMode(id);
            if (collapsed) onToggleCollapse();
          }}
          onView={(v) => onSelectSection?.(v)}
          lockedTabs={lockedTabs}
          lockReason={lockReason}
          badges={{
            leads: inboxCounts?.leads ?? 0,
            chat: inboxCounts?.chat ?? 0,
          }}
        />
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
        <UnifiedRail
          activeKey={railActiveKey(activeSection, mode)}
          onPagina={() => onSelectSection?.("page")}
          onPanel={(id) => {
            setMode(id);
            if (collapsed) onToggleCollapse();
          }}
          onView={(v) => onSelectSection?.(v)}
          lockedTabs={lockedTabs}
          lockReason={lockReason}
          badges={{
            leads: inboxCounts?.leads ?? 0,
            chat: inboxCounts?.chat ?? 0,
          }}
        />
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
            {/* El panel de páginas ya NO vive aquí: se monta dentro del
                desplegable de la barra de dirección, arriba del lienzo
                (2026-08-27). El rail perdió su icono y este modo se quedó sin
                nadie que lo encendiera — una rama que no se puede alcanzar es
                una invitación a que alguien la vuelva a cablear por error. */}
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
            {/* EL PANEL DE IMÁGENES SALIÓ DEL RAIL el 2026-08-29. Era la
                tercera copia de las mismas bibliotecas —OpenLen, Unsplash, las
                fotos del negocio— que ya vivían en el diálogo de sustituir, y
                un icono permanente para eso cobra sitio a algo que sí lo
                necesita. Lo suyo se fue al diálogo: «Tus subidas» (que allí no
                existía) y Motion.

                Lo que se perdió, y se perdió a sabiendas: arrastrar una foto
                DE NUESTRAS BIBLIOTECAS al lienzo, que era la única forma de
                llegar a `section-bg`, `media-split` y `new-section` sin pasar
                por el Agente. Arrastrar un fichero DESDE EL ESCRITORIO sigue
                dando las cinco intenciones — el motor de soltado no se tocó. */}
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

// Rail slot for the active-business switcher. While the parent is still
// fetching profiles, a pulsing avatar skeleton holds the slot (same h-7/w-7
// footprint as the real avatar) so the rail doesn't jump when the switcher
// pops in — and the slot reads as "something loads here", not an empty gap.
//
// WHY this stays separate from the rail's "business" item (rail-model.ts,
// RAIL_OPERAR): that icon is a plain nav button — it just opens the Business
// section view, same as every other rail item. This entry is a SWITCHER:
// clicking the avatar opens a dropdown to change which business is active
// (scoping Páginas/Analytics/Mensajes + the default for new pages), add a
// new business, or jump to "Todos" across 2+ businesses — none of which the
// rail item does. Collapsing them into one would either lose the switcher
// (users with multiple businesses couldn't change the active one from the
// rail) or turn every rail click into a dropdown (wrong for the other 11
// items). Kept both: this avatar is workspace chrome (always visible, top
// of rail), the rail item is one more destination in RAIL_OPERAR.
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
