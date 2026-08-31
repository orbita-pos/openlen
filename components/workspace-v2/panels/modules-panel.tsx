// Módulos — the one-click backend modules hub, laid out for the workspace
// CENTER (a wide view, not the old 272px rail). A responsive grid of module
// cards (toggle + inline settings, active cards ringed in accent), the live
// member list as a full-width section, and a compact "already included" row.
// Deterministic features, zero credits. Logic is unchanged from the rail
// version — only the presentation is center-grade.

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "../use-focus-trap";
import type { ChatSettings } from "@/lib/projects/types";
import type { PlacedModule } from "@/lib/projects/module-placements";
import {
  BarChart3,
  Calendar,
  ChatIcon,
  Globe,
  Grid3,
  Inbox,
  Loader,
  LockIcon,
  Megaphone,
  MessageSq,
  Package,
  Sparkles,
  Trash,
  Users,
  X,
} from "../icons";
import { publishedHost } from "@/lib/publish/base-host";

// ⚰️ «Mis plataformas» salió de esta unión el 2026-08-31 con el perfil de
// negocio: era la banda de redes que el perfil sembraba, y sin perfil no tenía
// de dónde sacar un solo enlace.
//
// MEDIDO al retirarlo, y vale la pena dejarlo escrito: de esta unión sólo
// `chat` construye una `ModuleEntry` de verdad. `comments` lleva tiempo siendo
// vocabulario sin tarjeta — código muerto que sigue hablando.
type ModuleKey =
  | "chat"
  | "comments";

interface ModuleEntry {
  key: ModuleKey;
  icon: ReactNode;
  title: string;
  tagline: string;
  scope: string;
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
  /** false → the drawer hides the Switch, para un módulo que no se enciende
   *  con `settings.enabled` sino por estar colocado. */
  toggleable?: boolean;
  /** One live-state line shown on the ACTIVE card (mode/number/mount/placement). */
  status?: string;
  /** Overrides `tagline` on the AVAILABLE card only (e.g. Broadcast's needsMembers hint). */
  availableHint?: string;
  /** Full settings JSX — identical to what used to render inline in ModCard's children. */
  body: ReactNode;
}

interface MemberItem {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "invited";
  createdAt: string;
  lastLoginAt: string | null;
}

interface ModulesPanelProps {
  currentProjectId?: string | null;
  /** How many pages currently carry the members-only flag. */
  /** Comments module enable card — toggles + moderation + insert section. */
  /** Bookings module enable card — toggles + settings + insert section. */
  /** Private chat module — toggle + mount + self-serve. */
  chatSettings?: ChatSettings;
  onUpdateChat?: (patch: ChatSettings) => Promise<boolean>;
  /** Create a dedicated brand-matched page for the module (bookings/collections). */
  onCreateModulePage?: (module: "bookings" | "collections") => void | Promise<void>;
  onShowLeads?: () => void;
  onShowAnalytics?: () => void;
  onShowAssistant?: () => void;
  /** Where each content module's band already lives across the site —
   *  drives the hub's "En: inicio, /catalogo" state line. */
  placements?: Record<PlacedModule, string[]>;
  /** Jump to the Library so the user can drop a module section onto another page. */
  onOpenLibrary?: () => void;
  /** Destination-page selector for the content group — the hub hides the
   *  canvas, so "a esta página" is invisible without naming it here. */
  sitePages?: { slug: string; title: string }[];
  activeSitePage?: string | null;
  onSwitchPage?: (slug: string | null) => void;
  homePageLabel?: string;
  /** WHICH SITE these modules belong to — users own several sites, so the
   *  hub must name it (título + subdominio publicado si existe). */
  projectTitle?: string | null;
  projectSubdomain?: string | null;
}

