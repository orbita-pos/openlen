/**
 * Few-shot reference: Technical Minimal / Tide
 * Product: Production observability for AI agents (Linear / Vercel / Supabase grade)
 * Palette: emerald-dark — #3ECF8E on #0F0F0F
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

// ─── variant: tide.jsx ───

// VARIANT 01 — TIDE
// Production observability for AI agents
// Accent: #3ECF8E (emerald) on #0F0F0F

const TIDE_ACCENT = "#3ECF8E";

function TideLogo({ size = 22 }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 14c2 0 2-3 5-3s3 3 5 3 2-3 5-3 3 3 5 3" stroke={TIDE_ACCENT} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M3 18c2 0 2-3 5-3s3 3 5 3 2-3 5-3 3 3 5 3" stroke={TIDE_ACCENT} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".5" />
      </svg>
      <span className="font-medium tracking-tight text-white text-[15px]">Tide</span>
    </span>
  );
}

function TideNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-[#0F0F0F]/75 border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-9">
          <TideLogo />
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-white/65">
            <a className="hover:text-white" href="#">Product</a>
            <a className="hover:text-white" href="#">Docs</a>
            <a className="hover:text-white" href="#">Changelog</a>
            <a className="hover:text-white" href="#">Pricing</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a className="hidden sm:inline-flex items-center gap-1.5 text-[13px] text-white/65 hover:text-white px-3 h-8" href="#">
            Sign in
          </a>
          <a className="inline-flex items-center gap-1.5 text-[13px] font-medium h-8 px-3 rounded-md text-black lift"
            style={{ background: TIDE_ACCENT }} href="#">
            Start tracing
            <ArrowRight size={13} sw={2.25} />
          </a>
        </div>
      </div>
    </header>
  );
}

// --- Hero terminal mockup ---
function TideTerminal() {
  return (
    <div className="rounded-xl overflow-hidden hairline bg-[#0a0a0a]"
      style={{ boxShadow: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 px-3.5 h-9 border-b border-white/[0.06] bg-white/[0.015]">
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="ml-3 font-mono text-[11px] text-white/40">~/customer-bot — tide</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10.5px] text-white/40">
          <span className="relative w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: TIDE_ACCENT, color: TIDE_ACCENT }} />
          live
        </span>
      </div>
      <div className="font-mono text-[12.5px] leading-[1.7] p-5 text-white/85">
        <div><span className="text-white/35">$</span> tide trace <span style={{ color: TIDE_ACCENT }}>--agent</span>=customer-bot <span style={{ color: TIDE_ACCENT }}>--tail</span></div>
        <div className="text-white/40 mt-2">→ connecting to wss://ingest.tide.dev … <span className="text-white/70">ok</span></div>
        <div className="text-white/40">→ following 1 active session (idle 3s)</div>

        <div className="mt-3 grid grid-cols-[auto_auto_1fr_auto] gap-x-4 text-[12px]">
          <span className="text-white/35">14:02:11.402</span>
          <span style={{ color: TIDE_ACCENT }}>span.start</span>
          <span className="text-white/80">tool.call <span className="text-white/50">name=</span>"lookup_order"</span>
          <span className="text-white/35">8ms</span>

          <span className="text-white/35">14:02:11.410</span>
          <span style={{ color: TIDE_ACCENT }}>llm.completion</span>
          <span className="text-white/80">openai/gpt-4o <span className="text-white/50">tokens=</span>1,284 <span className="text-white/50">$</span>0.0064</span>
          <span className="text-white/35">412ms</span>

          <span className="text-white/35">14:02:11.822</span>
          <span className="text-amber-300/90">retry</span>
          <span className="text-white/80">stripe.refund <span className="text-white/45">// rate_limited, backoff=320ms</span></span>
          <span className="text-white/35">—</span>

          <span className="text-white/35">14:02:12.142</span>
          <span style={{ color: TIDE_ACCENT }}>span.end</span>
          <span className="text-white/80">refund.succeeded <span className="text-white/50">order=</span>"ORD-29481"</span>
          <span className="text-white/35">740ms</span>
        </div>

        <div className="mt-3 text-white/40">→ session resolved <span className="text-white/70">PASS</span> in <span className="text-white/85">1.16s</span> across 4 spans</div>
        <div className="text-white/40">→ replay at <span className="text-white/85 underline-offset-2 underline decoration-white/20">tide.app/t/8f3a</span></div>

        <div className="mt-3 inline-flex items-center">
          <span className="text-white/35">$</span><span className="ml-2 w-2 h-[14px] inline-block bg-white/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function TideHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-[60vh] radial-fade-tide pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-28 md:pt-28 md:pb-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 h-7 px-2.5 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[11px] text-white/65">
            <span className="relative w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: TIDE_ACCENT, color: TIDE_ACCENT }} />
            v2.4 · OpenTelemetry-native
          </div>
          <h1 className="display mt-6 text-white text-[44px] sm:text-[58px] md:text-[72px] font-medium">
            See what your agents <span className="text-white/45">actually did.</span>
          </h1>
          <p className="mt-6 text-[17px] md:text-[19px] text-white/55 max-w-xl leading-relaxed" style={{ letterSpacing: '-0.01em' }}>
            Tide records every tool call, retry and token your LLM agents make in production — searchable, replayable, and priced per span.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md text-black text-[14px] font-medium lift"
              style={{ background: TIDE_ACCENT }}>
              Start tracing free
              <ArrowRight size={14} sw={2.25} />
            </a>
            <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/10 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
              Read the docs
              <ArrowUpRight size={14} sw={2} />
            </a>
            <span className="font-mono text-[11.5px] text-white/35 ml-2">
              $ npm i <span className="text-white/65">tide-sdk</span>
            </span>
          </div>
        </div>

        <div className="mt-14 md:mt-20 grid md:grid-cols-[1.35fr_1fr] gap-5">
          <TideTerminal />
          <TideStats />
        </div>
      </div>
    </section>
  );
}

function TideStats() {
  return (
    <div className="rounded-xl border border-white/[0.08] p-5 bg-white/[0.015] flex flex-col">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">customer-bot · last 24h</p>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-white/55">
          <span className="relative w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: TIDE_ACCENT, color: TIDE_ACCENT }} />
          live
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
        {[
          { k: "Sessions",   v: "12,408", d: "+8.4%", good: true },
          { k: "P95 latency", v: "1.18s",  d: "-120ms", good: true },
          { k: "Tool calls",  v: "84,612", d: "+12.1%", good: true },
          { k: "Failure rate", v: "0.42%",  d: "-0.18pp", good: true },
        ].map((s, i) => (
          <div key={i}>
            <div className="text-[11px] text-white/45 font-mono uppercase tracking-[0.14em]">{s.k}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="text-[26px] text-white num" style={{ letterSpacing: '-0.03em' }}>{s.v}</div>
              <div className="text-[11.5px] font-mono" style={{ color: TIDE_ACCENT }}>{s.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <div className="text-[11px] text-white/45 font-mono uppercase tracking-[0.14em] mb-3">tokens / minute</div>
        <Sparkline />
      </div>
    </div>
  );
}

function Sparkline() {
  // procedural sparkline
  const pts = [12, 15, 14, 18, 22, 19, 24, 28, 26, 31, 29, 34, 33, 38, 36, 42, 39, 44, 47, 45, 50, 48, 53, 56];
  const w = 280, h = 60, max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((p - min) / (max - min)) * (h - 6) - 3;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const da = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="tide-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={TIDE_ACCENT} stopOpacity="0.25" />
          <stop offset="100%" stopColor={TIDE_ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={da} fill="url(#tide-spark)" />
      <path d={d} fill="none" stroke={TIDE_ACCENT} strokeWidth="1.5" />
    </svg>
  );
}

// --- Bento features ---
function TideBento() {
  return (
    <section className="relative border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: TIDE_ACCENT }}>Observability</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">
            Built for the messy reality of production agents.
          </h2>
          <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed">
            One SDK call wraps every model, tool and chain. We figure out the rest — retries, costs, evals, replays.
          </p>
        </div>

        <div className="grid grid-cols-12 grid-rows-[auto_auto] gap-4">
          {/* Large tile: trace timeline */}
          <div className="col-span-12 md:col-span-7 md:row-span-2 rounded-xl border border-white/[0.08] p-7 flex flex-col bg-white/[0.015]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[17px] text-white font-medium tracking-tight">Span-level traces</h3>
                <p className="text-[13.5px] text-white/55 mt-1.5 max-w-md">Reconstruct any session as a hierarchical trace. Inspect prompts, tool args, retries and parallel branches.</p>
              </div>
              <span className="font-mono text-[10.5px] text-white/35">trace_id 8f3a…2d1</span>
            </div>
            <div className="mt-7 flex-1">
              <TraceWaterfall />
            </div>
          </div>

          {/* Tile 2 */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/60">
              <Activity size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Evals</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Score every run.</h3>
            <p className="text-[13.5px] text-white/55 mt-1.5">LLM-graded and rule-based evals attach to spans and fail builds on regression.</p>
            <div className="mt-5 flex items-center gap-2 flex-wrap">
              {[
                { l: "faithfulness", v: "0.94" },
                { l: "tool_choice",  v: "PASS" },
                { l: "latency<2s",   v: "PASS" },
                { l: "groundedness", v: "0.88" },
              ].map((p,i) => (
                <span key={i} className="inline-flex items-center gap-2 h-6 px-2 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[10.5px] text-white/70">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIDE_ACCENT }} />
                  {p.l}<span className="text-white/40">·</span><span className="text-white">{p.v}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Tile 3 */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/60">
              <Eye size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Replay</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Step through any run.</h3>
            <p className="text-[13.5px] text-white/55 mt-1.5">Re-execute a session with patched prompts or tools. Diff outputs against the original.</p>
            <div className="mt-5 grid grid-cols-2 gap-2 font-mono text-[11.5px]">
              <div className="rounded border border-white/[0.06] p-2.5">
                <div className="text-white/35 mb-1">before</div>
                <div className="text-white/80 truncate">"refund the order"</div>
              </div>
              <div className="rounded border p-2.5" style={{ borderColor: TIDE_ACCENT + '55', background: TIDE_ACCENT + '0a' }}>
                <div style={{ color: TIDE_ACCENT }} className="mb-1">after</div>
                <div className="text-white/85 truncate">"refund the latest order"</div>
              </div>
            </div>
          </div>

          {/* Tile 4 - costs */}
          <div className="col-span-6 md:col-span-3 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/40">Spend / run</div>
            <div className="mt-3 text-[34px] text-white num" style={{ letterSpacing: '-0.03em' }}>$0.0064</div>
            <div className="mt-1 font-mono text-[11px]" style={{ color: TIDE_ACCENT }}>−38% vs Tue</div>
          </div>

          {/* Tile 5 - SDK */}
          <div className="col-span-6 md:col-span-4 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/60">
              <Code size={14} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">SDK</span>
            </div>
            <pre className="mt-3 font-mono text-[11.5px] leading-[1.65] text-white/80 overflow-hidden">
{`import { trace } from "tide-sdk";

trace(agent, { project: "support" });`}
            </pre>
          </div>

          {/* Tile 6 - alerts */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015] flex items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-white/60">
                <Bolt size={14} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Alerts</span>
              </div>
              <p className="mt-3 text-[14px] text-white/80 leading-snug">Hallucination rate broke <span className="text-white" style={{ fontFamily: '"Geist Mono", monospace' }}>2.0%</span> on <span className="text-white">customer-bot</span>.</p>
              <p className="text-[12.5px] text-white/45 mt-1">PagerDuty · 2m ago</p>
            </div>
            <div className="shrink-0 w-14 h-14 rounded-md grid place-items-center" style={{ background: TIDE_ACCENT + '15', color: TIDE_ACCENT }}>
              <Bolt size={22} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TraceWaterfall() {
  const rows = [
    { label: "session.start",           dep: 0, start: 0,   dur: 100, kind: "root" },
    { label: "llm.chat openai/gpt-4o",  dep: 1, start: 4,   dur: 22,  kind: "llm" },
    { label: "tool.lookup_order",       dep: 2, start: 28,  dur: 8,   kind: "tool" },
    { label: "llm.chat openai/gpt-4o",  dep: 1, start: 36,  dur: 28,  kind: "llm" },
    { label: "tool.stripe.refund (retry)", dep: 2, start: 65, dur: 18, kind: "warn" },
    { label: "llm.chat openai/gpt-4o",  dep: 1, start: 84,  dur: 12,  kind: "llm" },
    { label: "session.end PASS",        dep: 0, start: 0,   dur: 100, kind: "ghost" },
  ];
  const colorFor = (k) => k === "llm" ? TIDE_ACCENT : k === "tool" ? "#9CA3AF" : k === "warn" ? "#F5C26B" : "rgba(255,255,255,0.18)";
  return (
    <div className="font-mono text-[11.5px] text-white/70">
      <div className="grid grid-cols-[260px_1fr_56px] gap-3 pb-2 border-b border-white/[0.06] text-white/35 text-[10.5px] uppercase tracking-[0.14em]">
        <span>span</span><span>timeline</span><span className="text-right">ms</span>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[260px_1fr_56px] gap-3 items-center">
            <span className={"truncate " + (r.kind === "ghost" ? "text-white/45" : "text-white/80")} style={{ paddingLeft: r.dep * 10 }}>
              {r.dep > 0 && <span className="text-white/25 mr-1.5">└</span>}{r.label}
            </span>
            <span className="relative h-3 rounded-sm bg-white/[0.04] overflow-hidden">
              <span className="absolute top-0 bottom-0 rounded-sm"
                style={{
                  left:  `${r.start}%`,
                  width: `${Math.max(r.dur, 1.2)}%`,
                  background: colorFor(r.kind),
                  opacity: r.kind === "ghost" ? 0.18 : 0.9,
                }} />
            </span>
            <span className="text-right text-white/55">{r.dur === 100 && r.kind === "ghost" ? "1160" : (r.dur * 11.6).toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Big alternating feature row ---
function TideBigFeature() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-2 gap-14 items-center">
        <div className="order-2 md:order-1">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden">
            <div className="flex items-center border-b border-white/[0.06]">
              {["Overview", "Spans", "Evals", "Costs"].map((t, i) => (
                <div key={t} className={"px-4 h-10 flex items-center text-[12.5px] " + (i === 2 ? "text-white border-b-2 -mb-px" : "text-white/45")}
                  style={i === 2 ? { borderColor: TIDE_ACCENT } : undefined}>{t}</div>
              ))}
              <div className="ml-auto pr-4 font-mono text-[11px] text-white/40">Last 7d</div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[
                  { l: "faithfulness", v: "0.942" },
                  { l: "groundedness", v: "0.881" },
                  { l: "tool_accuracy", v: "0.974" },
                ].map((m,i) => (
                  <div key={i} className="rounded-md border border-white/[0.06] p-3">
                    <div className="font-mono text-[10.5px] text-white/40 uppercase tracking-[0.12em]">{m.l}</div>
                    <div className="mt-1.5 text-[22px] text-white num" style={{ letterSpacing: '-0.03em' }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <EvalChart />
              <div className="mt-4 flex items-center gap-3 font-mono text-[11px] text-white/45">
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TIDE_ACCENT }} />current</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-white/25" />baseline</span>
                <span className="ml-auto text-white/35">12 evals · 4,208 runs</span>
              </div>
            </div>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: TIDE_ACCENT }}>Evaluations</p>
          <h2 className="display mt-3 text-white text-[32px] md:text-[42px] font-medium">
            Catch regressions before your users do.
          </h2>
          <p className="mt-5 text-[15.5px] text-white/60 leading-relaxed max-w-md">
            Run LLM-graded and deterministic evals on every commit. Tide diffs traces against your golden set and blocks the deploy if a score moves the wrong way.
          </p>
          <ul className="mt-7 space-y-3 text-[14px] text-white/75">
            {[
              "12 built-in graders, or BYO TypeScript.",
              "Golden datasets versioned alongside your code.",
              "GitHub check fails the PR on score regression.",
            ].map((l, i) => (
              <li key={i} className="flex gap-3"><span className="mt-2 w-1 h-1 rounded-full" style={{ background: TIDE_ACCENT }} />{l}</li>
            ))}
          </ul>
          <a className="mt-8 inline-flex items-center gap-1.5 text-[13.5px] font-medium lift" href="#" style={{ color: TIDE_ACCENT }}>
            Read the evals guide <ArrowRight size={13} sw={2.25} />
          </a>
        </div>
      </div>
    </section>
  );
}

function EvalChart() {
  const w = 560, h = 140;
  const curr = [0.62, 0.71, 0.76, 0.78, 0.81, 0.85, 0.83, 0.88, 0.90, 0.92, 0.93, 0.94];
  const base = [0.62, 0.65, 0.68, 0.71, 0.72, 0.74, 0.74, 0.77, 0.78, 0.80, 0.81, 0.82];
  const toPath = (arr) => arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - (v - 0.5) / 0.5 * (h - 20) - 10;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {[0,1,2,3].map(i => (
        <line key={i} x1="0" x2={w} y1={(h/3)*i + 10} y2={(h/3)*i + 10} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
      ))}
      <path d={toPath(base)} stroke="rgba(255,255,255,0.25)" strokeWidth="1.25" fill="none" />
      <path d={toPath(curr)} stroke={TIDE_ACCENT} strokeWidth="1.75" fill="none" />
    </svg>
  );
}

// --- Pricing ---
function TidePricing() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: TIDE_ACCENT }}>Pricing</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">Priced per span, not per seat.</h2>
          <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed">Start free. Pay for the spans you actually ingest. No per-user surcharge.</p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          <PriceCard
            tier="Hobby"
            price="$0"
            blurb="For side projects and learning. 100k spans / month included."
            features={["100,000 spans/mo", "7-day retention", "1 project", "Community support"]}
            cta="Start free"
            accent={TIDE_ACCENT}
          />
          <PriceCard
            tier="Pro"
            price="$49"
            blurb="For teams shipping agents to production. Everything you need to ship safely."
            features={["5M spans/mo, then $1/M", "30-day retention", "Evals + GitHub checks", "Slack + PagerDuty alerts", "Unlimited projects"]}
            cta="Start 14-day trial"
            featured
            accent={TIDE_ACCENT}
          />
          <PriceCard
            tier="Team"
            price="$249"
            blurb="For teams with compliance and volume requirements. SSO, audit logs, BYOC."
            features={["25M spans/mo included", "365-day retention", "SSO + SCIM + audit log", "Bring-your-own bucket", "Dedicated Slack channel"]}
            cta="Contact sales"
            accent={TIDE_ACCENT}
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

