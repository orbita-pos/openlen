/**
 * Few-shot reference: Warm Humanist / Cohort
 * Product: Community-driven courses — sage green humanist
 * Palette: sage green on warm off-white
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

// ─── variant: cohort.jsx ───

/* Variant 02 — Cohort (community for cohort-based courses, sage green) */

const CH = {
  bg: "#F5F1EA",
  bgAlt: "#EDE7DA",
  bgSoft: "#E8F0E5",
  accent: "#7CA982",
  accentDeep: "#4F8259",
  ink: "#1f1b16",
  inkSoft: "#4a423a",
  inkMute: "#7a6f63",
  line: "rgba(40,28,14,0.10)",
};

function CHNav() {
  return (
    <nav className="px-8 lg:px-14 pt-7 pb-2 flex items-center justify-between">
      <a className="flex items-center gap-2.5" href="#">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: CH.accent }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="10" r="3" fill="#fff"/>
            <circle cx="16" cy="14" r="3" fill="#fff" opacity="0.75"/>
            <path d="M6 18c1-1 3-1.5 4-1.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
          </svg>
        </span>
        <span className="font-display text-[19px] font-semibold tracking-tight" style={{ color: CH.ink }}>Cohort</span>
      </a>
      <div className="hidden md:flex items-center gap-9 text-[14.5px] text-[#4a423a]">
        <a className="hover:text-[#1f1b16]" href="#">For teachers</a>
        <a className="hover:text-[#1f1b16]" href="#">For learners</a>
        <a className="hover:text-[#1f1b16]" href="#">Pricing</a>
        <a className="hover:text-[#1f1b16]" href="#">Stories</a>
      </div>
      <div className="flex items-center gap-3">
        <a className="hidden sm:inline text-[14.5px] text-[#4a423a]" href="#">Sign in</a>
        <a href="#" className="px-4 py-2 rounded-full text-[14px] font-medium text-white warm-shadow-sm" style={{ background: CH.accentDeep }}>
          Open a cohort →
        </a>
      </div>
    </nav>
  );
}

