"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";
import { useToast } from "./toast";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Custom-domain modal.
//
// Flow:
//   1. User types `landing.miempresa.com` + clicks Add.
//   2. POST /api/projects/[id]/domains returns DNS instructions (A record
//      to our IP + TXT challenge with a per-claim token).
//   3. User adds both records at their DNS provider.
//   4. User clicks Verify (or it auto-polls every 30s). The verify endpoint
//      resolves `_openlen-challenge.<domain>` and matches the token.
//   5. On success, the row is flagged verified. Caddy's on_demand_tls picks
//      up the next handshake and auto-issues a Let's Encrypt cert.
//
// Releasing (Trash icon) deletes the row immediately — the cert lingers in
// Caddy's storage until natural expiry, but no traffic reaches the project
// because the lookup returns null.
// ─────────────────────────────────────────────────────────────────────────────

interface DnsInstructions {
  txt: { name: string; value: string; ttl: number };
  a: { name: string; value: string; ttl: number };
  cname: { name: string; value: string; ttl: number } | null;
}

interface DomainRow {
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  verificationToken: string;
  createdAt: string;
}

/** Domain Connect availability for a single pending claim — populated
 *  lazily when the modal lists/adds domains. `null` means "we asked and
 *  the user's DNS provider isn't supported (or signing isn't configured)";
 *  `undefined` means "haven't checked yet". */
interface ConnectAvailability {
  url: string;
  providerName: string;
}

export interface CustomDomainModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Current `*.openlen.com` slug claimed by this project. Null = not yet
   *  published; the modal then shows a "publish first" step with an editable
   *  subdomain instead of silently claiming one. */
  projectSubdomain: string | null;
  /** Project title — seeds the default subdomain in the publish-first step. */
  projectTitle?: string;
  /** Notify the parent that the project was just published from this modal.
   *  The parent re-fetches so the TopBar Live pill + publish state stay in
   *  sync without a hard refresh. */
  onAutoPublished?: (subdomain: string) => void;
}

// Seed the publish-first subdomain field with a friendly slug from the title
// (the user can edit it). Falls back to p-<id8> when the title yields nothing
// usable. Pure-numeric is avoided — the publish API rejects it.
function defaultSubdomain(
  title: string | undefined,
  projectId: string,
): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug && !/^\d+$/.test(slug) ? slug : `p-${projectId.slice(0, 8)}`;
}

// Mirrors the server validator — same regex, same suffix denylist. Catches
// obviously-bad input without a round-trip; the API still re-validates.
const DOMAIN_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RESERVED_SUFFIXES = [".openlen.com"];

function normalizeInput(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}

type ClientValidationError = "invalidHostname" | "reservedSubdomain";

function clientValidate(domain: string): ClientValidationError | null {
  if (!domain) return null;
  if (!DOMAIN_REGEX.test(domain)) return "invalidHostname";
  for (const suffix of RESERVED_SUFFIXES) {
    if (domain.endsWith(suffix)) {
      return "reservedSubdomain";
    }
  }
  return null;
}

