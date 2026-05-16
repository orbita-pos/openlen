/**
 * Few-shot reference: Warm Humanist / Daybreak
 * Product: Habit tracking — dusty rose accent on warm cream
 * Palette: warm cream + dusty rose #D97A8A
 * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.
 *
 * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated
 * here with its shared primitives so the model sees one self-contained
 * reference. Loaded by lib/orchestrator/few-shots/index.ts.
 */


// ─── shared: shared.jsx ───
/* Shared primitives: small SVG icons + FAQ + Avatars + Section heading */

const { useState } = React;

function Squiggle({ color = "currentColor", className = "", width = 96 }) {
  return (
    <svg className={className} width={width} height="12" viewBox="0 0 96 12" fill="none">
      <path d="M2 8 Q 12 1, 22 6 T 42 6 T 62 6 T 82 6 T 102 6" stroke={color} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Underline({ color = "currentColor", className = "", width = 140 }) {
  return (
    <svg className={className} width={width} height="10" viewBox="0 0 140 10" fill="none" preserveAspectRatio="none">
      <path d="M2 7 C 30 1, 70 1, 138 5" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function HandCheck({ color = "currentColor", size = 22, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 13 Q 7 18, 10 17 T 20 5" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function Avatar({ name, bg, ring = "#fff" }) {
  const initials = name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
  return (
    <div
      className="inline-flex items-center justify-center rounded-full font-medium text-[12px]"
      style={{ width: 32, height: 32, background: bg, color: "#fff", boxShadow: `0 0 0 2px ${ring}` }}
    >
      {initials}
    </div>
  );
}

function FAQItem({ q, a, open, onClick, accent }) {
  return (
    <div className="border-b" style={{ borderColor: "rgba(40,28,14,0.10)" }}>
      <button
        className="w-full flex items-start justify-between gap-6 text-left py-5"
        onClick={onClick}
      >
        <span className="text-[17px] font-medium text-[#1f1b16]">{q}</span>
        <span
          className="shrink-0 mt-1 inline-flex items-center justify-center rounded-full transition-transform"
          style={{
            width: 28, height: 28,
            background: open ? accent : "transparent",
            color: open ? "#fff" : "#1f1b16",
            border: open ? "none" : "1px solid rgba(40,28,14,0.18)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)"
          }}
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </span>
      </button>
      {open && (
        <p className="pb-6 pr-12 text-[15.5px] leading-relaxed text-[#4a423a]">{a}</p>
      )}
    </div>
  );
}

function FAQ({ items, accent }) {
  const [open, setOpen] = useState(0);
  return (
    <div>
      {items.map((it, i) => (
        <FAQItem
          key={i}
          q={it.q}
          a={it.a}
          open={open === i}
          onClick={() => setOpen(open === i ? -1 : i)}
          accent={accent}
        />
      ))}
    </div>
  );
}

function Eyebrow({ children, color }) {
  return (
    <div className="inline-flex items-center gap-2 text-[12.5px] font-medium tracking-[0.06em] uppercase" style={{ color }}>
      <span className="inline-block w-5 h-px" style={{ background: color }}></span>
      {children}
    </div>
  );
}

function StarRow({ color = "#1f1b16", count = 5 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={color}><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1z"/></svg>
      ))}
    </div>
  );
}

/* Newsletter input — used in footer of all variants */
function Newsletter({ accent, placeholder = "you@anywhere.com" }) {
  return (
    <form className="flex items-center gap-2 p-1.5 rounded-full bg-white hairline w-full max-w-md" onSubmit={e => e.preventDefault()}>
      <input
        type="email"
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none px-4 py-2 text-[15px] placeholder:text-[#9b8f80]"
      />
      <button
        type="submit"
        className="px-5 py-2.5 rounded-full text-[14px] font-medium text-white"
        style={{ background: accent }}
      >
        Subscribe
      </button>
    </form>
  );
}

Object.assign(window, {
  Squiggle, Underline, HandCheck, Avatar, FAQ, FAQItem, Eyebrow, StarRow, Newsletter,
});

// ─── variant: daybreak.jsx ───

/* Variant 01 — Daybreak (habit tracking, dusty rose on warm cream) */

const DB = {
  bg: "#FAF6F0",
  bgAlt: "#F4ECDE",
  bgSoft: "#FBE9EC",
  accent: "#D97A8A",
  accentDeep: "#B85C6E",
  ink: "#1f1b16",
  inkSoft: "#4a423a",
  inkMute: "#7a6f63",
  line: "rgba(40,28,14,0.10)",
};

function DBNav() {
  return (
    <nav className="px-8 lg:px-14 pt-7 pb-2 flex items-center justify-between">
      <a className="flex items-center gap-2.5" href="#">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: DB.accent }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 18 Q 12 4, 21 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none"/><circle cx="12" cy="11" r="1.6" fill="#fff"/></svg>
        </span>
        <span className="font-display text-[19px] font-semibold tracking-tight" style={{ color: DB.ink }}>Daybreak</span>
      </a>
      <div className="hidden md:flex items-center gap-9 text-[14.5px] text-[#4a423a]">
        <a className="hover:text-[#1f1b16]" href="#">How it works</a>
        <a className="hover:text-[#1f1b16]" href="#">Pricing</a>
        <a className="hover:text-[#1f1b16]" href="#">Stories</a>
        <a className="hover:text-[#1f1b16]" href="#">Journal</a>
      </div>
      <div className="flex items-center gap-3">
        <a className="hidden sm:inline text-[14.5px] text-[#4a423a]" href="#">Sign in</a>
        <a href="#" className="px-4 py-2 rounded-full text-[14px] font-medium text-white warm-shadow-sm" style={{ background: DB.accent }}>
          Try Daybreak →
        </a>
      </div>
    </nav>
  );
}

/* hand-drawn habit chips along the hero */
function HabitChip({ label, checked, time, color }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-[14px] bg-white hairline" style={{ opacity: checked ? 1 : 0.7 }}>
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
        style={{
          background: checked ? color : "transparent",
          border: checked ? "none" : "1.5px dashed rgba(40,28,14,0.22)"
        }}
      >
        {checked && <HandCheck color="#fff" size={16} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium leading-tight" style={{ color: DB.ink, textDecoration: checked ? "line-through" : "none", textDecorationColor: "rgba(40,28,14,0.25)" }}>{label}</div>
        <div className="text-[12px] text-[#7a6f63] mt-0.5">{time}</div>
      </div>
    </div>
  );
}

function DBHeroMock() {
  // a mock app card: today's habits
  const days = ["S","M","T","W","T","F","S"];
  const today = 3;
  return (
    <div className="relative">
      {/* big card */}
      <div className="relative rounded-[20px] bg-white warm-shadow-xl overflow-hidden" style={{ width: "100%" }}>
        {/* top bar */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: DB.line }}>
          <div>
            <div className="text-[12px] text-[#7a6f63] tracking-wide uppercase font-medium">Tuesday · May 14</div>
            <div className="font-display text-[22px] font-semibold mt-0.5 text-[#1f1b16]">Good morning, Mira</div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: DB.bgSoft }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: DB.accent }}></span>
            <span className="text-[12px] font-medium" style={{ color: DB.accentDeep }}>23 day streak</span>
          </div>
        </div>

        {/* week dots */}
        <div className="px-6 py-4 flex items-center gap-1.5">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[11px] text-[#7a6f63]">{d}</span>
              <span
                className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-medium"
                style={{
                  background: i < today ? DB.accent : (i === today ? "#1f1b16" : "transparent"),
                  border: i > today ? "1px dashed rgba(40,28,14,0.18)" : "none",
                  color: i <= today ? "#fff" : "#7a6f63"
                }}
              >
                {i < today ? <HandCheck color="#fff" size={13} /> : (10 + i)}
              </span>
            </div>
          ))}
        </div>

        {/* habits list */}
        <div className="px-6 pb-6 grid grid-cols-1 gap-2.5">
          <HabitChip label="Stretch & water" time="7:00 — kitchen" checked color={DB.accent} />
          <HabitChip label="Pages, journal" time="7:20 — desk" checked color="#E0A85B" />
          <HabitChip label="Walk to the park" time="6:00 PM" checked={false} color="#7CA982" />
          <HabitChip label="Read 10 min, no screen" time="9:30 PM" checked={false} color="#9C7CC9" />
        </div>

        {/* footer of card */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: DB.line, background: "#FBF7F1" }}>
          <div className="flex items-center gap-2 text-[13px] text-[#4a423a]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            <span>2 of 4 done — you're ahead.</span>
          </div>
          <button className="text-[13px] font-medium" style={{ color: DB.accentDeep }}>Add habit +</button>
        </div>
      </div>

      {/* floating sticky note */}
      <div
        className="absolute -right-6 -top-6 rotate-[6deg] px-4 py-3 warm-shadow-sm hidden md:block"
        style={{ background: "#FFF3A8", borderRadius: 6, fontFamily: "'Quicksand', sans-serif" }}
      >
        <div className="text-[12.5px] font-medium text-[#1f1b16]">future-me</div>
        <div className="text-[12.5px] text-[#4a423a]">thank you for the walks 🌿</div>
      </div>

      {/* floating mini badge */}
      <div className="absolute -left-5 -bottom-5 px-4 py-3 rounded-2xl bg-white warm-shadow-sm hidden md:flex items-center gap-3">
        <div className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ background: DB.bgSoft }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.6 6.2 6.7.6-5.1 4.4 1.6 6.6L12 16.4 6.2 19.8l1.6-6.6L2.7 8.8l6.7-.6z" fill={DB.accent}/></svg>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-[#1f1b16]">Tiny win</div>
          <div className="text-[11.5px] text-[#7a6f63]">23 days, no skips</div>
        </div>
      </div>
    </div>
  );
}

