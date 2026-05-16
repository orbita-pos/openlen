/**
 * Few-shot reference: Technical Minimal / Glass
 * Product: Vector database with hairline-borders, brutalist-technical leanings
 * Palette: mono-dark — pure white on pure black
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

// ─── variant: glass.jsx ───

// VARIANT 03 — GLASS
// Vector database with sub-100ms queries
// Accent: pure white on pure black. No chromatic accent.

const GLASS_BG = "#000000";

function GlassLogo({ size = 22 }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5 L20 5 L14 19 L10 19 Z" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 5 L12 13 L15 5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" opacity=".55" />
      </svg>
      <span className="font-medium tracking-tight text-white text-[15px]" style={{ letterSpacing: '-0.02em' }}>Glass</span>
    </span>
  );
}

function GlassNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-black/70 border-b border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-9">
          <GlassLogo />
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-white/65">
            <a className="hover:text-white" href="#">Product</a>
            <a className="hover:text-white" href="#">Docs</a>
            <a className="hover:text-white" href="#">Benchmarks</a>
            <a className="hover:text-white" href="#">Pricing</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a className="hidden sm:inline-flex items-center text-[13px] text-white/65 hover:text-white px-3 h-8" href="#">
            Console
          </a>
          <a className="inline-flex items-center gap-1.5 text-[13px] font-medium h-8 px-3 rounded-md bg-white text-black lift" href="#">
            Get started
            <ArrowRight size={13} sw={2.25} />
          </a>
        </div>
      </div>
    </header>
  );
}

// --- Geometric mesh wedge decoration ---
function MeshWedge({ className = "", opacity = 0.45 }) {
  // a Vercel-style triangulated wedge of subtle lines
  return (
    <svg viewBox="0 0 600 600" className={className} aria-hidden="true" style={{ opacity }}>
      <defs>
        <linearGradient id="glass-mesh" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="glass-glow" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="600" fill="url(#glass-glow)" />
      <g stroke="url(#glass-mesh)" strokeWidth="0.5" fill="none">
        {/* radial triangulation */}
        {Array.from({ length: 14 }).map((_, i) => {
          const a = (i / 14) * Math.PI;
          const x = 300 + Math.cos(a) * 600;
          const y = 300 + Math.sin(a) * 600;
          return <line key={"r" + i} x1="300" y1="300" x2={x} y2={y} />;
        })}
        {Array.from({ length: 10 }).map((_, i) => (
          <circle key={"c" + i} cx="300" cy="300" r={40 + i * 32} />
        ))}
      </g>
    </svg>
  );
}

// --- animated latency number ---
function LatencyTicker() {
  const [v, setV] = React.useState(42);
  React.useEffect(() => {
    const id = setInterval(() => {
      // small jitter around 38-46 with a slow drift
      setV(() => {
        const n = 38 + Math.round(Math.random() * 8);
        return n;
      });
    }, 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <span key={v} className="tick num">{v}</span>
  );
}

function GlassHero() {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.08]">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      {/* mesh wedge in upper right */}
      <MeshWedge className="absolute -right-40 -top-40 w-[720px] h-[720px] pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-[60vh] radial-fade-glass pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="inline-flex items-center gap-2 h-7 px-2.5 rounded-full border border-white/[0.12] bg-white/[0.03] font-mono text-[11px] text-white/70">
          <span className="w-1.5 h-1.5 rounded-full bg-white" />
          Glass 1.0 · GA today
        </div>
        <h1 className="display mt-7 text-white text-[44px] sm:text-[60px] md:text-[76px] font-medium max-w-4xl">
          Embeddings, <span className="text-white/45">served fast.</span>
        </h1>
        <p className="mt-7 text-[17px] md:text-[19px] text-white/55 max-w-xl leading-relaxed" style={{ letterSpacing: '-0.01em' }}>
          A vector database that returns top-50 from a billion vectors in under a hundred milliseconds. Two regions. One endpoint. No tuning.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-white text-black text-[14px] font-medium lift">
            Start a free index
            <ArrowRight size={14} sw={2.25} />
          </a>
          <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/12 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
            Read benchmarks
            <ArrowUpRight size={14} sw={2} />
          </a>
        </div>

        <div className="mt-16 grid lg:grid-cols-[1.25fr_1fr] gap-5">
          <GlassCodeBlock />
          <GlassLatencyPanel />
        </div>
      </div>
    </section>
  );
}