/* Mock cohort feed for the hero */
function ChatBubble({ name, color, role, when, body, reactions, replyCount }) {
  return (
    <div className="flex gap-3">
      <Avatar name={name} bg={color} ring="#fff" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-medium text-[#1f1b16]">{name}</span>
          {role && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: CH.bgSoft, color: CH.accentDeep }}>{role}</span>}
          <span className="text-[11.5px] text-[#7a6f63]">{when}</span>
        </div>
        <p className="mt-1 text-[14px] leading-[1.5] text-[#1f1b16]">{body}</p>
        {(reactions || replyCount != null) && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {reactions?.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px]" style={{ background: "#fff", boxShadow: "inset 0 0 0 1px rgba(40,28,14,0.10)" }}>
                <span>{r.e}</span><span className="text-[#4a423a]">{r.n}</span>
              </span>
            ))}
            {replyCount != null && (
              <span className="text-[11.5px] text-[#7a6f63]">↳ {replyCount} replies, last 4m ago</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CHHeroMock() {
  return (
    <div className="relative">
      <div className="rounded-[20px] bg-white warm-shadow-xl overflow-hidden">
        {/* sidebar + main */}
        <div className="grid grid-cols-[180px_1fr]">
          {/* sidebar */}
          <aside className="border-r" style={{ background: "#FBF7F1", borderColor: CH.line }}>
            <div className="px-4 py-4 border-b" style={{ borderColor: CH.line }}>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Cohort</div>
              <div className="text-[14px] font-semibold text-[#1f1b16] mt-1 font-display">Write to Think · Spring</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: CH.bgSoft, color: CH.accentDeep }}>Week 3 of 6</span>
              </div>
            </div>
            <nav className="px-2 py-3 text-[13px]">
              {[
                ["📒", "Live sessions", false],
                ["💬", "All threads", true],
                ["✏️", "Workshops", false],
                ["📅", "Schedule", false],
                ["📚", "Library", false],
              ].map(([e, label, active]) => (
                <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: active ? "#fff" : "transparent", color: active ? "#1f1b16" : "#4a423a", boxShadow: active ? "inset 0 0 0 1px rgba(40,28,14,0.08)" : "none" }}>
                  <span className="opacity-70">{e}</span>
                  <span className={active ? "font-medium" : ""}>{label}</span>
                </div>
              ))}
            </nav>
            <div className="mt-2 px-4">
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Classmates</div>
              <div className="mt-2 flex -space-x-1.5">
                <Avatar name="Yara N" bg="#7CA982" ring="#FBF7F1" />
                <Avatar name="Marc D" bg="#D97A8A" ring="#FBF7F1" />
                <Avatar name="Lena K" bg="#E0A85B" ring="#FBF7F1" />
                <Avatar name="Sam T"  bg="#9C7CC9" ring="#FBF7F1" />
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[10px] font-medium" style={{ background: "#fff", color: "#4a423a", boxShadow: "0 0 0 2px #FBF7F1, inset 0 0 0 1px rgba(40,28,14,0.10)" }}>+18</span>
              </div>
            </div>
          </aside>

          {/* main feed */}
          <div>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: CH.line }}>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Thread</div>
                <div className="font-display text-[16px] font-semibold text-[#1f1b16] mt-0.5">Tuesday workshop · "the shitty first draft"</div>
              </div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-[#4a423a]">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CH.accent }}></span>
                <span>5 live now</span>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">
              <ChatBubble
                name="Yara Naidu"
                role="teacher"
                color="#7CA982"
                when="9:02 AM"
                body="Drop your week-3 opener in this thread by Thursday — three sentences, no edits. I'll read every one and react in voice notes."
                reactions={[{ e: "🌿", n: 12 }, { e: "👀", n: 4 }]}
              />
              <ChatBubble
                name="Marc Donato"
                color="#D97A8A"
                when="9:18 AM"
                body={`Mine: "It started with a microwave, which is to say, with avoidance." — I've been afraid of this draft for two weeks.`}
                reactions={[{ e: "❤️", n: 9 }, { e: "🔥", n: 3 }]}
                replyCount={6}
              />
              <ChatBubble
                name="Lena Kovač"
                color="#E0A85B"
                when="9:34 AM"
                body="Marc — the microwave sentence is so good. I want to steal the rhythm. Mine is messier:"
                reactions={[{ e: "💛", n: 5 }]}
              />
            </div>

            {/* composer */}
            <div className="mx-5 mb-5 mt-1 rounded-[12px] hairline p-3 flex items-center gap-3" style={{ background: "#FBF7F1" }}>
              <Avatar name="You" bg="#9C7CC9" ring="#FBF7F1" />
              <input className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-[#9b8f80]" placeholder="Reply in thread… markdown welcome." />
              <button className="px-3 py-1.5 rounded-md text-[12.5px] font-medium text-white" style={{ background: CH.accentDeep }}>Send</button>
            </div>
          </div>
        </div>
      </div>

      {/* floating live-session badge */}
      <div className="absolute -right-5 -top-5 px-4 py-3 rounded-2xl bg-white warm-shadow-sm hidden md:flex items-center gap-3">
        <div className="w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ background: CH.bgSoft }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={CH.accentDeep} strokeWidth="2"/><circle cx="12" cy="12" r="3.5" fill={CH.accent}/></svg>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-[#1f1b16]">Live session</div>
          <div className="text-[11.5px] text-[#7a6f63]">Thu, 7pm CET</div>
        </div>
      </div>

      {/* speech bubble doodle */}
      <svg className="absolute -left-8 -bottom-6 hidden md:block" width="120" height="90" viewBox="0 0 120 90" fill="none">
        <path d="M8 50 Q 8 16, 60 16 T 112 50 Q 112 70, 80 72 L 60 84 L 60 72 Q 8 70, 8 50z" fill={CH.bgSoft} stroke={CH.accentDeep} strokeWidth="1.5" strokeDasharray="3 5" opacity="0.8"/>
        <circle cx="44" cy="44" r="3" fill={CH.accentDeep}/><circle cx="60" cy="44" r="3" fill={CH.accentDeep}/><circle cx="76" cy="44" r="3" fill={CH.accentDeep}/>
      </svg>
    </div>
  );
}