function TideCTA() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0a0a0a]">
          <div className="absolute inset-0 grid-bg opacity-70" />
          <div className="absolute inset-x-0 top-0 h-1/2 radial-fade-tide" />
          <div className="relative p-10 md:p-16 flex flex-col md:flex-row items-start md:items-end justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="display text-white text-[34px] md:text-[48px] font-medium">
                Your agents are running. <span className="text-white/45">Are you watching?</span>
              </h2>
              <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed max-w-lg">
                Drop in the SDK, ship to prod, and have your first trace inside ten minutes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md text-black text-[14px] font-medium lift"
                style={{ background: TIDE_ACCENT }}>
                Start tracing free <ArrowRight size={14} sw={2.25} />
              </a>
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/10 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
                Talk to sales
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TideFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <TideLogo size={22} />
            <p className="mt-5 text-[13.5px] text-white/55 max-w-xs leading-relaxed">
              Production observability for AI agents. Built in Berlin and Brooklyn.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 h-7 px-2.5 rounded-full border border-white/[0.08] font-mono text-[11px] text-white/55">
              <span className="relative w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: TIDE_ACCENT, color: TIDE_ACCENT }} />
              All systems normal
            </div>
          </div>
          <FooterCol label="Product" links={["Tracing", "Evals", "Replay", "Alerts", "Changelog"]} />
          <FooterCol label="Developers" links={["Docs", "SDK reference", "Examples", "Status", "Security"]} />
          <FooterCol label="Company" links={["About", "Customers", "Pricing", "Careers", "Contact"]} />
        </div>
        <div className="mt-14 pt-6 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3 font-mono text-[11.5px] text-white/40">
          <span>© 2026 Tide Labs, Inc.</span>
          <span className="flex items-center gap-5">
            <a href="#" className="hover:text-white/70">Privacy</a>
            <a href="#" className="hover:text-white/70">Terms</a>
            <a href="#" className="hover:text-white/70">DPA</a>
            <span className="text-white/25">·</span>
            <span className="text-white/55">v2.4.1</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function Tide() {
  return (
    <div className="bg-tide-ink text-white" style={{ background: '#0F0F0F' }} data-screen-label="01 Tide">
      <TideNav />
      <main>
        <TideHero />
        <LogoCloud
          label="Tracing agents in production at"
          theme="dark"
          names={[
            { name: "Linnea" }, { name: "Forecast" }, { name: "Glide" }, { name: "Vantage" },
            { name: "Mercury" }, { name: "Brightwave" }, { name: "Nimbus" }, { name: "Coast" },
          ]}
        />
        <TideBento />
        <TideBigFeature />
        <TidePricing />
        <TideTestimonials />
        <TideFAQ />
        <TideCTA />
      </main>
      <TideFooter />
    </div>
  );
}

window.Tide = Tide;