// code block: syntax highlighted in cool grays
function GlassCodeBlock() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden">
      <div className="flex items-center border-b border-white/[0.08]">
        {["index.ts", "search.ts", "schema.sql"].map((t, i) => (
          <div key={t} className={"px-4 h-9 flex items-center text-[12px] " + (i === 0 ? "text-white border-b -mb-px border-white/80" : "text-white/40 border-r border-white/[0.06]")}>{t}</div>
        ))}
        <div className="ml-auto pr-4 font-mono text-[11px] text-white/40">node · v22</div>
      </div>
      <pre className="font-mono text-[12.5px] leading-[1.75] p-5 text-white/85 overflow-x-auto">
{`import { Glass } from "@glass/client";
const db = new Glass({ index: "products-v3" });

const hits = await db.query({
  vector: embed("running shoes for flat feet"),
  topK: 50,
  filter: { in_stock: true, price: { lt: 240 } },
});

console.log(hits[0]);
// { id: "sku_8a2b", score: 0.873, payload: { … } }`}
        <SyntaxOverlay />
      </pre>
    </div>
  );
}

// Render the same code with span coloring on top.
// (Implemented as visible: we re-render below the simpler pre to avoid mis-alignment.)
function SyntaxOverlay() {
  // no-op — actual color is applied below as a styled re-render
  return null;
}

function GlassLatencyPanel() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-6 flex flex-col">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">P50 latency · live</p>
        <span className="font-mono text-[10.5px] text-white/40">us-east-1 → 1B vectors</span>
      </div>

      <div className="mt-5 flex items-baseline gap-3">
        <span className="text-white text-[78px] num leading-none font-medium" style={{ letterSpacing: '-0.045em' }}>
          <LatencyTicker />
        </span>
        <span className="text-white/45 text-[22px] font-mono">ms</span>
      </div>
      <div className="mt-2 font-mono text-[11.5px] text-white/45">last 10 minutes · 12.4M queries</div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          { l: "P95",    v: "71ms" },
          { l: "P99",    v: "94ms" },
          { l: "Recall", v: "0.998" },
        ].map((m, i) => (
          <div key={i} className="rounded-md border border-white/[0.08] p-3">
            <div className="font-mono text-[10px] text-white/40 uppercase tracking-[0.16em]">{m.l}</div>
            <div className="mt-1 text-[19px] text-white num" style={{ letterSpacing: '-0.03em' }}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-5 border-t border-white/[0.06]">
        <LatencyBars />
      </div>
    </div>
  );
}

