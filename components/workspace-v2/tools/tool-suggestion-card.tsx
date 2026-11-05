"use client";
// THE «CREAR» CARD UNDER LEN'S ANSWER (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's
// personalized-page card (client-ui-creation-recommendations, at fcc0ad4621, MIT) for an OpenLen tool. Unstarted: the
// title, the brief folded after about two lines, the initial content folded below, the place («En el rail», «En el
// proyecto», «Escribe dónde»), a closable notice of time and credits the browser remembers, «Crear» and «Ahora no».
// Then: creating (Cancelar, which waits for the cleanup), installing, installed (Abrir, Deshacer), removed
// (Restaurar), failed, cancelled or interrupted (Reintentar), needs your review (the findings, Instalar igual, Abrir
// proyecto), replaced (dimmed) and dismissed (one line). The press is the only thing that creates or installs.
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Info, Wrench, X } from "lucide-react";

import { CUSTOM_LOCATION_MAX, type ToolCardView } from "@/lib/tools/cards/types";

import { pressToolCard, toolCardsLive, type ToolCardPressResult } from "./use-tool-cards";

const NOTICE_KEY = "openlen.toolCard.costNotice";

type Place = "rail" | "project" | "custom";

function noticeHidden(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "hidden";
  } catch {
    return false;
  }
}

function rememberNotice(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(NOTICE_KEY, "hidden");
    else localStorage.removeItem(NOTICE_KEY);
  } catch {
    // Without storage it shows again next time.
  }
}

const primary = "rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60";
const secondary = "rounded-md px-3 py-1.5 text-[12.5px] fg-muted hover:bg-hover disabled:opacity-60";

