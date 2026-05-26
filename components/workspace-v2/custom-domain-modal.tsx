"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Current `*.openlen.com` slug claimed by this project. When null we
   *  auto-publish to a derived slug (`p-<projectId8>`) on modal open so
   *  the user never has to think about subdomain choice — Vercel-style. */
  projectSubdomain: string | null;
  /** Notify the parent that we just auto-published. The parent typically
   *  re-fetches the project so the TopBar Live pill + publish state stay
   *  in sync without a hard refresh. */
  onAutoPublished?: (subdomain: string) => void;
}

// Mirrors the server validator — same regex, same suffix denylist. Catches
// obviously-bad input without a round-trip; the API still re-validates.
const DOMAIN_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RESERVED_SUFFIXES = [".openlen.com"];

function normalizeInput(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}

function clientValidate(domain: string): string | null {
  if (!domain) return null;
  if (!DOMAIN_REGEX.test(domain)) return "Not a valid hostname.";
  for (const suffix of RESERVED_SUFFIXES) {
    if (domain.endsWith(suffix)) {
      return "Subdomains of openlen.com are managed via Deploy.";
    }
  }
  return null;
}

export function CustomDomainModal({
  open,
  onClose,
  projectId,
  projectSubdomain,
  onAutoPublished,
}: CustomDomainModalProps) {
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track whether the modal is currently performing the silent first-time
  // publish for a fresh (never-deployed) project. Gates the claim UI so the
  // user doesn't see an "Add domain" form before the project actually has
  // somewhere to route to.
  const [autoPublishing, setAutoPublishing] = useState(false);
  const [autoPublishedSub, setAutoPublishedSub] = useState<string | null>(
    projectSubdomain,
  );
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
              providerName: body.provider?.name ?? "your DNS provider",
            },
          }));
        } else {
          setConnect((m) => ({ ...m, [domain]: null }));
        }
      } catch {
        setConnect((m) => ({ ...m, [domain]: null }));
      }
    },
    [projectId],
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
        setError("Failed to load domains.");
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
      setError("Network error while loading domains.");
    } finally {
      setLoading(false);
    }
  }, [projectId, probeConnect]);

  // Silent first-publish — when the modal opens on a project that has no
  // *.openlen.com subdomain yet, claim an auto-derived slug first. The
  // user never sees the subdomain choice; their custom domain becomes
  // the canonical URL. Mirrors the Vercel/Netlify pattern (auto subdomain
  // exists behind the scenes; the user only sees their custom domain).
  useEffect(() => {
    if (!open) return;
    setInput("");
    setAddError(null);
    setError(null);
    setLastAddedDns(null);

    const ensurePublished = async () => {
      if (autoPublishedSub) return;
      setAutoPublishing(true);
      const autoSub = `p-${projectId.slice(0, 8)}`;
      try {
        const res = await fetch(`/api/projects/${projectId}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subdomain: autoSub }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
            limit?: number;
          };
          if (body.error === "taken") {
            // Almost impossible — projectId is a UUID — but degrade
            // gracefully: append a random suffix and retry once.
            const fallback = `${autoSub}-${Math.random().toString(36).slice(2, 5)}`;
            const retry = await fetch(`/api/projects/${projectId}/publish`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ subdomain: fallback }),
            });
            if (retry.ok) {
              setAutoPublishedSub(fallback);
              onAutoPublished?.(fallback);
              return;
            }
          }
          // Map API error codes to actionable copy. Generic fallback only
          // for truly unknown failures.
          const friendly =
            body.error === "limit_reached"
              ? `You already have ${body.limit ?? 1} published project on your plan. Unpublish another project, or upgrade to Pro for more subdomains.`
              : body.error === "not_found"
                ? "Project not found. Try reloading the page."
                : body.error === "invalid"
                  ? "Could not generate a valid internal subdomain. Use Publish manually."
                  : body.error === "reserved"
                    ? "Internal subdomain conflicts with a reserved name. Use Publish manually."
                    : body.message ||
                      `Could not auto-publish (${body.error ?? "unknown error"}). Use Publish manually first.`;
          setError(friendly);
          return;
        }
        setAutoPublishedSub(autoSub);
        onAutoPublished?.(autoSub);
      } catch {
        setError("Network error while preparing the project.");
      } finally {
        setAutoPublishing(false);
      }
    };

    void ensurePublished().then(() => {
      void refresh();
    });
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, projectId, autoPublishedSub, onAutoPublished, refresh]);

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
      setAddError(clientErr);
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
              ? "Domain is already claimed by another project."
              : "Couldn't add this domain."),
        );
        return;
      }
      setInput("");
      if (body.dns && body.domain) {
        setLastAddedDns({ domain: body.domain, dns: body.dns });
        // Probe Domain Connect now so the Connect button appears in
        // the same render as the manual DNS panel — avoids a "manual
        // first, button appears 500ms later" flicker.
        void probeConnect(body.domain);
      }
      await refresh();
    } catch {
      setAddError("Network error while adding domain.");
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
        setError(body.message || "Verification failed. Re-check the TXT record.");
      } else {
        setError(null);
        // Keep the DNS panel collapsed once verified.
        if (lastAddedDns?.domain === domain) setLastAddedDns(null);
      }
      await refresh();
    } catch {
      setError("Network error during verification.");
    } finally {
      setVerifying(null);
    }
  };

  const onRemove = async (domain: string) => {
    const confirmed = window.confirm(
      `Remove ${domain}? Visitors hitting it will see a TLS error within minutes.`,
    );
    if (!confirmed) return;
    setRemoving(domain);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError("Failed to remove the domain.");
      } else {
        setError(null);
        if (lastAddedDns?.domain === domain) setLastAddedDns(null);
      }
      await refresh();
    } catch {
      setError("Network error while removing domain.");
    } finally {
      setRemoving(null);
    }
  };

  if (!open) return null;

  return (
    <div
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
                Custom domain
              </h2>
              <p className="text-[11px] fg-faint">
                Serve your project at your own hostname.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover transition fg-muted"
            aria-label="Close"
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

          {/* Silent first-publish indicator — surfaces only the FIRST time
              the modal opens on a never-deployed project. Mirrors what
              Vercel/Netlify do behind the scenes: assign an internal
              subdomain so the custom domain has something to alias. */}
          {autoPublishing && (
            <div className="flex items-center gap-2.5 rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2.5">
              <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
              <div className="text-[12px] fg">
                Preparing your project…
                <span className="block text-[11px] fg-faint mt-0.5">
                  Setting up the hosting target so your custom domain has
                  something to point at.
                </span>
              </div>
            </div>
          )}

          {/* Add a domain */}
          <div>
            <label className="block text-[11.5px] font-medium fg mb-1.5">
              Add a domain
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
                placeholder="landing.miempresa.com"
                className="flex-1 h-9 px-3 rounded-md ring-1 ring-[color:var(--border)] bg-app text-[13px] fg placeholder:fg-faint focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] transition"
              />
              <button
                type="button"
                onClick={onAdd}
                disabled={adding || autoPublishing || !input.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[var(--accent)] text-white text-[12.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Adding…
                  </>
                ) : (
                  <>
                    <Plus size={12} /> Add
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
                Domains
              </h3>
              {loading && (
                <span className="text-[10.5px] fg-faint inline-flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Refreshing…
                </span>
              )}
            </div>
            {!loading && domains && domains.length === 0 && (
              <p className="text-[12px] fg-faint">
                None yet. Add one above to point your own hostname at this project.
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
                            <span>Verified · TLS active</span>
                          </div>
                        ) : (
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                            <Loader2 size={11} className="animate-spin" />
                            <span>Waiting on DNS</span>
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
                            <ExternalLink size={11} /> Open
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
                            Verify
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(d.domain)}
                          disabled={removing === d.domain}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11.5px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-50"
                          aria-label={`Remove ${d.domain}`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    {!d.verified && (
                      <details className="mt-2.5 group">
                        <summary className="cursor-pointer text-[11.5px] fg-muted hover:fg transition list-none flex items-center gap-1">
                          <span className="inline-block transition group-open:rotate-90">▸</span>
                          DNS setup
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
  return (
    <div className="rounded-lg ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="text-[12px] font-semibold fg">
            DNS setup for <span className="font-mono">{domain}</span>
          </div>
          <p className="text-[11px] fg-faint mt-0.5">
            {connect
              ? "One-click setup is available for your DNS provider."
              : "Add these two records at your DNS provider (Cloudflare, GoDaddy, etc.). Most propagate within 1–5 minutes."}
          </p>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--accent)] text-white text-[11.5px] font-medium hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {verifying ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Verify
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
        purpose="Points traffic"
      />
      <DnsRecord
        kind="TXT"
        name={dns.txt.name}
        value={dns.txt.value}
        purpose="Proves ownership"
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
        kind={isApex ? "A" : "A"}
        name={domain}
        value={ip}
        purpose="Points traffic"
      />
      <DnsRecord
        kind="TXT"
        name={`_openlen-challenge.${domain}`}
        value={token}
        purpose="Proves ownership"
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
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent)] text-white">
          <Zap size={12} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold fg leading-tight">
            One-click setup with {providerName}
          </span>
          <span className="block text-[10.5px] fg-faint leading-tight mt-0.5">
            Skip copy-pasting — we&apos;ll add the DNS records for you.
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
        <span className="fg-faint">Name</span>
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
        <span className="fg-faint">Value</span>
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
            On Cloudflare, set <strong>Proxy status: DNS only</strong> (gray
            cloud). Orange-cloud proxying blocks TLS cert issuance.
          </span>
        </div>
      )}
    </div>
  );
}
