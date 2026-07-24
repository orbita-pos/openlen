// Bookings owner panel — the Reservas tab. Two views: Services (create / edit /
// archive a bookable service + its weekly hours and blocked dates) and Bookings
// (the appointment queue with confirm / cancel / complete / no-show actions).
// All reads/writes go through /api/projects/[id]/bookings/*. Mirrors the
// comments/submissions panel conventions (fetch + skeleton + empty + busy).

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, Check, ChevronLeft, Loader, Pencil, Plus, RefreshCw, Trash, X } from "../icons";
import { useToast } from "../toast";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
interface DayRange {
  startMin: number;
  endMin: number;
}
interface ServiceException {
  date: string;
  blackout?: boolean;
  ranges?: DayRange[];
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  slotIncrementMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minLeadTimeMin: number;
  maxDaysAhead: number;
  creatorTz: string;
  weeklyHours: Partial<Record<string, DayRange[]>>;
  exceptions: ServiceException[];
  priceDisplay: string | null;
  locationText: string | null;
  status: "active" | "archived";
}
interface Booking {
  id: string;
  serviceId: string;
  start: number;
  end: number;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  memberId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  note: string | null;
  creatorTz: string;
}

const DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun display order

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function minToTime(m: number) {
  const c = Math.max(0, Math.min(1439, m));
  return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`;
}
function timeToMin(s: string) {
  const [h, mi] = s.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (mi || 0);
}

export function BookingsPanel({
  currentProjectId,
  defaultTz,
}: {
  currentProjectId?: string | null;
  defaultTz?: string;
}) {
  const t = useTranslations("bookings");
  const toast = useToast();
  const [view, setView] = useState<"services" | "bookings">("services");
  const [services, setServices] = useState<Service[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadServices = (pid: string) => {
    setError(null);
    void fetch(`/api/projects/${pid}/bookings/services`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { services: Service[] }) => setServices(d.services))
      .catch(() => {
        setError(t("services.loadError"));
        setServices([]);
      });
  };
  const loadBookings = (pid: string) => {
    setError(null);
    void fetch(`/api/projects/${pid}/bookings`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { bookings: Booking[] }) => setBookings(d.bookings))
      .catch(() => {
        setError(t("list.loadError"));
        setBookings([]);
      });
  };

  useEffect(() => {
    if (!currentProjectId) {
      setServices([]);
      setBookings([]);
      return;
    }
    setServices(null);
    setBookings(null);
    loadServices(currentProjectId);
    loadBookings(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Calendar size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">{t("perProject")}</p>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <ServiceEditor
        projectId={currentProjectId}
        service={editing === "new" ? null : editing}
        defaultTz={defaultTz || "America/Mexico_City"}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          loadServices(currentProjectId);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">{t("subtitle")}</div>
      </div>

      <div className="px-3 pb-2 shrink-0">
        <div className="flex rounded-md bg-elev ring-1 ring-[color:var(--border)] p-0.5">
          {(["services", "bookings"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${
                view === v ? "bg-[color:var(--bg)] fg shadow-card" : "fg-faint hover:fg"
              }`}
            >
              {t(`tabs.${v}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3">
        {error && (
          <div className="mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {view === "services" ? (
          <ServicesView
            services={services}
            onAdd={() => setEditing("new")}
            onEdit={(s) => setEditing(s)}
            onArchive={async (id) => {
              try {
                const r = await fetch(`/api/projects/${currentProjectId}/bookings/services/${id}`, {
                  method: "DELETE",
                });
                if (!r.ok) throw new Error(String(r.status));
                toast.success(t("toast.archived"));
              } catch {
                toast.error(t("toast.archiveError"));
              }
              loadServices(currentProjectId);
            }}
          />
        ) : (
          <BookingsView
            bookings={bookings}
            services={services ?? []}
            projectId={currentProjectId}
            onRescheduled={() => loadBookings(currentProjectId)}
            onAction={async (id, action) => {
              try {
                const r = await fetch(`/api/projects/${currentProjectId}/bookings/${id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action }),
                });
                if (!r.ok) throw new Error(String(r.status));
                loadBookings(currentProjectId);
                toast.success(t(`toast.${action}` as const));
              } catch {
                toast.error(t("toast.actionError"));
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function ServicesView({
  services,
  onAdd,
  onEdit,
  onArchive,
}: {
  services: Service[] | null;
  onAdd: () => void;
  onEdit: (s: Service) => void;
  onArchive: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations("bookings");
  if (services === null) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onAdd}
        className="w-full h-8 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition inline-flex items-center justify-center gap-1.5"
      >
        <Plus size={13} /> {t("services.add")}
      </button>
      {services.length === 0 ? (
        <p className="px-1 py-6 text-center text-[11.5px] fg-faint">{t("services.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {services.map((s) => (
            <li
              key={s.id}
              className="group rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2 flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold fg truncate">{s.name}</span>
                  {s.status === "archived" && (
                    <span className="inline-flex items-center px-1.5 h-[15px] rounded text-[9px] font-semibold ui-small bg-elev fg-faint ring-1 ring-[color:var(--border)]">
                      {t("services.archived")}
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] fg-faint">
                  {t("services.duration", { n: s.durationMin })}
                  {s.priceDisplay ? ` · ${s.priceDisplay}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(s)}
                aria-label={t("services.edit")}
                title={t("services.edit")}
                className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
              >
                <Pencil size={12} />
              </button>
              {s.status === "active" && (
                <button
                  type="button"
                  onClick={() => onArchive(s.id)}
                  aria-label={t("services.archive")}
                  title={t("services.archive")}
                  className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition"
                >
                  <Trash size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingsView({
  bookings,
  services,
  projectId,
  onAction,
  onRescheduled,
}: {
  bookings: Booking[] | null;
  services: Service[];
  projectId: string;
  onAction: (id: string, action: "confirm" | "cancel" | "complete" | "no_show") => void | Promise<void>;
  onRescheduled: () => void;
}) {
  const t = useTranslations("bookings");
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const svcName = useMemo(() => {
    const m = new Map(services.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [services]);

  if (bookings === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  const now = Date.now();
  const filtered = bookings.filter((b) =>
    filter === "all" ? true : filter === "upcoming" ? b.end >= now : b.end < now,
  );

  const fmt = (b: Booking) => {
    try {
      return new Date(b.start).toLocaleString(undefined, {
        timeZone: b.creatorTz,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return new Date(b.start).toISOString();
    }
  };
  const statusKey = (s: Booking["status"]) =>
    ({
      pending: "statusPending",
      confirmed: "statusConfirmed",
      cancelled: "statusCancelled",
      completed: "statusCompleted",
      no_show: "statusNoShow",
    })[s];

  return (
    <div className="space-y-2">
      <div className="flex rounded-md bg-elev ring-1 ring-[color:var(--border)] p-0.5">
        {(["upcoming", "past", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${
              filter === f ? "bg-[color:var(--bg)] fg shadow-card" : "fg-faint hover:fg"
            }`}
          >
            {t(`list.${f}`)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-8 text-center text-[11.5px] fg-faint">{t("list.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((b) => (
            <li
              key={b.id}
              className="group rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[12px] font-semibold fg truncate max-w-[55%]">{svcName(b.serviceId)}</span>
                <span
                  className={`ml-auto inline-flex items-center px-1.5 h-[15px] rounded text-[9px] font-semibold ui-small ${
                    b.status === "confirmed"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : b.status === "pending"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-elev fg-faint"
                  }`}
                >
                  {t(`list.${statusKey(b.status)}`)}
                </span>
              </div>
              <div className="text-[11px] fg leading-snug">{fmt(b)}</div>
              <div className="text-[10.5px] fg-faint truncate">
                {b.guestName || t("list.guest")}
                {b.guestEmail ? ` · ${b.guestEmail}` : ""}
              </div>
              {b.note && <div className="text-[10.5px] fg-faint mt-0.5 italic truncate">{b.note}</div>}

              <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                {b.status === "pending" && (
                  <ActBtn label={t("list.confirm")} onClick={() => onAction(b.id, "confirm")}>
                    <Check size={11} />
                  </ActBtn>
                )}
                {b.status === "confirmed" && (
                  <>
                    <ActBtn label={t("list.complete")} onClick={() => onAction(b.id, "complete")}>
                      <Check size={11} />
                    </ActBtn>
                    <ActBtn label={t("list.noShow")} onClick={() => onAction(b.id, "no_show")}>
                      <X size={11} />
                    </ActBtn>
                  </>
                )}
                {(b.status === "pending" || b.status === "confirmed") && b.end >= now && (
                  <ActBtn
                    label={t("list.reschedule")}
                    onClick={() => setRescheduling((id) => (id === b.id ? null : b.id))}
                  >
                    <RefreshCw size={11} />
                  </ActBtn>
                )}
                {(b.status === "pending" || b.status === "confirmed") &&
                  (confirmCancel === b.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        onAction(b.id, "cancel");
                        setConfirmCancel(null);
                      }}
                      className="h-6 px-2 rounded text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                    >
                      {t("list.cancelConfirm")}
                    </button>
                  ) : (
                    <ActBtn label={t("list.cancel")} onClick={() => setConfirmCancel(b.id)} danger>
                      <Trash size={11} />
                    </ActBtn>
                  ))}
              </div>

              {rescheduling === b.id && (
                <RescheduleBox
                  projectId={projectId}
                  bookingId={b.id}
                  onDone={() => {
                    setRescheduling(null);
                    onRescheduled();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Slot {
  start: number;
  label: string;
  date: string;
}

/** Inline slot picker for moving one booking — same engine the visitor sees,
 *  read through the owner endpoint so it works before the site is published. */
function RescheduleBox({
  projectId,
  bookingId,
  onDone,
}: {
  projectId: string;
  bookingId: string;
  onDone: () => void;
}) {
  const t = useTranslations("bookings");
  const toast = useToast();
  const url = `/api/projects/${projectId}/bookings/${bookingId}/reschedule`;
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [tz, setTz] = useState<string>("UTC");
  const [date, setDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setSlots(null);
    setDate(null);
    setPicked(null);
    void fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { tz: string; slots: Slot[] }) => {
        setTz(d.tz);
        setSlots(d.slots);
      })
      .catch(() => {
        setErr(t("list.slotsError"));
        setSlots([]);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [url]);

  const byDate = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const list = m.get(s.date);
      if (list) list.push(s);
      else m.set(s.date, [s]);
    }
    return m;
  }, [slots]);

  const dayLabel = (s: Slot) => {
    try {
      return new Date(s.start).toLocaleDateString(undefined, {
        timeZone: tz,
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    } catch {
      return s.date;
    }
  };

  const move = async () => {
    if (picked === null) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startUtcMs: picked }),
      });
      if (!r.ok) {
        setSaving(false);
        if (r.status === 409) {
          setErr(t("list.slotTaken"));
          load();
        } else {
          setErr(t("toast.rescheduleError"));
        }
        return;
      }
      toast.success(t("toast.rescheduled"));
      onDone();
    } catch {
      setSaving(false);
      setErr(t("toast.rescheduleError"));
    }
  };

  if (slots === null) {
    return <div className="mt-1.5 h-12 rounded-md bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />;
  }

  const dates = [...byDate.keys()].sort();
  return (
    <div className="mt-1.5 rounded-md ring-1 ring-[color:var(--border)] bg-elev px-2 py-2">
      <div className="text-[10.5px] font-semibold fg mb-1.5">{t("list.pickNewTime")}</div>
      {err && <div className="text-[10.5px] text-red-600 dark:text-red-400 mb-1.5">{err}</div>}
      {dates.length === 0 ? (
        <p className="text-[10.5px] fg-faint">{t("list.noSlots")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {dates.map((d) => (
              <Chip
                key={d}
                on={date === d}
                onClick={() => {
                  setDate(d);
                  setPicked(null);
                }}
              >
                {dayLabel(byDate.get(d)![0])}
              </Chip>
            ))}
          </div>
          {date && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-[color:var(--border)]">
              {(byDate.get(date) ?? []).map((s) => (
                <Chip key={s.start} on={picked === s.start} onClick={() => setPicked(s.start)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          )}
          {picked !== null && (
            <button
              type="button"
              onClick={() => void move()}
              disabled={saving}
              className="mt-2 w-full h-7 rounded-md text-[11px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader size={11} className="animate-spin" /> : null}
              {t("list.moveHere")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-6 px-2 rounded-full text-[10.5px] font-medium ring-1 transition ${
        on
          ? "bg-[var(--accent-strong)] text-white ring-transparent"
          : "bg-[color:var(--bg)] fg-muted ring-[color:var(--border)] hover:fg"
      }`}
    >
      {children}
    </button>
  );
}

function ActBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:bg-hover transition ${
        danger ? "hover:text-red-500" : "hover:fg"
      }`}
    >
      {children}
    </button>
  );
}

// ── Service editor ───────────────────────────────────────────────────────────

function ServiceEditor({
  projectId,
  service,
  defaultTz,
  onClose,
  onSaved,
}: {
  projectId: string;
  service: Service | null;
  defaultTz: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("bookings");
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [durationMin, setDurationMin] = useState(service?.durationMin ?? 30);
  const [slotIncrementMin, setSlotIncrementMin] = useState(service?.slotIncrementMin ?? 0);
  const [bufferBeforeMin, setBufferBeforeMin] = useState(service?.bufferBeforeMin ?? 0);
  const [bufferAfterMin, setBufferAfterMin] = useState(service?.bufferAfterMin ?? 0);
  const [minLeadTimeMin, setMinLeadTimeMin] = useState(service?.minLeadTimeMin ?? 120);
  const [maxDaysAhead, setMaxDaysAhead] = useState(service?.maxDaysAhead ?? 30);
  const [creatorTz, setCreatorTz] = useState(service?.creatorTz ?? defaultTz);
  const [priceDisplay, setPriceDisplay] = useState(service?.priceDisplay ?? "");
  const [locationText, setLocationText] = useState(service?.locationText ?? "");
  const [weekly, setWeekly] = useState<Record<string, DayRange[]>>(() => {
    const base: Record<string, DayRange[]> = {};
    for (let d = 0; d <= 6; d++) base[String(d)] = (service?.weeklyHours?.[String(d)] ?? []).map((r) => ({ ...r }));
    // A brand-new service starts with a sensible Mon–Fri 9–5.
    if (!service) for (const d of [1, 2, 3, 4, 5]) base[String(d)] = [{ startMin: 540, endMin: 1020 }];
    return base;
  });
  const [blackouts, setBlackouts] = useState<string[]>(
    () => (service?.exceptions ?? []).filter((e) => e.blackout).map((e) => e.date),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addRange = (d: number) =>
    setWeekly((w) => ({ ...w, [d]: [...(w[d] ?? []), { startMin: 540, endMin: 1020 }] }));
  const removeRange = (d: number, i: number) =>
    setWeekly((w) => ({ ...w, [d]: (w[d] ?? []).filter((_, j) => j !== i) }));
  const setRange = (d: number, i: number, field: "startMin" | "endMin", min: number) =>
    setWeekly((w) => ({
      ...w,
      [d]: (w[d] ?? []).map((r, j) => (j === i ? { ...r, [field]: min } : r)),
    }));

  const save = async () => {
    setSaving(true);
    setErr(null);
    const weeklyHours: Record<string, DayRange[]> = {};
    for (const d of Object.keys(weekly)) if (weekly[d]?.length) weeklyHours[d] = weekly[d];
    const exceptions: ServiceException[] = blackouts.map((date) => ({ date, blackout: true }));
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      durationMin,
      slotIncrementMin,
      bufferBeforeMin,
      bufferAfterMin,
      minLeadTimeMin,
      maxDaysAhead,
      creatorTz: creatorTz.trim(),
      weeklyHours,
      exceptions,
      priceDisplay: priceDisplay.trim() || null,
      locationText: locationText.trim() || null,
    };
    try {
      const url = service
        ? `/api/projects/${projectId}/bookings/services/${service.id}`
        : `/api/projects/${projectId}/bookings/services`;
      const r = await fetch(url, {
        method: service ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setErr(
          j?.issues?.some((i: { path?: string[] }) => i.path?.includes("creatorTz"))
            ? t("editor.tzInvalid")
            : t("editor.saveError"),
        );
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setErr(t("editor.saveError"));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("editor.cancel")}
          className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="text-[12px] font-semibold fg">
          {service ? t("editor.editTitle") : t("editor.newTitle")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-3">
        {err && (
          <div className="rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {err}
          </div>
        )}

        <Field label={t("editor.name")}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("editor.namePlaceholder")} />
        </Field>
        <Field label={t("editor.description")}>
          <textarea className={`${inputCls} min-h-[56px] resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("editor.descriptionPlaceholder")} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <NumField label={t("editor.durationMin")} value={durationMin} onChange={setDurationMin} min={5} />
          <NumField label={t("editor.slotIncrementMin")} value={slotIncrementMin} onChange={setSlotIncrementMin} min={0} hint={t("editor.slotIncrementHint")} />
          <NumField label={t("editor.bufferBeforeMin")} value={bufferBeforeMin} onChange={setBufferBeforeMin} min={0} />
          <NumField label={t("editor.bufferAfterMin")} value={bufferAfterMin} onChange={setBufferAfterMin} min={0} />
          <NumField label={t("editor.minLeadTimeMin")} value={minLeadTimeMin} onChange={setMinLeadTimeMin} min={0} />
          <NumField label={t("editor.maxDaysAhead")} value={maxDaysAhead} onChange={setMaxDaysAhead} min={1} />
        </div>

        <Field label={t("editor.creatorTz")}>
          <input className={inputCls} value={creatorTz} onChange={(e) => setCreatorTz(e.target.value)} placeholder="America/Mexico_City" />
        </Field>
        <Field label={t("editor.priceDisplay")} hint={t("editor.priceHint")}>
          <input className={inputCls} value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} />
        </Field>
        <Field label={t("editor.locationText")}>
          <input className={inputCls} value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder={t("editor.locationPlaceholder")} />
        </Field>

        {/* Weekly hours */}
        <div>
          <div className="text-[11px] font-semibold fg mb-1.5">{t("editor.hours")}</div>
          <div className="space-y-1.5">
            {DAYS.map((d) => {
              const ranges = weekly[String(d)] ?? [];
              return (
                <div key={d} className="rounded-md ring-1 ring-[color:var(--border)] bg-elev px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium fg w-9">{t(`days.${d}`)}</span>
                    {ranges.length === 0 && <span className="text-[10.5px] fg-faint flex-1">{t("editor.closed")}</span>}
                    <button
                      type="button"
                      onClick={() => addRange(d)}
                      className="ml-auto h-5 px-1.5 rounded text-[10px] font-medium fg-faint hover:fg bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] inline-flex items-center gap-1"
                    >
                      <Plus size={10} /> {t("editor.addRange")}
                    </button>
                  </div>
                  {ranges.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 mt-1.5">
                      <input
                        type="time"
                        className={timeCls}
                        value={minToTime(r.startMin)}
                        onChange={(e) => setRange(d, i, "startMin", timeToMin(e.target.value))}
                      />
                      <span className="text-[11px] fg-faint">–</span>
                      <input
                        type="time"
                        className={timeCls}
                        value={minToTime(r.endMin)}
                        onChange={(e) => setRange(d, i, "endMin", timeToMin(e.target.value))}
                      />
                      <button
                        type="button"
                        onClick={() => removeRange(d, i)}
                        className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:text-red-500 transition"
                        aria-label={t("editor.cancel")}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Blocked dates */}
        <div>
          <div className="text-[11px] font-semibold fg mb-1.5">{t("editor.blackouts")}</div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {blackouts.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11px] bg-elev ring-1 ring-[color:var(--border)] fg-muted">
                {d}
                <button type="button" onClick={() => setBlackouts((b) => b.filter((x) => x !== d))} className="fg-faint hover:text-red-500">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <input
            type="date"
            className={timeCls}
            onChange={(e) => {
              const v = e.target.value;
              if (v && !blackouts.includes(v)) setBlackouts((b) => [...b, v].sort());
              e.target.value = "";
            }}
            aria-label={t("editor.addBlackout")}
          />
        </div>

        <p className="text-[10px] fg-faint leading-relaxed">{t("module.noCharge")}</p>
      </div>

      <div className="px-3 py-2 shrink-0 border-t border-[color:var(--border)] flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 h-8 rounded-md text-[11.5px] font-medium fg-muted hover:fg bg-elev ring-1 ring-[color:var(--border)] transition"
        >
          {t("editor.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !name.trim()}
          className="flex-1 h-8 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader size={12} className="animate-spin" /> : null}
          {saving ? t("editor.saving") : t("editor.save")}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-8 rounded-md px-2.5 text-[12px] bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]";
const timeCls =
  "h-7 rounded-md px-2 text-[11.5px] bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium fg block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[10px] fg-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-medium fg block mb-1">{label}</span>
      <input
        type="number"
        min={min}
        className={inputCls}
        value={value}
        onChange={(e) => onChange(Math.max(min, parseInt(e.target.value || String(min), 10)))}
      />
      {hint && <span className="text-[9.5px] fg-faint block mt-0.5">{hint}</span>}
    </label>
  );
}
