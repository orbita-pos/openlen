/**
 * Few-shot reference: Refined Editorial / Folio
 * Product: Wealth management for engineers & operators — warm-dark editorial
 * Palette: warm-dark — orange #F97316 on near-black
 * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.
 *
 * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated
 * here with its shared primitives so the model sees one self-contained
 * reference. Loaded by lib/orchestrator/few-shots/index.ts.
 */


// ─── variant: folio.jsx ───

// Folio — Variant 01: warm dark, wealth management for engineers & operators
// Accent: #F97316 on #0A0A0A

window.Folio = function Folio({ mode = "dark" }) {
  const dark = mode === "dark";

  // Palettes
  const c = dark ? {
    bg: "#0A0A0A",
    bgAlt: "#111110",
    surface: "#16140F",
    text: "#F2EFEA",
    textDim: "rgba(242,239,234,0.62)",
    textMute: "rgba(242,239,234,0.42)",
    rule: "rgba(242,239,234,0.10)",
    accent: "#F97316",
    accentSoft: "rgba(249,115,22,0.14)",
  } : {
    bg: "#FAFAF9",
    bgAlt: "#F5F2EC",
    surface: "#FFFFFF",
    text: "#1A1714",
    textDim: "rgba(26,23,20,0.62)",
    textMute: "rgba(26,23,20,0.42)",
    rule: "rgba(26,23,20,0.10)",
    accent: "#D4581A",
    accentSoft: "rgba(212,88,26,0.10)",
  };

  return (
    <div className="font-sans-ed" style={{ background: c.bg, color: c.text }}>

      {/* ============ NAV ============ */}
      <nav className="max-w-[1320px] mx-auto px-8 lg:px-12 pt-24 pb-6 flex items-center justify-between">
        <a className="flex items-center gap-2.5" href="#">
          <span style={{ background: c.accent }} className="w-2 h-2 rounded-full" />
          <span className="font-serif-ed text-[20px] tracking-tight" style={{ fontWeight: 500 }}>Folio</span>
          <span className="font-mono-ed text-[10px] tracking-[0.2em] uppercase" style={{ color: c.textMute }}>&nbsp;/ 02</span>
        </a>
        <div className="hidden md:flex items-center gap-9 text-[13px]" style={{ color: c.textDim }}>
          <a href="#thesis" className="link-ed">Thesis</a>
          <a href="#features" className="link-ed">How it works</a>
          <a href="#pricing" className="link-ed">Pricing</a>
          <a href="#journal" className="link-ed">Journal</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="#" className="text-[13px] link-ed hidden sm:inline" style={{ color: c.textDim }}>Sign in</a>
          <a href="#"
             className="text-[13px] px-3.5 py-2 rounded-full font-medium"
             style={{ background: c.text, color: c.bg }}>
            Request access
          </a>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="relative overflow-hidden">
        {dark && <div className="absolute inset-0 mesh-folio pointer-events-none" aria-hidden />}
        {!dark && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden style={{
            background: "radial-gradient(900px 600px at 80% 10%, rgba(212,88,26,0.10), transparent 60%)"
          }} />
        )}
        <div className="relative max-w-[1320px] mx-auto px-8 lg:px-12 pt-20 pb-32">
          <div className="flex items-center gap-3 mb-10 font-mono-ed text-[11px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
            <span style={{ color: c.accent }}>§ 01</span>
            <span className="w-8 h-px" style={{ background: c.rule }} />
            <span>A managed portfolio with a paper trail</span>
          </div>

          <h1 className="font-serif-ed lead-display-tight ed-display max-w-[14ch]" style={{ fontWeight: 400 }}>
            Invest like you'd<br/>
            ship — <em className="editorial" style={{ color: c.accent, fontStyle: "italic" }}>with thesis.</em>
          </h1>

          <div className="mt-14 grid grid-cols-12 gap-8">
            <p className="col-span-12 md:col-span-6 text-[18px] leading-[1.55] max-w-[58ch]" style={{ color: c.textDim }}>
              Folio is a private wealth practice for the people who built the software. Every position carries a written
              thesis, a review cadence, and a metric you'd actually defend at standup. No mystery funds. No quarterly theater.
            </p>
            <div className="col-span-12 md:col-span-6 md:pl-8 flex items-start md:justify-end gap-6 flex-wrap">
              <a href="#"
                 className="inline-flex items-center gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium"
                 style={{ background: c.accent, color: "#1a0d05" }}>
                Book an intro call
                <span aria-hidden>→</span>
              </a>
              <a href="#" className="inline-flex items-center gap-2 text-[13px] link-ed self-center" style={{ color: c.textDim }}>
                Read the methodology <span aria-hidden style={{ color: c.accent }}>↗</span>
              </a>
            </div>
          </div>

          {/* Hero metric strip */}
          <div className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-x-10 gap-y-8 pt-10 border-t" style={{ borderColor: c.rule }}>
            {[
              { k: "AUM", v: "$284.6M", d: "across 41 households" },
              { k: "Median client size", v: "$1.2M", d: "engineer / operator profile" },
              { k: "Net IRR, 2019–25", v: "+11.8%", d: "after fees and tax drag" },
              { k: "Drawdown, '22", v: "−9.4%", d: "vs. −19.4% S&P 500" },
            ].map((m, i) => (
              <div key={i}>
                <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-3" style={{ color: c.textMute }}>{m.k}</div>
                <div className="font-mono-ed tnum text-[28px] md:text-[34px]" style={{ color: c.text, fontWeight: 500 }}>{m.v}</div>
                <div className="text-[12px] mt-1.5" style={{ color: c.textDim }}>{m.d}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ============ PULL QUOTE / FEATURED SNIPPET ============ */}
      <section className="border-t border-b" style={{ borderColor: c.rule, background: c.bgAlt }}>
        <div className="max-w-[1100px] mx-auto px-8 lg:px-12 py-28">
          <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-10" style={{ color: c.textMute }}>
            <span style={{ color: c.accent }}>§ 02</span> &nbsp; A note from the desk
          </div>
          <blockquote className="font-serif-ed ed-h2 lead-display max-w-[24ch]" style={{ fontWeight: 400 }}>
            "We don't pick funds.<br/>
            We write <em className="editorial" style={{ color: c.accent, fontStyle: "italic" }}>memos</em>, and the memos
            pick the funds."
          </blockquote>
          <div className="mt-10 flex items-center gap-4 text-[13px]" style={{ color: c.textDim }}>
            <div className="w-8 h-8 rounded-full" style={{ background: c.accentSoft, color: c.accent }}>
              <div className="w-full h-full flex items-center justify-center font-serif-ed text-[14px]">M</div>
            </div>
            <div>
              <div style={{ color: c.text }}>Marisol Tan</div>
              <div className="text-[12px]" style={{ color: c.textMute }}>Founding Principal — formerly Series-Eng @ Stripe</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURES — alternating split rows ============ */}
      <section id="features" className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
        <div className="flex items-end justify-between mb-20">
          <div>
            <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
              <span style={{ color: c.accent }}>§ 03</span> &nbsp; How the practice works
            </div>
            <h2 className="font-serif-ed ed-h1 lead-display max-w-[20ch]" style={{ fontWeight: 400 }}>
              Three primitives. <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>One paper trail.</em>
            </h2>
          </div>
          <div className="hidden lg:block text-[13px] max-w-[28ch]" style={{ color: c.textDim }}>
            Each row below is something you can read about, argue with, and reverse. The opposite of a black box.
          </div>
        </div>

        {[
          {
            n: "01",
            tag: "Thesis Library",
            title: "Every position has a memo.",
            body: "Before capital moves, the rationale moves first. Each holding ships with a one-page thesis: why now, what would unwind it, and the exact metric that decides whether we hold or close. Memos are versioned, searchable, and yours to keep.",
            metric: { k: "Active memos", v: "147", sub: "avg. 412 words" },
            ph: "left",
          },
          {
            n: "02",
            tag: "Review Cadence",
            title: "Quarterly, but it ships weekly.",
            body: "We rebalance on a cadence you can put on a calendar. Every Friday, you get a one-screen review: what moved, what didn't, and which theses are now under pressure. The annual letter is a real letter, not a deck.",
            metric: { k: "Weekly notes shipped", v: "312", sub: "since founding, 2019" },
            ph: "right",
          },
          {
            n: "03",
            tag: "Tax & Concentration",
            title: "Built around your equity.",
            body: "Most of our clients sit on concentrated single-stock positions from somewhere they used to work. Folio is structured for that: 10b5-1 plans, exchange funds, charitable trusts — boring instruments, executed quietly, on a schedule.",
            metric: { k: "Avg. concentration unwound", v: "62%", sub: "over 5 years, blended" },
            ph: "left",
          },
        ].map((row, i) => (
          <div key={i} className="grid grid-cols-12 gap-10 py-14 border-t" style={{ borderColor: c.rule }}>
            {/* image side */}
            <div className={`col-span-12 md:col-span-6 ${row.ph === "right" ? "md:order-2" : ""}`}>
              <div className="relative aspect-[5/4] rounded-sm overflow-hidden"
                   style={{ background: c.surface, border: `1px solid ${c.rule}` }}>
                <div className={`absolute inset-0 ${dark ? "ph-shimmer" : "ph-shimmer-dark"}`} />
                {/* faux UI inside placeholder */}
                <div className="absolute inset-6 flex flex-col">
                  <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-3" style={{ color: c.textMute }}>
                    Memo · {row.tag}
                  </div>
                  <div className="font-serif-ed text-[22px] leading-[1.2] max-w-[24ch]" style={{ color: c.text }}>
                    {i === 0 && "On holding INTC through the foundry transition — three falsifiable bets."}
                    {i === 1 && "Week 41 — TLT softened on CPI; thesis intact, review trigger unchanged."}
                    {i === 2 && "Plan: unwind 18% of NVDA over 14 months via 10b5-1, ladder into munis."}
                  </div>
                  <div className="mt-auto flex items-end justify-between text-[11px] font-mono-ed" style={{ color: c.textMute }}>
                    <span>fol/{row.n}/{(i === 0 ? "intc-foundry-04" : i === 1 ? "macro-w41" : "nvda-unwind-plan")}.md</span>
                    <span style={{ color: c.accent }}>v.{4 + i}</span>
                  </div>
                </div>
              </div>
            </div>
            {/* text side */}
            <div className={`col-span-12 md:col-span-6 md:pt-6 ${row.ph === "right" ? "md:order-1 md:pr-12" : "md:pl-12"}`}>
              <div className="flex items-center gap-3 mb-6 font-mono-ed text-[11px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
                <span style={{ color: c.accent }}>{row.n}</span>
                <span className="w-8 h-px" style={{ background: c.rule }} />
                <span>{row.tag}</span>
              </div>
              <h3 className="font-serif-ed ed-h2 lead-display max-w-[18ch]" style={{ fontWeight: 400 }}>{row.title}</h3>
              <p className="mt-7 text-[16px] leading-[1.65] max-w-[52ch]" style={{ color: c.textDim }}>{row.body}</p>
              <div className="mt-10 flex items-baseline gap-6">
                <div>
                  <div className="font-mono-ed tnum text-[28px]" style={{ color: c.text, fontWeight: 500 }}>{row.metric.v}</div>
                  <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mt-1" style={{ color: c.textMute }}>{row.metric.k}</div>
                </div>
                <div className="text-[12px] pb-1" style={{ color: c.textDim }}>{row.metric.sub}</div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ============ PRICING — tiered fee structure, serif numbers ============ */}
      <section id="pricing" className="border-t border-b" style={{ borderColor: c.rule, background: dark ? "#0c0c0b" : "#F2EEE6" }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
          <div className="grid grid-cols-12 gap-10 mb-20">
            <div className="col-span-12 md:col-span-7">
              <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
                <span style={{ color: c.accent }}>§ 04</span> &nbsp; Fee schedule
              </div>
              <h2 className="font-serif-ed ed-h1 lead-display max-w-[18ch]" style={{ fontWeight: 400 }}>
                A tiered fee.<br/>
                <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>Printed in full. No carry.</em>
              </h2>
            </div>
            <div className="col-span-12 md:col-span-5 md:pt-10 text-[15px] leading-[1.65]" style={{ color: c.textDim }}>
              Folio is a flat AUM fee, declining at thresholds. No performance fees, no fund-of-fund layers, no kickbacks
              from custodians. Everything below is what you actually pay.
            </div>
          </div>

          <div className="grid grid-cols-12 border-t" style={{ borderColor: c.rule }}>
            <div className="col-span-12 grid grid-cols-12 py-5 font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.textMute, borderBottom: `1px solid ${c.rule}` }}>
              <div className="col-span-6 md:col-span-5">Bracket</div>
              <div className="col-span-3 md:col-span-3 text-right md:text-left">Annual fee</div>
              <div className="hidden md:block md:col-span-2">Min. review cadence</div>
              <div className="col-span-3 md:col-span-2 text-right">Concierge desk</div>
            </div>
            {[
              { range: "First $500,000",       fee: "0.95%", cad: "Quarterly", desk: "Shared" },
              { range: "$500k — $2,000,000",   fee: "0.75%", cad: "Quarterly", desk: "Shared" },
              { range: "$2,000,000 — $10M",    fee: "0.55%", cad: "Monthly",   desk: "Dedicated" },
              { range: "Above $10,000,000",    fee: "0.35%", cad: "On request",desk: "Dedicated" },
            ].map((r, i) => (
              <div key={i} className="col-span-12 grid grid-cols-12 py-6 items-baseline" style={{ borderBottom: `1px solid ${c.rule}` }}>
                <div className="col-span-6 md:col-span-5 text-[15px]" style={{ color: c.text }}>{r.range}</div>
                <div className="col-span-3 md:col-span-3 text-right md:text-left">
                  <span className="font-serif-ed tnum text-[34px] md:text-[40px]" style={{ color: c.text, fontWeight: 400 }}>{r.fee}</span>
                </div>
                <div className="hidden md:block md:col-span-2 font-mono-ed text-[12px]" style={{ color: c.textDim }}>{r.cad}</div>
                <div className="col-span-3 md:col-span-2 text-right text-[13px]" style={{ color: c.textDim }}>{r.desk}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-6 text-[12px]" style={{ color: c.textMute }}>
            <span>— Fees are blended across brackets, billed quarterly in arrears.</span>
            <span>— Tax, estate, and equity-compensation work included.</span>
            <span>— Custody at Schwab Institutional or Fidelity, your choice.</span>
          </div>
        </div>
      </section>

      {/* ============ WHY FOLIO ============ */}
      <section id="thesis" className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-12 md:col-span-4">
            <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
              <span style={{ color: c.accent }}>§ 05</span> &nbsp; Why Folio
            </div>
            <h2 className="font-serif-ed ed-h1 lead-display" style={{ fontWeight: 400 }}>
              Four reasons<br/>
              <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>operators</em><br/>
              choose us.
            </h2>
            <p className="mt-8 text-[14px] leading-[1.65] max-w-[36ch]" style={{ color: c.textDim }}>
              We've found these are the things that matter to the people we work with. They might be the things that matter to you.
            </p>
          </div>
          <div className="col-span-12 md:col-span-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-14">
              {[
                {
                  k: "i.",
                  t: "Memos, not pitches.",
                  b: "We will never call you about a hot fund. The investment case is written down before the trade — and if we can't write it, we don't make it. You read it. You push back. Then it ships.",
                },
                {
                  k: "ii.",
                  t: "Optimised for the 9-to-5 portfolio.",
                  b: "If most of your net worth is sitting in a single ticker from somewhere you used to work, your problem is unwind, not allocation. Folio is built around exactly that situation.",
                },
                {
                  k: "iii.",
                  t: "Fiduciary, and only that.",
                  b: "Fee-only, no commissions, no insurance products, no proprietary funds. The numbers above are the entire revenue model. There is no second page.",
                },
                {
                  k: "iv.",
                  t: "Calm by design.",
                  b: "Quarterly reviews. Annual letters. No app notifications. We will never text you about the market. If a thesis breaks, we call. Otherwise: silence is the product.",
                },
              ].map((r, i) => (
                <div key={i}>
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="font-serif-ed text-[20px]" style={{ color: c.accent, fontStyle: "italic" }}>{r.k}</span>
                    <h3 className="font-serif-ed text-[24px] leading-[1.2]" style={{ fontWeight: 500 }}>{r.t}</h3>
                  </div>
                  <p className="text-[15px] leading-[1.65]" style={{ color: c.textDim }}>{r.b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURED CUSTOMER QUOTE ============ */}
      <section className="border-t" style={{ borderColor: c.rule, background: c.bgAlt }}>
        <div className="max-w-[1100px] mx-auto px-8 lg:px-12 py-32">
          <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-12" style={{ color: c.textMute }}>
            <span style={{ color: c.accent }}>§ 06</span> &nbsp; In the words of a client
          </div>
          <blockquote className="font-serif-ed ed-h1 lead-display max-w-[24ch]" style={{ fontWeight: 400 }}>
            <span style={{ color: c.accent }} className="font-serif-ed text-[64px] leading-none">“</span>
            They unwound a position I'd been holding hostage for six years.
            Quietly. <em className="editorial" style={{ fontStyle: "italic" }}>On schedule.</em> Without a single panicked Slack."
          </blockquote>
          <div className="mt-12 grid grid-cols-12 gap-6 items-end">
            <div className="col-span-12 md:col-span-6 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-serif-ed text-[16px]"
                   style={{ background: c.accentSoft, color: c.accent }}>J</div>
              <div>
                <div className="text-[14px]" style={{ color: c.text }}>Jordan Park</div>
                <div className="text-[12px]" style={{ color: c.textMute }}>Former Director of Eng, public infra co.</div>
              </div>
            </div>
            <div className="col-span-12 md:col-span-6 md:text-right text-[12px] font-mono-ed" style={{ color: c.textMute }}>
              <span style={{ color: c.accent }}>●</span> 7 yrs · concentrated single-stock unwind · est. tax saved $1.4M
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="max-w-[1100px] mx-auto px-8 lg:px-12 py-40">
        <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-8" style={{ color: c.textMute }}>
          <span style={{ color: c.accent }}>§ 07</span> &nbsp; Next step
        </div>
        <h2 className="font-serif-ed ed-h1 lead-display max-w-[18ch]" style={{ fontWeight: 400 }}>
          A 45-minute call.<br/>
          <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>No deck. No pitch.</em>
        </h2>
        <p className="mt-8 text-[16px] leading-[1.65] max-w-[58ch]" style={{ color: c.textDim }}>
          We'll ask what you hold, what you'd like to hold, and where the friction is. If Folio is a fit, we send a short
          plan a week later. If it isn't, we say so, and tell you who is.
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-6">
          <a href="#"
             className="inline-flex items-center gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium"
             style={{ background: c.accent, color: "#1a0d05" }}>
            Book an intro call <span aria-hidden>→</span>
          </a>
          <a href="#" className="text-[13px] link-ed" style={{ color: c.textDim }}>
            Or read the 2024 annual letter ↗
          </a>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t" style={{ borderColor: c.rule }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-24">
          <div className="grid grid-cols-12 gap-10 mb-20">
            <div className="col-span-12 md:col-span-6">
              <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
                The Folio Journal
              </div>
              <h3 className="font-serif-ed text-[40px] leading-[1.05] max-w-[18ch]" style={{ fontWeight: 400 }}>
                A short letter, once a month. <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>That's all.</em>
              </h3>
            </div>
            <div className="col-span-12 md:col-span-6 md:pl-10 md:pt-2">
              <form className="flex items-center gap-2 border-b pb-3" style={{ borderColor: c.rule }} onSubmit={e => e.preventDefault()}>
                <input
                  type="email"
                  placeholder="your.address@somewhere.com"
                  className="flex-1 bg-transparent outline-none text-[16px] py-2"
                  style={{ color: c.text }}
                />
                <button type="submit"
                        className="px-4 py-2 text-[12px] rounded-full font-medium"
                        style={{ background: c.text, color: c.bg }}>
                  Subscribe →
                </button>
              </form>
              <div className="mt-4 text-[12px]" style={{ color: c.textMute }}>
                We send the journal on the first Tuesday. One topic, ~6 minutes, never resold.
              </div>
            </div>
          </div>

          <div className="rule mb-10" style={{ background: c.text }} />

          <div className="grid grid-cols-12 gap-10 text-[12px]" style={{ color: c.textDim }}>
            <div className="col-span-12 md:col-span-3">
              <div className="flex items-center gap-2 mb-4">
                <span style={{ background: c.accent }} className="w-2 h-2 rounded-full" />
                <span className="font-serif-ed text-[18px]" style={{ color: c.text }}>Folio</span>
              </div>
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
                Inari Advisors LLC<br/>
                CRD #318822 · SEC Registered
              </div>
              <div className="mt-6 leading-[1.6]">
                415 Bryant Street<br/>
                San Francisco, CA 94107
              </div>
            </div>
            <div className="col-span-6 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Practice</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Methodology</a></li>
                <li><a href="#" className="link-ed">Form ADV</a></li>
                <li><a href="#" className="link-ed">2024 letter</a></li>
                <li><a href="#" className="link-ed">Team</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Journal</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Index</a></li>
                <li><a href="#" className="link-ed">Memos (sample)</a></li>
                <li><a href="#" className="link-ed">Tax notes</a></li>
                <li><a href="#" className="link-ed">RSS</a></li>
              </ul>
            </div>
            <div className="col-span-12 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Disclosure</div>
              <p className="leading-[1.7]" style={{ color: c.textMute }}>
                Past performance is a record, not a promise. Folio is offered to qualifying households. Custody by third
                parties. No assets of clients are held by Folio.
              </p>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono-ed" style={{ color: c.textMute }}>
            <div>© Inari Advisors LLC, MMXXVI</div>
            <div className="flex gap-6">
              <a href="#" className="link-ed">Privacy</a>
              <a href="#" className="link-ed">Terms</a>
              <a href="#" className="link-ed">Disclosures</a>
            </div>
            <div>Set in Source Serif &amp; Inter.</div>
          </div>
        </div>
      </footer>
    </div>
  );
};