/**
 * Few-shot reference: Refined Editorial / Brace
 * Product: Customer success platform — mono-light editorial with warm sienna accent
 * Palette: mono-light + sienna accent
 * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.
 *
 * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated
 * here with its shared primitives so the model sees one self-contained
 * reference. Loaded by lib/orchestrator/few-shots/index.ts.
 */


// ─── variant: brace.jsx ───

// Brace — Variant 02: mono-light with warm accents, CS platform for enterprise SaaS
// Accent: #1A1A2E on #FAFAF9

window.Brace = function Brace({ mode = "light" }) {
  const dark = mode === "dark";

  const c = dark ? {
    bg: "#0E0E14",
    bgAlt: "#15151F",
    cream: "#181626",
    surface: "#1B1B27",
    text: "#F4F2EE",
    textDim: "rgba(244,242,238,0.62)",
    textMute: "rgba(244,242,238,0.40)",
    rule: "rgba(244,242,238,0.10)",
    accent: "#C8A88A",      // warm
    accentInk: "#F4F2EE",
    ink: "#F4F2EE",
  } : {
    bg: "#FAFAF9",
    bgAlt: "#FFFFFF",
    cream: "#F4EFE6",
    surface: "#FFFFFF",
    text: "#1A1A2E",
    textDim: "rgba(26,26,46,0.62)",
    textMute: "rgba(26,26,46,0.42)",
    rule: "rgba(26,26,46,0.10)",
    accent: "#B36A3A",      // warm sienna
    accentInk: "#1A1A2E",
    ink: "#1A1A2E",
  };

  // Customer wordmarks — fictional, set as serif/sans wordmarks (no images)
  const wordmarks = [
    { name: "Northwind", font: "font-serif-ed", style: { fontWeight: 500, letterSpacing: "-0.01em" } },
    { name: "VECTRON",   font: "font-sans-ed",  style: { fontWeight: 700, letterSpacing: "0.16em" } },
    { name: "Halcyon",   font: "font-serif-ed", style: { fontWeight: 400, fontStyle: "italic" } },
    { name: "Quartermast",font: "font-sans-ed", style: { fontWeight: 500, letterSpacing: "-0.02em" } },
    { name: "atrium",    font: "font-sans-ed",  style: { fontWeight: 400, letterSpacing: "-0.03em" } },
    { name: "Foundry &amp; Co.", font: "font-serif-ed", style: { fontWeight: 500 } },
    { name: "ORIEL",     font: "font-sans-ed",  style: { fontWeight: 600, letterSpacing: "0.22em" } },
    { name: "Marrow",    font: "font-serif-ed", style: { fontWeight: 500 } },
  ];

  return (
    <div className="font-sans-ed" style={{ background: c.bg, color: c.text }}>

      {/* ============ NAV ============ */}
      <nav className="max-w-[1320px] mx-auto px-8 lg:px-12 pt-24 pb-6 flex items-center justify-between">
        <a className="flex items-baseline gap-2" href="#">
          <span className="font-serif-ed text-[22px] tracking-tight" style={{ fontWeight: 500 }}>Brace</span>
          <span className="font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>/ rev.07</span>
        </a>
        <div className="hidden md:flex items-center gap-9 text-[13px]" style={{ color: c.textDim }}>
          <a href="#product" className="link-ed">Product</a>
          <a href="#customers" className="link-ed">Customers</a>
          <a href="#pricing" className="link-ed">Pricing</a>
          <a href="#" className="link-ed">Field notes</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="#" className="text-[13px] link-ed hidden sm:inline" style={{ color: c.textDim }}>Sign in</a>
          <a href="#"
             className="text-[13px] px-3.5 py-2 rounded-full font-medium border"
             style={{ borderColor: c.text, color: c.text }}>
            Talk to sales
          </a>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="relative">
        <div className="absolute inset-0 mesh-brace pointer-events-none" aria-hidden />
        <div className="relative max-w-[1320px] mx-auto px-8 lg:px-12 pt-20 pb-28">
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-12 md:col-span-8">
              <div className="flex items-center gap-3 mb-10 font-mono-ed text-[11px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
                <span style={{ color: c.accent }}>Vol. I</span>
                <span className="w-8 h-px" style={{ background: c.rule }} />
                <span>Customer Success, for the back half of the funnel</span>
              </div>

              <h1 className="font-serif-ed lead-display-tight max-w-[16ch]"
                  style={{ fontWeight: 400, fontSize: "clamp(48px,8.0vw,128px)" }}>
                Renewal conversations,<br/>
                <em className="editorial" style={{ fontStyle: "italic" }}>before</em> they're contentious.
              </h1>

              <p className="mt-14 text-[19px] leading-[1.55] max-w-[58ch]" style={{ color: c.textDim }}>
                Brace is the working surface for enterprise customer success teams. It listens to every account
                signal — usage, sentiment, support, contract — and quietly tells your CSMs where the renewal
                is about to slip, six months before it would.
              </p>

              <div className="mt-12 flex flex-wrap items-center gap-7">
                <a href="#"
                   className="inline-flex items-center gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium"
                   style={{ background: c.ink, color: c.bg }}>
                  Request a working session <span aria-hidden>→</span>
                </a>
                <a href="#" className="text-[13px] link-ed" style={{ color: c.textDim }}>
                  See a recorded walkthrough <span aria-hidden style={{ color: c.accent }}>↗</span>
                </a>
              </div>
            </div>

            {/* Hero data card */}
            <div className="col-span-12 md:col-span-4 md:pt-4">
              <div className="rounded-sm p-7 border h-full" style={{ background: c.surface, borderColor: c.rule }}>
                <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-5" style={{ color: c.textMute }}>
                  Account · Halcyon Robotics
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="font-serif-ed text-[44px] tnum" style={{ fontWeight: 400 }}>87<span style={{ color: c.textMute, fontSize: "20px" }}>/100</span></div>
                  <div className="text-[11px] font-mono-ed" style={{ color: c.accent }}>↑ from 72 · 30d</div>
                </div>
                <div className="text-[12px] mt-1" style={{ color: c.textDim }}>Renewal confidence, blended</div>

                <div className="mt-7 space-y-3 text-[12px]">
                  {[
                    ["Usage depth (P90)",  "84",  "+6"],
                    ["Sentiment, exec",    "76",  "−2"],
                    ["Support burden",     "12 tk","−9"],
                    ["Contract distance",  "147d","—"],
                  ].map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b" style={{ borderColor: c.rule }}>
                      <div style={{ color: c.textDim }}>{r[0]}</div>
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono-ed tnum" style={{ color: c.text }}>{r[1]}</span>
                        <span className="font-mono-ed text-[10px] w-8 text-right" style={{ color: c.textMute }}>{r[2]}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 rounded-sm" style={{ background: c.cream }}>
                  <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>
                    Brace suggests
                  </div>
                  <div className="font-serif-ed text-[15px] leading-[1.4]" style={{ color: c.ink }}>
                    Book a 30-min review with Priya before EOQ — exec sentiment is drifting and contract sits in their next FY.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============ LARGE HERO QUOTE FROM VP OF CS ============ */}
      <section id="customers" className="border-t border-b" style={{ borderColor: c.rule, background: c.cream }}>
        <div className="max-w-[1200px] mx-auto px-8 lg:px-12 py-32">
          <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-10" style={{ color: c.textMute }}>
            <span style={{ color: c.accent }}>Field note · 04</span> &nbsp; — From Halcyon Robotics
          </div>
          <blockquote className="font-serif-ed lead-display max-w-[22ch]"
                      style={{ fontWeight: 400, fontSize: "clamp(38px, 5.6vw, 88px)" }}>
            <span style={{ color: c.accent }} className="font-serif-ed text-[80px] leading-none align-top">“</span>
            For ten years my job was to be surprised by churn.
            Brace is the first tool that <em className="editorial" style={{ fontStyle: "italic" }}>stops surprising me</em>."
          </blockquote>
          <div className="mt-14 grid grid-cols-12 gap-6 items-end">
            <div className="col-span-12 md:col-span-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center font-serif-ed text-[20px]"
                     style={{ background: c.ink, color: c.bg }}>P</div>
                <div>
                  <div className="text-[15px]" style={{ color: c.ink }}>Priya Suresh</div>
                  <div className="text-[12px]" style={{ color: c.textDim }}>VP, Customer Success — Halcyon Robotics</div>
                </div>
              </div>
            </div>
            <div className="col-span-12 md:col-span-6 md:text-right text-[12px] font-mono-ed" style={{ color: c.textMute }}>
              GRR 96.4% &nbsp;·&nbsp; NRR 118% &nbsp;·&nbsp; 14 CSMs &nbsp;·&nbsp; live on Brace since '24
            </div>
          </div>
        </div>
      </section>

      {/* ============ CUSTOMER WORDMARKS (no logo images) ============ */}
      <section className="border-b" style={{ borderColor: c.rule }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-20">
          <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-10 flex items-center gap-3" style={{ color: c.textMute }}>
            <span className="w-8 h-px" style={{ background: c.rule }} />
            Read in the renewal rooms of
            <span className="w-8 h-px" style={{ background: c.rule }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-12 gap-x-8 items-center justify-items-center">
            {wordmarks.map((w, i) => (
              <div key={i} className={`${w.font} text-[26px] md:text-[30px]`}
                   style={{ ...w.style, color: c.ink, opacity: 0.85 }}
                   dangerouslySetInnerHTML={{ __html: w.name }} />
            ))}
          </div>
        </div>
      </section>

      {/* ============ FEATURES — alternating split rows, alt cream ============ */}
      <section id="product">
        {[
          {
            n: "01",
            tag: "Account Signals",
            title: "Every dashboard you ignore — finally in one place.",
            body: "Brace listens across product analytics, Salesforce, Zendesk, Gong calls, billing, and email. The work isn't another dashboard; it's a confidence score per account, broken into four parts you can argue with: usage, sentiment, support, contract.",
            metric: { k: "Sources connected, median", v: "7", sub: "in week one" },
            bg: "white",
            ph: "left",
          },
          {
            n: "02",
            tag: "Renewal Brief",
            title: "A two-page brief, three weeks before the call.",
            body: "Twenty-one days before the renewal conversation, Brace drafts the brief: what changed, who pushed back, what the customer said in their last QBR, and which three questions to lead with. Your CSM edits. They don't write.",
            metric: { k: "Avg. prep time saved", v: "4.2h", sub: "per renewal, blended" },
            bg: "cream",
            ph: "right",
          },
          {
            n: "03",
            tag: "Quiet Alerts",
            title: "It tells your CSM. Not everyone in Slack.",
            body: "When confidence drops, the alert goes to one person, with one suggested next step, with a deadline. No firehose, no #cs-alerts channel, no panic. The board only sees what the team has already worked.",
            metric: { k: "Alerts to noise ratio", v: "1:1.2", sub: "vs. 1:14 industry avg." },
            bg: "white",
            ph: "left",
          },
        ].map((row, i) => (
          <div key={i} className={`border-b`} style={{
            borderColor: c.rule,
            background: row.bg === "cream" ? c.cream : c.bg,
          }}>
            <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
              <div className="grid grid-cols-12 gap-10 items-center">
                <div className={`col-span-12 md:col-span-6 ${row.ph === "right" ? "md:order-2" : ""}`}>
                  <div className="rounded-sm overflow-hidden border" style={{ borderColor: c.rule, background: c.surface }}>
                    {/* Faux UI per row */}
                    {i === 0 && (
                      <div className="p-7">
                        <div className="flex items-center justify-between mb-6">
                          <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>Top accounts · this week</div>
                          <div className="font-mono-ed text-[10px]" style={{ color: c.textMute }}>Sort ↓ Δ</div>
                        </div>
                        <div className="divide-y" style={{ borderColor: c.rule }}>
                          {[
                            ["Northwind Logistics", 91, "+4",  "ok"],
                            ["VECTRON Defense",     78, "−6",  "watch"],
                            ["Quartermast",         84, "+1",  "ok"],
                            ["Foundry & Co.",       62, "−11", "at-risk"],
                            ["Atrium Health",       88, "—",   "ok"],
                            ["ORIEL Studios",       71, "−3",  "watch"],
                          ].map((r, j) => (
                            <div key={j} className="flex items-center justify-between py-4 first:pt-0" style={{ borderColor: c.rule, borderBottomWidth: j === 5 ? 0 : 1 }}>
                              <div className="flex items-baseline gap-3">
                                <span className="font-serif-ed text-[16px]" style={{ color: c.text }}>{r[0]}</span>
                                <span className="font-mono-ed text-[10px]" style={{
                                  color: r[3] === "at-risk" ? c.accent : (r[3] === "watch" ? c.textDim : c.textMute)
                                }}>{r[3]}</span>
                              </div>
                              <div className="flex items-baseline gap-4">
                                <span className="font-mono-ed tnum text-[14px]" style={{ color: c.text }}>{r[1]}</span>
                                <span className="font-mono-ed tnum text-[11px] w-8 text-right" style={{
                                  color: typeof r[2] === "string" && r[2].startsWith("−") ? c.accent : c.textMute
                                }}>{r[2]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {i === 1 && (
                      <div className="p-8">
                        <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>
                          Brief · VECTRON Defense · Q2 renewal
                        </div>
                        <div className="font-serif-ed text-[24px] leading-[1.2] mb-5" style={{ color: c.text }}>
                          A renewal that will live or die on the new compliance module.
                        </div>
                        <div className="space-y-3 text-[13px] leading-[1.6]" style={{ color: c.textDim }}>
                          <p><span className="font-mono-ed text-[10px] mr-2" style={{ color: c.accent }}>·</span>
                          Usage is up 22% in the workflow engine, but exec adoption has stalled since March.</p>
                          <p><span className="font-mono-ed text-[10px] mr-2" style={{ color: c.accent }}>·</span>
                          In the Feb QBR, Anand explicitly said "compliance is the only thing keeping us here."</p>
                          <p><span className="font-mono-ed text-[10px] mr-2" style={{ color: c.accent }}>·</span>
                          Three open support tickets, all rated ‘frustrated' — none escalated.</p>
                        </div>
                        <div className="mt-7 pt-5 border-t font-mono-ed text-[11px] flex items-center justify-between" style={{ borderColor: c.rule, color: c.textMute }}>
                          <span>brief · v.3 · drafted 14 May</span>
                          <span style={{ color: c.accent }}>Lead with Q2.</span>
                        </div>
                      </div>
                    )}
                    {i === 2 && (
                      <div className="p-7">
                        <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-5" style={{ color: c.textMute }}>Today's queue · 1 owner</div>
                        <div className="space-y-4">
                          {[
                            {who: "Foundry & Co.", what: "Exec sentiment dropped 14 pts after pricing memo leaked. Reach out to Mara today.", when: "by EOD"},
                            {who: "ORIEL Studios", what: "Usage of analytics module fell to zero in the last 11 days. Likely an integration break.", when: "this week"},
                          ].map((r, j) => (
                            <div key={j} className="p-4 rounded-sm border" style={{ borderColor: c.rule }}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="font-serif-ed text-[16px]" style={{ color: c.text }}>{r.who}</div>
                                <div className="font-mono-ed text-[10px]" style={{ color: c.accent }}>● due {r.when}</div>
                              </div>
                              <div className="text-[13px] leading-[1.55]" style={{ color: c.textDim }}>{r.what}</div>
                            </div>
                          ))}
                          <div className="text-[12px] font-mono-ed pt-2" style={{ color: c.textMute }}>
                            — Brace shipped 2 alerts to you this week. Industry avg. for your team size: 31.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={`col-span-12 md:col-span-6 ${row.ph === "right" ? "md:order-1 md:pr-16" : "md:pl-16"}`}>
                  <div className="flex items-center gap-3 mb-6 font-mono-ed text-[11px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
                    <span style={{ color: c.accent }}>{row.n}</span>
                    <span className="w-8 h-px" style={{ background: c.rule }} />
                    <span>{row.tag}</span>
                  </div>
                  <h3 className="font-serif-ed ed-h2 lead-display max-w-[18ch]" style={{ fontWeight: 400 }}>{row.title}</h3>
                  <p className="mt-8 text-[16px] leading-[1.65] max-w-[52ch]" style={{ color: c.textDim }}>{row.body}</p>
                  <div className="mt-10 flex items-baseline gap-6">
                    <div>
                      <div className="font-serif-ed tnum text-[40px]" style={{ color: c.text, fontWeight: 400 }}>{row.metric.v}</div>
                      <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mt-1" style={{ color: c.textMute }}>{row.metric.k}</div>
                    </div>
                    <div className="text-[12px] pb-1" style={{ color: c.textDim }}>{row.metric.sub}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ============ PRICING — 3 tier business ============ */}
      <section id="pricing" style={{ background: c.bg }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
          <div className="grid grid-cols-12 gap-10 mb-20">
            <div className="col-span-12 md:col-span-7">
              <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
                <span style={{ color: c.accent }}>Pricing</span> &nbsp; — Annual, per-CSM
              </div>
              <h2 className="font-serif-ed ed-h1 lead-display max-w-[22ch]" style={{ fontWeight: 400 }}>
                Priced for the team,<br/>
                not the seat count.
              </h2>
            </div>
            <div className="col-span-12 md:col-span-5 md:pt-12 text-[15px] leading-[1.65]" style={{ color: c.textDim }}>
              Implementation, integrations, and the first quarter of brief calibration are included at every tier. We don't
              ship Brace until your team can read the briefs without us in the room.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-l rounded-sm overflow-hidden" style={{ borderColor: c.rule }}>
            {[
              {
                name: "Studio",
                for: "For CS teams of 3–10",
                price: "$1,200",
                unit: "/ CSM / month",
                billed: "Billed annually. 12-month minimum.",
                features: [
                  "Up to 250 active accounts",
                  "5 data sources connected",
                  "Renewal briefs, monthly",
                  "Quiet alerts to email + Slack",
                  "Quarterly calibration session",
                ],
                cta: "Start a working session",
                primary: false,
              },
              {
                name: "Practice",
                for: "For CS teams of 10–40",
                price: "$1,950",
                unit: "/ CSM / month",
                billed: "Billed annually. Volume discounts at 25+ seats.",
                features: [
                  "Up to 1,200 active accounts",
                  "12 data sources, full Gong & Salesforce",
                  "Renewal briefs, weekly cadence",
                  "Dedicated calibration analyst",
                  "Exec digest (read by your CRO, not you)",
                  "SSO, SCIM, audit log",
                ],
                cta: "Most teams start here",
                primary: true,
              },
              {
                name: "Atelier",
                for: "Global CS organisations",
                price: "Bespoke",
                unit: "",
                billed: "Annual, with named SLAs.",
                features: [
                  "Unlimited accounts and seats",
                  "Custom data warehouse + reverse ETL",
                  "On-prem brief models, your data, your IP",
                  "Embedded Brace analyst, 0.4 FTE",
                  "Procurement, MSA, vendor review handled",
                ],
                cta: "Speak with the partner",
                primary: false,
              },
            ].map((p, i) => (
              <div key={i}
                   className="p-10 border-r border-b"
                   style={{
                     borderColor: c.rule,
                     background: p.primary ? c.ink : (i === 1 ? c.bg : c.bg),
                     color: p.primary ? c.bg : c.text,
                   }}>
                <div className="flex items-baseline justify-between mb-3">
                  <div className="font-serif-ed text-[28px]" style={{ fontWeight: 500 }}>{p.name}</div>
                  {p.primary && <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.accent }}>recommended</div>}
                </div>
                <div className="text-[13px] mb-10" style={{ color: p.primary ? "rgba(250,250,249,0.6)" : c.textDim }}>{p.for}</div>

                <div className="flex items-baseline gap-2 mb-1">
                  <div className="font-serif-ed text-[64px] tnum" style={{ fontWeight: 400 }}>{p.price}</div>
                  <div className="text-[13px]" style={{ color: p.primary ? "rgba(250,250,249,0.6)" : c.textDim }}>{p.unit}</div>
                </div>
                <div className="text-[12px] font-mono-ed mb-10" style={{ color: p.primary ? "rgba(250,250,249,0.55)" : c.textMute }}>
                  {p.billed}
                </div>

                <ul className="space-y-3 text-[14px] mb-10 ed-list">
                  {p.features.map((f, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="font-mono-ed text-[12px] mt-0.5" style={{ color: c.accent }}>—</span>
                      <span style={{ color: p.primary ? "rgba(250,250,249,0.85)" : c.text }}>{f}</span>
                    </li>
                  ))}
                </ul>

                <a href="#"
                   className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium"
                   style={{
                     background: p.primary ? c.bg : "transparent",
                     color: p.primary ? c.ink : c.text,
                     border: p.primary ? "none" : `1px solid ${c.rule.replace("0.10", "0.30")}`,
                   }}>
                  {p.cta} <span aria-hidden>→</span>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY BRACE ============ */}
      <section className="border-t border-b" style={{ borderColor: c.rule, background: c.cream }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-32">
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-12 md:col-span-4">
              <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
                <span style={{ color: c.accent }}>Why Brace</span>
              </div>
              <h2 className="font-serif-ed ed-h1 lead-display" style={{ fontWeight: 400 }}>
                Three things<br/>
                <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>your CRO</em><br/>
                already knows.
              </h2>
            </div>
            <div className="col-span-12 md:col-span-8">
              <div className="space-y-12">
                {[
                  {
                    k: "i.",
                    t: "Churn is a backlog, not a season.",
                    b: "By the time it shows up in the QBR, the conversation has been going on inside the customer for ninety days. Brace exists to surface that conversation while there's still a hand to play. Not after.",
                  },
                  {
                    k: "ii.",
                    t: "Your CSMs are not the problem.",
                    b: "They're managing twenty-eight accounts apiece and pattern-matching from memory. Brace gives them the prep time they were already trying to take — and a brief they can defend to a board.",
                  },
                  {
                    k: "iii.",
                    t: "Alerts should respect a calendar.",
                    b: "Every other tool yells. Brace writes. One owner, one action, one deadline. If we can't summarise it in two sentences, it doesn't ship.",
                  },
                ].map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-6 pb-12" style={{ borderBottom: i < 2 ? `1px solid ${c.rule}` : "none" }}>
                    <div className="col-span-12 md:col-span-2">
                      <div className="font-serif-ed text-[28px]" style={{ color: c.accent, fontStyle: "italic" }}>{r.k}</div>
                    </div>
                    <div className="col-span-12 md:col-span-10">
                      <h3 className="font-serif-ed text-[28px] leading-[1.2] mb-4" style={{ fontWeight: 500 }}>{r.t}</h3>
                      <p className="text-[15px] leading-[1.7] max-w-[60ch]" style={{ color: c.textDim }}>{r.b}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ SECOND CUSTOMER QUOTE ============ */}
      <section className="max-w-[1200px] mx-auto px-8 lg:px-12 py-32">
        <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-10" style={{ color: c.textMute }}>
          <span style={{ color: c.accent }}>Field note · 07</span> &nbsp; — From Northwind Logistics
        </div>
        <blockquote className="font-serif-ed ed-h1 lead-display max-w-[26ch]" style={{ fontWeight: 400 }}>
          We renewed two of our top-five before the conversation
          would <em className="editorial" style={{ fontStyle: "italic" }}>normally have started.</em>
        </blockquote>
        <div className="mt-12 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-serif-ed text-[16px]"
               style={{ background: c.cream, color: c.ink }}>D</div>
          <div className="text-[14px]" style={{ color: c.text }}>
            Devon Iyer
            <span className="ml-2 text-[12px]" style={{ color: c.textMute }}>— Director of CS, Northwind</span>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="border-t" style={{ borderColor: c.rule, background: c.cream }}>
        <div className="max-w-[1100px] mx-auto px-8 lg:px-12 py-40">
          <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-8" style={{ color: c.textMute }}>
            <span style={{ color: c.accent }}>Next</span> &nbsp; A working session
          </div>
          <h2 className="font-serif-ed ed-h1 lead-display max-w-[22ch]" style={{ fontWeight: 400 }}>
            Bring one renewal.<br/>
            <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>We'll bring the brief.</em>
          </h2>
          <p className="mt-8 text-[16px] leading-[1.65] max-w-[58ch]" style={{ color: c.textDim }}>
            Send us one account you're nervous about. In two weeks we come back with a brief drafted from your own data,
            sat next to your CSM. If it isn't better than what they would have walked in with — we don't talk again.
          </p>
          <div className="mt-12 flex flex-wrap items-center gap-6">
            <a href="#"
               className="inline-flex items-center gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium"
               style={{ background: c.ink, color: c.bg }}>
              Book the session <span aria-hidden>→</span>
            </a>
            <a href="#" className="text-[13px] link-ed" style={{ color: c.textDim }}>
              Or read a sample brief ↗
            </a>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ background: c.bg }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-12 py-24">
          <div className="grid grid-cols-12 gap-10 mb-20">
            <div className="col-span-12 md:col-span-6">
              <div className="font-mono-ed text-[11px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>
                Brace Field Notes
              </div>
              <h3 className="font-serif-ed text-[40px] leading-[1.05] max-w-[20ch]" style={{ fontWeight: 400 }}>
                Two essays a month, on the business of <em className="editorial" style={{ fontStyle: "italic", color: c.textDim }}>renewing.</em>
              </h3>
            </div>
            <div className="col-span-12 md:col-span-6 md:pl-10 md:pt-2">
              <form className="flex items-center gap-2 border-b pb-3" style={{ borderColor: c.rule }} onSubmit={e => e.preventDefault()}>
                <input
                  type="email"
                  placeholder="work email, please"
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
                12,400 CS leaders read this. We don't sell the list. We barely send it.
              </div>
            </div>
          </div>

          <div className="rule mb-10" style={{ background: c.text }} />

          <div className="grid grid-cols-12 gap-10 text-[12px]" style={{ color: c.textDim }}>
            <div className="col-span-12 md:col-span-3">
              <div className="font-serif-ed text-[22px] mb-3" style={{ color: c.text }}>Brace</div>
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase" style={{ color: c.textMute }}>
                Brace, Inc. · 2026
              </div>
              <div className="mt-5 leading-[1.7]">
                88 Mercer Street, 4th floor<br/>
                New York, NY 10012
              </div>
            </div>
            <div className="col-span-6 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Product</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Account signals</a></li>
                <li><a href="#" className="link-ed">Renewal brief</a></li>
                <li><a href="#" className="link-ed">Quiet alerts</a></li>
                <li><a href="#" className="link-ed">Integrations</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Company</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Field notes</a></li>
                <li><a href="#" className="link-ed">Customers</a></li>
                <li><a href="#" className="link-ed">Careers — 4 open</a></li>
                <li><a href="#" className="link-ed">Security</a></li>
              </ul>
            </div>
            <div className="col-span-12 md:col-span-3">
              <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-4" style={{ color: c.textMute }}>Contact</div>
              <ul className="space-y-2.5">
                <li><a href="mailto:hello@brace.cs" className="link-ed">hello@brace.cs</a></li>
                <li><a href="#" className="link-ed">Press</a></li>
                <li><a href="#" className="link-ed">Partner program</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono-ed" style={{ color: c.textMute }}>
            <div>© Brace, Inc. — All wordmarks are property of their owners.</div>
            <div className="flex gap-6">
              <a href="#" className="link-ed">Privacy</a>
              <a href="#" className="link-ed">Terms</a>
              <a href="#" className="link-ed">DPA</a>
              <a href="#" className="link-ed">SOC 2</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};