// Unified left sidebar — 6 modes (chat, content, design, pages, versions,
// comments). Collapsible to a 48px icon-rail. The artifact replaced separate
// left+right sidebars with this single panel; we keep that decision.

"use client";

import {
  ChatIcon,
  FileText,
  Grid3,
  HistoryIcon,
  Layers,
  MessageSq,
  PaletteIcon,
  PanelLeft,
  PanelRight,
  Pencil,
} from "./icons";
import type { Section } from "./mock-data";
import { ChatPanel } from "./panels/chat-panel";
import { CommentsPanel } from "./panels/comments-panel";
import { ContentPanel } from "./panels/content-panel";
import { DesignPanel } from "./panels/design-panel";
import { PagesPanel } from "./panels/pages-panel";
import { PastePanel } from "./panels/paste-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { VersionsPanel } from "./panels/versions-panel";
import { IconBtn, Tooltip } from "./ui";

import type { ComponentType } from "react";
import type { DesignState } from "./mock-data";

export type SidebarMode =
  | "chat"
  | "content"
  | "design"
  | "templates"
  | "pages"
  | "versions"
  | "comments";

interface ModeTab {
  id: SidebarMode;
  icon: ComponentType<{ size?: number }>;
  label: string;
  title: string;
}

const MODE_TABS: ModeTab[] = [
  { id: "chat", icon: ChatIcon, label: "Chat", title: "Chat with Orchestra" },
  { id: "content", icon: Pencil, label: "Content", title: "Edit content" },
  { id: "design", icon: PaletteIcon, label: "Design", title: "Design system" },
  { id: "templates", icon: Grid3, label: "Templates", title: "Start from a template" },
  { id: "pages", icon: FileText, label: "Pages", title: "Recent projects" },
  { id: "versions", icon: HistoryIcon, label: "Versions", title: "Version history" },
  { id: "comments", icon: MessageSq, label: "Comments", title: "Comments" },
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
  design: DesignState;
  setDesign: (patch: Partial<DesignState>) => void;
  /** Called when the user clicks a template card — sets the previewed
   *  template in the parent so PreviewArea loads its URL. */
  onPreviewTemplate?: (t: {
    id: string;
    name: string;
    previewUrl: string;
  }) => void;
  /** ID of the currently previewed template (highlights the matching card). */
  previewingTemplateId?: string | null;
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
  design,
  setDesign,
  onPreviewTemplate,
  previewingTemplateId,
  lockedTabs,
  lockReason,
  entryMode = "editing",
}: LeftSidebarProps) {
  const lockedSet = new Set(lockedTabs ?? []);
  const isLocked = (id: SidebarMode) => lockedSet.has(id);
  const activeMeta = MODE_TABS.find((t) => t.id === mode) ?? MODE_TABS[0];

  if (collapsed) {
    return (
      <aside className="h-full w-12 shrink-0 bg-side border-r bd flex flex-col items-center pt-2 gap-0.5">
        {MODE_TABS.map((t) => {
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
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition ${
                  locked
                    ? "fg-faint opacity-40 cursor-not-allowed"
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
          {MODE_TABS.map((t) => {
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
                  className={`h-7 w-8 inline-flex items-center justify-center rounded-md transition ${
                    locked
                      ? "fg-faint opacity-40 cursor-not-allowed"
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
        ) : (
          <>
            {mode === "chat" && <ChatPanel />}
            {mode === "content" && (
              <ContentPanel
                sections={sections}
                expanded={expanded}
                setExpanded={setExpanded}
                onUpdate={onUpdateSection}
              />
            )}
            {mode === "design" && (
              <DesignPanel design={design} setDesign={setDesign} />
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
            {mode === "pages" && <PagesPanel />}
            {mode === "versions" && <VersionsPanel />}
            {mode === "comments" && <CommentsPanel />}
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
