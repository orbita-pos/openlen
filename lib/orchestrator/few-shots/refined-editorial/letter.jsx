/**
 * Few-shot reference: Refined Editorial / Letter
 * Product: Independent newsletter publishing — pure mono-light editorial
 * Palette: mono-light pure
 * Aesthetic: Linear / Vercel / Supabase-grade craft demonstration.
 *
 * Authored as a claude.ai artifact (React + Tailwind JSX). Concatenated
 * here with its shared primitives so the model sees one self-contained
 * reference. Loaded by lib/orchestrator/few-shots/index.ts.
 */


// ─── variant: letter.jsx ───

// Letter — Variant 03: pure mono light, newsletter platform for serious writers
// Accent: #000 on #FFF

window.Letter = function Letter({ mode = "light" }) {
  const dark = mode === "dark";

  const c = dark ? {
    bg: "#0A0A0A",
    bgAlt: "#0F0F0F",
    surface: "#141414",
    text: "#FFFFFF",
    textDim: "rgba(255,255,255,0.62)",
    textMute: "rgba(255,255,255,0.42)",
    rule: "rgba(255,255,255,0.16)",
    ruleSoft: "rgba(255,255,255,0.08)",
    ink: "#FFFFFF",
  } : {
    bg: "#FFFFFF",
    bgAlt: "#FAFAFA",
    surface: "#FFFFFF",
    text: "#000000",
    textDim: "rgba(0,0,0,0.62)",
    textMute: "rgba(0,0,0,0.42)",
    rule: "rgba(0,0,0,0.16)",
    ruleSoft: "rgba(0,0,0,0.08)",
    ink: "#000000",
  };

  const Rule = ({ className = "" }) => (
    <div className={`h-px w-full ${className}`} style={{ background: c.rule }} />
  );
  const RuleSoft = ({ className = "" }) => (
    <div className={`h-px w-full ${className}`} style={{ background: c.ruleSoft }} />
  );

  // Issue list (table of contents style)
  const issues = [
    { n: "047", date: "12 May 2026", title: "On the second draft, and why I'm always wrong about it.",     author: "Wren Halloway",  reads: "14,212" },
    { n: "046", date: "05 May 2026", title: "A short defence of the long sentence.",                       author: "Felix Ogun",    reads: "9,807" },
    { n: "045", date: "28 Apr 2026", title: "What I learned writing 50,000 words I'll never publish.",     author: "Amara Cole",     reads: "21,030" },
    { n: "044", date: "21 Apr 2026", title: "The semicolon, and other furniture.",                         author: "Wren Halloway",  reads: "6,318" },
    { n: "043", date: "14 Apr 2026", title: "Patron, reader, archivist — the three jobs of a subscriber.", author: "Mateo Lin",      reads: "11,940" },
  ];

  return (
    <div className="font-sans-ed" style={{ background: c.bg, color: c.text }}>

      {/* ============ NAV ============ */}
      <nav className="max-w-[1320px] mx-auto px-8 lg:px-16 pt-24 pb-6 flex items-center justify-between">
        <a className="flex items-baseline gap-3" href="#">
          <span className="font-serif-ed text-[26px] tracking-tight" style={{ fontWeight: 400 }}>
            <em className="editorial" style={{ fontStyle: "italic" }}>Letter</em>
          </span>
          <span className="font-mono-ed text-[10px] tracking-[0.2em] uppercase" style={{ color: c.textMute }}>est. MMXXIV</span>
        </a>
        <div className="hidden md:flex items-center gap-9 text-[13px]" style={{ color: c.textDim }}>
          <a href="#read" className="link-ed">Read</a>
          <a href="#write" className="link-ed">Write</a>
          <a href="#pricing" className="link-ed">Subscribe</a>
          <a href="#colophon" className="link-ed">Colophon</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="#" className="text-[13px] link-ed hidden sm:inline" style={{ color: c.textDim }}>Sign in</a>
          <a href="#"
             className="text-[13px] px-3.5 py-2 rounded-full font-medium"
             style={{ background: c.ink, color: c.bg }}>
            Start a Letter
          </a>
        </div>
      </nav>

      {/* ============ HERO — wide column ============ */}
      <header className="max-w-[1320px] mx-auto px-8 lg:px-16 pt-24 pb-28">
        <div className="flex items-center gap-4 mb-12 font-mono-ed text-[11px] tracking-[0.2em] uppercase" style={{ color: c.textMute }}>
          <span>Issue №&nbsp;001</span>
          <span className="w-10 h-px" style={{ background: c.rule }} />
          <span>The Founding Letter</span>
          <span className="w-10 h-px" style={{ background: c.rule }} />
          <span>12 May 2026</span>
        </div>

        <h1 className="font-serif-ed lead-display-tight max-w-[18ch]"
            style={{ fontWeight: 400, fontSize: "clamp(52px, 9.4vw, 160px)" }}>
          Where essays<br/>
          find their <em className="editorial" style={{ fontStyle: "italic" }}>readers.</em>
        </h1>

        {/* Narrow sub-column with drop cap */}
        <div className="mt-20 grid grid-cols-12 gap-10">
          <div className="col-span-12 md:col-span-5 md:col-start-1">
            <p className="font-serif-ed text-[22px] leading-[1.5] dropcap" style={{ color: c.text }}>
              Letter is a publishing home for writers who care about the form. No infinite scroll. No
              ‘creator economy.' No algorithmic feed that decides whether your sentence about Tuscany
              deserves to be read. Just essays — and the people who choose to read them.
            </p>
          </div>
          <div className="col-span-12 md:col-span-5 md:col-start-8 md:pt-3">
            <p className="text-[15px] leading-[1.75]" style={{ color: c.textDim }}>
              Used by 4,200 essayists — historians, novelists, working journalists, and people who write a
              long piece once a season and want it read carefully. Letter handles the mailing list, the
              archive, the typography, the paywall, and the quiet bookkeeping. You handle the writing.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-7">
              <a href="#"
                 className="inline-flex items-center gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium"
                 style={{ background: c.ink, color: c.bg }}>
                Start your Letter <span aria-hidden>→</span>
              </a>
              <a href="#" className="text-[13px] link-ed" style={{ color: c.textDim }}>
                Read this week's issue ↗
              </a>
            </div>
          </div>
        </div>

        <div className="mt-32"><Rule /></div>
      </header>

      {/* ============ FEATURED ISSUE / PULL QUOTE ============ */}
      <section className="max-w-[1320px] mx-auto px-8 lg:px-16 pb-32">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-12 md:col-span-4">
            <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: c.textMute }}>This week's issue</div>
            <div className="font-mono-ed text-[12px]" style={{ color: c.text }}>Issue №&nbsp;047</div>
            <div className="font-mono-ed text-[11px] mt-1" style={{ color: c.textMute }}>12 May 2026 · ~12 min</div>
            <div className="mt-8 text-[13px] leading-[1.7] max-w-[28ch]" style={{ color: c.textDim }}>
              From Wren Halloway, on the slow craft of writing it again.
            </div>
            <a href="#" className="inline-block mt-8 text-[13px] link-ed" style={{ color: c.text }}>Read in full →</a>
          </div>
          <div className="col-span-12 md:col-span-8">
            <h2 className="font-serif-ed lead-display max-w-[20ch]"
                style={{ fontWeight: 400, fontSize: "clamp(36px, 4.2vw, 64px)" }}>
              On the second draft, and why I'm <em className="editorial" style={{ fontStyle: "italic" }}>always</em> wrong about it.
            </h2>
            <div className="mt-10 max-w-[58ch] text-[18px] leading-[1.65] font-serif-ed" style={{ color: c.text }}>
              <p className="dropcap">
                The first draft is the part you can talk about. It has a shape. You can read it aloud to
                someone you love, and they will nod, and that nod will feel like an opinion. The second
                draft is not like this. The second draft is mostly cutting, and cutting is not a thing
                you can read aloud.
              </p>
              <p className="mt-6" style={{ color: c.textDim }}>
                I used to think the work of the second draft was an act of refinement — that I was, in
                some quiet way, becoming a better writer with every paragraph I removed. I no longer
                believe this. The work of the second draft is the work of admitting that, on Tuesday,
                I did not yet know what I was writing about ↗
              </p>
            </div>
          </div>
        </div>
      </section>

      <Rule />

      {/* ============ FEATURES — alternating split rows ============ */}
      <section id="write">
        {[
          {
            n: "I.",
            tag: "Composition",
            title: "A writing room, not a content management system.",
            body: "Two columns. A serif you can defend. A subtle ruler down the right margin that tells you when a sentence has gone past 28 words. Letter's editor was built by, and for, people who read books on purpose. No emoji picker. No engagement tips. No surfaces that want to be Substack.",
            note: "— Includes versioned drafts, side-by-side rev mode, and a footnote that knows how to be a footnote.",
            ph: "left",
          },
          {
            n: "II.",
            tag: "The Reading Page",
            title: "Designed for the long form, on a Sunday morning.",
            body: "Each issue is set in a measured column with proper leading, true small caps, and ligatures that don't trip on a fi. Readers can mark a passage and save it to their own commonplace book. Writers can see which paragraph the reading slowed down on, and which one the reader returned to twice.",
            note: "— Letter has never run a recommendation algorithm. We never will.",
            ph: "right",
          },
          {
            n: "III.",
            tag: "Patronage",
            title: "Paid readers, not ‘monetisation'.",
            body: "Letter's payments work like a small magazine: annual subscriptions, optional patron tiers, and a one-time-thank-you button at the end of each issue. Readers can tip a particular essay. Writers can choose to make one issue a year free for everyone — most do.",
            note: "— Stripe under the hood. Plain in the heart. 7% to Letter, 0% to anyone else.",
            ph: "left",
          },
        ].map((row, i) => (
          <div key={i}>
            <div className="max-w-[1320px] mx-auto px-8 lg:px-16 py-32">
              <div className="grid grid-cols-12 gap-10 items-center">
                {/* placeholder side */}
                <div className={`col-span-12 md:col-span-6 ${row.ph === "right" ? "md:order-2" : ""}`}>
                  <div className="border" style={{ borderColor: c.rule, background: c.surface }}>
                    {/* Faux page mock per row */}
                    {i === 0 && (
                      <div className="aspect-[5/4] flex">
                        <div className="w-12 border-r flex flex-col items-center py-6 gap-5 font-mono-ed text-[10px]" style={{ borderColor: c.ruleSoft, color: c.textMute }}>
                          <span>Aa</span>
                          <span>{`{ }`}</span>
                          <span>¶</span>
                          <span>—</span>
                          <span>¹</span>
                        </div>
                        <div className="flex-1 px-10 py-8 relative">
                          <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>draft · v.4 · saved 11:42</div>
                          <div className="font-serif-ed text-[24px] leading-[1.18]" style={{ color: c.text }}>
                            <em className="editorial" style={{ fontStyle: "italic" }}>An essay on the comma,</em><br/>
                            and other small invitations.
                          </div>
                          <div className="mt-5 text-[13px] leading-[1.7] font-serif-ed" style={{ color: c.textDim }}>
                            I have come, in the last decade, to believe that the comma is the most honest piece of punctuation in the English language. Not for what it says, but for what it asks of you, which is a pause, and then nothing more.
                          </div>
                          <div className="absolute right-3 top-8 bottom-8 w-px" style={{ background: c.ruleSoft }} />
                          <div className="absolute right-1 top-[160px] font-mono-ed text-[10px]" style={{ color: c.textMute }}>28w</div>
                        </div>
                      </div>
                    )}
                    {i === 1 && (
                      <div className="aspect-[5/4] p-12 flex flex-col">
                        <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-3" style={{ color: c.textMute }}>Issue №&nbsp;046 · The Common Sentence</div>
                        <div className="font-serif-ed text-[28px] leading-[1.15] mb-5" style={{ color: c.text, fontStyle: "italic" }}>
                          A short defence of the long sentence.
                        </div>
                        <div className="text-[12px] font-mono-ed mb-4" style={{ color: c.textMute }}>Felix Ogun · 7 min read · 9,807 readers</div>
                        <div className="font-serif-ed text-[14px] leading-[1.7]" style={{ color: c.textDim }}>
                          <span className="font-serif-ed text-[44px] float-left mr-2" style={{ color: c.text, lineHeight: 0.8, fontWeight: 400 }}>T</span>
                          here is a sentence in Marilynne Robinson that I have, on five separate occasions and in four separate cities, copied out by hand into the same small black notebook, and each time I read it back I am surprised by where it begins...
                        </div>
                        <div className="mt-auto flex items-end justify-between pt-6 font-mono-ed text-[10px]" style={{ color: c.textMute, borderTop: `1px solid ${c.ruleSoft}` }}>
                          <span className="pt-4">Saved to 211 commonplace books</span>
                          <span className="pt-4">↧ continue reading</span>
                        </div>
                      </div>
                    )}
                    {i === 2 && (
                      <div className="aspect-[5/4] p-10 flex flex-col">
                        <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-6" style={{ color: c.textMute }}>The Halloway Letter · subscribers</div>
                        <div className="grid grid-cols-2 gap-y-5 gap-x-8 text-[13px]">
                          <div>
                            <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>Free readers</div>
                            <div className="font-serif-ed text-[40px] tnum" style={{ color: c.text, fontWeight: 400 }}>3,108</div>
                          </div>
                          <div>
                            <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>Paid readers</div>
                            <div className="font-serif-ed text-[40px] tnum" style={{ color: c.text, fontWeight: 400 }}>614</div>
                          </div>
                          <div>
                            <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>Patrons</div>
                            <div className="font-serif-ed text-[40px] tnum" style={{ color: c.text, fontWeight: 400 }}>47</div>
                          </div>
                          <div>
                            <div className="font-mono-ed text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: c.textMute }}>Annual revenue</div>
                            <div className="font-serif-ed text-[40px] tnum" style={{ color: c.text, fontWeight: 400 }}>$58,420</div>
                          </div>
                        </div>
                        <div className="mt-auto pt-6 font-mono-ed text-[10px]" style={{ color: c.textMute, borderTop: `1px solid ${c.ruleSoft}` }}>
                          letter takes 7%. stripe takes 2.9%. you keep 90.1%.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* text side */}
                <div className={`col-span-12 md:col-span-6 ${row.ph === "right" ? "md:order-1 md:pr-16" : "md:pl-16"}`}>
                  <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-6" style={{ color: c.textMute }}>
                    Section {row.n} &nbsp;·&nbsp; {row.tag}
                  </div>
                  <h3 className="font-serif-ed lead-display max-w-[18ch]" style={{ fontWeight: 400, fontSize: "clamp(30px, 3.4vw, 52px)" }}>
                    {row.title}
                  </h3>
                  <p className="mt-8 text-[16px] leading-[1.7] max-w-[52ch] font-serif-ed" style={{ color: c.textDim }}>{row.body}</p>
                  <p className="mt-6 text-[12px] font-mono-ed max-w-[58ch]" style={{ color: c.textMute }}>{row.note}</p>
                </div>
              </div>
            </div>
            <Rule />
          </div>
        ))}
      </section>

      {/* ============ INDEX / READ — table of contents style ============ */}
      <section id="read" className="max-w-[1320px] mx-auto px-8 lg:px-16 py-32">
        <div className="grid grid-cols-12 gap-10 mb-16">
          <div className="col-span-12 md:col-span-5">
            <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>The Index</div>
            <h2 className="font-serif-ed lead-display" style={{ fontWeight: 400, fontSize: "clamp(40px, 5.0vw, 72px)" }}>
              A few of the<br/>letters this <em className="editorial" style={{ fontStyle: "italic" }}>spring.</em>
            </h2>
          </div>
          <div className="col-span-12 md:col-span-5 md:col-start-8 md:pt-8 text-[15px] leading-[1.7]" style={{ color: c.textDim }}>
            Letter publishes once a week, on Monday morning, before most of the internet is awake. The full index is
            kept here, in chronological order, and on paper twice a year as a bound annual.
          </div>
        </div>

        <Rule />
        {issues.map((it, i) => (
          <a key={i} href="#"
             className="group grid grid-cols-12 gap-6 py-7 items-baseline transition-colors hover:bg-[rgba(0,0,0,0.02)]"
             style={{ borderBottom: `1px solid ${c.rule}` }}>
            <div className="col-span-2 md:col-span-1 font-mono-ed text-[12px] tnum" style={{ color: c.textMute }}>№ {it.n}</div>
            <div className="hidden md:block md:col-span-2 font-mono-ed text-[11px]" style={{ color: c.textMute }}>{it.date}</div>
            <div className="col-span-10 md:col-span-6">
              <h3 className="font-serif-ed text-[22px] md:text-[26px] leading-[1.2]" style={{ fontWeight: 400 }}>
                {it.title}
              </h3>
            </div>
            <div className="col-span-6 md:col-span-2 text-[13px]" style={{ color: c.textDim }}>{it.author}</div>
            <div className="col-span-6 md:col-span-1 text-right font-mono-ed text-[11px] tnum" style={{ color: c.textMute }}>{it.reads} →</div>
          </a>
        ))}
        <div className="mt-8 text-[13px] font-mono-ed" style={{ color: c.textMute }}>— Forty-two more issues in the index ↧</div>
      </section>

      <Rule />

      {/* ============ PRICING — simple two-tier ============ */}
      <section id="pricing" className="max-w-[1320px] mx-auto px-8 lg:px-16 py-32">
        <div className="grid grid-cols-12 gap-10 mb-16">
          <div className="col-span-12 md:col-span-7">
            <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Pricing</div>
            <h2 className="font-serif-ed lead-display max-w-[18ch]" style={{ fontWeight: 400, fontSize: "clamp(40px, 5.0vw, 72px)" }}>
              Two ways<br/>to keep <em className="editorial" style={{ fontStyle: "italic" }}>writing.</em>
            </h2>
          </div>
          <div className="col-span-12 md:col-span-5 md:pt-10 text-[15px] leading-[1.7]" style={{ color: c.textDim }}>
            Free for as long as you'd like, and a flat annual fee when you'd like the rest of it. There is no per-seat
            pricing on Letter. There is no audience tier. We charge once.
          </div>
        </div>

        <Rule />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* Free */}
          <div className="py-16 md:pr-16" style={{ borderRight: `1px solid ${c.rule}` }}>
            <div className="flex items-baseline justify-between mb-6">
              <h3 className="font-serif-ed text-[40px]" style={{ fontWeight: 400 }}>Free</h3>
              <span className="font-mono-ed text-[11px] tracking-[0.2em] uppercase" style={{ color: c.textMute }}>Forever</span>
            </div>
            <div className="font-serif-ed text-[88px] leading-none tnum mb-2" style={{ fontWeight: 400 }}>
              $0
            </div>
            <div className="text-[13px] font-mono-ed mb-10" style={{ color: c.textMute }}>per year — no card required</div>

            <ul className="space-y-4 text-[15px] leading-[1.6] mb-10 ed-list">
              {[
                "A Letter at name.letter.press",
                "Up to 500 readers on the mailing list",
                "Full editor, full archive, full typography",
                "The reading page, with footnotes",
                "A private commonplace book for your readers",
              ].map((f, i) => (
                <li key={i} className="flex gap-4"><span style={{ color: c.textMute }}>—</span><span>{f}</span></li>
              ))}
            </ul>

            <a href="#"
               className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[13px] font-medium border"
               style={{ borderColor: c.ink, color: c.ink }}>
              Start a free Letter <span aria-hidden>→</span>
            </a>
          </div>

          {/* Pro */}
          <div className="py-16 md:pl-16">
            <div className="flex items-baseline justify-between mb-6">
              <h3 className="font-serif-ed text-[40px]" style={{ fontWeight: 400 }}>Pro</h3>
              <span className="font-mono-ed text-[11px] tracking-[0.2em] uppercase" style={{ color: c.textMute }}>Annual · one price</span>
            </div>
            <div className="flex items-baseline gap-3 mb-2">
              <div className="font-serif-ed text-[88px] leading-none tnum" style={{ fontWeight: 400 }}>
                $96
              </div>
              <div className="font-mono-ed text-[12px] pb-3" style={{ color: c.textMute }}>/ year, billed once</div>
            </div>
            <div className="text-[13px] font-mono-ed mb-10" style={{ color: c.textMute }}>$8 / month equivalent — no per-reader fees</div>

            <ul className="space-y-4 text-[15px] leading-[1.6] mb-10 ed-list">
              {[
                "Your own domain (letter routes the mail)",
                "Unlimited readers, free and paid",
                "Patronage tiers, tip jars, and annual gifting",
                "Bound-annual export (PDF, print-ready)",
                "Reading analytics — paragraph-level, anonymised",
                "Priority editorial support (a real person, by mail)",
              ].map((f, i) => (
                <li key={i} className="flex gap-4"><span style={{ color: c.textMute }}>—</span><span>{f}</span></li>
              ))}
            </ul>

            <a href="#"
               className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[13px] font-medium"
               style={{ background: c.ink, color: c.bg }}>
              Subscribe to Pro <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        <div className="pt-8 text-[12px] font-mono-ed" style={{ color: c.textMute }}>
          — Letter takes a flat 7% on patronage payments, in addition to Stripe's processing fee. No upgrade gating. No surprise modal.
        </div>
      </section>

      <Rule />

      {/* ============ WHY LETTER ============ */}
      <section className="max-w-[1320px] mx-auto px-8 lg:px-16 py-32">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-12 md:col-span-4">
            <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Why Letter</div>
            <h2 className="font-serif-ed lead-display" style={{ fontWeight: 400, fontSize: "clamp(40px, 5.0vw, 72px)" }}>
              Four<br/>
              <em className="editorial" style={{ fontStyle: "italic" }}>convictions.</em>
            </h2>
            <p className="mt-8 text-[14px] leading-[1.7] max-w-[34ch] font-serif-ed" style={{ color: c.textDim }}>
              These have not changed since the first issue went out. We expect they will not change.
            </p>
          </div>
          <div className="col-span-12 md:col-span-8 space-y-12 md:pl-8">
            {[
              { k: "i.",   t: "The serif is the product.",
                b: "Typography is not decoration. A reading page that has been set with care is the difference between an essay finished and an essay closed. Letter ships with a small, opinionated set of faces. We will not add a Comic Sans toggle, no matter how kindly you ask." },
              { k: "ii.",  t: "Readers, not subscribers.",
                b: "We do not call them subscribers. We call them readers. The distinction matters. A reader can be free or paying, occasional or devoted; what they share is having read the thing. Letter is built around the act of reading, not the act of paying." },
              { k: "iii.", t: "No recommendations, ever.",
                b: "Letter does not have a discovery feed. We do not recommend other writers. We do not surface anything. Your readers found you because you told them about you. We think that's the only way it should work." },
              { k: "iv.",  t: "A small, slow company.",
                b: "Letter is run by nine people in a back office in Oakland. We will not raise growth-stage capital. We will not be acquired. We charge a flat fee and we have been profitable since month seven. This is the entire business plan." },
            ].map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-6" style={{ borderBottom: i < 3 ? `1px solid ${c.rule}` : "none", paddingBottom: i < 3 ? "48px" : 0 }}>
                <div className="col-span-12 md:col-span-2">
                  <div className="font-serif-ed text-[28px]" style={{ fontStyle: "italic" }}>{r.k}</div>
                </div>
                <div className="col-span-12 md:col-span-10">
                  <h3 className="font-serif-ed text-[28px] leading-[1.2] mb-4" style={{ fontWeight: 500 }}>{r.t}</h3>
                  <p className="text-[15px] leading-[1.75] max-w-[60ch] font-serif-ed" style={{ color: c.textDim }}>{r.b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Rule />

      {/* ============ FEATURED CUSTOMER QUOTE ============ */}
      <section className="max-w-[1200px] mx-auto px-8 lg:px-16 py-32">
        <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-12" style={{ color: c.textMute }}>
          A reader writes —
        </div>
        <blockquote className="font-serif-ed lead-display max-w-[20ch]"
                    style={{ fontWeight: 400, fontSize: "clamp(42px, 6.4vw, 96px)" }}>
          <span className="font-serif-ed text-[84px] leading-none align-top" style={{ color: c.ink, opacity: 0.3 }}>“</span>
          The first <em className="editorial" style={{ fontStyle: "italic" }}>quiet</em> place I've found on the internet in twelve years."
        </blockquote>
        <div className="mt-14 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center font-serif-ed text-[20px]"
               style={{ background: c.ink, color: c.bg }}>S</div>
          <div>
            <div className="text-[15px]" style={{ color: c.text }}>Sasha Brent</div>
            <div className="text-[12px]" style={{ color: c.textMute }}>Reader since Issue №&nbsp;002 — pays for 4 Letters</div>
          </div>
        </div>
      </section>

      <Rule />

      {/* ============ FINAL CTA ============ */}
      <section className="max-w-[1320px] mx-auto px-8 lg:px-16 py-40">
        <div className="grid grid-cols-12 gap-10 items-end">
          <div className="col-span-12 md:col-span-8">
            <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-8" style={{ color: c.textMute }}>The invitation</div>
            <h2 className="font-serif-ed lead-display-tight max-w-[16ch]" style={{ fontWeight: 400, fontSize: "clamp(48px, 7.2vw, 112px)" }}>
              Write the first<br/>
              <em className="editorial" style={{ fontStyle: "italic" }}>letter</em> this Sunday.
            </h2>
          </div>
          <div className="col-span-12 md:col-span-4">
            <p className="text-[15px] leading-[1.75] max-w-[36ch] font-serif-ed" style={{ color: c.textDim }}>
              No setup, no migration, no design decisions to make on a Friday afternoon. Pick a name. Pick a serif.
              Write the first letter. Send it Sunday.
            </p>
            <div className="mt-10 flex flex-col gap-4">
              <a href="#"
                 className="inline-flex items-center justify-between gap-3 px-5 py-3.5 rounded-full text-[13px] font-medium w-fit"
                 style={{ background: c.ink, color: c.bg }}>
                Start a Letter <span aria-hidden>→</span>
              </a>
              <a href="#" className="text-[13px] link-ed w-fit" style={{ color: c.textDim }}>
                Or read the colophon ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer id="colophon" style={{ borderTop: `1px solid ${c.rule}` }}>
        <div className="max-w-[1320px] mx-auto px-8 lg:px-16 py-24">
          <div className="grid grid-cols-12 gap-10 mb-16">
            <div className="col-span-12 md:col-span-6">
              <div className="font-mono-ed text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>The Editor's Note</div>
              <h3 className="font-serif-ed text-[40px] leading-[1.05] max-w-[20ch]" style={{ fontWeight: 400 }}>
                Once a month, a short letter from the editors of <em className="editorial" style={{ fontStyle: "italic" }}>Letter.</em>
              </h3>
            </div>
            <div className="col-span-12 md:col-span-6 md:pl-10 md:pt-2">
              <form className="flex items-center gap-2 border-b pb-3" style={{ borderColor: c.rule }} onSubmit={e => e.preventDefault()}>
                <input
                  type="email"
                  placeholder="your.address@example.com"
                  className="flex-1 bg-transparent outline-none text-[16px] py-2 font-serif-ed"
                  style={{ color: c.text }}
                />
                <button type="submit"
                        className="px-4 py-2 text-[12px] rounded-full font-medium"
                        style={{ background: c.ink, color: c.bg }}>
                  Subscribe →
                </button>
              </form>
              <div className="mt-4 text-[12px] font-mono-ed" style={{ color: c.textMute }}>
                Sent the first Sunday of each month. ~600 words. One topic, no list.
              </div>
            </div>
          </div>

          <Rule />

          <div className="grid grid-cols-12 gap-10 mt-16 text-[12px]" style={{ color: c.textDim }}>
            <div className="col-span-12 md:col-span-4">
              <div className="font-serif-ed text-[28px] mb-3" style={{ color: c.text }}>
                <em className="editorial" style={{ fontStyle: "italic" }}>Letter</em>
              </div>
              <p className="font-serif-ed text-[14px] leading-[1.7] max-w-[34ch]">
                Set in Source Serif and JetBrains Mono. Designed and assembled in a back office in Oakland, California.
                Issued every Monday, on purpose, by hand.
              </p>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Read</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">This week</a></li>
                <li><a href="#" className="link-ed">The Index</a></li>
                <li><a href="#" className="link-ed">Annual, '24</a></li>
                <li><a href="#" className="link-ed">RSS</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Write</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Start a Letter</a></li>
                <li><a href="#" className="link-ed">Editor</a></li>
                <li><a href="#" className="link-ed">Patronage</a></li>
                <li><a href="#" className="link-ed">Migrate</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Letter, Inc.</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Colophon</a></li>
                <li><a href="#" className="link-ed">Editors</a></li>
                <li><a href="#" className="link-ed">Mail us</a></li>
                <li><a href="#" className="link-ed">Press</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="font-mono-ed text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: c.textMute }}>Plain</div>
              <ul className="space-y-2.5">
                <li><a href="#" className="link-ed">Privacy</a></li>
                <li><a href="#" className="link-ed">Terms</a></li>
                <li><a href="#" className="link-ed">No-AI policy</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 text-[11px] font-mono-ed" style={{ color: c.textMute }}>
            <div>© Letter, Inc. — MMXXVI · Oakland</div>
            <div>Issue №&nbsp;047 · 12 May 2026</div>
            <div>“Quiet is the product.”</div>
          </div>
        </div>
      </footer>
    </div>
  );
};