export function ModulesPanel({
  currentProjectId,
  chatSettings,
  onUpdateChat,
  onCreateModulePage,
  onShowLeads,
  onShowAnalytics,
  onShowAssistant,
  placements,
  onOpenLibrary,
  sitePages,
  activeSitePage,
  onSwitchPage,
  homePageLabel,
  projectTitle,
  projectSubdomain,
}: ModulesPanelProps) {
  const tw = useTranslations("wsPage");
  const chatOn = chatSettings?.enabled === true;
  const chatMount = chatSettings?.mount ?? "both";
  const chatSelfServe = chatSettings?.selfServeJoin !== false;
  const chatIdentityMode = chatSettings?.identityMode ?? "guest";
  const chatTheme = chatSettings?.theme ?? "light";
  const [chatBusy, setChatBusy] = useState(false);
  const [chatWelcomeLocal, setChatWelcomeLocal] = useState(chatSettings?.welcome ?? "");
  const [chatQRs, setChatQRs] = useState<{ _key: string; q: string; a: string }[]>(
    (chatSettings?.quickReplies ?? []).map(r => ({ _key: crypto.randomUUID(), q: r.q, a: r.a }))
  );
  const [busy, setBusy] = useState(false);

  // Fix 3: resync chat local state when the active project changes
  useEffect(() => {
    setChatWelcomeLocal(chatSettings?.welcome ?? "");
    setChatQRs((chatSettings?.quickReplies ?? []).map(r => ({ _key: crypto.randomUUID(), q: r.q, a: r.a })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);
  const [inserted, setInserted] = useState(false);
  const [autoPageSlug, setAutoPageSlug] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<ModuleKey | null>(null);

  const activeCount = [
    chatOn,
  ].filter(Boolean).length;

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center px-6 py-24 text-center">
        <div className="max-w-[260px]">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Users size={18} />
          </div>
          <p className="text-[13px] fg-muted leading-relaxed">{tw("modulesHub.perProject")}</p>
        </div>
      </div>
    );
  }

  const updateChat = async (patch: ChatSettings) => {
    if (chatBusy || !onUpdateChat) return;
    setChatBusy(true);
    await onUpdateChat(patch);
    setChatBusy(false);
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-[26px] font-display fg leading-tight">{tw("modulesHub.title")}</h1>
          <p className="text-[13.5px] fg-muted mt-1.5 leading-snug">{tw("modulesHub.subtitle")}</p>
          {projectTitle && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full ring-1 ring-[color:var(--border)] bg-elev px-3 py-1.5 max-w-full">
              <Globe size={13} className="text-accent shrink-0" />
              <span className="text-[10px] uppercase tracking-[0.12em] fg-faint font-semibold shrink-0">
                {tw("modulesHub.siteLabel")}
              </span>
              <span className="text-[12.5px] font-semibold fg truncate">{projectTitle}</span>
              {projectSubdomain && (
                <span className="text-[11px] fg-faint truncate">
                  {publishedHost(projectSubdomain)}
                </span>
              )}
            </div>
          )}
        </div>
        {activeCount > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft px-2.5 py-1.5 rounded-full tabular">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {activeCount}
          </span>
        )}
      </header>

      {/* Estado en vivo por módulo — reusado por la tarjeta activa Y el drawer. */}
      {(() => {
        const bookingsPlacement =
          placements && placements.bookings.length > 0
            ? tw("modulesHub.placedIn", {
                pages: placements.bookings
                  .map((s) => (s === "" ? tw("modulesHub.home") : `/${s}`))
                  .join(", "),
              })
            : tw("modulesHub.placedNowhere");
        const scopeSiteText = tw("modulesHub.scopeSite");
        const scopePageText = tw("modulesHub.scopePage");

        const modules: ModuleEntry[] = [
          {
            key: "chat",
            icon: <ChatIcon size={18} />,
            title: tw("chat.title"),
            tagline: tw("chat.tagline"),
            scope: scopeSiteText,
            on: chatOn,
            busy: chatBusy,
            onToggle: () => void updateChat({ enabled: !chatOn }),
            status: tw(`chat.mount.${chatMount}`),
            body: (
              <div className="space-y-2">
                <Segment
                  value={chatMount}
                  options={[
                    { id: "fab", label: tw("chat.mount.fab") },
                    { id: "section", label: tw("chat.mount.section") },
                    { id: "both", label: tw("chat.mount.both") },
                  ]}
                  disabled={chatBusy}
                  onPick={(v) => void updateChat({ mount: v as "fab" | "section" | "both" })}
                />
                <p className="text-[11.5px] fg-faint leading-relaxed">
                  {tw(`chat.mount.${chatMount}Hint`)}
                </p>
                <ToggleRow
                  label={tw("chat.selfServeJoin")}
                  hint={tw("chat.selfServeJoinHint")}
                  checked={chatSelfServe}
                  disabled={chatBusy}
                  onChange={(v) => void updateChat({ selfServeJoin: v })}
                />
                <ToggleRow
                  label={tw("chat.requireAccount")}
                  hint={tw("chat.requireAccountHint")}
                  checked={chatIdentityMode === "account"}
                  disabled={chatBusy}
                  onChange={(v) => void updateChat({ identityMode: v ? "account" : "guest" })}
                />
                <div className="space-y-1">
                  <div className="text-[12px] font-medium fg-muted">{tw("chat.welcome")}</div>
                  <input
                    value={chatWelcomeLocal}
                    disabled={chatBusy}
                    onChange={(e) => setChatWelcomeLocal(e.target.value)}
                    onBlur={(e) => void updateChat({ welcome: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    maxLength={200}
                    placeholder={tw("chat.welcomePlaceholder")}
                    className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-3 h-9 text-[13px] fg outline-none focus:ring-[color:var(--accent)] transition disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[12px] font-medium fg-muted">{tw("chat.theme")}</div>
                  <Segment
                    value={chatTheme}
                    options={[
                      { id: "light", label: tw("chat.themeLight") },
                      { id: "dark", label: tw("chat.themeDark") },
                    ]}
                    disabled={chatBusy}
                    onPick={(v) => void updateChat({ theme: v as "light" | "dark" })}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[12px] font-medium fg-muted">{tw("chat.quickReplies")}</div>
                  {chatQRs.map((qr, i) => (
                    <div key={qr._key} className="flex items-center gap-1.5">
                      <input
                        value={qr.q}
                        onChange={(e) => {
                          const next = chatQRs.map((r, j) => j === i ? { ...r, q: e.target.value } : r);
                          setChatQRs(next);
                        }}
                        onBlur={() => void updateChat({ quickReplies: chatQRs.map(({ q, a }) => ({ q, a })) })}
                        placeholder={tw("chat.qrQ")}
                        maxLength={40}
                        className="flex-1 min-w-0 bg-app ring-1 ring-[color:var(--border)] rounded-lg px-2.5 h-8 text-[12px] fg outline-none focus:ring-[color:var(--accent)] transition"
                      />
                      <input
                        value={qr.a}
                        onChange={(e) => {
                          const next = chatQRs.map((r, j) => j === i ? { ...r, a: e.target.value } : r);
                          setChatQRs(next);
                        }}
                        onBlur={() => void updateChat({ quickReplies: chatQRs.map(({ q, a }) => ({ q, a })) })}
                        placeholder={tw("chat.qrA")}
                        maxLength={500}
                        className="flex-1 min-w-0 bg-app ring-1 ring-[color:var(--border)] rounded-lg px-2.5 h-8 text-[12px] fg outline-none focus:ring-[color:var(--accent)] transition"
                      />
                      <button
                        type="button"
                        aria-label="Remove"
                        disabled={chatBusy}
                        onClick={() => {
                          const next = chatQRs.filter((_, j) => j !== i);
                          setChatQRs(next);
                          void updateChat({ quickReplies: next.map(({ q, a }) => ({ q, a })) });
                        }}
                        className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-40"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={chatBusy || chatQRs.length >= 6}
                    onClick={() => {
                      if (chatQRs.length >= 6) return;
                      setChatQRs([...chatQRs, { _key: crypto.randomUUID(), q: "", a: "" }]);
                    }}
                    className="h-7 px-3 rounded-lg text-[12px] font-medium fg-muted hover:fg bg-app ring-1 ring-[color:var(--border)] hover:bg-hover transition disabled:opacity-40"
                  >
                    + {tw("chat.qrAdd")}
                  </button>
                  <p className="text-[10.5px] fg-faint leading-relaxed">{tw("chat.qrHint")}</p>
                </div>
                {currentProjectId && (
                  <AgentsList projectId={currentProjectId} tw={tw} />
                )}
                <p className="text-[10.5px] fg-faint leading-relaxed">{tw("modulesHub.seePreview")}</p>
              </div>
            ),
          },
        ];

        const activeModules = modules.filter((m) => m.on);
        const availableModules = modules.filter((m) => !m.on);
        const openModule = modules.find((m) => m.key === openKey) ?? null;

        return (
          <>
            {activeModules.length > 0 && (
              <>
                <div className="text-[10.5px] uppercase tracking-[0.18em] fg font-semibold ui-small mb-2.5">
                  {tw("modulesHub.activeGroup")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                  {activeModules.map((m) => (
                    <ActiveModuleCard
                      key={m.key}
                      mod={m}
                      openLabel={tw("modulesHub.open")}
                      onOpen={() => setOpenKey(m.key)}
                    />
                  ))}
                </div>
              </>
            )}

            {availableModules.length > 0 && (
              <>
                <div className={`text-[10.5px] uppercase tracking-[0.18em] fg font-semibold ui-small mb-2.5 ${activeModules.length > 0 ? "mt-6" : ""}`}>
                  {tw("modulesHub.availableGroup")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                  {availableModules.map((m) => (
                    <AvailableModuleCard
                      key={m.key}
                      mod={m}
                      activateLabel={tw("modulesHub.activate")}
                      onOpen={() => setOpenKey(m.key)}
                    />
                  ))}
                </div>
              </>
            )}

            <ModuleDrawer
              module={openModule}
              onClose={() => setOpenKey(null)}
              closeLabel={tw("modulesHub.drawerClose")}
            />
          </>
        );
      })()}

      {/* Already included */}
      <div className="mt-8">
        <div className="text-[10.5px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small mb-2.5">
          {tw("modulesHub.included.title")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <IncludedCard icon={<Inbox size={15} />} title={tw("modulesHub.included.forms")} hint={tw("modulesHub.included.formsHint")} onOpen={onShowLeads} openLabel={tw("modulesHub.included.open")} />
          <IncludedCard icon={<BarChart3 size={15} />} title={tw("modulesHub.included.analytics")} hint={tw("modulesHub.included.analyticsHint")} onOpen={onShowAnalytics} openLabel={tw("modulesHub.included.open")} />
          <IncludedCard icon={<Sparkles size={15} />} title={tw("modulesHub.included.assistant")} hint={tw("modulesHub.included.assistantHint")} onOpen={onShowAssistant} openLabel={tw("modulesHub.included.open")} />
        </div>
      </div>
    </div>
  );
}

// ACTIVE-group card — icon tile, name, one live status line, scope tag
// top-right, "Abrir ›" footer. The whole card is one button: clicking
// anywhere opens the drawer (no separate hit target to keep track of).
function ActiveModuleCard({
  mod,
  onOpen,
  openLabel,
}: {
  mod: ModuleEntry;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left w-full rounded-2xl bg-elev shadow-card p-[18px] ring-1 ring-[color:var(--accent)]/40 transition duration-150 hover:-translate-y-0.5 hover:shadow-elev hover:ring-[color:var(--accent)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-accent-soft text-accent">
            {mod.icon}
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold fg leading-tight tracking-[-0.01em] truncate">{mod.title}</div>
            {mod.status && (
              <div className="text-[11.5px] fg-muted leading-snug mt-1 truncate">{mod.status}</div>
            )}
          </div>
        </div>
        <span className="shrink-0 text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold">
          {mod.scope}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        <span className="text-[11px] fg-muted group-hover:fg transition">{openLabel} ›</span>
      </div>
    </button>
  );
}

// AVAILABLE-group card — same skeleton, muted tile, tagline (or a special
// hint, e.g. Broadcast's "turn on Accounts first"), primary "Activar" pill.
// Clicking anywhere (card or the pill) opens the drawer without toggling the
// module — flipping it on happens from inside the drawer.
function AvailableModuleCard({
  mod,
  onOpen,
  activateLabel,
}: {
  mod: ModuleEntry;
  onOpen: () => void;
  activateLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left w-full rounded-2xl bg-elev shadow-card p-[18px] ring-1 ring-[color:var(--border)] transition duration-150 hover:-translate-y-0.5 hover:shadow-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-hover fg-muted">
            {mod.icon}
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold fg leading-tight tracking-[-0.01em] truncate">{mod.title}</div>
            <div className="text-[11.5px] fg-muted leading-snug mt-1 truncate">
              {mod.availableHint ?? mod.tagline}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold">
          {mod.scope}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        <span className="h-7 px-3 inline-flex items-center justify-center rounded-md text-[11.5px] font-medium text-white bg-[var(--accent-strong)] group-hover:brightness-105 transition">
          {activateLabel}
        </span>
      </div>
    </button>
  );
}

// The "Se agregará a" page-target selector — was one shared block above the
// old Content grid; now duplicated into each content module's drawer body
// (bookings/collections/comments) since the drawer only shows one module at
// a time. Same onSwitchPage/activeSitePage props, no logic change.
function TargetPageSelector({
  activeSitePage,
  sitePages,
  homePageLabel,
  onSwitchPage,
  label,
}: {
  activeSitePage?: string | null;
  sitePages?: { slug: string; title: string }[];
  homePageLabel?: string;
  onSwitchPage: (slug: string | null) => void;
  label: string;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-[0.12em] fg-faint font-semibold mb-1">
        {label}
      </label>
      <select
        value={activeSitePage ?? ""}
        onChange={(e) => onSwitchPage(e.target.value || null)}
        className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-2.5 h-8 text-[12px] fg outline-none focus:ring-[color:var(--accent)] transition"
      >
        <option value="">{homePageLabel ?? "inicio"}</option>
        {(sitePages ?? []).map((p) => (
          <option key={p.slug} value={p.slug}>
            /{p.slug} — {p.title}
          </option>
        ))}
      </select>
    </div>
  );
}

// The right-side config drawer — one module at a time. Header carries the
// icon tile, name, scope tag, the module's own enable Switch, and a close
// X; body is the full settings JSX moved verbatim from the old inline
// ModCard children. `content` remembers the last non-null module so the
// sheet keeps showing it while sliding out (avoids a blank flash on close).
//
// Portaled to the `.workspace-v2` root: the workspace shell locks
// `body { overflow: hidden; height: 100dvh }` (app/globals.css) so the
// layout never collapses — but that traps this drawer's `position: fixed`
// stacking BELOW the TopBar's own `relative z-30` header instead of above
// it, even at z-50. Rendering as a sibling of the header (still inside
// `.workspace-v2` so the scoped design tokens/utility classes keep
// resolving) sidesteps the nested stacking context entirely.
function ModuleDrawer({
  module,
  onClose,
  closeLabel,
}: {
  module: ModuleEntry | null;
  onClose: () => void;
  closeLabel: string;
}) {
  const [content, setContent] = useState<ModuleEntry | null>(null);
  useEffect(() => {
    if (module) setContent(module);
  }, [module]);

  useEffect(() => {
    if (!module) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [module, onClose]);

  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalRoot(document.querySelector<HTMLElement>(".workspace-v2") ?? document.body);
  }, []);

  const isOpen = !!module;
  const trapRef = useFocusTrap(isOpen);

  if (!portalRoot) return null;

  return createPortal(
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!isOpen}
        tabIndex={-1}
        // El cajón queda montado tras cerrarse (animación de salida): sin
        // inert sus controles siguen siendo tabulables fuera de pantalla.
        inert={!isOpen}
        className={`fixed right-0 top-0 z-50 h-full w-[400px] max-w-[92vw] bg-app border-l bd shadow-2xl overflow-y-auto nice-scroll transition-transform duration-200 motion-reduce:transition-none ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {content && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-accent-soft text-accent">
                {content.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="text-[16px] font-semibold fg leading-tight tracking-[-0.01em] truncate">
                    {content.title}
                  </div>
                  <span className="ml-auto shrink-0 text-[8.5px] uppercase tracking-[0.12em] px-1 py-0.5 rounded fg-faint bg-hover font-semibold">
                    {content.scope}
                  </span>
                </div>
                <div className="text-[12.5px] fg-muted leading-snug mt-1">{content.tagline}</div>
              </div>
              {content.toggleable !== false && (
                <Switch on={content.on} disabled={content.busy} label={content.title} onClick={content.onToggle} />
              )}
              <button
                type="button"
                aria-label={closeLabel}
                onClick={onClose}
                className="shrink-0 -mt-0.5 -mr-1 h-7 w-7 inline-flex items-center justify-center rounded-lg fg-faint hover:fg hover:bg-hover transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mt-4">{content.body}</div>
          </div>
        )}
      </div>
    </>,
    portalRoot,
  );
}

function Switch({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition ${
        on ? "bg-[var(--accent)]" : "bg-zinc-300 dark:bg-zinc-700"
      } disabled:opacity-50`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
          on ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

function Segment({
  value,
  options,
  disabled,
  onPick,
}: {
  value: string;
  options: { id: string; label: string }[];
  disabled?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex rounded-lg bg-app ring-1 ring-[color:var(--border)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.id)}
          className={`flex-1 h-7 rounded-md text-[11.5px] font-medium transition ${
            value === o.id ? "seg-active" : "fg-faint hover:fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A prominent full-width accent action (e.g. "Create booking page" / "Add
// WhatsApp section") — the new branded-surface CTA on a module card.
function SurfaceButton({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  /** One accent CTA per drawer — everything else stays quiet. */
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full inline-flex items-center justify-center h-8 rounded-lg text-[12px] font-medium transition ${
        primary
          ? "text-white bg-[var(--accent-strong)] hover:brightness-105"
          : "fg bg-hover hover:bg-app ring-1 ring-[color:var(--border)]"
      }`}
    >
      {label}
    </button>
  );
}

function CardActions({
  onInsert,
  insertLabel,
  inserted,
  insertedLabel,
  onManage,
  manageLabel,
  note,
}: {
  onInsert?: () => void;
  insertLabel: string;
  inserted: boolean;
  insertedLabel: string;
  onManage?: () => void;
  manageLabel: string;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      {note && <p className="text-[10.5px] fg-faint leading-relaxed">{note}</p>}
      {inserted && (
        <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
          {insertedLabel}
        </p>
      )}
      <div className="flex gap-2">
        {onInsert && (
          <button
            type="button"
            onClick={onInsert}
            className="flex-1 inline-flex items-center justify-center h-8 rounded-lg text-[12px] font-medium fg-muted hover:fg bg-app ring-1 ring-[color:var(--border)] hover:bg-hover transition"
          >
            {insertLabel}
          </button>
        )}
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="flex-1 h-8 rounded-lg text-[12px] font-medium text-white bg-[var(--accent-strong)] hover:brightness-105 transition"
          >
            {manageLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function IncludedCard({
  icon,
  title,
  hint,
  onOpen,
  openLabel,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onOpen?: () => void;
  openLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl ring-1 ring-[color:var(--border)] bg-elev px-3 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover fg-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium fg leading-tight">{title}</div>
        <div className="text-[10.5px] fg-faint leading-snug truncate">{hint}</div>
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 h-7 px-2.5 rounded-md text-[11px] font-medium fg-muted hover:fg bg-app ring-1 ring-[color:var(--border)] hover:bg-hover transition"
        >
          {openLabel}
        </button>
      )}
    </div>
  );
}


interface AgentItem {
  id: string;
  invitedEmail: string;
  status: string;
  createdAt: string;
}

function AgentsList({
  projectId,
  tw,
}: {
  projectId: string;
  tw: ReturnType<typeof useTranslations<"wsPage">>;
}) {
  const [agents, setAgents] = useState<AgentItem[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fetch(`/api/projects/${projectId}/agents`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ agents: AgentItem[] }>;
      })
      .then((d) => setAgents(d.agents))
      .catch(() => setAgents([]));
  };

  useEffect(() => {
    setAgents(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const invite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (r.status === 404) {
        const d = (await r.json()) as { error?: string };
        setError(tw(d.error === "no_account" ? "chat.team.noAccount" : "chat.team.inviteError"));
      } else if (r.status === 400) {
        setError(tw("chat.team.selfInvite"));
      } else if (!r.ok) {
        setError(tw("chat.team.inviteError"));
      } else {
        setEmail("");
        load();
      }
    } catch {
      setError(tw("chat.team.inviteError"));
    }
    setBusy(false);
  };

  const remove = async (agentId: string) => {
    setRemoving(agentId);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/${agentId}`, {
        method: "DELETE",
      });
      if (r.ok) load();
      else setError(tw("chat.team.removeError"));
    } catch {
      setError(tw("chat.team.removeError"));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="pt-2 space-y-2">
      <div className="text-[10.5px] uppercase tracking-[0.14em] fg-faint font-semibold">
        {tw("chat.team.title")}
      </div>

      {/* Invite row */}
      <div className="flex items-center gap-1.5">
        <input
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void invite(); }}
          type="email"
          placeholder={tw("chat.team.placeholder")}
          className="flex-1 min-w-0 bg-app ring-1 ring-[color:var(--border)] rounded-lg px-2.5 h-8 text-[12px] fg outline-none focus:ring-[color:var(--accent)] transition"
        />
        <button
          type="button"
          disabled={busy || !email.trim()}
          onClick={() => void invite()}
          className="shrink-0 h-8 px-3 rounded-lg bg-[var(--accent-strong)] text-white text-[12px] font-medium hover:brightness-105 transition disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy && <Loader size={10} className="animate-spin" />}
          {tw("chat.team.invite")}
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">{error}</p>
      )}

      {/* Agent list */}
      {agents === null && (
        <div className="space-y-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      )}
      {agents !== null && agents.length === 0 && (
        <p className="text-[11px] fg-faint leading-snug">{tw("chat.team.empty")}</p>
      )}
      {agents !== null && agents.length > 0 && (
        <ul className="space-y-0.5">
          {agents.map((a) => (
            <li
              key={a.id}
              className="group flex items-center gap-2 rounded-lg px-2 h-8 hover:bg-hover transition"
            >
              <span className="flex-1 min-w-0 text-[12px] fg truncate">{a.invitedEmail}</span>
              <span
                className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  a.status === "active"
                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                    : "fg-faint bg-hover"
                }`}
              >
                {a.status === "active" ? tw("chat.team.statusActive") : tw("chat.team.statusInvited")}
              </span>
              <button
                type="button"
                disabled={removing === a.id}
                aria-label={tw("chat.team.remove")}
                title={tw("chat.team.remove")}
                onClick={() => void remove(a.id)}
                className="h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded-md fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50 shrink-0"
              >
                {removing === a.id ? (
                  <Loader size={10} className="animate-spin" />
                ) : (
                  <Trash size={10} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium fg leading-tight">{label}</div>
        {hint && <div className="text-[10.5px] fg-faint leading-snug mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full transition ${
          checked ? "bg-[var(--accent)]" : "bg-zinc-300 dark:bg-zinc-700"
        } disabled:opacity-50`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${
            checked ? "left-[16px]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  );
}
