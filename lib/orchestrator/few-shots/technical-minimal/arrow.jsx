/**
 * Few-shot reference: Technical Minimal / Arrow
 * Product: Async standups for distributed engineering teams
 * Palette: indigo-dark — #5E6AD2 on near-black
 * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.
 *
 * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated
 * here with its shared primitives so the model sees one self-contained
 * reference. Loaded by lib/orchestrator/few-shots/index.ts.
 */


// ─── shared: icons.jsx ───
// Sparse icon set — inline SVG, lucide-style strokes
// All icons accept { className, size, strokeWidth }

const I = ({ d, c, size = 16, sw = 1.5, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {c ? c : <path d={d} />}
  </svg>
);

const ArrowRight = (p) => <I {...p} d="M5 12h14M13 6l6 6-6 6" />;
const ArrowUpRight = (p) => <I {...p} d="M7 17 17 7M8 7h9v9" />;
const Check = (p) => <I {...p} d="M5 12l5 5L20 7" />;
const Plus = (p) => <I {...p} d="M12 5v14M5 12h14" />;
const Minus = (p) => <I {...p} d="M5 12h14" />;
const Star = (p) => <I {...p} d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.4 9.3l6-.7L12 3z" />;
const Search = (p) => <I {...p} c={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>} />;
const Bolt = (p) => <I {...p} d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />;
const Shield = (p) => <I {...p} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />;
const Layers = (p) => <I {...p} c={<><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="m3 13 9 5 9-5" /><path d="m3 18 9 5 9-5" /></>} />;
const Terminal = (p) => <I {...p} c={<><path d="m4 8 4 4-4 4" /><path d="M12 16h8" /></>} />;
const Code = (p) => <I {...p} d="m8 7-5 5 5 5M16 7l5 5-5 5" />;
const Github = (p) => <I {...p} d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.4.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />;
const Sun = (p) => <I {...p} c={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>} />;
const Moon = (p) => <I {...p} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />;
const Menu = (p) => <I {...p} d="M4 7h16M4 12h16M4 17h16" />;
const X = (p) => <I {...p} d="M6 6l12 12M18 6 6 18" />;
const ChevDown = (p) => <I {...p} d="m6 9 6 6 6-6" />;
const Database = (p) => <I {...p} c={<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>} />;
const Cpu = (p) => <I {...p} c={<><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></>} />;
const Activity = (p) => <I {...p} d="M3 12h4l3-8 4 16 3-8h4" />;
const Eye = (p) => <I {...p} c={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>} />;
const Clock = (p) => <I {...p} c={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />;
const Users = (p) => <I {...p} c={<><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-7 7-7s7 3 7 7" /><circle cx="17" cy="6" r="3" /><path d="M22 19c0-3-2-5-5-5" /></>} />;
const MessageSquare = (p) => <I {...p} d="M4 5h16v11H8l-4 4V5z" />;
const Cloud = (p) => <I {...p} d="M7 18h11a4 4 0 0 0 .5-7.95A6 6 0 0 0 6.7 9.3 4.5 4.5 0 0 0 7 18z" />;
const Globe = (p) => <I {...p} c={<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>} />;
const Lock = (p) => <I {...p} c={<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>} />;
const Sparkle = (p) => <I {...p} d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />;
const Filter = (p) => <I {...p} d="M4 5h16l-6 8v6l-4-2v-4L4 5z" />;
const Zap = (p) => <I {...p} d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />;

Object.assign(window, {
  ArrowRight, ArrowUpRight, Check, Plus, Minus, Star, Search, Bolt, Shield, Layers,
  Terminal, Code, Github, Sun, Moon, Menu, X, ChevDown, Database, Cpu, Activity,
  Eye, Clock, Users, MessageSquare, Cloud, Globe, Lock, Sparkle, Filter, Zap,
});

// ─── shared: primitives.jsx ───
// Shared primitives used across variants

// Hairline border container — pure utility class on element instead.
// Logo cloud row — receives an array of {name, mark?} and accent class.
function LogoCloud({ label = "Used by teams at", names, theme = "dark" }) {
  const muted = theme === "dark" ? "text-white/40" : "text-black/40";
  const fg    = theme === "dark" ? "text-white/55" : "text-black/55";
  return (
    <section className={"border-t border-b " + (theme === "dark" ? "border-white/[0.06]" : "border-black/[0.08]")}>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-center gap-8">
          <p className={"text-[11px] uppercase tracking-[0.18em] font-mono " + muted}>{label}</p>
          <div className="flex-1 overflow-hidden relative">
            <div className="marquee-row whitespace-nowrap">
              {[...names, ...names].map((n, i) => (
                <span key={i} className={"shrink-0 text-[15px] " + fg + " tracking-tight"}
                  style={{ fontFamily: n.mono ? '"Geist Mono", monospace' : 'Inter, sans-serif', fontWeight: n.mono ? 500 : 500, letterSpacing: n.mono ? '-0.01em' : '-0.02em' }}>
                  {n.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Pricing card
function PriceCard({ tier, price, period = "/mo", blurb, features, cta, featured, theme = "dark", accent = "#3ECF8E" }) {
  const dark = theme === "dark";
  return (
    <div className={
      "relative rounded-xl p-7 flex flex-col " +
      (featured
        ? (dark ? "bg-white/[0.03] " : "bg-black/[0.02] ")
        : (dark ? "bg-transparent " : "bg-transparent ")) +
      (dark ? "border border-white/[0.08] " : "border border-black/[0.08] ")
    }
      style={featured ? { boxShadow: `inset 0 0 0 1px ${accent}55, 0 0 0 1px ${accent}22` } : undefined}>
      {featured && (
        <div className="absolute -top-3 left-7 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.18em] font-mono"
          style={{ background: accent, color: '#0a0a0a' }}>
          Most popular
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className={"text-sm font-medium " + (dark ? "text-white" : "text-black")}>{tier}</h3>
      </div>
      <div className="mt-5 flex items-baseline gap-1">
        <span className={"text-5xl tracking-tight font-medium num " + (dark ? "text-white" : "text-black")} style={{ letterSpacing: '-0.04em' }}>{price}</span>
        <span className={"text-sm " + (dark ? "text-white/40" : "text-black/40")}>{period}</span>
      </div>
      <p className={"mt-3 text-[13.5px] leading-relaxed " + (dark ? "text-white/55" : "text-black/55")}>{blurb}</p>

      <div className={"mt-6 h-px " + (dark ? "bg-white/[0.06]" : "bg-black/[0.08]")} />

      <ul className="mt-6 space-y-3 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13.5px]">
            <span className="mt-[3px] shrink-0" style={{ color: accent }}>
              <Check size={14} sw={2} />
            </span>
            <span className={dark ? "text-white/75" : "text-black/75"}>{f}</span>
          </li>
        ))}
      </ul>

      <button className={
        "mt-7 h-10 rounded-md text-[13px] font-medium lift " +
        (featured
          ? ""
          : (dark
              ? "border border-white/10 text-white hover:bg-white/[0.04]"
              : "border border-black/15 text-black hover:bg-black/[0.04]"))
      }
        style={featured ? { background: accent, color: '#0a0a0a' } : undefined}>
        {cta}
      </button>
    </div>
  );
}

// FAQ Item — controlled details
function FAQItem({ q, a, theme = "dark" }) {
  const dark = theme === "dark";
  return (
    <details className={"group py-5 " + (dark ? "border-b border-white/[0.06]" : "border-b border-black/[0.08]")}>
      <summary className="flex items-center justify-between gap-6">
        <span className={"text-[15.5px] font-medium tracking-tight " + (dark ? "text-white" : "text-black")}>{q}</span>
        <span className={"chev shrink-0 " + (dark ? "text-white/60" : "text-black/50")}>
          <Plus size={16} sw={1.75} />
        </span>
      </summary>
      <div className={"mt-3 text-[14.5px] leading-relaxed max-w-2xl " + (dark ? "text-white/60" : "text-black/60")}>
        {a}
      </div>
    </details>
  );
}

// Testimonial card
function Testimonial({ quote, name, role, company, mark, theme = "dark", accent }) {
  const dark = theme === "dark";
  return (
    <figure className={
      "rounded-xl p-7 flex flex-col gap-6 " +
      (dark ? "border border-white/[0.08] bg-white/[0.015]" : "border border-black/[0.08] bg-black/[0.01]")
    }>
      <div className="flex items-center gap-1.5" style={{ color: accent || (dark ? '#ffffff' : '#000000') }}>
        {[0,1,2,3,4].map(i => <Star key={i} size={13} sw={2} />)}
      </div>
      <blockquote className={"text-[15.5px] leading-relaxed flex-1 " + (dark ? "text-white/85" : "text-black/85")}>
        {quote}
      </blockquote>
      <figcaption className="flex items-center gap-3">
        <div className={
          "w-9 h-9 rounded-full grid place-items-center font-mono text-[12px] font-medium " +
          (dark ? "bg-white/[0.06] text-white/80 border border-white/10" : "bg-black/[0.04] text-black/80 border border-black/10")
        }>
          {mark}
        </div>
        <div className="leading-tight">
          <div className={"text-[13.5px] font-medium " + (dark ? "text-white" : "text-black")}>{name}</div>
          <div className={"text-[12.5px] " + (dark ? "text-white/45" : "text-black/45")}>{role} · {company}</div>
        </div>
      </figcaption>
    </figure>
  );
}

// Footer column
function FooterCol({ label, links, dark = true }) {
  return (
    <div>
      <h4 className={"text-[11px] uppercase tracking-[0.18em] font-mono mb-4 " + (dark ? "text-white/40" : "text-black/40")}>{label}</h4>
      <ul className="space-y-2.5">
        {links.map((l, i) => (
          <li key={i}>
            <a href="#" className={"text-[13.5px] " + (dark ? "text-white/65 hover:text-white" : "text-black/65 hover:text-black")}>{l}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

Object.assign(window, { LogoCloud, PriceCard, FAQItem, Testimonial, FooterCol });

// ─── variant: arrow.jsx ───

// VARIANT 02 — ARROW
// Async standup tool for distributed engineering teams
// Accent: #5E6AD2 (indigo) on #08090A

const ARROW_ACCENT = "#5E6AD2";
const ARROW_BG = "#08090A";

function ArrowLogo({ size = 22 }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12 L17 12 M12 7 L17 12 L12 17" stroke={ARROW_ACCENT} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="5" cy="12" r="2" fill={ARROW_ACCENT} />
      </svg>
      <span className="font-medium tracking-tight text-white text-[15px]">Arrow</span>
    </span>
  );
}

function ArrowNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur" style={{ background: ARROW_BG + 'cc', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-9">
          <ArrowLogo />
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-white/65">
            <a className="hover:text-white" href="#">Features</a>
            <a className="hover:text-white" href="#">Method</a>
            <a className="hover:text-white" href="#">Customers</a>
            <a className="hover:text-white" href="#">Pricing</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a className="hidden sm:inline-flex items-center text-[13px] text-white/65 hover:text-white px-3 h-8" href="#">
            Sign in
          </a>
          <a className="inline-flex items-center gap-1.5 text-[13px] font-medium h-8 px-3 rounded-md text-white lift"
            style={{ background: ARROW_ACCENT }} href="#">
            Start free
            <ArrowRight size={13} sw={2.25} />
          </a>
        </div>
      </div>
    </header>
  );
}

// --- Hero mockup: today's standup timeline ---
function StandupMockup() {
  const updates = [
    { who: "Mira K.",  role: "Frontend",  time: "08:14", tz: "Berlin", color: "#F5A8C9",
      did: "Shipped the v4 invite flow; landed in main this morning.",
      doing: "Polish empty-states for /settings.",
      blocked: null,
      tags: ["INV-204", "INV-211"], cursor: { x: 38, y: 17 } },
    { who: "Dre Q.",   role: "Platform",  time: "09:02", tz: "Lagos",  color: "#7DD3FC",
      did: "Migrated us off the old job queue. ~28% drop in p95.",
      doing: "Spec the worker autoscaler.",
      blocked: "Need infra review on the IAM split.",
      tags: ["PLT-91"], cursor: null },
    { who: "Hiro T.",  role: "Backend",   time: "10:31", tz: "Tokyo (yest)", color: "#A78BFA",
      did: "Knocked out the billing webhook race; tests green.",
      doing: "Pair w/ Anya on the export pipeline at 06:00 UTC.",
      blocked: null,
      tags: ["BIL-58"], cursor: { x: 76, y: 60 } },
    { who: "Anya V.",  role: "Data",      time: "11:48", tz: "Toronto", color: "#86EFAC",
      did: "Backfilled missing org rows for the cohort report.",
      doing: "Bench the new vector index against pg_trgm.",
      blocked: null,
      tags: ["DAT-12"], cursor: null },
  ];
  return (
    <div className="relative rounded-xl overflow-hidden border border-white/[0.07] bg-white/[0.015]"
      style={{ boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 h-11 px-4 border-b border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-white/12" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/12" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/12" />
        </div>
        <div className="ml-3 flex items-center gap-2 text-[12.5px] text-white/55">
          <span className="font-medium text-white/85">#standup-platform</span>
          <span className="text-white/30">/</span>
          <span>Tue · Mar 18</span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10.5px] text-white/45">
          <span className="relative w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: ARROW_ACCENT, color: ARROW_ACCENT }} />
          4 of 6 in
        </span>
      </div>

      {/* Timeline */}
      <div className="relative p-5 md:p-6">
        {/* day axis */}
        <div className="hidden md:flex items-center justify-between font-mono text-[10.5px] text-white/30 mb-3 px-1">
          {["00", "04", "08", "12", "16", "20", "24"].map(t => <span key={t}>{t}:00</span>)}
        </div>
        <div className="relative h-px bg-white/[0.06] mb-5">
          <div className="absolute top-0 bottom-0" style={{ left: '38%', width: '1px', background: ARROW_ACCENT + '99' }} />
          <span className="absolute -top-4 font-mono text-[10px]" style={{ left: 'calc(38% - 14px)', color: ARROW_ACCENT }}>now</span>
        </div>

        <ul className="space-y-3.5">
          {updates.map((u, i) => (
            <li key={i} className="group rounded-lg border border-white/[0.06] bg-[#0e1014] px-4 py-3.5 hover:border-white/[0.12] transition-colors">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-medium text-[#0a0a0a]" style={{ background: u.color }}>
                  {u.who.split(" ").map(s => s[0]).join("")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-medium text-white truncate">{u.who}</span>
                    <span className="text-[11.5px] text-white/40">{u.role}</span>
                  </div>
                </div>
                <span className="font-mono text-[10.5px] text-white/40">{u.time} · {u.tz}</span>
              </div>

              <div className="mt-2.5 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-relaxed">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/35 md:pt-1">Did</span>
                <span className="text-white/85">{u.did}</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/35 md:pt-1">Doing</span>
                <span className="text-white/80">{u.doing}</span>
                {u.blocked && <>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] md:pt-1" style={{ color: '#F5C26B' }}>Blocked</span>
                  <span className="text-amber-200/90">{u.blocked}</span>
                </>}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {u.tags.map(t => (
                  <span key={t} className="inline-flex items-center h-5 px-1.5 rounded font-mono text-[10.5px] text-white/65 bg-white/[0.04] border border-white/[0.05]">
                    {t}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {/* cursors */}
        <Cursor x="14%" y="22%" name="Mira"  color="#F5A8C9" />
        <Cursor x="62%" y="64%" name="Hiro"  color="#A78BFA" />
      </div>
    </div>
  );
}

function Cursor({ x, y, name, color }) {
  return (
    <div className="absolute pointer-events-none" style={{ left: x, top: y }}>
      <svg width="18" height="18" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
        <path d="M4 3l6 17 3-7 7-3-16-7z" fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="absolute left-3 top-3.5 inline-flex items-center h-5 px-1.5 rounded text-[10px] font-medium text-[#0a0a0a]" style={{ background: color }}>
        {name}
      </span>
    </div>
  );
}

function ArrowHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-[60vh] radial-fade-arrow pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="grid md:grid-cols-[1.05fr_1.2fr] gap-12 md:gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 h-7 px-2.5 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[11px] text-white/65">
              <Sparkle size={11} sw={2} style={{ color: ARROW_ACCENT }} />
              <span style={{ color: ARROW_ACCENT }}>NEW</span>
              <span className="text-white/30">·</span>
              <span>GitHub & Linear sync</span>
            </div>
            <h1 className="display mt-6 text-white text-[42px] sm:text-[54px] md:text-[68px] font-medium">
              Standups that don't waste <span className="text-white/45">anyone's time.</span>
            </h1>
            <p className="mt-6 text-[17px] md:text-[19px] text-white/55 max-w-xl leading-relaxed" style={{ letterSpacing: '-0.01em' }}>
              Arrow turns a chaotic Slack thread into a clean async timeline. Three questions, four time zones, zero 9am meetings.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md text-white text-[14px] font-medium lift"
                style={{ background: ARROW_ACCENT }}>
                Start free for your team
                <ArrowRight size={14} sw={2.25} />
              </a>
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/10 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
                See it in motion
                <ArrowUpRight size={14} sw={2} />
              </a>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-[12.5px] text-white/45">
              <span className="inline-flex items-center gap-2"><Check size={13} sw={2.25} style={{ color: ARROW_ACCENT }} /> No-meeting Mondays</span>
              <span className="inline-flex items-center gap-2"><Check size={13} sw={2.25} style={{ color: ARROW_ACCENT }} /> SOC 2 Type II</span>
              <span className="inline-flex items-center gap-2"><Check size={13} sw={2.25} style={{ color: ARROW_ACCENT }} /> Slack + Linear native</span>
            </div>
          </div>

          <StandupMockup />
        </div>
      </div>
    </section>
  );
}

// --- Bento ---
function ArrowBento() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: ARROW_ACCENT }}>How Arrow works</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">
            Built for engineers who write code, not meeting agendas.
          </h2>
        </div>

        <div className="grid grid-cols-12 gap-4 auto-rows-[minmax(220px,auto)]">
          {/* Large left: roll-up */}
          <div className="col-span-12 md:col-span-7 md:row-span-2 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[17px] text-white font-medium tracking-tight">The Daily Roll-up</h3>
                <p className="mt-1.5 text-[13.5px] text-white/55 max-w-md">One digest a day. Surfaces what shipped, what's blocked, and who's heading where — in 90 seconds of reading.</p>
              </div>
              <span className="font-mono text-[10.5px] text-white/35">06:00 PT · auto</span>
            </div>
            <div className="mt-6 rounded-lg border border-white/[0.06] bg-[#0e1014] p-5 flex-1 flex flex-col">
              <div className="flex items-center gap-2 text-[12px] text-white/60">
                <ArrowLogo size={14} />
                <span className="text-white/40">·</span>
                <span>Mar 18 · Platform</span>
                <span className="ml-auto font-mono text-[10.5px] text-white/35">5 of 6 in</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <RollupStat label="Shipped" value="7" sub="↑ from 4" />
                <RollupStat label="Blocked" value="1" sub="IAM split" warn />
                <RollupStat label="Carry-over" value="3" sub="≤ 1d" />
              </div>
              <div className="mt-5 text-[12.5px] text-white/65 leading-relaxed flex-1">
                <p>Highlights:</p>
                <ul className="mt-2 space-y-1.5 text-white/75">
                  <li className="flex gap-2"><span className="text-white/30">·</span>Mira shipped the v4 invite flow — <span className="font-mono text-[11.5px] text-white/55">INV-204</span></li>
                  <li className="flex gap-2"><span className="text-white/30">·</span>Dre cut p95 28% by retiring the legacy queue — <span className="font-mono text-[11.5px] text-white/55">PLT-91</span></li>
                  <li className="flex gap-2"><span className="text-white/30">·</span>Hiro & Anya pairing on the export pipeline at 06:00 UTC tomorrow.</li>
                </ul>
              </div>
              <div className="mt-4 flex items-center gap-3 pt-3 border-t border-white/[0.05]">
                <span className="font-mono text-[10.5px] text-white/35">Read full thread →</span>
                <span className="ml-auto inline-flex -space-x-1.5">
                  {["#F5A8C9", "#7DD3FC", "#A78BFA", "#86EFAC"].map((c, i) => (
                    <span key={i} className="w-5 h-5 rounded-full border border-[#0e1014]" style={{ background: c }} />
                  ))}
                </span>
              </div>
            </div>
          </div>

          {/* Tile: Integrations */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/60">
              <Layers size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Integrations</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Talks to your toolchain.</h3>
            <p className="mt-1.5 text-[13.5px] text-white/55">Pull commits, PRs and issue moves into updates automatically. Push the roll-up to Slack.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {[
                "GitHub", "Linear", "Slack", "Notion", "PagerDuty", "Sentry", "Vercel", "Jira",
              ].map(n => (
                <span key={n} className="inline-flex items-center h-7 px-2.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-[12.5px] text-white/75">
                  {n}
                </span>
              ))}
            </div>
          </div>

          {/* Tile: TZ */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/60">
              <Globe size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Time zones</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Honors the timezone gap.</h3>
            <p className="mt-1.5 text-[13.5px] text-white/55">Arrow waits for everyone in their working window. Nobody pings Hiro at 3am.</p>
            <div className="mt-5 space-y-2">
              {[
                { city: "Berlin",  off: "+1",  cover: [25, 75] },
                { city: "Lagos",   off: "+1",  cover: [25, 75] },
                { city: "Toronto", off: "−4", cover: [55, 95] },
                { city: "Tokyo",   off: "+9",  cover: [0, 40] },
              ].map(z => (
                <div key={z.city} className="grid grid-cols-[80px_1fr_28px] items-center gap-3 text-[11.5px]">
                  <span className="text-white/65">{z.city}</span>
                  <span className="relative h-2 rounded-sm bg-white/[0.05] overflow-hidden">
                    <span className="absolute top-0 bottom-0 rounded-sm" style={{ left: `${z.cover[0]}%`, width: `${z.cover[1] - z.cover[0]}%`, background: ARROW_ACCENT + 'd9' }} />
                  </span>
                  <span className="font-mono text-white/40 text-right">{z.off}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tile: Pre-fill */}
          <div className="col-span-6 md:col-span-3 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015] flex flex-col">
            <div className="flex items-center gap-2 text-white/60">
              <Bolt size={15} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Pre-fill</span>
            </div>
            <h3 className="mt-4 text-[15.5px] text-white font-medium tracking-tight">From your commits.</h3>
            <div className="mt-auto pt-5 font-mono text-[10.5px] text-white/55 leading-relaxed">
              <div>fix(billing): race in webhook retry</div>
              <div className="text-white/30">+ 4 more</div>
            </div>
          </div>

          {/* Tile: Privacy */}
          <div className="col-span-6 md:col-span-4 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015] flex flex-col">
            <div className="flex items-center gap-2 text-white/60">
              <Lock size={15} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Privacy</span>
            </div>
            <h3 className="mt-4 text-[15.5px] text-white font-medium tracking-tight">Updates stay in your workspace.</h3>
            <p className="mt-1.5 text-[12.5px] text-white/55 leading-relaxed">SOC 2 Type II. SSO + SCIM on every plan over Pro.</p>
          </div>

          {/* Tile: Threads */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015] flex items-center gap-5">
            <div>
              <div className="flex items-center gap-2 text-white/60">
                <MessageSquare size={15} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Threads</span>
              </div>
              <h3 className="mt-3 text-[15.5px] text-white font-medium tracking-tight">Threads collapse, not multiply.</h3>
              <p className="mt-1.5 text-[12.5px] text-white/55">Comments stay attached to the update, not lost in #general.</p>
            </div>
            <div className="ml-auto shrink-0 w-16 h-16 rounded-md grid place-items-center" style={{ background: ARROW_ACCENT + '20', color: ARROW_ACCENT }}>
              <MessageSquare size={26} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RollupStat({ label, value, sub, warn }) {
  return (
    <div className="rounded-md border border-white/[0.06] p-3 bg-white/[0.015]">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-[22px] text-white num" style={{ letterSpacing: '-0.03em' }}>{value}</div>
        <div className="font-mono text-[10.5px]" style={{ color: warn ? "#F5C26B" : ARROW_ACCENT }}>{sub}</div>
      </div>
    </div>
  );
}

// --- Big feature ---
function ArrowBigFeature() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-2 gap-14 items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: ARROW_ACCENT }}>Velocity, not vibes</p>
          <h2 className="display mt-3 text-white text-[32px] md:text-[42px] font-medium">
            Patterns you can see before they hurt.
          </h2>
          <p className="mt-5 text-[15.5px] text-white/60 leading-relaxed max-w-md">
            Arrow turns six weeks of updates into a heatmap your eng manager can scan in a coffee break — without ever surveilling individual ICs.
          </p>
          <ul className="mt-7 space-y-3 text-[14px] text-white/75">
            {[
              "Blocker velocity by repo, not by person.",
              "Carry-over alerts when an issue lingers > 3 days.",
              "Quiet-week detection across teams and timezones.",
            ].map((l, i) => (
              <li key={i} className="flex gap-3"><span className="mt-2 w-1 h-1 rounded-full" style={{ background: ARROW_ACCENT }} />{l}</li>
            ))}
          </ul>
          <a className="mt-8 inline-flex items-center gap-1.5 text-[13.5px] font-medium lift" href="#" style={{ color: ARROW_ACCENT }}>
            See sample dashboard <ArrowRight size={13} sw={2.25} />
          </a>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13.5px] text-white font-medium">Carry-over heatmap</div>
              <div className="text-[12px] text-white/45">Last 6 weeks · Platform</div>
            </div>
            <span className="font-mono text-[10.5px] text-white/40">issues open &gt; 1 day</span>
          </div>
          <Heatmap />
          <div className="mt-4 flex items-center gap-3 font-mono text-[10.5px] text-white/40">
            <span>fewer</span>
            <span className="flex items-center gap-0.5">
              {[0.08, 0.2, 0.4, 0.65, 0.9].map((a, i) => (
                <span key={i} className="w-4 h-2.5 rounded-sm" style={{ background: `rgba(94,106,210,${a})` }} />
              ))}
            </span>
            <span>more</span>
            <span className="ml-auto text-white/55">Median age <span className="text-white">1.8d</span></span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Heatmap() {
  // 6 weeks × 7 days, with a pseudo-random but stable pattern
  const data = [
    [.1,.3,.2,.5,.4,.2,.0],
    [.2,.4,.5,.6,.5,.3,.0],
    [.1,.2,.3,.4,.7,.3,.0],
    [.3,.5,.6,.5,.8,.2,.0],
    [.4,.7,.9,.8,.6,.4,.0],
    [.2,.5,.6,.4,.3,.2,.0],
  ];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const wks  = ["w-5", "w-4", "w-3", "w-2", "w-1", "now"];
  return (
    <div className="mt-5 grid grid-cols-[28px_1fr] gap-1.5">
      <div />
      <div className="grid grid-cols-6 gap-1.5">
        {wks.map(w => <div key={w} className="text-[10px] font-mono text-white/35 text-center">{w}</div>)}
      </div>
      {days.map((d, di) => (
        <React.Fragment key={di}>
          <div className="text-[10px] font-mono text-white/35 flex items-center">{d}</div>
          <div className="grid grid-cols-6 gap-1.5">
            {data.map((wk, wi) => (
              <div key={wi} className="h-7 rounded-sm" style={{ background: `rgba(94,106,210,${wk[di] + 0.04})`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)' }} />
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// --- Pricing ---
function ArrowPricing() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: ARROW_ACCENT }}>Pricing</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">
            One price per teammate. No per-action gotchas.
          </h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          <PriceCard
            tier="Free"
            price="$0"
            blurb="For solo founders and pairs. Up to 3 teammates."
            features={["Up to 3 teammates", "Daily roll-up", "GitHub + Slack", "7-day history"]}
            cta="Add your team"
            accent={ARROW_ACCENT}
          />
          <PriceCard
            tier="Pro"
            price="$6"
            period="/user / mo"
            blurb="For most engineering teams. Everything you need to retire the 9am call."
            features={["Unlimited teammates", "All integrations", "Carry-over alerts", "Linear + Jira sync", "Unlimited history"]}
            cta="Start 14-day trial"
            featured
            accent={ARROW_ACCENT}
          />
          <PriceCard
            tier="Team"
            price="$12"
            period="/user / mo"
            blurb="For multi-team orgs that need controls. SSO, audit log, custom retention."
            features={["SSO + SCIM", "Audit log", "Custom retention", "Carry-over heatmap", "Priority support"]}
            cta="Contact sales"
            accent={ARROW_ACCENT}
          />
        </div>
      </div>
    </section>
  );
}

// --- Testimonials ---

// ─────────────────────────────────────────────────────────────────────
// Testimonials + FAQ sections trimmed from this reference to fit the
// few-shot token budget. The original artifact included two more
// sections between Pricing and CTA (a 3-up testimonial grid and an
// accordion FAQ). The craft patterns shown elsewhere are sufficient
// to demonstrate the aesthetic.
// ─────────────────────────────────────────────────────────────────────

function ArrowCTA() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="relative rounded-2xl overflow-hidden border border-white/[0.08]" style={{ background: ARROW_BG }}>
          <div className="absolute inset-0 grid-bg opacity-70" />
          <div className="absolute inset-x-0 top-0 h-1/2 radial-fade-arrow" />
          <div className="relative p-10 md:p-16 flex flex-col md:flex-row items-start md:items-end justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="display text-white text-[34px] md:text-[48px] font-medium">
                Stop holding the meeting. <span className="text-white/45">Start reading the page.</span>
              </h2>
              <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed max-w-lg">
                Add Arrow to Slack in two clicks. Your first roll-up arrives tomorrow at 06:00.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md text-white text-[14px] font-medium lift"
                style={{ background: ARROW_ACCENT }}>
                Add to Slack <ArrowRight size={14} sw={2.25} />
              </a>
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/10 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
                Book a 15-min demo
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArrowFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <ArrowLogo size={22} />
            <p className="mt-5 text-[13.5px] text-white/55 max-w-xs leading-relaxed">
              Async standups for distributed engineering teams. Made for people who'd rather be writing code.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 h-7 px-2.5 rounded-full border border-white/[0.08] font-mono text-[11px] text-white/55">
              <Lock size={11} sw={2} />
              SOC 2 Type II · GDPR
            </div>
          </div>
          <FooterCol label="Product" links={["Standups", "Roll-up", "Heatmaps", "Integrations", "Changelog"]} />
          <FooterCol label="Use cases" links={["Distributed teams", "Eng managers", "Tech leads", "Open source"]} />
          <FooterCol label="Company" links={["About", "Customers", "Pricing", "Careers", "Contact"]} />
        </div>
        <div className="mt-14 pt-6 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3 font-mono text-[11.5px] text-white/40">
          <span>© 2026 Arrow, PBC</span>
          <span className="flex items-center gap-5">
            <a href="#" className="hover:text-white/70">Privacy</a>
            <a href="#" className="hover:text-white/70">Terms</a>
            <a href="#" className="hover:text-white/70">DPA</a>
            <span className="text-white/25">·</span>
            <span className="text-white/55">v3.12</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function Arrow() {
  return (
    <div className="text-white" style={{ background: ARROW_BG }} data-screen-label="02 Arrow">
      <ArrowNav />
      <main>
        <ArrowHero />
        <LogoCloud
          label="Replacing 9am standups at"
          theme="dark"
          names={[
            { name: "Plot" }, { name: "Northwind" }, { name: "Spry" }, { name: "Helix" },
            { name: "Topo" }, { name: "Marker" }, { name: "Sequoia Robotics" }, { name: "Quill" },
          ]}
        />
        <ArrowBento />
        <ArrowBigFeature />
        <ArrowPricing />
        <ArrowTestimonials />
        <ArrowFAQ />
        <ArrowCTA />
      </main>
      <ArrowFooter />
    </div>
  );
}

window.Arrow = Arrow;