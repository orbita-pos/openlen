// Módulos — the one-click backend modules hub, laid out for the workspace
// CENTER (a wide view, not the old 272px rail). A responsive grid of module
// cards (toggle + inline settings, active cards ringed in accent), the live
// member list as a full-width section, and a compact "already included" row.
// Deterministic features, zero credits. Logic is unchanged from the rail
// version — only the presentation is center-grade.

"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  BookingsSettings,
  BroadcastSettings,
  ChatSettings,
  CollectionsSettings,
  CommentsSettings,
  MembersSettings,
  WhatsAppSettings,
} from "@/lib/projects/types";
import {
  BarChart3,
  Calendar,
  ChatIcon,
  Grid3,
  Inbox,
  Loader,
  LockIcon,
  Megaphone,
  MessageSq,
  Sparkles,
  Trash,
  Users,
} from "../icons";

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
  chatSettings,
  onUpdateChat,
  onCreateModulePage,
  onAddWhatsappSection,
  onShowLeads,
  onShowAnalytics,
  onShowAssistant,
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
  const bookingsOn = bookingsSettings?.enabled === true;
  const bookingsRequireLogin = bookingsSettings?.requireLogin === true;
  const bookingsAutoConfirm = bookingsSettings?.autoConfirm !== false;
  const bookingsReminders = bookingsSettings?.sendReminders !== false;
  const collectionsOn = collectionsSettings?.enabled === true;
  const whatsappOn = whatsappSettings?.enabled === true;
  const chatOn = chatSettings?.enabled === true;
  const chatMount = chatSettings?.mount ?? "both";
  const chatSelfServe = chatSettings?.selfServeJoin !== false;
  const [waBusy, setWaBusy] = useState(false);
  const [waNumber, setWaNumber] = useState(whatsappSettings?.number ?? "");
  const [waMessage, setWaMessage] = useState(whatsappSettings?.message ?? "");
  const [chatBusy, setChatBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bcastBusy, setBcastBusy] = useState(false);
  const [cmtBusy, setCmtBusy] = useState(false);
  const [bkBusy, setBkBusy] = useState(false);
  const [bkInserted, setBkInserted] = useState(false);
  const [colBusy, setColBusy] = useState(false);
  const [colInserted, setColInserted] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [autoPageSlug, setAutoPageSlug] = useState<string | null>(null);

  const activeCount = [
    enabled,
    bookingsOn,
    broadcastOn,
    commentsOn,
    collectionsOn,
    whatsappOn,
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
    const result = await onUpdateMembers({ enabled: next });
    if (next && result.ok && result.createdPageSlug) {
      setAutoPageSlug(result.createdPageSlug);
    }
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
  const updateBookings = async (patch: BookingsSettings) => {
    if (bkBusy || !onUpdateBookings) return;
    setBkBusy(true);
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
    setBkBusy(false);
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
        </div>
        {activeCount > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft px-2.5 py-1.5 rounded-full tabular">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {activeCount}
          </span>
        )}
      </header>

      {/* Module grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
        {/* Miembros */}
        <ModCard
          icon={<Users size={18} />}
          title={t("module.title")}
          tagline={t("module.tagline")}
          on={enabled}
          busy={busy}
          onToggle={() => void setEnabled(!enabled)}
        >
          {enabled && (
            <div className="space-y-2.5">
              {autoPageSlug && (
                <p className="rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                  {t("module.autoPage", { slug: autoPageSlug })}
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
            </div>
          )}
        </ModCard>

        {/* Reservas */}
        <ModCard
          icon={<Calendar size={18} />}
          title={tbk("module.title")}
          tagline={tbk("module.tagline")}
          on={bookingsOn}
          busy={bkBusy}
          onToggle={() => void updateBookings({ enabled: !bookingsOn })}
        >
          {bookingsOn && (
            <div className="space-y-2">
              {enabled && (
                <ToggleRow
                  label={tbk("module.requireLogin")}
                  hint={bookingsRequireLogin ? tbk("module.requireLoginHint") : tbk("module.guestHint")}
                  checked={bookingsRequireLogin}
                  disabled={bkBusy}
                  onChange={(v) => void updateBookings({ requireLogin: v })}
                />
              )}
              <ToggleRow
                label={tbk("module.autoConfirm")}
                hint={bookingsAutoConfirm ? tbk("module.autoConfirmHint") : tbk("module.approveHint")}
                checked={bookingsAutoConfirm}
                disabled={bkBusy}
                onChange={(v) => void updateBookings({ autoConfirm: v })}
              />
              <ToggleRow
                label={tbk("module.reminders")}
                hint={tbk("module.remindersHint")}
                checked={bookingsReminders}
                disabled={bkBusy}
                onChange={(v) => void updateBookings({ sendReminders: v })}
              />
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
            </div>
          )}
        </ModCard>

        {/* Broadcast */}
        <ModCard
          icon={<Megaphone size={18} />}
          title={tb("module.title")}
          tagline={tb("module.tagline")}
          on={broadcastOn}
          busy={bcastBusy || !enabled}
          onToggle={() => void setBroadcastEnabled(!broadcastOn)}
        >
          {(broadcastOn || !enabled) && (
            !enabled ? (
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
            )
          )}
        </ModCard>

        {/* Comentarios */}
        <ModCard
          icon={<MessageSq size={18} />}
          title={tc("module.title")}
          tagline={tc("module.tagline")}
          on={commentsOn}
          busy={cmtBusy || !enabled}
          onToggle={() => void setCommentsEnabled(!commentsOn)}
        >
          {(commentsOn || !enabled) && (
            !enabled ? (
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
                <CardActions
                  onInsert={onInsertCommentsSection ? () => { onInsertCommentsSection(); setInserted(true); } : undefined}
                  insertLabel={tc("module.insert")}
                  inserted={inserted}
                  insertedLabel={tc("module.inserted")}
                  onManage={onShowComments}
                  manageLabel={tc("title")}
                />
              </div>
            )
          )}
        </ModCard>

        {/* Colecciones */}
        <ModCard
          icon={<Grid3 size={18} />}
          title={tcol("module.title")}
          tagline={tcol("module.tagline")}
          on={collectionsOn}
          busy={colBusy}
          onToggle={() => void updateCollections({ enabled: !collectionsOn })}
        >
          {collectionsOn && (
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
            </div>
          )}
        </ModCard>

        {/* WhatsApp */}
        <ModCard
          icon={<MessageSq size={18} />}
          title={tw("whatsapp.title")}
          tagline={tw("whatsapp.tagline")}
          on={whatsappOn}
          busy={waBusy}
          onToggle={() => void updateWhatsapp({ enabled: !whatsappOn })}
        >
          {whatsappOn && (
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
              <p className="text-[10.5px] fg-faint leading-relaxed">{tw("whatsapp.note")}</p>
              {!!whatsappSettings?.number?.trim() && onAddWhatsappSection && (
                <SurfaceButton
                  label={tw("moduleSurface.addWhatsappSection")}
                  onClick={onAddWhatsappSection}
                />
              )}
            </div>
          )}
        </ModCard>

        {/* Chat */}
        <ModCard
          icon={<ChatIcon size={18} />}
          title={tw("chat.title")}
          tagline={tw("chat.tagline")}
          on={chatOn}
          busy={chatBusy}
          onToggle={() => void updateChat({ enabled: !chatOn })}
        >
          {chatOn && (
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
            </div>
          )}
        </ModCard>
      </div>

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

// A module tile: icon, title, tagline, toggle. When `on`, the children
// (settings / actions) render under a hairline divider. Active tiles get an
// accent ring so the page reads at a glance.
function ModCard({
  icon,
  title,
  tagline,
  on,
  busy,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  tagline: string;
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl bg-elev shadow-card p-[18px] ring-1 transition duration-150 hover:-translate-y-0.5 hover:shadow-elev ${
        on
          ? "ring-[color:color-mix(in_oklch,var(--accent)_45%,var(--border))]"
          : "ring-[color:var(--border)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-accent-soft text-accent">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold fg leading-tight tracking-[-0.01em]">{title}</div>
          <div className="text-[12.5px] fg-muted leading-snug mt-1">{tagline}</div>
        </div>
        <Switch on={on} disabled={busy} label={title} onClick={onToggle} />
      </div>
      {children && <div className="mt-3.5 pt-3.5 border-t bd">{children}</div>}
    </div>
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
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full inline-flex items-center justify-center h-8 rounded-lg text-[12px] font-medium text-white bg-[var(--accent-strong)] hover:brightness-105 transition"
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