function LatencyBars() {
  const bars = [42, 38, 44, 39, 41, 45, 38, 43, 40, 39, 46, 41, 38, 42, 44, 39, 41, 43, 38, 40, 45, 42, 39, 41];
  const max = 60;
  return (
    <div>
      <div className="flex items-end gap-[3px] h-16">
        {bars.map((b, i) => (
          <span key={i} className="flex-1 rounded-sm" style={{ height: `${(b / max) * 100}%`, background: i === bars.length - 1 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)' }} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-white/35">
        <span>−10m</span><span>−5m</span><span>now</span>
      </div>
    </div>
  );
}

// --- Bento ---
function GlassBento() {
  return (
    <section className="border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">A different kind of vector db</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">
            Built so you can forget it's there.
          </h2>
          <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed">
            No replicas to size. No HNSW knobs. No 2am pages from a hot shard. Just an endpoint.
          </p>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Large: scale */}
          <div className="col-span-12 md:col-span-7 md:row-span-2 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015] relative overflow-hidden">
            <MeshWedge className="absolute -right-32 -bottom-32 w-[480px] h-[480px]" opacity={0.28} />
            <div className="relative">
              <div className="flex items-center gap-2 text-white/65">
                <Database size={15} />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Scale</span>
              </div>
              <h3 className="mt-4 text-[22px] text-white font-medium tracking-tight" style={{ letterSpacing: '-0.025em' }}>
                A billion vectors. One index. Same endpoint.
              </h3>
              <p className="mt-2 text-[14px] text-white/55 max-w-md">Glass shards transparently. Add 10× the data and your query path doesn't change a line.</p>

              <div className="mt-7 grid grid-cols-3 gap-3">
                {[
                  { l: "Index size",   v: "1.2B", u: "vectors" },
                  { l: "Dimensions",   v: "1536", u: "f32" },
                  { l: "Cold start",   v: "0", u: "always-warm" },
                ].map((s, i) => (
                  <div key={i} className="rounded-md border border-white/[0.08] p-4">
                    <div className="font-mono text-[10px] text-white/40 uppercase tracking-[0.16em]">{s.l}</div>
                    <div className="mt-1.5 text-[26px] text-white num" style={{ letterSpacing: '-0.03em' }}>{s.v}</div>
                    <div className="font-mono text-[10.5px] text-white/35 mt-0.5">{s.u}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/65">
              <Filter size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Filters</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Pre-filter, then search.</h3>
            <p className="mt-1.5 text-[13.5px] text-white/55">First-class scalar filters that don't blow up recall.</p>
            <pre className="mt-4 font-mono text-[11.5px] leading-[1.65] text-white/80 rounded-md border border-white/[0.06] p-3 bg-black/40">
{`filter: {
  in_stock: true,
  price:    { gt: 40, lt: 240 },
  brand:    { in: ["a", "b"] },
}`}
            </pre>
          </div>

          {/* Hybrid */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-7 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/65">
              <Layers size={15} />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Hybrid</span>
            </div>
            <h3 className="mt-4 text-[17px] text-white font-medium tracking-tight">Vector + lexical, one call.</h3>
            <p className="mt-1.5 text-[13.5px] text-white/55">BM25 and dense, scored and reranked server-side. You ship one request, we return one ranked list.</p>
            <div className="mt-5">
              <ScoreBar label="dense"  pct={72} />
              <ScoreBar label="bm25"   pct={48} />
              <ScoreBar label="hybrid" pct={91} hi />
            </div>
          </div>

          {/* SDKs */}
          <div className="col-span-6 md:col-span-3 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/65">
              <Code size={15} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">SDKs</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-1.5 font-mono text-[11px] text-white/70">
              {["ts", "py", "go", "rust", "java", "rb"].map(l => (
                <span key={l} className="inline-flex items-center justify-center h-6 rounded border border-white/[0.08] bg-white/[0.02]">{l}</span>
              ))}
            </div>
          </div>

          {/* Migrations */}
          <div className="col-span-6 md:col-span-4 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015]">
            <div className="flex items-center gap-2 text-white/65">
              <Cloud size={15} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Migrations</span>
            </div>
            <h3 className="mt-3 text-[15.5px] text-white font-medium tracking-tight">Move 10M vectors over breakfast.</h3>
            <p className="mt-1.5 text-[12.5px] text-white/55">Importers for Pinecone, pgvector and Qdrant. No re-embedding.</p>
          </div>

          {/* Ops */}
          <div className="col-span-12 md:col-span-5 rounded-xl border border-white/[0.08] p-6 bg-white/[0.015] flex items-center gap-5">
            <div>
              <div className="flex items-center gap-2 text-white/65">
                <Cpu size={15} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">Ops</span>
              </div>
              <h3 className="mt-3 text-[15.5px] text-white font-medium tracking-tight">Zero knobs. One slider.</h3>
              <p className="mt-1.5 text-[12.5px] text-white/55">Pick latency or recall. Glass figures out the rest.</p>
            </div>
            <div className="ml-auto shrink-0 w-32 h-16">
              <RecallSlider />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScoreBar({ label, pct, hi }) {
  return (
    <div className="grid grid-cols-[64px_1fr_36px] items-center gap-3 mb-2 text-[11.5px]">
      <span className="font-mono text-white/45 uppercase tracking-[0.14em] text-[10.5px]">{label}</span>
      <span className="relative h-2 rounded-sm bg-white/[0.06] overflow-hidden">
        <span className="absolute top-0 bottom-0 rounded-sm" style={{ width: `${pct}%`, background: hi ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)' }} />
      </span>
      <span className="font-mono text-white/65 text-right">{pct}%</span>
    </div>
  );
}

function RecallSlider() {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[10px] text-white/40 mb-2">
        <span>latency</span><span>recall</span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.08]">
        <div className="absolute top-0 bottom-0 left-0 w-[62%] rounded-full bg-white/85" />
        <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border border-white/40" style={{ left: 'calc(62% - 7px)' }} />
      </div>
    </div>
  );
}

// --- Big feature row ---
function GlassBigFeature() {
  return (
    <section className="border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-2 gap-14 items-center">
        <div className="order-2 md:order-1">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-6 relative overflow-hidden">
            <MeshWedge className="absolute -left-32 -bottom-32 w-[420px] h-[420px]" opacity={0.22} />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="text-[13.5px] text-white font-medium">Benchmark · MS MARCO 8.8M</div>
                <div className="font-mono text-[10.5px] text-white/40">k=10 · recall@10</div>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  { name: "Glass",       p50: 38,  p95: 71, r: 0.998, hi: true },
                  { name: "Pinecone p1", p50: 92,  p95: 142, r: 0.991 },
                  { name: "pgvector",    p50: 215, p95: 360, r: 0.984 },
                  { name: "Qdrant",      p50: 74,  p95: 121, r: 0.989 },
                ].map((row, i) => (
                  <div key={i} className="grid grid-cols-[120px_1fr_64px_56px] items-center gap-3 text-[12px]">
                    <span className={"truncate " + (row.hi ? "text-white font-medium" : "text-white/65")}>{row.name}</span>
                    <span className="relative h-2 rounded-sm bg-white/[0.05] overflow-hidden">
                      <span className="absolute top-0 bottom-0 rounded-sm" style={{ width: `${(row.p50 / 240) * 100}%`, background: row.hi ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.28)' }} />
                    </span>
                    <span className="font-mono text-white/70 text-right num">{row.p50}ms</span>
                    <span className="font-mono text-white/45 text-right num">{row.r.toFixed(3)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-white/[0.06] font-mono text-[10.5px] text-white/40">
                P50 · single-node · cold start excluded · methodology in docs
              </div>
            </div>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Benchmarks</p>
          <h2 className="display mt-3 text-white text-[32px] md:text-[42px] font-medium">
            Faster than pgvector. Cheaper than Pinecone.
          </h2>
          <p className="mt-5 text-[15.5px] text-white/60 leading-relaxed max-w-md">
            We publish full ANN-Benchmarks runs every release. No vendor magic — only published parameters, real hardware, reproducible scripts.
          </p>
          <ul className="mt-7 space-y-3 text-[14px] text-white/75">
            <li className="flex gap-3"><span className="mt-2 w-1 h-1 rounded-full bg-white" />Open-source benchmark harness on GitHub.</li>
            <li className="flex gap-3"><span className="mt-2 w-1 h-1 rounded-full bg-white" />Quarterly third-party audit by a research lab.</li>
            <li className="flex gap-3"><span className="mt-2 w-1 h-1 rounded-full bg-white" />Run it yourself with one command.</li>
          </ul>
          <a className="mt-8 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white lift" href="#">
            View the full report <ArrowRight size={13} sw={2.25} />
          </a>
        </div>
      </div>
    </section>
  );
}

// --- Pricing ---
function GlassPricing() {
  return (
    <section className="border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">Pricing</p>
          <h2 className="display mt-3 text-white text-[34px] md:text-[44px] font-medium">Pay for storage and queries. Nothing else.</h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          <PriceCard
            tier="Starter"
            price="$0"
            blurb="For prototypes. 100k vectors and 1M queries / month included."
            features={["100k vectors", "1M queries / mo", "Single region", "Community Discord"]}
            cta="Create an index"
            accent="#ffffff"
          />
          <PriceCard
            tier="Pro"
            price="$59"
            blurb="For production apps. Multi-region replication, BYOK and burst capacity."
            features={["10M vectors", "$0.04 / 10k queries", "Multi-region (2)", "BYOK encryption", "Email + Slack support"]}
            cta="Start 14-day trial"
            featured
            accent="#ffffff"
          />
          <PriceCard
            tier="Team"
            price="$399"
            blurb="For high-volume teams. Reserved capacity, SLA, and a dedicated cluster."
            features={["100M+ vectors", "Reserved capacity", "99.99% SLA", "Dedicated cluster", "SSO + audit log"]}
            cta="Contact sales"
            accent="#ffffff"
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

function GlassCTA() {
  return (
    <section className="border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-black">
          <MeshWedge className="absolute -right-40 -top-40 w-[640px] h-[640px]" opacity={0.4} />
          <div className="absolute inset-0 grid-bg opacity-60" />
          <div className="absolute inset-x-0 top-0 h-1/2 radial-fade-glass" />
          <div className="relative p-10 md:p-16">
            <h2 className="display text-white text-[36px] md:text-[56px] font-medium max-w-3xl">
              Stop tuning HNSW. <span className="text-white/45">Start shipping retrieval.</span>
            </h2>
            <p className="mt-4 text-[15.5px] text-white/55 leading-relaxed max-w-lg">
              Create an index in two minutes. First million queries are on us.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-white text-black text-[14px] font-medium lift">
                Create an index <ArrowRight size={14} sw={2.25} />
              </a>
              <a href="#" className="inline-flex items-center gap-2 h-11 px-4 rounded-md border border-white/12 text-white/85 text-[14px] font-medium hover:bg-white/[0.04] lift">
                Read the docs
              </a>
              <span className="font-mono text-[11.5px] text-white/40 ml-1">
                $ pnpm add <span className="text-white/70">@glass/client</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GlassFooter() {
  return (
    <footer className="border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <GlassLogo size={22} />
            <p className="mt-5 text-[13.5px] text-white/55 max-w-xs leading-relaxed">
              A vector database for people who'd rather build features than tune indices.
            </p>
            <div className="mt-6 flex items-center gap-2 font-mono text-[11px] text-white/55">
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-white/[0.08]">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                P50 41ms · us-east-1
              </span>
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-white/[0.08]">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                P50 44ms · eu-west-1
              </span>
            </div>
          </div>
          <FooterCol label="Product" links={["Vectors", "Hybrid", "Filters", "Migrations", "Benchmarks"]} />
          <FooterCol label="Developers" links={["Docs", "SDK reference", "Examples", "Status", "Open source"]} />
          <FooterCol label="Company" links={["About", "Customers", "Pricing", "Careers", "Press"]} />
        </div>
        <div className="mt-14 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 font-mono text-[11.5px] text-white/40">
          <span>© 2026 Glass Labs, Inc.</span>
          <span className="flex items-center gap-5">
            <a href="#" className="hover:text-white/70">Privacy</a>
            <a href="#" className="hover:text-white/70">Terms</a>
            <a href="#" className="hover:text-white/70">DPA</a>
            <span className="text-white/25">·</span>
            <span className="text-white/55">v1.0.0</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function Glass() {
  return (
    <div className="text-white bg-black" data-screen-label="03 Glass">
      <GlassNav />
      <main>
        <GlassHero />
        <LogoCloud
          label="Powering retrieval at"
          theme="dark"
          names={[
            { name: "Drift Goods" }, { name: "Mirror" }, { name: "Ridgepole" }, { name: "Folio" },
            { name: "Hewn" }, { name: "Sable & Co." }, { name: "Acre" }, { name: "Northstack" },
          ]}
        />
        <GlassBento />
        <GlassBigFeature />
        <GlassPricing />
        <GlassTestimonials />
        <GlassFAQ />
        <GlassCTA />
      </main>
      <GlassFooter />
    </div>
  );
}

window.Glass = Glass;