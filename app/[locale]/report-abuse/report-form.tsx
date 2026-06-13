"use client";

import { useState } from "react";

export interface ReportFormStrings {
  categoryLabel: string;
  categories: { value: string; label: string }[];
  urlLabel: string;
  urlPlaceholder: string;
  detailsLabel: string;
  detailsPlaceholder: string;
  emailLabel: string;
  emailHint: string;
  submit: string;
  sending: string;
  sent: string;
  sentBody: string;
  errInvalid: string;
  errRate: string;
  errServer: string;
}

export function ReportForm({ t }: { t: ReportFormStrings }) {
  const [category, setCategory] = useState(t.categories[0]?.value ?? "other");
  const [siteUrl, setSiteUrl] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const r = await fetch("/api/report-abuse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl,
          category,
          details,
          reporterEmail: email,
          website: hp,
        }),
      });
      if (r.status === 429) {
        setError(t.errRate);
        setState("idle");
      } else if (r.status === 400) {
        setError(t.errInvalid);
        setState("idle");
      } else if (!r.ok) {
        setError(t.errServer);
        setState("idle");
      } else {
        setState("sent");
      }
    } catch {
      setError(t.errServer);
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950/40">
        <p className="font-semibold text-emerald-800 dark:text-emerald-300">{t.sent}</p>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{t.sentBody}</p>
      </div>
    );
  }

  const field =
    "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-[14px] text-zinc-900 outline-none transition focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300";
  const label = "mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300";

  return (
    <form onSubmit={submit} className="not-prose space-y-5">
      <div>
        <label className={label} htmlFor="r-cat">{t.categoryLabel}</label>
        <select
          id="r-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={field}
        >
          {t.categories.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="r-url">{t.urlLabel}</label>
        <input
          id="r-url"
          required
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder={t.urlPlaceholder}
          className={field}
        />
      </div>
      <div>
        <label className={label} htmlFor="r-details">{t.detailsLabel}</label>
        <textarea
          id="r-details"
          required
          minLength={10}
          rows={5}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t.detailsPlaceholder}
          className={field}
        />
      </div>
      <div>
        <label className={label} htmlFor="r-email">{t.emailLabel}</label>
        <input
          id="r-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />
        <p className="mt-1 text-[12px] text-zinc-500">{t.emailHint}</p>
      </div>
      {/* Honeypot — off-viewport, never shown to humans. */}
      <input
        type="text"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }}
      />
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {state === "sending" ? t.sending : t.submit}
      </button>
    </form>
  );
}