function DBHero() {
  return (
    <section className="px-8 lg:px-14 pt-10 pb-20 lg:pb-28 grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full hairline bg-white text-[12.5px] text-[#4a423a]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: DB.accent }}></span>
          New — Morning routines for v2.4
        </div>
        <h1 className="mt-6 font-display text-[64px] lg:text-[78px] leading-[1.02] font-semibold tracking-[-0.02em] text-[#1f1b16]">
          Tiny habits,
          <br />
          stacked{" "}
          <span className="relative inline-block">
            daily
            <Underline color={DB.accent} width={170} className="absolute -bottom-3 left-0" />
          </span>
          .
        </h1>
        <p className="mt-7 text-[19px] leading-[1.55] text-[#4a423a] max-w-[520px]">
          Build the version of you that future-you thanks. Daybreak makes
          your tiny routines kind of irresistible — one rounded checkbox at a time.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white warm-shadow-sm" style={{ background: DB.accent }}>
            Start a 7-day try
          </a>
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium bg-white hairline text-[#1f1b16] inline-flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            Watch 90-sec tour
          </a>
        </div>

        <div className="mt-10 flex items-center gap-4">
          <div className="flex -space-x-2">
            <Avatar name="Mira K" bg="#D97A8A" ring={DB.bg} />
            <Avatar name="Theo L" bg="#E0A85B" ring={DB.bg} />
            <Avatar name="Asha P" bg="#7CA982" ring={DB.bg} />
            <Avatar name="Jun R"  bg="#9C7CC9" ring={DB.bg} />
          </div>
          <div className="text-[13.5px] text-[#4a423a]">
            <span className="font-medium text-[#1f1b16]">4,200+ habit builders</span> — quietly showing up most days.
          </div>
        </div>
      </div>

      <DBHeroMock />
    </section>
  );
}

function DBLogos() {
  return (
    <section className="px-8 lg:px-14 pb-16">
      <div className="rounded-[18px] py-7 px-8 hairline" style={{ background: "#FBF7F1" }}>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          <span className="text-[12.5px] text-[#7a6f63] uppercase tracking-[0.08em] mr-2">Featured in</span>
          {["The Mindful Quarterly","Morning Routine Mag","Coffee &amp; Code","Slow Letter","Habit Lab"].map(n => (
            <span key={n} className="font-display text-[18px] font-semibold text-[#4a423a]/70" dangerouslySetInnerHTML={{__html: n}} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DBFeatures() {
  const items = [
    {
      title: "Stacks, not lists",
      body: "Anchor a new habit to a thing you already do — coffee, the kettle boiling, brushing teeth. Daybreak gently asks: what comes next?",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="4" rx="2" fill={DB.accent}/><rect x="3" y="12" width="14" height="4" rx="2" fill="#1f1b16" opacity="0.85"/><rect x="3" y="18" width="9" height="3" rx="1.5" fill="#1f1b16" opacity="0.35"/></svg>
      ),
      tint: "#FBE9EC"
    },
    {
      title: "Honest streaks",
      body: "We don't shame you for a rest day. Streaks pause; momentum keeps. Miss two and we'll suggest going a size smaller, not harder.",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3c2 4 6 5 6 10a6 6 0 1 1-12 0c0-3 2-4 3-6 1 1 1 3 1 3s2-2 2-7z" fill="#E0A85B"/></svg>
      ),
      tint: "#FBF1DE"
    },
    {
      title: "End-of-day note",
      body: "Each evening, a 2-line reflection. No paragraphs, no pressure. Daybreak weaves them into a little weekly story you'll want to read.",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" fill="#7CA982"/><path d="M7 9h10M7 13h7M7 17h5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>
      ),
      tint: "#E8F0E5"
    },
  ];
  return (
    <section className="px-8 lg:px-14 py-20">
      <div className="max-w-2xl">
        <Eyebrow color={DB.accentDeep}>What it does</Eyebrow>
        <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          The opposite of an<br/>overwhelming habit app.
        </h2>
        <p className="mt-4 text-[17px] text-[#4a423a] leading-[1.55] max-w-[540px]">
          Three small things, done well, on most days. That's the whole pitch.
        </p>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {items.map(it => (
          <div key={it.title} className="rounded-[14px] bg-white p-7 warm-shadow-sm hairline">
            <div className="w-11 h-11 rounded-[10px] inline-flex items-center justify-center" style={{ background: it.tint }}>
              {it.icon}
            </div>
            <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-[#1f1b16]">{it.title}</h3>
            <p className="mt-2 text-[15.5px] text-[#4a423a] leading-[1.55]">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DBHowItWorks() {
  const steps = [
    { n: "01", t: "Pick one tiny thing", b: "Smaller than you think. \"Floss one tooth\" small. We'll grow it with you when you're ready." },
    { n: "02", t: "Anchor it to right now", b: "Daybreak helps you attach the habit to a routine that already exists — kettle, kids out the door, last email." },
    { n: "03", t: "Show up most days", b: "Tap, doodle, voice-note. Daybreak counts honest weeks, not 28-day perfect streaks." },
  ];
  return (
    <section className="px-8 lg:px-14 py-20" style={{ background: DB.bgSoft }}>
      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
        <div>
          <Eyebrow color={DB.accentDeep}>How it works</Eyebrow>
          <h2 className="mt-3 font-display text-[42px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Three steps. Then,<br/>
            <span className="font-serif italic font-normal">most mornings.</span>
          </h2>
          <div className="mt-6 max-w-md">
            <Squiggle color={DB.accentDeep} width={120} />
          </div>
          <p className="mt-6 text-[16px] text-[#4a423a] leading-[1.55] max-w-[420px]">
            We tested this with 240 early users. The pattern that worked wasn't
            harder — it was kinder.
          </p>
        </div>

        <div className="grid sm:grid-cols-1 gap-4">
          {steps.map((s, i) => (
            <div key={s.n} className="relative flex gap-6 p-7 rounded-[14px] bg-white hairline warm-shadow-sm">
              <div className="font-display text-[40px] leading-none font-semibold" style={{ color: DB.accent }}>{s.n}</div>
              <div>
                <h3 className="font-display text-[22px] font-semibold text-[#1f1b16]">{s.t}</h3>
                <p className="mt-1.5 text-[15.5px] text-[#4a423a] leading-[1.55]">{s.b}</p>
              </div>
              {i < steps.length - 1 && (
                <svg className="absolute left-[42px] -bottom-3 scribble" width="20" height="22" viewBox="0 0 20 22" fill="none">
                  <path d="M10 1 Q 4 11, 10 21" stroke={DB.accentDeep} strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M5 16 L 10 21 L 15 16" stroke={DB.accentDeep} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DBPricing() {
  const tiers = [
    {
      name: "Sprout",
      price: "$0",
      sub: "Free, forever-ish",
      blurb: "For one or two habits and the basics of showing up.",
      cta: "Start free",
      features: ["Up to 3 habits", "7 day history", "Daily reminder", "Weekly recap email"],
      featured: false
    },
    {
      name: "Daybreak Plus",
      price: "$6",
      sub: "/ month, billed yearly",
      blurb: "Stacks, journals, and the things that make it stick.",
      cta: "Try 14 days free",
      features: ["Unlimited habits & stacks", "Year-long story view", "Evening journal & insights", "Custom anchors", "Sync to Things / Notion Calendar"],
      featured: true
    },
  ];

  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="text-center max-w-xl mx-auto">
        <Eyebrow color={DB.accentDeep}>Pricing</Eyebrow>
        <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          Honest, low, and<br/><span className="font-serif italic font-normal">cancellable in two taps.</span>
        </h2>
      </div>

      <div className="mt-14 grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {tiers.map(t => (
          <div
            key={t.name}
            className="relative rounded-[16px] p-8 warm-shadow-sm hairline"
            style={{ background: t.featured ? "#fff" : "#FBF7F1" }}
          >
            {t.featured && (
              <div className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[11px] font-medium text-white tracking-wide uppercase" style={{ background: DB.accent }}>
                Most picked
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-[24px] font-semibold text-[#1f1b16]">{t.name}</h3>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-[48px] font-semibold text-[#1f1b16] leading-none">{t.price}</span>
              <span className="text-[14px] text-[#7a6f63]">{t.sub}</span>
            </div>
            <p className="mt-3 text-[15px] text-[#4a423a] leading-[1.55]">{t.blurb}</p>
            <a href="#" className="mt-6 inline-flex items-center justify-center w-full px-5 py-3 rounded-full text-[14px] font-medium" style={{ background: t.featured ? DB.accent : "transparent", color: t.featured ? "#fff" : "#1f1b16", boxShadow: t.featured ? "none" : "inset 0 0 0 1px rgba(40,28,14,0.18)" }}>
              {t.cta}
            </a>
            <div className="mt-6 pt-6 border-t" style={{ borderColor: DB.line }}>
              <ul className="space-y-3">
                {t.features.map(f => (
                  <li key={f} className="flex items-start gap-3 text-[14.5px] text-[#4a423a]">
                    <span className="mt-0.5 shrink-0">
                      <HandCheck color={DB.accent} size={16} />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DBTestimonials() {
  const t = [
    { q: "I used to start every Monday and skid by Wednesday. Daybreak shrunk the habit until I couldn't say no. I've stretched every morning for four months.", n: "Mira K.", role: "physiotherapist, Lisbon", color: "#D97A8A" },
    { q: "The honest-streaks thing is so dumb-good. I missed a Tuesday and the app went, \"that's fine, here's tomorrow.\" I almost cried.", n: "Theo L.", role: "writer & dad of two", color: "#E0A85B" },
    { q: "I'm a planner. I've tried them all. This is the only one that feels like a small kind friend, not a productivity boss.", n: "Asha P.", role: "founder, Quiet Goods", color: "#7CA982" },
  ];
  return (
    <section className="px-8 lg:px-14 py-20" style={{ background: DB.bgAlt }}>
      <div className="max-w-2xl">
        <Eyebrow color={DB.accentDeep}>People showing up</Eyebrow>
        <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          Notes from the first 4,200.
        </h2>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {t.map(it => (
          <figure key={it.n} className="rounded-[14px] bg-white p-7 warm-shadow-sm hairline flex flex-col">
            <StarRow color={DB.accent} />
            <blockquote className="mt-4 text-[16px] leading-[1.55] text-[#1f1b16] flex-1">"{it.q}"</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <Avatar name={it.n} bg={it.color} ring="#fff" />
              <div>
                <div className="text-[14px] font-medium text-[#1f1b16]">{it.n}</div>
                <div className="text-[12.5px] text-[#7a6f63]">{it.role}</div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function DBFAQSection() {
  const items = [
    { q: "Is Daybreak going to nag me?", a: "Once a day, at the time you choose, with words you can edit. That's it. No badges, no streak-saver pop-ups at 11:58pm." },
    { q: "What if I miss a week?", a: "You're a person. The week ends, a kind recap arrives, and we offer you a smaller version of the habit. The streak count pauses, the momentum count keeps going." },
    { q: "Does it work with my other apps?", a: "Daybreak Plus syncs with Things, Notion Calendar, Apple Health, and most of the calendars you already keep. We don't send your data anywhere else." },
    { q: "Is there a desktop version?", a: "Yes — a small ambient one. It lives in your menu bar and only speaks up at the times you tell it to." },
    { q: "Who's behind it?", a: "Two friends in Lisbon and Toronto who got tired of habit apps that felt like guilt machines. Hi 👋" },
  ];
  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="grid lg:grid-cols-[0.9fr_1.4fr] gap-14">
        <div>
          <Eyebrow color={DB.accentDeep}>Questions</Eyebrow>
          <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Real ones we<br/>get a lot.
          </h2>
          <p className="mt-5 text-[15.5px] text-[#4a423a] leading-[1.6] max-w-[360px]">
            Don't see yours? Write us at <a className="underline decoration-2 underline-offset-2" style={{ color: DB.accentDeep, textDecorationColor: DB.accent }} href="#">hello@daybreak.so</a>. Real people. Reasonable reply times.
          </p>
        </div>
        <FAQ items={items} accent={DB.accent} />
      </div>
    </section>
  );
}

function DBFinalCTA() {
  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="relative rounded-[24px] overflow-hidden warm-shadow-xl" style={{ background: DB.accent }}>
        <div className="absolute inset-0 opacity-25 grain"></div>
        <div className="relative px-10 lg:px-16 py-16 lg:py-20 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
          <div>
            <h2 className="font-display text-[50px] lg:text-[62px] leading-[1.02] font-semibold tracking-[-0.02em] text-white">
              Give it a try<br/>for a quiet week.
            </h2>
            <p className="mt-6 text-[18px] text-white/85 leading-[1.55] max-w-md">
              No card. Just one tiny habit, seven days. If you don't feel a little
              more like yourself by Sunday, we'll part ways kindly.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium bg-white text-[#1f1b16]">Start a 7-day try</a>
              <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)" }}>iOS · Android · Web</a>
            </div>
          </div>
          <div className="hidden lg:flex justify-end">
            <svg width="220" height="220" viewBox="0 0 220 220">
              <circle cx="110" cy="140" r="80" fill="#FBE9EC" opacity="0.35" />
              <path d="M30 165 Q 110 30, 190 165" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
              <circle cx="110" cy="92" r="20" fill="#fff" />
              <path d="M55 165 L 55 185 M 90 165 L 90 195 M 130 165 L 130 195 M 165 165 L 165 185" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function DBFooter() {
  return (
    <footer className="px-8 lg:px-14 py-16 border-t" style={{ borderColor: DB.line }}>
      <div className="grid lg:grid-cols-[1.2fr_1fr_1fr_1fr] gap-10">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: DB.accent }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 18 Q 12 4, 21 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none"/><circle cx="12" cy="11" r="1.6" fill="#fff"/></svg>
            </span>
            <span className="font-display text-[19px] font-semibold tracking-tight">Daybreak</span>
          </div>
          <p className="mt-4 text-[14.5px] text-[#4a423a] leading-[1.55]">
            One thoughtful email a month — no FOMO, no growth-hack tips. Just one
            small thing we noticed about habits.
          </p>
          <div className="mt-5">
            <Newsletter accent={DB.accent} placeholder="you@somewhere.kind" />
          </div>
        </div>

        {[
          { h: "Product", l: ["Stacks","Streaks","Journal","iOS app","Android app"] },
          { h: "Company", l: ["About us","Journal","Press","Contact"] },
          { h: "Quiet things", l: ["Privacy","Terms","Status","Manifesto"] },
        ].map(c => (
          <div key={c.h}>
            <div className="text-[12.5px] uppercase tracking-[0.08em] font-medium text-[#7a6f63]">{c.h}</div>
            <ul className="mt-4 space-y-2.5">
              {c.l.map(x => <li key={x}><a className="text-[14.5px] text-[#1f1b16] hover:text-[#7a6f63]" href="#">{x}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 pt-6 border-t flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#7a6f63]" style={{ borderColor: DB.line }}>
        <span>© Daybreak Labs, Lisbon & Toronto. Made with kettle breaks.</span>
        <span>v2.4 — Morning routines</span>
      </div>
    </footer>
  );
}

function Daybreak() {
  return (
    <div data-screen-label="01 Daybreak" style={{ background: DB.bg, color: DB.ink }}>
      <DBNav />
      <DBHero />
      <DBLogos />
      <DBFeatures />
      <DBHowItWorks />
      <DBPricing />
      <DBTestimonials />
      <DBFAQSection />
      <DBFinalCTA />
      <DBFooter />
    </div>
  );
}

window.Daybreak = Daybreak;