function CHHero() {
  return (
    <section className="px-8 lg:px-14 pt-10 pb-20 lg:pb-28 grid lg:grid-cols-[1fr_1.1fr] gap-14 items-center">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full hairline bg-white text-[12.5px] text-[#4a423a]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: CH.accent }}></span>
          Spring 2026 — 38 cohorts running
        </div>
        <h1 className="mt-6 font-display text-[60px] lg:text-[74px] leading-[1.02] font-semibold tracking-[-0.02em] text-[#1f1b16]">
          Learning happens<br/>
          in{" "}
          <span className="relative inline-block">
            conversations
            <Underline color={CH.accent} width={260} className="absolute -bottom-3 left-0" />
          </span>.
        </h1>
        <p className="mt-7 text-[19px] leading-[1.55] text-[#4a423a] max-w-[540px]">
          Cohort is the cozy back-room of cohort-based courses. Real teachers.
          Real classmates. Real schedules — and one warm thread for every workshop.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white warm-shadow-sm" style={{ background: CH.accentDeep }}>
            Open your cohort
          </a>
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium bg-white hairline text-[#1f1b16] inline-flex items-center gap-2">
            See a sample classroom
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </a>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
          {[
            { n: "38", l: "cohorts running" },
            { n: "1,240", l: "classmates this term" },
            { n: "4.9", l: "avg cohort rating" },
          ].map(s => (
            <div key={s.l}>
              <div className="font-display text-[28px] font-semibold text-[#1f1b16] leading-none">{s.n}</div>
              <div className="text-[12.5px] text-[#7a6f63] mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <CHHeroMock />
    </section>
  );
}

function CHLogos() {
  return (
    <section className="px-8 lg:px-14 pb-16">
      <div className="text-center text-[13px] text-[#7a6f63] tracking-wide">
        Loved by 1,240 cohort leaders this term — from poets to product folks.
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-70">
        {["Write to Think","South Park Type","Quiet Founders","Cabin Studio","Morning Pages Pro","Bake Club"].map(n => (
          <span key={n} className="font-display text-[20px] font-semibold text-[#4a423a]">{n}</span>
        ))}
      </div>
    </section>
  );
}

function CHFeatures() {
  const items = [
    {
      title: "One warm thread per workshop",
      body: "Not Slack. Not Discord. A single thread per session, with the teacher's voice notes pinned to the top. Everyone's reading the same room.",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="14" height="10" rx="3" fill={CH.accent}/>
          <rect x="8" y="11" width="14" height="9" rx="3" fill="#1f1b16" opacity="0.85"/>
        </svg>
      ),
      tint: CH.bgSoft
    },
    {
      title: "Honest classmate signals",
      body: "Reactions, not analytics. A 🌿 means \"this helped me,\" not \"this got engagement.\" No vanity counters, ever.",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 21s-7-4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 6-7 10-7 10z" fill="#D97A8A"/>
        </svg>
      ),
      tint: "#FBE9EC"
    },
    {
      title: "Schedules that breathe",
      body: "Sessions live alongside reading, drafts, and rest days. Cohort works with the timezones your classmates actually live in.",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="16" rx="3" fill="#E0A85B"/>
          <rect x="3" y="5" width="18" height="4" rx="2" fill="#1f1b16" opacity="0.85"/>
          <circle cx="8" cy="14" r="1.5" fill="#fff"/><circle cx="13" cy="14" r="1.5" fill="#fff"/><circle cx="18" cy="14" r="1.5" fill="#fff"/>
        </svg>
      ),
      tint: "#FBF1DE"
    },
  ];
  return (
    <section className="px-8 lg:px-14 py-20">
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-10 items-end">
        <div>
          <Eyebrow color={CH.accentDeep}>What's inside</Eyebrow>
          <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Built for the<br/>
            <span className="font-serif italic font-normal">good kind of small.</span>
          </h2>
        </div>
        <p className="text-[17px] text-[#4a423a] leading-[1.6] lg:pb-4">
          A cohort is 8–80 people sharing a few weeks of attention. Cohort gives that group the
          handful of things they actually need — and nothing else from the Big Group Chat
          handbook.
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

function CHHowItWorks() {
  const steps = [
    { n: "01", t: "Open a room", b: "You set the dates, the rhythm, and the size. Cohort sets up threads, schedules, and a clean roster — about four minutes start to finish." },
    { n: "02", t: "Invite eight to eighty", b: "Send one link. Classmates choose a name, pick an avatar color, and land in your first thread already saying hello." },
    { n: "03", t: "Teach inside the conversation", b: "Voice notes, prompts, weekly recaps. Cohort archives the room as a quiet site classmates can revisit for a year." },
  ];
  return (
    <section className="px-8 lg:px-14 py-20" style={{ background: CH.bgSoft }}>
      <div className="max-w-2xl">
        <Eyebrow color={CH.accentDeep}>How a cohort runs</Eyebrow>
        <h2 className="mt-3 font-display text-[42px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          A teacher, a room,<br/>a few short weeks.
        </h2>
      </div>

      <div className="mt-14 grid lg:grid-cols-3 gap-5">
        {steps.map((s, i) => (
          <div key={s.n} className="relative rounded-[14px] bg-white p-7 warm-shadow-sm hairline">
            <div className="flex items-center gap-3">
              <span className="font-display text-[14px] font-medium px-2.5 py-1 rounded-full" style={{ background: CH.bgSoft, color: CH.accentDeep }}>STEP {s.n}</span>
            </div>
            <h3 className="mt-5 font-display text-[24px] font-semibold text-[#1f1b16]">{s.t}</h3>
            <p className="mt-2 text-[15.5px] text-[#4a423a] leading-[1.55]">{s.b}</p>

            {/* tiny illustrative chip */}
            <div className="mt-6 rounded-[10px] p-3 hairline" style={{ background: "#FBF7F1" }}>
              {i === 0 && (
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-[#4a423a]">Sat · 10:00 AM CET</span>
                  <span className="px-2 py-0.5 rounded-full" style={{ background: CH.bgSoft, color: CH.accentDeep }}>6 weeks</span>
                </div>
              )}
              {i === 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] flex-1 text-[#7a6f63] truncate">cohort.so/r/write-to-think</span>
                  <button className="text-[12px] px-2 py-1 rounded-md hairline bg-white">Copy</button>
                </div>
              )}
              {i === 2 && (
                <div className="flex items-center gap-2 text-[12px] text-[#4a423a]">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: CH.accent }}></span>
                  <span>Voice note · 2:14 · "the shitty first draft"</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CHPricing() {
  const tiers = [
    {
      name: "Classmate",
      price: "Free",
      sub: "for everyone joining a cohort",
      blurb: "If your teacher invites you, you're in. No catches, no quotas.",
      cta: "Sign up free",
      features: ["Unlimited cohorts you join", "1-year archive access","Voice notes & reactions","Mobile + web"],
      featured: false
    },
    {
      name: "Teacher",
      price: "$22",
      sub: "/ month, per teacher",
      blurb: "One price. Your size of room, your rules.",
      cta: "Open a cohort",
      features: ["Up to 200 classmates per cohort","Voice notes & live sessions","Schedules across timezones","Stripe-powered checkout","Cohort archive (yours forever)"],
      featured: true
    },
    {
      name: "Studio",
      price: "Talk to us",
      sub: "for schools & teams of teachers",
      blurb: "Multiple teachers, shared roster, custom domain.",
      cta: "Say hello",
      features: ["Unlimited teachers","Shared roster & roles","Custom domain + branding","SSO and SCIM","Friendly humans on email"],
      featured: false
    },
  ];

  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="text-center max-w-xl mx-auto">
        <Eyebrow color={CH.accentDeep}>Pricing</Eyebrow>
        <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          One price, real humans,<br/>no per-seat math.
        </h2>
      </div>

      <div className="mt-14 grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {tiers.map(t => (
          <div
            key={t.name}
            className="relative rounded-[16px] p-7 warm-shadow-sm hairline"
            style={{ background: t.featured ? "#1f1b16" : "#fff", color: t.featured ? "#fff" : CH.ink }}
          >
            {t.featured && (
              <div className="absolute -top-3 left-7 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide uppercase" style={{ background: CH.accent, color: "#0f1a12" }}>
                For teachers
              </div>
            )}
            <h3 className="font-display text-[22px] font-semibold">{t.name}</h3>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-[42px] font-semibold leading-none">{t.price}</span>
              <span className="text-[13px] opacity-70">{t.sub}</span>
            </div>
            <p className="mt-3 text-[14.5px] leading-[1.55]" style={{ color: t.featured ? "rgba(255,255,255,0.78)" : CH.inkSoft }}>{t.blurb}</p>
            <a href="#" className="mt-5 inline-flex items-center justify-center w-full px-5 py-3 rounded-full text-[14px] font-medium"
              style={{
                background: t.featured ? CH.accent : "transparent",
                color: t.featured ? "#0f1a12" : CH.ink,
                boxShadow: t.featured ? "none" : "inset 0 0 0 1px rgba(40,28,14,0.18)"
              }}
            >
              {t.cta}
            </a>
            <ul className="mt-6 space-y-2.5">
              {t.features.map(f => (
                <li key={f} className="flex items-start gap-3 text-[14px]" style={{ color: t.featured ? "rgba(255,255,255,0.85)" : CH.inkSoft }}>
                  <span className="mt-0.5 shrink-0">
                    <HandCheck color={t.featured ? CH.accent : CH.accentDeep} size={15} />
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function CHTestimonials() {
  const t = [
    {
      q: "I taught the same essay course twice. On Discord it was hide-and-seek; on Cohort it was a kitchen table. The drafts got braver, and so did I.",
      n: "Yara Naidu", role: "writing teacher · Berlin", color: "#7CA982"
    },
    {
      q: "We're a tiny culinary school in Lyon. Cohort lets each of our three teachers run their own room and still feel like the same little school.",
      n: "Pascal Reine", role: "founder, Petite École", color: "#E0A85B"
    },
    {
      q: "I was the shy classmate. Cohort somehow made me the helpful one — voice notes are easier than typing, and the thread waits for you.",
      n: "Sam Tagore", role: "classmate, Spring '26", color: "#D97A8A"
    },
  ];
  return (
    <section className="px-8 lg:px-14 py-20">
      <div className="rounded-[20px] p-10 lg:p-14 warm-shadow-sm hairline" style={{ background: CH.bgAlt }}>
        <div className="max-w-2xl">
          <Eyebrow color={CH.accentDeep}>From the rooms</Eyebrow>
          <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Notes from teachers<br/>and classmates.
          </h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {t.map(it => (
            <figure key={it.n} className="rounded-[14px] bg-white p-7 hairline warm-shadow-sm flex flex-col">
              <svg width="22" height="22" viewBox="0 0 24 24" fill={CH.accent}><path d="M9 7H5a3 3 0 0 0-3 3v5h7V7zm13 0h-4a3 3 0 0 0-3 3v5h7V7z"/></svg>
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
      </div>
    </section>
  );
}

function CHFAQSection() {
  const items = [
    { q: "Is Cohort the same as a Discord server?", a: "No — and that's the point. There's no general channel, no random-banter sub-server. Each session is its own thread, with the teacher pinned to the top. Smaller surface area, better conversations." },
    { q: "Can I bring my own video tool?", a: "Yes. Cohort sits next to your favorite — Zoom, Google Meet, Whereby — and remembers the link for every recurring session." },
    { q: "Will my classmates need accounts?", a: "Just a name and a color circle. No verification email, no LinkedIn-style profile. The roster is private to the room." },
    { q: "Do you take a cut of my course revenue?", a: "Never. Charge however you want — Stripe, Lemon Squeezy, a bank transfer to your aunt. Cohort just hosts the room." },
    { q: "What happens when the cohort ends?", a: "The room becomes a quiet, read-only site you and your classmates can revisit for a year. Voice notes and threads stay where you left them." },
    { q: "Where are you based?", a: "Berlin and Lyon. Two teachers and three engineers. We answer email ourselves." },
  ];
  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="grid lg:grid-cols-[0.9fr_1.4fr] gap-14">
        <div>
          <Eyebrow color={CH.accentDeep}>Questions, mostly</Eyebrow>
          <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            We get these<br/>most often.
          </h2>
        </div>
        <FAQ items={items} accent={CH.accentDeep} />
      </div>
    </section>
  );
}

function CHFinalCTA() {
  return (
    <section className="px-8 lg:px-14 py-20">
      <div className="relative rounded-[24px] overflow-hidden warm-shadow-xl p-10 lg:p-16 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center" style={{ background: "#1f1b16" }}>
        {/* sage corner blobs */}
        <div className="absolute -top-16 -right-10 w-72 h-72 rounded-full" style={{ background: CH.accent, opacity: 0.25 }}></div>
        <div className="absolute -bottom-24 -left-10 w-72 h-72 rounded-full" style={{ background: CH.bgSoft, opacity: 0.12 }}></div>

        <div className="relative">
          <Eyebrow color={CH.accent}>Open a room</Eyebrow>
          <h2 className="mt-3 font-display text-[50px] lg:text-[60px] leading-[1.02] font-semibold tracking-[-0.02em] text-white">
            Teach the way<br/>
            <span className="font-serif italic font-normal" style={{ color: CH.accent }}>you wish you'd been taught.</span>
          </h2>
          <p className="mt-6 text-[18px] leading-[1.55] text-white/75 max-w-md">
            Open a cohort in four minutes. The first one's free — yes, the whole cohort.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium" style={{ background: CH.accent, color: "#0f1a12" }}>Open your first cohort</a>
            <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)" }}>See a sample room</a>
          </div>
        </div>

        {/* mini doodle - the room */}
        <div className="relative hidden lg:flex justify-end">
          <div className="rounded-[16px] bg-white/95 p-5 w-[280px] warm-shadow-sm">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Sat · 10:00</div>
            <div className="font-display text-[16px] font-semibold mt-1 text-[#1f1b16]">Your room is ready</div>
            <div className="mt-3 flex -space-x-2">
              <Avatar name="Yara N" bg="#7CA982" />
              <Avatar name="Marc D" bg="#D97A8A" />
              <Avatar name="Lena K" bg="#E0A85B" />
              <Avatar name="Sam T"  bg="#9C7CC9" />
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[10px] font-medium bg-white" style={{ boxShadow: "0 0 0 2px #fff, inset 0 0 0 1px rgba(40,28,14,0.10)" }}>+12</span>
            </div>
            <div className="mt-4 text-[12.5px] text-[#4a423a]">cohort.so/r/your-first-room</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CHFooter() {
  return (
    <footer className="px-8 lg:px-14 py-16 border-t" style={{ borderColor: CH.line }}>
      <div className="grid lg:grid-cols-[1.2fr_1fr_1fr_1fr] gap-10">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: CH.accent }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="10" r="3" fill="#fff"/><circle cx="16" cy="14" r="3" fill="#fff" opacity="0.75"/>
              </svg>
            </span>
            <span className="font-display text-[19px] font-semibold tracking-tight">Cohort</span>
          </div>
          <p className="mt-4 text-[14.5px] text-[#4a423a] leading-[1.55]">
            Get one thoughtful email a month — a postcard from a teacher we admire.
            That's it. No webinars.
          </p>
          <div className="mt-5">
            <Newsletter accent={CH.accentDeep} placeholder="you@your-cohort.org" />
          </div>
        </div>

        {[
          { h: "Product", l: ["Live sessions","Threads","Schedules","Mobile app","Changelog"] },
          { h: "For teachers", l: ["Open a cohort","Pricing","Templates","Stories"] },
          { h: "Cohort", l: ["About","Manifesto","Privacy","Status"] },
        ].map(c => (
          <div key={c.h}>
            <div className="text-[12.5px] uppercase tracking-[0.08em] font-medium text-[#7a6f63]">{c.h}</div>
            <ul className="mt-4 space-y-2.5">
              {c.l.map(x => <li key={x}><a className="text-[14.5px] text-[#1f1b16] hover:text-[#7a6f63]" href="#">{x}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 pt-6 border-t flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#7a6f63]" style={{ borderColor: CH.line }}>
        <span>© Cohort GmbH, Berlin & Lyon. Two teachers, three engineers.</span>
        <span>Spring term — 2026</span>
      </div>
    </footer>
  );
}

function Cohort() {
  return (
    <div data-screen-label="02 Cohort" style={{ background: CH.bg, color: CH.ink }}>
      <CHNav />
      <CHHero />
      <CHLogos />
      <CHFeatures />
      <CHHowItWorks />
      <CHPricing />
      <CHTestimonials />
      <CHFAQSection />
      <CHFinalCTA />
      <CHFooter />
    </div>
  );
}

window.Cohort = Cohort;