export function ToolSuggestionCard({
  card,
  capCredits,
  onPress,
  onOpen,
  onOpenProject,
}: {
  card: ToolCardView;
  capCredits: number;
  onPress: (verb: string, payload?: Record<string, unknown>) => Promise<ToolCardPressResult>;
  onOpen?: (installationId: string) => void;
  onOpenProject?: (projectId: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const [place, setPlace] = useState<Place>(card.customLocation ? "custom" : card.placement);
  const [words, setWords] = useState(card.customLocation ?? "");
  const [notice, setNotice] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => setNotice(!noticeHidden()), []);

  const send = async (verb: string, payload?: Record<string, unknown>) => {
    setPending(verb);
    setRefusal(null);
    const r = await onPress(verb, payload);
    setPending(null);
    if (r.status === "refused") setRefusal(r.reason);
  };
  const placePayload = (): Record<string, unknown> => (place === "custom" ? { customLocation: words.trim() } : { placement: place });
  const wordsOk = words.trim().length >= 1 && words.trim().length <= CUSTOM_LOCATION_MAX;

  if (card.phase === "dismissed") {
    return (
      <p className="mt-2 text-[12px] fg-faint" data-tool-card={card.phase}>
        {t("toolCard.dismissed", { title: card.title })}
      </p>
    );
  }

  const busy = pending !== null;
  return (
    <div className={`mt-2 rounded-xl border bd bg-elev px-3 py-2.5 text-[12.5px] ${card.phase === "replaced" ? "opacity-50" : ""}`} data-tool-card={card.phase}>
      <div className="flex items-center gap-1.5">
        <Wrench size={13} className="shrink-0 text-[var(--nc-accent-text)]" />
        <p className="min-w-0 truncate text-[13px] font-semibold fg">{card.title}</p>
      </div>
      <p className={`mt-1 whitespace-pre-wrap fg-muted ${briefOpen ? "" : "line-clamp-2"}`}>{card.brief}</p>
      {card.brief.length > 160 ? (
        <button type="button" onClick={() => setBriefOpen((o) => !o)} className="text-[11.5px] text-[var(--nc-accent-text)]">
          {briefOpen ? t("toolCard.less") : t("toolCard.more")}
        </button>
      ) : null}
      {card.initialContent ? (
        <details className="mt-1.5" data-tool-card-content="">
          <summary className="cursor-pointer text-[11.5px] fg-muted">{t("toolCard.initialContent")}</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--hover)] px-2 py-1.5 text-[11.5px] fg">{card.initialContent}</pre>
        </details>
      ) : null}

      {card.phase === "proposed" ? (
        <>
          <label className="mt-2 flex items-center gap-2 text-[12px] fg-muted">
            {t("toolCard.place")}
            <select
              data-tool-card-place=""
              value={place}
              onChange={(e) => setPlace(e.target.value as Place)}
              className="rounded-md border bd bg-[var(--bg)] px-2 py-1 text-[12px] fg"
            >
              <option value="rail">{t("toolCard.inRail")}</option>
              <option value="project">{t("toolCard.inProject")}</option>
              <option value="custom">{t("toolCard.custom")}</option>
            </select>
          </label>
          {place === "custom" ? (
            <textarea
              data-tool-card-custom=""
              value={words}
              onChange={(e) => setWords(e.target.value)}
              onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)}
              placeholder={t("toolCard.customPlaceholder")}
              rows={2}
              className="mt-1.5 w-full rounded-md border bd bg-[var(--bg)] px-2 py-1.5 text-[12px] fg"
            />
          ) : null}
          {notice ? (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--hover)] px-2.5 py-1.5 text-[12px] fg-muted" data-tool-card-notice="">
              <span className="min-w-0 flex-1">{t("toolCard.notice", { cap: capCredits })}</span>
              <button
                type="button"
                aria-label={t("toolCard.closeNotice")}
                onClick={() => {
                  setNotice(false);
                  rememberNotice(true);
                }}
                className="shrink-0 rounded p-0.5 hover:bg-hover"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            <button type="button" disabled={busy || (place === "custom" && !wordsOk)} onClick={() => void send("create", placePayload())} className={primary}>
              {t("toolCard.create")}
            </button>
            <button type="button" disabled={busy} onClick={() => void send("dismiss", place === "custom" ? undefined : { placement: place })} className={secondary}>
              {t("toolCard.notNow")}
            </button>
            {!notice ? (
              <button
                type="button"
                aria-label={t("toolCard.showNotice")}
                onClick={() => {
                  setNotice(true);
                  rememberNotice(false);
                }}
                className="ml-auto rounded p-1 fg-muted hover:bg-hover"
              >
                <Info size={13} />
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {card.phase === "creating" ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 fg-muted">{t("toolCard.creating")}</span>
          <button type="button" disabled={busy} onClick={() => void send("cancel")} className={secondary}>
            {pending === "cancel" ? t("toolCard.cancelling") : t("toolCard.cancel")}
          </button>
        </div>
      ) : null}
      {card.phase === "installing" ? <p className="mt-2 fg-muted">{t("toolCard.installing")}</p> : null}

      {card.phase === "installed" ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[var(--nc-ok)]">{t("toolCard.installed")}</span>
          <button type="button" disabled={busy || !card.installationId} onClick={() => card.installationId && onOpen?.(card.installationId)} className={primary}>
            {t("toolCard.open")}
          </button>
          <button type="button" disabled={busy} onClick={() => void send("undo")} className={secondary}>
            {t("toolCard.undo")}
          </button>
        </div>
      ) : null}

      {card.phase === "removed" ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 fg-muted">{t("toolCard.removed")}</span>
          <button type="button" disabled={busy} onClick={() => void send("restore")} className={secondary}>
            {t("toolCard.restore")}
          </button>
        </div>
      ) : null}

      {card.phase === "failed" || card.phase === "cancelled" || card.phase === "interrupted" ? (
        <div className="mt-2">
          <p className="text-[var(--nc-warn)]">
            {card.phase === "failed" ? t("toolCard.failed") : card.phase === "cancelled" ? t("toolCard.cancelled") : t("toolCard.interrupted")}
          </p>
          {card.phase === "failed" && card.error ? <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11.5px] fg-muted">{card.error}</p> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void send("retry")} className={primary}>
              {t("toolCard.retry")}
            </button>
          </div>
        </div>
      ) : null}

      {card.phase === "needs_review" && card.review ? (
        <div className="mt-2">
          <p className="font-medium fg">{t("toolCard.needsReview")}</p>
          <div className="mt-1.5 rounded-lg bg-[var(--hover)] px-2.5 py-1.5 text-[12px] fg">
            <p className="font-medium">{card.review.kind === "security_findings" ? t("installCard.findings") : t("installCard.destructive")}</p>
            <ul className="mt-1 list-disc pl-4">
              {card.review.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void send("install_anyway")} className={primary}>
              {t("toolCard.installAnyway")}
            </button>
            <button type="button" disabled={busy || !card.toolProjectId} onClick={() => card.toolProjectId && onOpenProject?.(card.toolProjectId)} className={secondary}>
              {t("toolCard.openProject")}
            </button>
          </div>
        </div>
      ) : null}

      {refusal ? (
        <p className="mt-2 text-[12px] text-[var(--nc-warn)]">
          {refusal === "plan_required" ? t("toolCard.planRequired") : refusal === "source-missing" ? t("toolCard.sourceMissing") : t("toolCard.refused", { reason: refusal })}
        </p>
      ) : null}
    </div>
  );
}

/** The cards Len proposed in one answer, read from the chat's store; nothing (and no router) when there are none. */
export function ToolSuggestionCards({ projectId, rowId }: { projectId: string; rowId: string }) {
  const snapshot = useSyncExternalStore(toolCardsLive.subscribe, toolCardsLive.snapshot, toolCardsLive.snapshot);
  const cards = [...snapshot.values()].filter((c) => c.projectId === projectId && c.chatRowId === rowId);
  return cards.length === 0 ? null : <CardsWithActions projectId={projectId} cards={cards} />;
}

function CardsWithActions({ projectId, cards }: { projectId: string; cards: readonly ToolCardView[] }) {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();
  const go = (set: Record<string, string>, keep: boolean) => {
    const params = new URLSearchParams(keep ? (searchParams?.toString() ?? "") : "");
    for (const [k, v] of Object.entries(set)) params.set(k, v);
    // The workspace's own URL, in the person's language (`localePrefix: "always"`).
    router.replace(`/${locale}/new?${params.toString()}`);
  };
  return (
    <>
      {cards.map((card) => (
        <ToolSuggestionCard
          key={card.id}
          card={card}
          capCredits={toolCardsLive.capCredits()}
          onPress={(verb, payload) => pressToolCard(projectId, card.id, verb, payload, { locale, timeZone })}
          // An installed rail tool opens in the center, keeping the project open (as the rail does).
          onOpen={(installationId) => go({ view: "tool", tool: installationId }, true)}
          onOpenProject={(toolProjectId) => go({ project: toolProjectId }, false)}
        />
      ))}
    </>
  );
}
