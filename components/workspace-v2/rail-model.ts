import type { ComponentType } from "react";
import {
  BarChart3, ChatIcon, HistoryIcon, HomeIcon, ImageIcon, Inbox,
  Layers, ListTree, Megaphone, Package, Sparkles, Store,
} from "./icons";

// The account-wide sections, addressable independently of any loaded project,
// vs. SidebarMode — the tools that act on the currently loaded page.
// Canonical declaration — left-sidebar.tsx imports these from here (avoids a
// circular import between the rail and the sidebar).
export type SectionView =
  | "page" | "projects" | "templates" | "analytics" | "messages"
  | "modulos" | "marketing" | "business" | "explore" | "resultados";

export type SidebarMode =
  | "site" | "chat" | "templates" | "images" | "library" | "pages"
  | "assistant" | "members" | "broadcast" | "comments" | "bookings"
  | "collections" | "modulos" | "insights" | "versions" | "3d";

type Icon = ComponentType<{ size?: number }>;

// ── Rail único (2026-07-22, spec un-rail-navegacion-unificada) ──────────────
// One permanent, site-scoped rail. Two groups: CREAR (tools that edit the
// page) and OPERAR (the site's operations). "Página" is an action that
// returns to the canvas from any center view.

export type RailItemDef =
  | { kind: "action"; key: "pagina"; icon: Icon }
  | { kind: "panel"; id: SidebarMode; icon: Icon }
  | { kind: "view"; view: SectionView; icon: Icon; badge?: "leads" | "chat" };

export const RAIL_CREAR: ReadonlyArray<RailItemDef> = [
  { kind: "action", key: "pagina", icon: HomeIcon },
  { kind: "panel", id: "site", icon: ListTree },
  { kind: "panel", id: "chat", icon: ChatIcon },
  { kind: "panel", id: "images", icon: ImageIcon },
  { kind: "panel", id: "library", icon: Layers },
  { kind: "panel", id: "3d", icon: Sparkles },
];

export const RAIL_OPERAR: ReadonlyArray<RailItemDef> = [
  { kind: "view", view: "modulos", icon: Package },
  { kind: "view", view: "resultados", icon: BarChart3, badge: "leads" },
  { kind: "view", view: "messages", icon: Inbox, badge: "chat" },
  { kind: "view", view: "marketing", icon: Megaphone },
  { kind: "view", view: "business", icon: Store },
  { kind: "panel", id: "versions", icon: HistoryIcon },
];

export function railItemKey(item: RailItemDef): string {
  return item.kind === "action" ? item.key : item.kind === "panel" ? item.id : item.view;
}

export function railActiveKey(centerView: SectionView, mode: SidebarMode): string {
  if (centerView === "page") return mode;
  if (centerView === "analytics") return "resultados";
  return centerView;
}
