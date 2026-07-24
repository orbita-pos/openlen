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
import type {
  BookingsSettings,
  BroadcastSettings,
  ChatSettings,
  CollectionsSettings,
  CommentsSettings,
  MembersSettings,
  OrdersSettings,
  WhatsAppSettings,
} from "@/lib/projects/types";
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

// The 8 modules the hub can show — drives which one the drawer has open.
type ModuleKey =
  | "members"
  | "broadcast"
  | "whatsapp"
  | "chat"
  | "bookings"
  | "collections"
  | "comments"
  | "orders";

interface ModuleEntry {
  key: ModuleKey;
  icon: ReactNode;
  title: string;
  tagline: string;
  scope: string;
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
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
  membersSettings?: MembersSettings;
  /** How many pages currently carry the members-only flag. */
  gatedCount: number;
  /** PATCH settings.members. First enable may auto-create the members page
   *  (born from the home shell, already locked) — createdPageSlug drives
   *  the one-time hint under the toggle. */
  onUpdateMembers?: (
    patch: MembersSettings,
  ) => Promise<{ ok: boolean; createdPageSlug?: string }>;
  /** Broadcast module enable card — toggles settings.broadcast.enabled. */
  broadcastSettings?: BroadcastSettings;
  onUpdateBroadcast?: (patch: BroadcastSettings) => Promise<boolean>;
  onShowBroadcast?: () => void;
  /** Comments module enable card — toggles + moderation + insert section. */
  commentsSettings?: CommentsSettings;
  onUpdateComments?: (patch: CommentsSettings) => Promise<boolean>;
  onInsertCommentsSection?: () => void;
  onShowComments?: () => void;
  /** Bookings module enable card — toggles + settings + insert section. */
  bookingsSettings?: BookingsSettings;
  onUpdateBookings?: (patch: BookingsSettings) => Promise<boolean>;
  onInsertBookingsSection?: () => void;
  onShowBookings?: () => void;
  /** Collections module enable card — toggle + insert section + manage. */
  collectionsSettings?: CollectionsSettings;
  onUpdateCollections?: (patch: CollectionsSettings) => Promise<boolean>;
  onInsertCollectionsSection?: () => void;
  onShowCollections?: () => void;
  /** WhatsApp button module — toggle + number + prefilled message. */
  whatsappSettings?: WhatsAppSettings;
  onUpdateWhatsapp?: (patch: WhatsAppSettings) => Promise<boolean>;
  /** Pedidos por WhatsApp module — toggle + destination number. */
  ordersSettings?: OrdersSettings;
  onUpdateOrders?: (patch: OrdersSettings) => Promise<boolean>;
  /** Private chat module — toggle + mount + self-serve. */
  chatSettings?: ChatSettings;
  onUpdateChat?: (patch: ChatSettings) => Promise<boolean>;
  /** Create a dedicated brand-matched page for the module (bookings/collections). */
  onCreateModulePage?: (module: "bookings" | "collections") => void | Promise<void>;
  /** Insert the designed WhatsApp CTA section into the home. */
  onAddWhatsappSection?: () => void;
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
  membersSettings,
  broadcastSettings,
  gatedCount,
  onUpdateMembers,
  onUpdateBroadcast,
  onShowBroadcast,
  commentsSettings,
  onUpdateComments,
  onInsertCommentsSection,
  onShowComments,
  bookingsSettings,
  onUpdateBookings,
  onInsertBookingsSection,
  onShowBookings,
  collectionsSettings,
  onUpdateCollections,
  onInsertCollectionsSection,
  onShowCollections,
  whatsappSettings,
  onUpdateWhatsapp,
  ordersSettings,
  onUpdateOrders,
  chatSettings,
  onUpdateChat,
  onCreateModulePage,
  onAddWhatsappSection,
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
  const t = useTranslations("members");
  const tb = useTranslations("broadcast");
  const tc = useTranslations("comments");
  const tbk = useTranslations("bookings");
  const tcol = useTranslations("collections");
  const tw = useTranslations("wsPage");
  const enabled = membersSettings?.enabled === true;
  const mode = membersSettings?.mode === "invite" ? "invite" : "open";
  const broadcastOn = broadcastSettings?.enabled === true;
  const commentsOn = commentsSettings?.enabled === true;
  const commentsMod = commentsSettings?.moderation === "all" ? "all" : "moderated";
  const commentsTheme = commentsSettings?.theme ?? "light";
  const bookingsOn = bookingsSettings?.enabled === true;
  const bookingsRequireLogin = bookingsSettings?.requireLogin === true;
  const bookingsTheme = bookingsSettings?.theme ?? "light";
  const bookingsAutoConfirm = bookingsSettings?.autoConfirm !== false;
  const bookingsReminders = bookingsSettings?.sendReminders !== false;
  const collectionsOn = collectionsSettings?.enabled === true;
  const whatsappOn = whatsappSettings?.enabled === true;
  const ordersOn = ordersSettings?.enabled === true;
  const chatOn = chatSettings?.enabled === true;
  const chatMount = chatSettings?.mount ?? "both";
  const chatSelfServe = chatSettings?.selfServeJoin !== false;
  const chatIdentityMode = chatSettings?.identityMode ?? "guest";
  const chatTheme = chatSettings?.theme ?? "light";
  const [waBusy, setWaBusy] = useState(false);
  const [waNumber, setWaNumber] = useState(whatsappSettings?.number ?? "");
  const [waMessage, setWaMessage] = useState(whatsappSettings?.message ?? "");
  // Enabling with an empty number gets the business-profile default filled
  // server-side; it arrives via the settings sync. Only fill an EMPTY field —
  // never clobber what the user is typing.
  useEffect(() => {
    const n = whatsappSettings?.number ?? "";
    if (n) setWaNumber((cur) => (cur.trim() ? cur : n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappSettings?.number]);
  const [ordBusy, setOrdBusy] = useState(false);
  const [ordNumber, setOrdNumber] = useState(
    ordersSettings?.number ?? whatsappSettings?.number ?? "",
  );
  const [chatBusy, setChatBusy] = useState(false);
  const [chatWelcomeLocal, setChatWelcomeLocal] = useState(chatSettings?.welcome ?? "");
  const [chatQRs, setChatQRs] = useState<{ _key: string; q: string; a: string }[]>(
    (chatSettings?.quickReplies ?? []).map(r => ({ _key: crypto.randomUUID(), q: r.q, a: r.a }))
  );
  const [busy, setBusy] = useState(false);
  const [bcastBusy, setBcastBusy] = useState(false);

  // Fix 3: resync chat local state when the active project changes
  useEffect(() => {
    setChatWelcomeLocal(chatSettings?.welcome ?? "");
    setChatQRs((chatSettings?.quickReplies ?? []).map(r => ({ _key: crypto.randomUUID(), q: r.q, a: r.a })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);
  const [cmtBusy, setCmtBusy] = useState(false);
  // Bookings: el lock es POR PERILLA (una perilla en vuelo no congela las
  // otras) y los PATCH se encolan — el settings del proyecto se reescribe
  // entero en cada uno, así que en paralelo se pisarían.
  const [bkBusyKeys, setBkBusyKeys] = useState<(keyof BookingsSettings)[]>([]);
  const bkQueue = useRef<Promise<void>>(Promise.resolve());
  const bkBusy = (key: keyof BookingsSettings) => bkBusyKeys.includes(key);
  const [bkInserted, setBkInserted] = useState(false);
  const [colBusy, setColBusy] = useState(false);
  const [colInserted, setColInserted] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [autoPageSlug, setAutoPageSlug] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<ModuleKey | null>(null);

  const activeCount = [
    enabled,
    bookingsOn,
    broadcastOn,
    commentsOn,
    collectionsOn,
    whatsappOn,
    ordersOn,
    chatOn,
  ].filter(Boolean).length;

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center px-6 py-24 text-center">
        <div className="max-w-[260px]">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Users size={18} />
          </div>
          <p className="text-[13px] fg-muted leading-relaxed">{t("perProject")}</p>
        </div>
      </div>
    );
  }

  const setEnabled = async (next: boolean) => {
    if (busy || !onUpdateMembers) return;
    setBusy(true);
    const result = await onUpdateMembers(
      next
        ? { enabled: true, mode: membersSettings?.mode ?? "open", passwordLogin: true, accountArea: true }
        : { enabled: false },
    );
    if (next && result.ok) setAutoPageSlug("cuenta");
    if (!next) setAutoPageSlug(null);
    setBusy(false);
  };
  const setMode = async (next: "open" | "invite") => {
    if (busy || !onUpdateMembers || next === mode) return;
    setBusy(true);
    await onUpdateMembers({ mode: next });
    setBusy(false);
  };
  const setBroadcastEnabled = async (next: boolean) => {
    if (bcastBusy || !onUpdateBroadcast) return;
    setBcastBusy(true);
    await onUpdateBroadcast({ enabled: next });
    setBcastBusy(false);
  };
  const setCommentsEnabled = async (next: boolean) => {
    if (cmtBusy || !onUpdateComments) return;
    setCmtBusy(true);
    await onUpdateComments({ enabled: next });
    setCmtBusy(false);
  };
  const setCommentsMod = async (next: "all" | "moderated") => {
    if (cmtBusy || !onUpdateComments || next === commentsMod) return;
    setCmtBusy(true);
    await onUpdateComments({ moderation: next });
    setCmtBusy(false);
  };
  const setCommentsTheme = async (next: "light" | "dark") => {
    if (cmtBusy || !onUpdateComments || next === commentsTheme) return;
    setCmtBusy(true);
    await onUpdateComments({ theme: next });
    setCmtBusy(false);
  };
  const updateBookings = (patch: BookingsSettings) => {
    if (!onUpdateBookings) return;
    const keys = Object.keys(patch) as (keyof BookingsSettings)[];
    if (keys.some((k) => bkBusyKeys.includes(k))) return;
    setBkBusyKeys((cur) => [...cur, ...keys]);
    const run = async () => {
      try {
        // Seed the creator tz from the browser on first enable so new services
        // default to the right zone without the owner typing it.
        if (patch.enabled === true && !bookingsSettings?.creatorTz) {
          try {
            patch.creatorTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            /* leave unset; the editor defaults it */
          }
        }
        await onUpdateBookings(patch);
      } finally {
        setBkBusyKeys((cur) => cur.filter((k) => !keys.includes(k)));
      }
    };
    bkQueue.current = bkQueue.current.then(run, run).catch(() => {});
  };
  const updateCollections = async (patch: CollectionsSettings) => {
    if (colBusy || !onUpdateCollections) return;
    setColBusy(true);
    await onUpdateCollections(patch);
    setColBusy(false);
  };
  const updateWhatsapp = async (patch: WhatsAppSettings) => {
    if (waBusy || !onUpdateWhatsapp) return;
    setWaBusy(true);
    await onUpdateWhatsapp(patch);
    setWaBusy(false);
  };
  const commitWhatsapp = () => {
    void updateWhatsapp({ number: waNumber.trim(), message: waMessage.trim() });
  };
  const updateOrders = async (patch: OrdersSettings) => {
    if (ordBusy || !onUpdateOrders) return;
    setOrdBusy(true);
    await onUpdateOrders(patch);
    setOrdBusy(false);
  };
  const commitOrders = () => {
    void updateOrders({ number: ordNumber.trim() });
  };
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
          <h1 className="text-[26px] font-display fg leading-tight">{t("title")}</h1>
          <p className="text-[13.5px] fg-muted mt-1.5 leading-snug">{t("subtitle")}</p>
          {projectTitle && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full ring-1 ring-[color:var(--border)] bg-elev px-3 py-1.5 max-w-full">
              <Globe size={13} className="text-accent shrink-0" />
              <span className="text-[10px] uppercase tracking-[0.12em] fg-faint font-semibold shrink-0">
                {tw("modulesHub.siteLabel")}
              </span>
              <span className="text-[12.5px] font-semibold fg truncate">{projectTitle}</span>
              {projectSubdomain && (
                <span className="text-[11px] fg-faint truncate">
                  {projectSubdomain}.openlen.com
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
        const collectionsPlacement =
          placements && placements.collections.length > 0
            ? tw("modulesHub.placedIn", {
                pages: placements.collections
                  .map((s) => (s === "" ? tw("modulesHub.home") : `/${s}`))
                  .join(", "),
              })
            : tw("modulesHub.placedNowhere");
        const commentsPlacement =
          placements && placements.comments.length > 0
            ? tw("modulesHub.placedIn", {
                pages: placements.comments
                  .map((s) => (s === "" ? tw("modulesHub.home") : `/${s}`))
                  .join(", "),
              })
            : tw("modulesHub.placedNowhere");
        const scopeSiteText = tw("modulesHub.scopeSite");
        const scopePageText = tw("modulesHub.scopePage");

        const modules: ModuleEntry[] = [
          {
            key: "members",
            icon: <Users size={18} />,
            title: t("module.title"),
            tagline: t("module.tagline"),
            scope: scopeSiteText,
            on: enabled,
            busy,
            onToggle: () => void setEnabled(!enabled),
            status: t(`module.mode.${mode}`),
            body: (
              <div className="space-y-2.5">
                {autoPageSlug && (
                  <p className="rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                    {t("module.accountLive")}
                  </p>
                )}
                <Segment
                  value={mode}
                  options={[
                    { id: "open", label: t("module.mode.open") },
                    { id: "invite", label: t("module.mode.invite") },
                  ]}
                  disabled={busy}
                  onPick={(v) => void setMode(v as "open" | "invite")}
                />
                <p className="text-[11.5px] fg-faint leading-relaxed">
                  {t(`module.mode.${mode}Hint`)}
                </p>
                <p className="text-[11.5px] leading-relaxed fg-muted inline-flex items-start gap-1.5">
                  <LockIcon size={12} className="mt-[1px] shrink-0" />
                  <span>
                    {gatedCount > 0
                      ? t("module.gatedCount", { count: gatedCount })
                      : t("module.gatedNone")}
                  </span>
                </p>
                {enabled && (
                  <p className="text-[11.5px] fg-muted leading-relaxed">
                    {t("module.doorPages")}
                  </p>
                )}
                <p className="text-[10.5px] fg-faint leading-relaxed">{tw("modulesHub.seePreview")}</p>
              </div>
            ),
          },
          {
            key: "broadcast",
            icon: <Megaphone size={18} />,
            title: tb("module.title"),
            tagline: tb("module.tagline"),
            scope: scopeSiteText,
            on: broadcastOn,
            busy: bcastBusy || !enabled,
            onToggle: () => void setBroadcastEnabled(!broadcastOn),
            status: tb("module.enabledHint"),
            availableHint: !enabled ? tb("module.needsMembers") : undefined,
            body: !enabled ? (
              <p className="text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                {tb("module.needsMembers")}
              </p>
            ) : (
              <button
                type="button"
                onClick={onShowBroadcast}
                className="w-full inline-flex items-center justify-center h-8 rounded-lg text-[12px] font-medium fg-muted hover:fg bg-app ring-1 ring-[color:var(--border)] hover:bg-hover transition"
              >
                {tb("module.enabledHint")}
              </button>
            ),
          },
          {
            key: "whatsapp",
            icon: <MessageSq size={18} />,
            title: tw("whatsapp.title"),
            tagline: tw("whatsapp.tagline"),
            scope: scopeSiteText,
            on: whatsappOn,
            busy: waBusy,
            onToggle: () => void updateWhatsapp({ enabled: !whatsappOn }),
            status: `${waNumber.trim() || tw("whatsapp.missingNumber")} · ${scopeSiteText}`,
            body: (
              <div className="space-y-2">
                <input
                  value={waNumber}
                  onChange={(e) => setWaNumber(e.target.value)}
                  onBlur={commitWhatsapp}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  inputMode="tel"
                  maxLength={32}
                  placeholder={tw("whatsapp.numberPlaceholder")}
                  className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-3 h-9 text-[13px] fg outline-none focus:ring-[color:var(--accent)] transition"
                />
                <input
                  value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)}
                  onBlur={commitWhatsapp}
                  maxLength={300}
                  placeholder={tw("whatsapp.messagePlaceholder")}
                  className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-3 h-9 text-[13px] fg outline-none focus:ring-[color:var(--accent)] transition"
                />
                {!waNumber.trim() && (
                  <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
                    {tw("whatsapp.missingNumber")}
                  </p>
                )}
                <p className="text-[10.5px] fg-faint leading-relaxed">{tw("whatsapp.note")}</p>
                {!!whatsappSettings?.number?.trim() && onAddWhatsappSection && (
                  <SurfaceButton
                    label={tw("moduleSurface.addWhatsappSection")}
                    onClick={onAddWhatsappSection}
                  />
                )}
              </div>
            ),
          },
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
          {
            key: "bookings",
            icon: <Calendar size={18} />,
            title: tbk("module.title"),
            tagline: tbk("module.tagline"),
            scope: scopePageText,
            on: bookingsOn,
            busy: bkBusy("enabled"),
            onToggle: () => void updateBookings({ enabled: !bookingsOn }),
            status: bookingsPlacement,
            body: (
              <div className="space-y-2">
                {enabled && (
                  <ToggleRow
                    label={tbk("module.requireLogin")}
                    hint={bookingsRequireLogin ? tbk("module.requireLoginHint") : tbk("module.guestHint")}
                    checked={bookingsRequireLogin}
                    disabled={bkBusy("requireLogin")}
                    onChange={(v) => void updateBookings({ requireLogin: v })}
                  />
                )}
                <ToggleRow
                  label={tbk("module.autoConfirm")}
                  hint={bookingsAutoConfirm ? tbk("module.autoConfirmHint") : tbk("module.approveHint")}
                  checked={bookingsAutoConfirm}
                  disabled={bkBusy("autoConfirm")}
                  onChange={(v) => void updateBookings({ autoConfirm: v })}
                />
                <ToggleRow
                  label={tbk("module.reminders")}
                  hint={tbk("module.remindersHint")}
                  checked={bookingsReminders}
                  disabled={bkBusy("sendReminders")}
                  onChange={(v) => void updateBookings({ sendReminders: v })}
                />
                {/* Tema del widget en la página publicada (los VALORES Claro/
                    Oscuro sí se reusan del chat; la etiqueta es neutra). */}
                <div className="space-y-1">
                  <div className="text-[12px] font-medium fg-muted">{tw("modulesHub.theme")}</div>
                  <Segment
                    value={bookingsTheme}
                    options={[
                      { id: "light", label: tw("chat.themeLight") },
                      { id: "dark", label: tw("chat.themeDark") },
                    ]}
                    disabled={bkBusy("theme")}
                    onPick={(v) => void updateBookings({ theme: v as "light" | "dark" })}
                  />
                </div>
                <CardActions
                  onInsert={onInsertBookingsSection ? () => { onInsertBookingsSection(); setBkInserted(true); } : undefined}
                  insertLabel={tbk("module.insert")}
                  inserted={bkInserted}
                  insertedLabel={tbk("module.inserted")}
                  onManage={onShowBookings}
                  manageLabel={tbk("module.manage")}
                  note={tbk("module.noCharge")}
                />
                {onCreateModulePage && (
                  <SurfaceButton
                    label={tw("moduleSurface.createBookingPage")}
                    onClick={() => void onCreateModulePage("bookings")}
                  />
                )}
                <p className="text-[10.5px] fg-faint leading-relaxed">{bookingsPlacement}</p>
                {onOpenLibrary && (
                  <SurfaceButton label={tw("modulesHub.addToPage")} onClick={onOpenLibrary} />
                )}
                {onSwitchPage && (
                  <TargetPageSelector
                    activeSitePage={activeSitePage}
                    sitePages={sitePages}
                    homePageLabel={homePageLabel}
                    onSwitchPage={onSwitchPage}
                    label={tw("modulesHub.targetLabel")}
                  />
                )}
              </div>
            ),
          },
          {
            key: "collections",
            icon: <Grid3 size={18} />,
            title: tcol("module.title"),
            tagline: tcol("module.tagline"),
            scope: scopePageText,
            on: collectionsOn,
            busy: colBusy,
            onToggle: () => void updateCollections({ enabled: !collectionsOn }),
            status: collectionsPlacement,
            body: (
              <div className="space-y-2">
                <CardActions
                  onInsert={onInsertCollectionsSection ? () => { onInsertCollectionsSection(); setColInserted(true); } : undefined}
                  insertLabel={tcol("module.insert")}
                  inserted={colInserted}
                  insertedLabel={tcol("module.inserted")}
                  onManage={onShowCollections}
                  manageLabel={tcol("module.manage")}
                  note={tcol("module.noCharge")}
                />
                {onCreateModulePage && (
                  <SurfaceButton
                    label={tw("moduleSurface.createCatalogPage")}
                    onClick={() => void onCreateModulePage("collections")}
                  />
                )}
                <p className="text-[10.5px] fg-faint leading-relaxed">{collectionsPlacement}</p>
                {onOpenLibrary && (
                  <SurfaceButton label={tw("modulesHub.addToPage")} onClick={onOpenLibrary} />
                )}
                {onSwitchPage && (
                  <TargetPageSelector
                    activeSitePage={activeSitePage}
                    sitePages={sitePages}
                    homePageLabel={homePageLabel}
                    onSwitchPage={onSwitchPage}
                    label={tw("modulesHub.targetLabel")}
                  />
                )}
              </div>
            ),
          },
          {
            key: "comments",
            icon: <MessageSq size={18} />,
            title: tc("module.title"),
            tagline: tc("module.tagline"),
            scope: scopePageText,
            on: commentsOn,
            busy: cmtBusy || !enabled,
            onToggle: () => void setCommentsEnabled(!commentsOn),
            status: commentsPlacement,
            body: !enabled ? (
              <p className="text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                {tc("module.needsMembers")}
              </p>
            ) : (
              <div className="space-y-2">
                <Segment
                  value={commentsMod}
                  options={[
                    { id: "moderated", label: tc("module.modModerated") },
                    { id: "all", label: tc("module.modAll") },
                  ]}
                  disabled={cmtBusy}
                  onPick={(v) => void setCommentsMod(v as "all" | "moderated")}
                />
                <p className="text-[11.5px] fg-faint leading-relaxed">
                  {tc(commentsMod === "moderated" ? "module.modModeratedHint" : "module.modAllHint")}
                </p>
                {/* Tema del widget (valores Claro/Oscuro del chat; etiqueta neutra). */}
                <div className="space-y-1">
                  <div className="text-[12px] font-medium fg-muted">{tw("modulesHub.theme")}</div>
                  <Segment
                    value={commentsTheme}
                    options={[
                      { id: "light", label: tw("chat.themeLight") },
                      { id: "dark", label: tw("chat.themeDark") },
                    ]}
                    disabled={cmtBusy}
                    onPick={(v) => void setCommentsTheme(v as "light" | "dark")}
                  />
                </div>
                <CardActions
                  onInsert={onInsertCommentsSection ? () => { onInsertCommentsSection(); setInserted(true); } : undefined}
                  insertLabel={tc("module.insert")}
                  inserted={inserted}
                  insertedLabel={tc("module.inserted")}
                  onManage={onShowComments}
                  manageLabel={tc("title")}
                />
                <p className="text-[10.5px] fg-faint leading-relaxed">{commentsPlacement}</p>
                {onOpenLibrary && (
                  <SurfaceButton label={tw("modulesHub.addToPage")} onClick={onOpenLibrary} />
                )}
                {onSwitchPage && (
                  <TargetPageSelector
                    activeSitePage={activeSitePage}
                    sitePages={sitePages}
                    homePageLabel={homePageLabel}
                    onSwitchPage={onSwitchPage}
                    label={tw("modulesHub.targetLabel")}
                  />
                )}
              </div>
            ),
          },
          {
            key: "orders",
            icon: <Package size={18} />,
            title: tw("orders.title"),
            tagline: tw("orders.tagline"),
            scope: scopePageText,
            on: ordersOn,
            busy: ordBusy,
            onToggle: () =>
              void updateOrders({
                enabled: !ordersOn,
                ...(!ordersOn && ordNumber.trim() ? { number: ordNumber.trim() } : {}),
              }),
            status: `${ordNumber.trim() || tw("orders.numberPlaceholder")} · ${scopePageText}`,
            body: (
              <div className="space-y-2">
                <input
                  value={ordNumber}
                  onChange={(e) => setOrdNumber(e.target.value)}
                  onBlur={commitOrders}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  inputMode="tel"
                  maxLength={32}
                  placeholder={tw("orders.numberPlaceholder")}
                  className="w-full bg-app ring-1 ring-[color:var(--border)] rounded-lg px-3 h-9 text-[13px] fg outline-none focus:ring-[color:var(--accent)] transition"
                />
                <p className="text-[10.5px] fg-faint leading-relaxed">{tw("orders.note")}</p>
                {collectionsSettings?.enabled !== true && (
                  <p className="text-[10.5px] fg-faint leading-relaxed">
                    {tw("orders.needsCatalog")}
                  </p>
                )}
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

      {/* Members section — the live list, full width. */}
      {enabled && (
        <div className="mt-5">
          <MembersList projectId={currentProjectId} />
        </div>
      )}

      {/* Already included */}
      <div className="mt-8">
        <div className="text-[10.5px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small mb-2.5">
          {t("included.title")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <IncludedCard icon={<Inbox size={15} />} title={t("included.forms")} hint={t("included.formsHint")} onOpen={onShowLeads} openLabel={t("included.open")} />
          <IncludedCard icon={<BarChart3 size={15} />} title={t("included.analytics")} hint={t("included.analyticsHint")} onOpen={onShowAnalytics} openLabel={t("included.open")} />
          <IncludedCard icon={<Sparkles size={15} />} title={t("included.assistant")} hint={t("included.assistantHint")} onOpen={onShowAssistant} openLabel={t("included.open")} />
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
              <Switch on={content.on} disabled={content.busy} label={content.title} onClick={content.onToggle} />
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

function MembersList({ projectId }: { projectId: string }) {
  const t = useTranslations("members");
  const [items, setItems] = useState<MemberItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [cap, setCap] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void fetch(`/api/projects/${projectId}/members`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ members: MemberItem[]; count: number; cap: number }>;
      })
      .then((d) => {
        setItems(d.members);
        setCount(d.count);
        setCap(d.cap);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("list.loadError"));
        setItems([]);
      });
  };

  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviting) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.status === 409) setInviteMsg(t("invite.duplicate"));
      else if (r.status === 402) setInviteMsg(t("invite.cap"));
      else if (!r.ok) setInviteMsg(t("invite.error"));
      else {
        setInviteEmail("");
        const d = (await r.json()) as { emailed?: boolean };
        setInviteMsg(d.emailed ? t("invite.sentEmailed") : t("invite.sent"));
        load();
      }
    } catch {
      setInviteMsg(t("invite.error"));
    }
    setInviting(false);
  };

  const remove = async (memberId: string) => {
    setRemoving(memberId);
    try {
      const r = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "DELETE",
      });
      if (r.ok) load();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="rounded-2xl ring-1 ring-[color:var(--border)] bg-elev shadow-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3.5">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold fg leading-tight tracking-[-0.01em]">
            {t("list.title")}
          </div>
        </div>
        {cap > 0 && (
          <span className="shrink-0 text-[12px] font-semibold fg-muted tabular mt-0.5">
            {count} / {cap}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input
          value={inviteEmail}
          onChange={(e) => {
            setInviteEmail(e.target.value);
            setInviteMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          type="email"
          placeholder={t("invite.placeholder")}
          className="flex-1 min-w-0 bg-app border bd rounded-lg px-3 h-9 text-[13px] fg outline-none focus:border-[color:var(--accent)] transition"
        />
        <button
          type="button"
          disabled={inviting || !inviteEmail.trim()}
          onClick={() => void invite()}
          className="shrink-0 h-9 px-4 rounded-lg bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {inviting && <Loader size={11} className="animate-spin" />}
          {t("invite.cta")}
        </button>
      </div>
      {inviteMsg && (
        <div className="pb-1 text-[11px] fg-muted leading-snug">{inviteMsg}</div>
      )}
      {error && (
        <div className="mb-1.5 rounded-lg ring-1 ring-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {items === null && (
        <div className="space-y-1.5 pt-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 rounded-xl bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      )}
      {items !== null && items.length === 0 && !error && (
        <p className="pt-2 text-[11.5px] fg-faint leading-relaxed">{t("list.empty")}</p>
      )}
      {items !== null && items.length > 0 && (
        <ul className="pt-1 space-y-0.5">
          {items.map((m) => (
            <li
              key={m.id}
              className="group flex items-center gap-3 rounded-xl px-2 h-11 hover:bg-hover transition"
            >
              <span className="h-8 w-8 shrink-0 grid place-items-center rounded-full bg-accent-soft text-accent text-[12px] font-bold uppercase">
                {(m.name || m.email).trim().charAt(0) || "?"}
              </span>
              <span className="flex-1 min-w-0 text-[13px] fg truncate">{m.email}</span>
              <span
                className={`shrink-0 text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                  m.status === "active"
                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                    : "fg-faint bg-hover"
                }`}
              >
                {t(`list.status.${m.status}`)}
              </span>
              <button
                type="button"
                disabled={removing === m.id}
                aria-label={t("list.remove", { email: m.email })}
                title={t("list.remove", { email: m.email })}
                onClick={() => void remove(m.id)}
                className="h-7 w-7 hidden group-hover:inline-flex items-center justify-center rounded-md fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50 shrink-0"
              >
                {removing === m.id ? (
                  <Loader size={11} className="animate-spin" />
                ) : (
                  <Trash size={11} />
                )}
              </button>
            </li>
          ))}
        </ul>
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