export function CustomDomainModal({
  open,
  onClose,
  projectId,
  projectSubdomain,
  projectTitle,
  onAutoPublished,
}: CustomDomainModalProps) {
  const t = useTranslations("modalsDomain");
  const toast = useToast();
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until the project has a claimed subdomain. Gates the modal between the
  // "publish first" step and the domain-claim UI.
  const [autoPublishedSub, setAutoPublishedSub] = useState<string | null>(
    projectSubdomain,
  );
  // Publish-first step — editable subdomain + in-flight flag.
  const [subInput, setSubInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [lastAddedDns, setLastAddedDns] = useState<
    | { domain: string; dns: DnsInstructions }
    | null
  >(null);
  // Per-domain Domain Connect availability cache. Key = domain, value =
  // { url, providerName } when supported, null after a failed check.
  const [connect, setConnect] = useState<
    Record<string, ConnectAvailability | null>
  >({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Probe the Domain Connect endpoint for a single host. Stores the result
  // in `connect` regardless of outcome — null means "not supported", which
  // is the most common case (most DNS providers aren't onboarded yet).
  const probeConnect = useCallback(
    async (domain: string) => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/domains/${encodeURIComponent(domain)}/connect-url`,
        );
        if (!res.ok) {
          setConnect((m) => ({ ...m, [domain]: null }));
          return;
        }
        const body = (await res.json()) as {
          ok?: boolean;
          url?: string;
          provider?: { name?: string };
        };
        if (body.ok && body.url) {
          setConnect((m) => ({
            ...m,
            [domain]: {
              url: body.url!,
              providerName:
                body.provider?.name ??
                t("customDomain.defaultProviderName"),
            },
          }));
        } else {
          setConnect((m) => ({ ...m, [domain]: null }));
        }
      } catch {
        setConnect((m) => ({ ...m, [domain]: null }));
      }
    },
    [projectId, t],
  );

  // Pulls the current claim list. Called on mount + after every mutation.
  // Also kicks off (in the background) a Domain Connect probe for any
  // pending domain we haven't checked yet, so the "Connect with X" button
  // can appear without the user having to wait.
  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/domains`);
      if (!res.ok) {
        setError(t("customDomain.errors.loadFailed"));
        return;
      }
      const data = (await res.json()) as { domains: DomainRow[] };
      setDomains(data.domains);
      // Note: we intentionally do NOT clear `error` here. Errors from
      // verify / add / remove should stay visible until the user takes
      // another action — clearing them in the background refresh causes
      // the "flash and disappear" UX bug.
      // Fire-and-forget probes for unverified rows we haven't checked.
      const toProbe = data.domains.filter((d) => !d.verified);
      for (const d of toProbe) {
        // Use functional setState reader pattern to dedupe — only probe
        // when we have no recorded result yet for this domain.
        setConnect((current) => {
          if (current[d.domain] !== undefined) return current;
          void probeConnect(d.domain);
          return current;
        });
      }
    } catch {
      setError(t("customDomain.errors.networkLoad"));
    } finally {
      setLoading(false);
    }
  }, [projectId, probeConnect, t]);

  // On open: reset transient state and seed the publish-first subdomain field
  // from the title (only matters when the project isn't published yet). No more
  // silent auto-publish — the user explicitly picks a subdomain and clicks
  // Publish in the step below.
  useEffect(() => {
    if (!open) return;
    setInput("");
    setAddError(null);
    setError(null);
    setLastAddedDns(null);
    if (!autoPublishedSub) {
      setSubInput(defaultSubdomain(projectTitle, projectId));
    }
    void refresh();
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, projectId, projectTitle, autoPublishedSub, refresh]);

  // Publish-first step — claim the chosen subdomain, then reveal the
  // domain-claim UI. Reuses the same POST /publish the Deploy dropdown uses.
  const onPublishSubdomain = async () => {
    const sub = subInput.trim().toLowerCase();
    if (!sub) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subdomain: sub }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          limit?: number;
        };
        const friendly =
          body.error === "taken"
            ? t("publish.status.taken")
            : body.error === "limit_reached"
              ? t("customDomain.autoPublish.limitReached", {
                  limit: body.limit ?? 1,
                })
              : body.error === "not_found"
                ? t("customDomain.autoPublish.notFound")
                : body.error === "reserved"
                  ? t("publish.status.reserved")
                  : t("publish.status.invalid");
        setError(friendly);
        return;
      }
      setAutoPublishedSub(sub);
      onAutoPublished?.(sub);
      toast.success(t("toast.publishedTitle"), {
        description: t("toast.publishedBody", { subdomain: sub }),
      });
      await refresh();
    } catch {
      setError(t("customDomain.errors.networkPreparing"));
    } finally {
      setPublishing(false);
    }
  };

  // Auto-poll verification every 30s while there's at least one pending row.
  // Clears immediately on close to avoid wasting requests on a hidden modal.
  useEffect(() => {
    if (!open || !domains) return;
    const pending = domains.filter((d) => !d.verified);
    if (pending.length === 0) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [open, domains, refresh]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onAdd = async () => {
    const domain = normalizeInput(input);
    if (!domain) return;
    const clientErr = clientValidate(domain);
    if (clientErr) {
      setAddError(t(`customDomain.validation.${clientErr}`));
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/domains`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        dns?: DnsInstructions;
        domain?: string;
      };
      if (!res.ok || !body.ok) {
        setAddError(
          body.message ||
            (body.error === "taken"
              ? t("customDomain.errors.addTaken")
              : t("customDomain.errors.addGeneric")),
        );
        return;
      }
      setInput("");
      if (body.dns && body.domain) {
        setLastAddedDns({ domain: body.domain, dns: body.dns });
        toast.success(t("toast.domainClaimedTitle", { domain: body.domain }), {
          description: t("toast.domainClaimedBody"),
        });
        // Probe Domain Connect now so the Connect button appears in
        // the same render as the manual DNS panel — avoids a "manual
        // first, button appears 500ms later" flicker.
        void probeConnect(body.domain);
      }
      await refresh();
    } catch {
      setAddError(t("customDomain.errors.networkAdd"));
    } finally {
      setAdding(false);
    }
  };

  const onVerify = async (domain: string) => {
    setVerifying(domain);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        verified?: boolean;
        message?: string;
        reason?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.message || t("customDomain.errors.verifyFailed"));
      } else {
        setError(null);
        toast.success(t("toast.domainVerifiedTitle", { domain }), {
          description: t("toast.domainVerifiedBody"),
        });
        // Keep the DNS panel collapsed once verified.
        if (lastAddedDns?.domain === domain) setLastAddedDns(null);
      }
      await refresh();
    } catch {
      setError(t("customDomain.errors.networkVerify"));
    } finally {
      setVerifying(null);
    }
  };

  const onRemove = async (domain: string) => {
    const confirmed = window.confirm(
      t("customDomain.confirmRemove", { domain }),
    );
    if (!confirmed) return;
    setRemoving(domain);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError(t("customDomain.errors.removeFailed"));
      } else {
        setError(null);
        toast.success(t("toast.domainRemovedTitle", { domain }));
        if (lastAddedDns?.domain === domain) setLastAddedDns(null);
      }
      await refresh();
    } catch {
      setError(t("customDomain.errors.networkRemove"));
    } finally {
      setRemoving(null);
    }
  };

  const trapRef = useFocusTrap(open);

  if (!open) return null;

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Card */}
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-elev border bd shadow-elev">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b bd bg-elev rounded-t-2xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
              <Globe size={14} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight fg">
                {t("customDomain.header.title")}
              </h2>
              <p className="text-[11px] fg-faint">
                {t("customDomain.header.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover transition fg-muted"
            aria-label={t("customDomain.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md ring-1 ring-red-200 dark:ring-red-500/30 bg-red-50/60 dark:bg-red-500/5 px-3 py-2 text-[12px] text-red-800 dark:text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Publish-first step — shown until the project has a subdomain. No
              silent publish: the user picks the name and clicks Publish. */}
          {!autoPublishedSub && (
            <div className="rounded-lg ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 p-3.5 space-y-3">
              <div>
                <div className="text-[12.5px] font-semibold fg">
                  {t("customDomain.publishFirst.title")}
                </div>
                <p className="text-[11px] fg-faint mt-0.5">
                  {t("customDomain.publishFirst.subtitle")}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center rounded-md ring-1 ring-[color:var(--border)] bg-app focus-within:ring-2 focus-within:ring-[color:var(--accent)] transition overflow-hidden">
                  <input
                    value={subInput}
                    onChange={(e) =>
                      setSubInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !publishing && subInput.trim())
                        onPublishSubdomain();
                    }}
                    placeholder={t("customDomain.publishFirst.placeholder")}
                    className="flex-1 min-w-0 h-9 px-3 bg-transparent text-[13px] fg placeholder:fg-faint focus:outline-none"
                  />
                  <span className="px-2.5 text-[11.5px] fg-faint shrink-0 border-l bd">
                    .openlen.com
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onPublishSubdomain}
                  disabled={publishing || !subInput.trim()}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {publishing ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />{" "}
                      {t("customDomain.publishFirst.publishing")}
                    </>
                  ) : (
                    t("customDomain.publishFirst.button")
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Domain-claim UI — only once the project has a subdomain to alias. */}
          {autoPublishedSub && (
            <>
          {/* Add a domain */}
          <div>
            <label className="block text-[11.5px] font-medium fg mb-1.5">
              {t("customDomain.add.label")}
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (addError) setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !adding) onAdd();
                }}
                placeholder={t("customDomain.add.placeholder")}
                className="flex-1 h-9 px-3 rounded-md ring-1 ring-[color:var(--border)] bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] transition"
              />
              <button
                type="button"
                onClick={onAdd}
                disabled={adding || !input.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />{" "}
                    {t("customDomain.add.adding")}
                  </>
                ) : (
                  <>
                    <Plus size={12} /> {t("customDomain.add.button")}
                  </>
                )}
              </button>
            </div>
            {addError && (
              <p className="mt-1.5 text-[11.5px] text-red-700 dark:text-red-300">
                {addError}
              </p>
            )}
          </div>

          {/* Just-added DNS instructions — surfaced inline so the user can
              copy values without scrolling. Stays visible until verify or
              remove. */}
          {lastAddedDns && (
            <DnsInstructionsPanel
              domain={lastAddedDns.domain}
              dns={lastAddedDns.dns}
              verifying={verifying === lastAddedDns.domain}
              onVerify={() => onVerify(lastAddedDns.domain)}
              connect={connect[lastAddedDns.domain]}
            />
          )}

          {/* Claim list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] uppercase tracking-wider fg-faint font-medium">
                {t("customDomain.list.heading")}
              </h3>
              {loading && (
                <span className="text-[10.5px] fg-faint inline-flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" />{" "}
                  {t("customDomain.list.refreshing")}
                </span>
              )}
            </div>
            {!loading && domains && domains.length === 0 && (
              <p className="text-[12px] fg-faint">
                {t("customDomain.list.empty")}
              </p>
            )}
            {domains && domains.length > 0 && (
              <ul className="space-y-2">
                {domains.map((d) => (
                  <li
                    key={d.domain}
                    className="rounded-lg ring-1 ring-[color:var(--border)] bg-app p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium fg truncate">
                          {d.domain}
                        </div>
                        {d.verified ? (
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 size={11} />
                            <span>{t("customDomain.list.verified")}</span>
                          </div>
                        ) : (
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                            <Loader2 size={11} className="animate-spin" />
                            <span>{t("customDomain.list.waiting")}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {d.verified && (
                          <a
                            href={`https://${d.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11.5px] font-medium fg-muted hover:bg-hover transition"
                          >
                            <ExternalLink size={11} />{" "}
                            {t("customDomain.list.open")}
                          </a>
                        )}
                        {!d.verified && (
                          <button
                            type="button"
                            onClick={() => onVerify(d.domain)}
                            disabled={verifying === d.domain}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11.5px] font-medium fg-muted ring-1 ring-[color:var(--border)] hover:bg-hover transition disabled:opacity-50"
                          >
                            {verifying === d.domain ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <RefreshCw size={11} />
                            )}
                            {t("customDomain.list.verify")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(d.domain)}
                          disabled={removing === d.domain}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11.5px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-50"
                          aria-label={t("customDomain.list.removeAria", {
                            domain: d.domain,
                          })}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    {!d.verified && (
                      <details className="mt-2.5 group">
                        <summary className="cursor-pointer text-[11.5px] fg-muted hover:fg transition list-none flex items-center gap-1">
                          <span className="inline-block transition group-open:rotate-90">▸</span>
                          {t("customDomain.list.dnsSetup")}
                        </summary>
                        <DnsInstructionsBody
                          domain={d.domain}
                          token={d.verificationToken}
                          connect={connect[d.domain]}
                        />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DnsInstructionsPanel({
  domain,
  dns,
  verifying,
  onVerify,
  connect,
}: {
  domain: string;
  dns: DnsInstructions;
  verifying: boolean;
  onVerify: () => void;
  /** When present, render the "Connect with X" one-click button above the
   *  manual records. `undefined` = still probing; `null` = provider not
   *  supported (manual is the only path). */
  connect: ConnectAvailability | null | undefined;
}) {
  const t = useTranslations("modalsDomain");
  return (
    <div className="rounded-lg ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-[12px] font-semibold fg">
            {t("customDomain.dns.setupFor")}{" "}
            <span className="font-mono">{domain}</span>
          </div>
          <p className="text-[11px] fg-faint mt-0.5">
            {connect
              ? t("customDomain.dns.oneClickAvailable")
              : t("customDomain.dns.manualHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--accent-strong)] text-white text-[11.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {verifying ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          {t("customDomain.list.verify")}
        </button>
      </div>
      {connect && (
        <ConnectButton
          providerName={connect.providerName}
          url={connect.url}
          className="mb-2.5"
        />
      )}
      <DnsRecord
        kind={dns.cname ? "CNAME" : "A"}
        name={dns.cname ? dns.cname.name : dns.a.name}
        value={dns.cname ? dns.cname.value : dns.a.value}
        purpose={t("customDomain.dns.pointsTraffic")}
      />
      <DnsRecord
        kind="TXT"
        name={dns.txt.name}
        value={dns.txt.value}
        purpose={t("customDomain.dns.provesOwnership")}
      />
    </div>
  );
}

function DnsInstructionsBody({
  domain,
  token,
  connect,
}: {
  domain: string;
  token: string;
  connect: ConnectAvailability | null | undefined;
}) {
  const t = useTranslations("modalsDomain");
  // Mirrors the server-side dnsInstructions() function so the panel is
  // self-contained — we don't need to re-fetch the original POST response.
  const ip = "178.156.175.171"; // CUSTOM_DOMAIN_TARGET_IP default
  const isApex = domain.split(".").length === 2;
  return (
    <div className="mt-2 space-y-2">
      {connect && (
        <ConnectButton providerName={connect.providerName} url={connect.url} />
      )}
      <DnsRecord
        kind={isApex ? "A" : "CNAME"}
        name={domain}
        value={isApex ? ip : "custom.openlen.com"}
        purpose={t("customDomain.dns.pointsTraffic")}
      />
      <DnsRecord
        kind="TXT"
        name={`_openlen-challenge.${domain}`}
        value={token}
        purpose={t("customDomain.dns.provesOwnership")}
      />
    </div>
  );
}

/** Domain Connect one-click button. Opens the signed Apply URL in a new
 *  tab so the user keeps their workspace context; when they come back,
 *  the auto-poll in the modal picks up the now-verified state. */
function ConnectButton({
  providerName,
  url,
  className,
}: {
  providerName: string;
  url: string;
  className?: string;
}) {
  const t = useTranslations("modalsDomain");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`group flex items-center justify-between gap-2 w-full rounded-md ring-1 ring-[color:var(--accent)]/40 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15 px-3 py-2.5 transition ${
        className ?? ""
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent-strong)] text-white">
          <Zap size={12} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold fg leading-tight">
            {t("customDomain.connect.title", { provider: providerName })}
          </span>
          <span className="block text-[10.5px] fg-faint leading-tight mt-0.5">
            {t("customDomain.connect.subtitle")}
          </span>
        </span>
      </span>
      <Sparkles
        size={13}
        className="shrink-0 text-[var(--accent)] group-hover:scale-110 transition"
      />
    </a>
  );
}

function DnsRecord({
  kind,
  name,
  value,
  purpose,
}: {
  kind: "A" | "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: string;
}) {
  const t = useTranslations("modalsDomain");
  // A + CNAME records on Cloudflare must be "DNS only" (gray cloud), not
  // proxied (orange cloud). The proxy strips Let's Encrypt's HTTP-01 ACME
  // challenge so Caddy can never issue a TLS cert, and on top of that
  // forces all traffic through CF's edge (we lose the direct origin
  // benefits we wanted in the first place). TXT records aren't proxied
  // anyway, so this hint shows only on A/CNAME rows.
  const needsDnsOnly = kind === "A" || kind === "CNAME";
  const [copied, setCopied] = useState<"name" | "value" | null>(null);
  const copy = async (which: "name" | "value", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div className="rounded-md ring-1 ring-[color:var(--border)] bg-app p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold uppercase tracking-wider ring-1 ring-[color:var(--accent)]/30 text-[var(--accent)]">
            {kind}
          </span>
          <span className="text-[10.5px] fg-faint">{purpose}</span>
        </span>
      </div>
      <div className="grid grid-cols-[60px_1fr_auto] items-center gap-1.5 text-[11.5px]">
        <span className="fg-faint">{t("customDomain.dns.name")}</span>
        <code className="font-mono fg truncate">{name}</code>
        <button
          type="button"
          onClick={() => copy("name", name)}
          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] fg-faint hover:fg hover:bg-hover transition"
        >
          {copied === "name" ? "✓" : <Copy size={9} />}
        </button>
      </div>
      <div className="grid grid-cols-[60px_1fr_auto] items-center gap-1.5 text-[11.5px] mt-0.5">
        <span className="fg-faint">{t("customDomain.dns.value")}</span>
        <code className="font-mono fg truncate">{value}</code>
        <button
          type="button"
          onClick={() => copy("value", value)}
          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] fg-faint hover:fg hover:bg-hover transition"
        >
          {copied === "value" ? "✓" : <Copy size={9} />}
        </button>
      </div>
      {needsDnsOnly && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-amber-700 dark:text-amber-300">
          <AlertCircle size={10} className="shrink-0" />
          <span>
            {t.rich("customDomain.dns.cloudflareHint", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        </div>
      )}
    </div>
  );
}
