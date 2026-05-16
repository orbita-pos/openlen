/**
 * Few-shot reference: Warm Humanist / Kettle
 * Product: Recipe management — terracotta humanist with paper texture
 * Palette: terracotta on warm cream
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

// ─── variant: kettle.jsx ───

/* Variant 03 — Kettle (recipe + smart shopping lists, terracotta) */

const KT = {
  bg: "#FAF6F0",
  bgAlt: "#F0E8D8",
  bgSoft: "#F7E3D5",
  accent: "#C66B3D",
  accentDeep: "#9B4D24",
  ink: "#1f1b16",
  inkSoft: "#4a423a",
  inkMute: "#7a6f63",
  line: "rgba(40,28,14,0.10)",
};

function KTNav() {
  return (
    <nav className="px-8 lg:px-14 pt-7 pb-2 flex items-center justify-between">
      <a className="flex items-center gap-2.5" href="#">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: KT.accent }}>
          {/* hand drawn kettle */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 12 Q 5 8, 9 8 L 16 8 Q 19 8, 19 12 L 19 17 Q 19 19, 17 19 L 7 19 Q 5 19, 5 17 Z" fill="#fff"/>
            <path d="M16 8 Q 18 5, 14 5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
            <path d="M9 11 L 15 11" stroke={KT.accentDeep} strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="font-display text-[19px] font-semibold tracking-tight" style={{ color: KT.ink }}>Kettle</span>
      </a>
      <div className="hidden md:flex items-center gap-9 text-[14.5px] text-[#4a423a]">
        <a className="hover:text-[#1f1b16]" href="#">Recipes</a>
        <a className="hover:text-[#1f1b16]" href="#">Shopping</a>
        <a className="hover:text-[#1f1b16]" href="#">Plan</a>
        <a className="hover:text-[#1f1b16]" href="#">Stories</a>
      </div>
      <div className="flex items-center gap-3">
        <a className="hidden sm:inline text-[14.5px] text-[#4a423a]" href="#">Sign in</a>
        <a href="#" className="px-4 py-2 rounded-full text-[14px] font-medium text-white warm-shadow-sm" style={{ background: KT.accent }}>
          Get the app →
        </a>
      </div>
    </nav>
  );
}

/* Kitchen icons (hand-drawn-ish svg) */
function PotIcon({ size = 22, color = KT.accentDeep }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 10 L 19 10 L 18 19 Q 18 21, 16 21 L 8 21 Q 6 21, 6 19 Z" fill={color}/>
      <rect x="3" y="10" width="3" height="1.5" rx="0.7" fill={color}/>
      <rect x="18" y="10" width="3" height="1.5" rx="0.7" fill={color}/>
      <path d="M9 7 Q 9 4, 12 4 T 15 7" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="2 3"/>
    </svg>
  );
}
function HerbIcon({ size = 22, color = KT.accentDeep }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 21 Q 12 14, 14 10 Q 16 6, 20 5 Q 19 12, 14 14" fill={color}/>
      <path d="M12 21 Q 12 16, 9 12 Q 6 9, 4 9 Q 6 14, 9 15" fill={color} opacity="0.7"/>
      <path d="M12 21 L 12 14" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
function BowlIcon({ size = 22, color = KT.accentDeep }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 11 L 21 11 Q 20 19, 12 19 Q 4 19, 3 11Z" fill={color}/>
      <ellipse cx="12" cy="11" rx="9" ry="1.6" fill={color} opacity="0.55"/>
      <path d="M8 7 Q 9 5, 11 7" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeDasharray="2 3"/>
    </svg>
  );
}

/* Hero mock — phone + extracted recipe card */
function KTPhone() {
  return (
    <div
      className="relative rounded-[36px] p-3 warm-shadow-xl"
      style={{ background: "#1f1b16", width: 260, height: 520 }}
    >
      <div className="rounded-[28px] overflow-hidden h-full relative" style={{ background: "#F7E3D5" }}>
        {/* notch */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 rounded-full" style={{ background: "#1f1b16" }}></div>

        {/* status */}
        <div className="px-5 pt-7 pb-2 flex justify-between text-[10px] font-medium text-[#1f1b16]">
          <span>9:41</span><span>•••</span>
        </div>

        {/* photo of food (illustrated) */}
        <div className="mx-3 mt-1 rounded-[18px] overflow-hidden relative" style={{ height: 200, background: "linear-gradient(135deg, #E0A85B, #C66B3D)" }}>
          {/* fake handwritten recipe card */}
          <div className="absolute inset-0 grain opacity-30"></div>
          <div className="absolute inset-3 rounded-[10px] rotate-[-3deg]" style={{ background: "#FBF7F1" }}>
            <div className="p-3 font-serif italic text-[11px] leading-[1.4] text-[#4a423a]">
              <div className="font-semibold not-italic font-display text-[13px] text-[#1f1b16] mb-1">Aunt Reet's dal</div>
              ½ c red lentils<br/>
              1 tbsp ghee<br/>
              1 onion, fine<br/>
              2 garlic, ginger<br/>
              tomato, 1 small<br/>
              cumin, turmeric<br/>
              <span className="text-[10px]">…simmer till silky</span>
            </div>
          </div>

          {/* AI scan corners */}
          {[
            "top-2 left-2 border-t-2 border-l-2",
            "top-2 right-2 border-t-2 border-r-2",
            "bottom-2 left-2 border-b-2 border-l-2",
            "bottom-2 right-2 border-b-2 border-r-2",
          ].map(c => (
            <div key={c} className={`absolute ${c} w-5 h-5 rounded-md`} style={{ borderColor: "#fff" }}></div>
          ))}
          <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, #fff, transparent)" }}></div>
        </div>

        {/* extracting state */}
        <div className="mx-3 mt-3 rounded-[12px] bg-white p-3 hairline">
          <div className="flex items-center gap-2 text-[10.5px]">
            <span className="inline-flex w-5 h-5 rounded-full items-center justify-center" style={{ background: KT.bgSoft }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke={KT.accentDeep} strokeWidth="2" strokeLinecap="round"/></svg>
            </span>
            <span className="font-medium text-[#1f1b16]">Reading the card…</span>
            <span className="ml-auto text-[#7a6f63]">98%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full" style={{ background: KT.bgSoft }}>
            <div className="h-full rounded-full" style={{ background: KT.accent, width: "98%" }}></div>
          </div>
        </div>

        {/* ingredients chips */}
        <div className="mx-3 mt-3">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-[#7a6f63]">Spotted ingredients</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["red lentils ½ c","ghee 1 tbsp","onion","garlic","ginger","tomato","cumin","turmeric"].map((c, i) => (
              <span key={c} className="px-2 py-1 rounded-full text-[10.5px] font-medium" style={{ background: i < 5 ? KT.bgSoft : "#fff", color: KT.accentDeep, boxShadow: "inset 0 0 0 1px rgba(40,28,14,0.08)" }}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* CTA bottom */}
        <div className="absolute bottom-3 left-3 right-3 rounded-[14px] p-2.5 flex items-center justify-between" style={{ background: KT.ink, color: "#fff" }}>
          <div className="text-[11.5px]">
            <div className="font-medium">Add 6 items to list</div>
            <div className="text-[10px] opacity-70">2 already in your pantry</div>
          </div>
          <span className="inline-flex w-7 h-7 rounded-full items-center justify-center" style={{ background: KT.accent }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </div>
      </div>
    </div>
  );
}

function KTShoppingCard() {
  const items = [
    { c: "Produce", g: ["1 onion","2 cloves garlic","ginger, thumb","1 small tomato","cilantro, handful"] },
    { c: "Dry & spice", g: ["red lentils, ½ c","cumin","turmeric"] },
    { c: "Already at home", g: ["ghee","kosher salt"] },
  ];
  return (
    <div className="rounded-[18px] bg-white warm-shadow-xl hairline w-[300px] absolute -left-10 -bottom-10 hidden md:block">
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: KT.line }}>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Shopping list</div>
          <div className="font-display text-[16px] font-semibold text-[#1f1b16]">Tuesday — dal night</div>
        </div>
        <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: KT.bgSoft, color: KT.accentDeep }}>6 items</span>
      </div>
      <div className="px-5 py-4 max-h-[300px] overflow-hidden">
        {items.map((cat, i) => (
          <div key={cat.c} className={i ? "mt-3" : ""}>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-[#7a6f63]">{cat.c}</div>
            <ul className="mt-1.5 space-y-1.5">
              {cat.g.map(g => (
                <li key={g} className="flex items-center gap-2 text-[13px] text-[#1f1b16]">
                  <span className="inline-flex w-4 h-4 rounded items-center justify-center" style={{ background: i === 2 ? KT.bgSoft : "transparent", border: i === 2 ? "none" : "1.4px solid rgba(40,28,14,0.18)" }}>
                    {i === 2 && <HandCheck color={KT.accent} size={11} />}
                  </span>
                  <span style={{ textDecoration: i === 2 ? "line-through" : "none", color: i === 2 ? "#7a6f63" : "#1f1b16" }}>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function KTHero() {
  return (
    <section className="px-8 lg:px-14 pt-10 pb-24 lg:pb-32 grid lg:grid-cols-[1.1fr_1fr] gap-14 items-center">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full hairline bg-white text-[12.5px] text-[#4a423a]">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: KT.accent }}></span>
          New — paste any link, photo, or screenshot
        </div>
        <h1 className="mt-6 font-display text-[62px] lg:text-[78px] leading-[1.02] font-semibold tracking-[-0.02em] text-[#1f1b16]">
          Cook from your{" "}
          <span className="relative inline-block">
            camera roll
            <Underline color={KT.accent} width={250} className="absolute -bottom-3 left-0" />
          </span>.
        </h1>
        <p className="mt-7 text-[19px] leading-[1.55] text-[#4a423a] max-w-[540px]">
          That recipe your aunt sent? That handwritten card on the fridge?
          The screenshot from Tuesday's reel? Kettle reads them all, sorts the
          ingredients, and puts dinner on the list.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white warm-shadow-sm" style={{ background: KT.accent }}>
            Get Kettle — free
          </a>
          <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium bg-white hairline text-[#1f1b16] inline-flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M9 9h6v6H9z" fill="currentColor"/></svg>
            Try with our photo
          </a>
        </div>

        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-md">
          {[
            { i: <BowlIcon size={20} />, t: "4,200 home cooks" },
            { i: <PotIcon size={20} />,  t: "180k recipes saved" },
            { i: <HerbIcon size={20} />, t: "Avg 1.4 trips/week" },
          ].map(s => (
            <div key={s.t} className="flex items-center gap-2.5 text-[13px] text-[#4a423a]">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full" style={{ background: KT.bgSoft }}>{s.i}</span>
              <span>{s.t}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center justify-center">
        {/* sun blob behind phone */}
        <div className="absolute -top-6 right-8 w-[360px] h-[360px] rounded-full" style={{ background: KT.bgSoft, opacity: 0.6 }}></div>
        <div className="absolute top-12 -right-2 hidden lg:block">
          <HerbIcon size={64} color={KT.accent} />
        </div>
        <KTPhone />
        <KTShoppingCard />
      </div>
    </section>
  );
}

function KTLogos() {
  return (
    <section className="px-8 lg:px-14 pb-16">
      <div className="rounded-[18px] py-7 px-8 hairline relative overflow-hidden" style={{ background: "#FBF7F1" }}>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          <span className="text-[12.5px] text-[#7a6f63] uppercase tracking-[0.08em] mr-2">Loved by 4,200 home cooks</span>
          {["Slow Sundays","The Family Stove","Apartment Kitchen","Salt &amp; Soak","Weekend Pantry","Fork Story"].map(n => (
            <span key={n} className="font-display text-[18px] font-semibold text-[#4a423a]/70" dangerouslySetInnerHTML={{ __html: n }} />
          ))}
        </div>
      </div>
    </section>
  );
}

function KTFeatures() {
  const items = [
    {
      title: "It reads anything",
      body: "Paste a TikTok, drop a photo of a cookbook page, forward grandma's email. Kettle finds the ingredients and the method — and asks before guessing.",
      icon: <PotIcon size={22} color="#fff" />,
      tint: KT.accent,
      bg: KT.bgSoft
    },
    {
      title: "Lists, by aisle, not chaos",
      body: "Your list sorts itself by produce, dairy, pantry — the way your store is actually shaped. Two cooks, one list, no duplicate cilantro.",
      icon: <BowlIcon size={22} color="#fff" />,
      tint: "#7CA982",
      bg: "#E8F0E5"
    },
    {
      title: "What's in the pantry, anyway",
      body: "Kettle remembers what you bought last week and gently checks: \"still got cumin?\" Less waste, fewer trips, kinder receipts.",
      icon: <HerbIcon size={22} color="#fff" />,
      tint: "#E0A85B",
      bg: "#FBF1DE"
    },
  ];
  return (
    <section className="px-8 lg:px-14 py-20">
      <div className="grid lg:grid-cols-[1fr_1.5fr] gap-10 items-end">
        <div>
          <Eyebrow color={KT.accentDeep}>What it does</Eyebrow>
          <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            A small kitchen<br/>
            <span className="font-serif italic font-normal">brain.</span>
          </h2>
        </div>
        <p className="text-[17px] text-[#4a423a] leading-[1.6] lg:pb-3">
          Kettle is the back-of-the-fridge magnet you wish existed. Save recipes the way
          you actually find them, and let the boring parts — what to buy, what's left —
          take care of themselves.
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

/* paper-texture divider between sections */
function PaperDivider({ color = KT.bgSoft }) {
  return (
    <div className="px-8 lg:px-14 py-2">
      <svg width="100%" height="14" viewBox="0 0 1200 14" preserveAspectRatio="none">
        <path d="M0 7 Q 80 2, 160 7 T 320 7 T 480 7 T 640 7 T 800 7 T 960 7 T 1120 7 T 1280 7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function KTHowItWorks() {
  const steps = [
    { n: "01", t: "Drop it in", b: "Paste a link, snap the cookbook page, screenshot the reel. Kettle works from links, images, and your own handwriting.", art: (
        <div className="rounded-[10px] p-2.5 flex items-center gap-2 hairline text-[12px]" style={{ background: "#fff" }}>
          <span className="inline-flex w-5 h-5 rounded items-center justify-center" style={{ background: KT.bgSoft }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 19h14M19 14l-7-7-7 7M12 7v12" stroke={KT.accentDeep} strokeWidth="2" strokeLinecap="round"/></svg>
          </span>
          <span className="truncate text-[#4a423a]">tiktok.com/@meeralahiri/quick-dal</span>
        </div>
      )
    },
    { n: "02", t: "Confirm what's spotted", b: "Kettle pulls out the ingredients and asks before guessing. Edit a swap, save a note for next time — your version is yours.", art: (
        <div className="flex flex-wrap gap-1.5">
          {["red lentils","ghee","onion","garlic","ginger","tomato"].map(c => (
            <span key={c} className="px-2 py-1 rounded-full text-[11.5px] font-medium" style={{ background: KT.bgSoft, color: KT.accentDeep }}>{c}</span>
          ))}
        </div>
      )
    },
    { n: "03", t: "Cook from the list", b: "Walk into the shop with one tidy list. Open the recipe at the stove, swipe between steps with floury fingers.", art: (
        <div className="rounded-[10px] p-2.5 hairline" style={{ background: "#fff" }}>
          <div className="flex items-center gap-2">
            <span className="inline-flex w-5 h-5 rounded items-center justify-center" style={{ background: KT.accent }}>
              <HandCheck color="#fff" size={11} />
            </span>
            <span className="text-[12.5px] line-through text-[#7a6f63]">Step 2 · bloom the cumin</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="inline-flex w-5 h-5 rounded items-center justify-center" style={{ border: "1.4px solid rgba(40,28,14,0.18)" }} />
            <span className="text-[12.5px] text-[#1f1b16]">Step 3 · add lentils + 2 cups water</span>
          </div>
        </div>
      )
    },
  ];

  return (
    <section className="px-8 lg:px-14 py-20" style={{ background: KT.bgSoft }}>
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-10 items-start">
        <div>
          <Eyebrow color={KT.accentDeep}>How it works</Eyebrow>
          <h2 className="mt-3 font-display text-[42px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Three small steps,<br/>then dinner.
          </h2>
          <p className="mt-5 text-[16px] text-[#4a423a] leading-[1.55] max-w-[400px]">
            We tested this on 90 home kitchens — including a few real grandmothers.
            Their handwriting was the real benchmark.
          </p>
          <div className="mt-6">
            <HerbIcon size={48} color={KT.accentDeep} />
          </div>
        </div>

        <div className="grid sm:grid-cols-1 gap-5">
          {steps.map(s => (
            <div key={s.n} className="grid grid-cols-[60px_1fr_1.1fr] gap-5 items-start p-6 rounded-[14px] bg-white hairline warm-shadow-sm">
              <div className="font-display text-[36px] leading-none font-semibold" style={{ color: KT.accent }}>{s.n}</div>
              <div>
                <h3 className="font-display text-[20px] font-semibold text-[#1f1b16]">{s.t}</h3>
                <p className="mt-1.5 text-[14.5px] text-[#4a423a] leading-[1.55]">{s.b}</p>
              </div>
              <div className="self-center">{s.art}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function KTPricing() {
  const tiers = [
    {
      name: "Home",
      price: "Free",
      sub: "for one cook",
      blurb: "Save recipes, build lists, never lose grandma's dal again.",
      cta: "Get Kettle",
      features: ["Save up to 100 recipes", "Aisle-sorted shopping lists", "Photo & link import", "iOS & Android"],
      featured: false
    },
    {
      name: "Kitchen",
      price: "$4",
      sub: "/ month, billed yearly",
      blurb: "For two cooks who share a fridge and a Sunday meal plan.",
      cta: "Try Kitchen free",
      features: ["Unlimited recipes & lists","Shared fridge & pantry","AI extraction from anywhere","Weekly meal plan view","Apple Watch shopping mode"],
      featured: true
    },
  ];

  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-end">
        <div>
          <Eyebrow color={KT.accentDeep}>Pricing</Eyebrow>
          <h2 className="mt-3 font-display text-[44px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            One tier for solo,<br/>one for sharing.
          </h2>
        </div>
        <p className="text-[16px] text-[#4a423a] leading-[1.6] max-w-md lg:pb-2">
          We don't charge per recipe, per import, or per anything else petty. Cancel any
          time — you keep your recipes either way.
        </p>
      </div>

      <div className="mt-14 grid md:grid-cols-2 gap-6">
        {tiers.map(t => (
          <div
            key={t.name}
            className="relative rounded-[16px] p-8 warm-shadow-sm hairline"
            style={{ background: t.featured ? KT.bg : "#fff", boxShadow: t.featured ? "inset 0 0 0 2px " + KT.accent : "inset 0 0 0 1px rgba(40,28,14,0.06)" }}
          >
            {t.featured && (
              <div className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[11px] font-medium text-white tracking-wide uppercase" style={{ background: KT.accent }}>
                Two cooks
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="inline-flex w-9 h-9 rounded-[10px] items-center justify-center" style={{ background: KT.bgSoft }}>
                {t.featured ? <PotIcon size={20} /> : <BowlIcon size={20} />}
              </span>
              <h3 className="font-display text-[24px] font-semibold text-[#1f1b16]">{t.name}</h3>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-[48px] font-semibold text-[#1f1b16] leading-none">{t.price}</span>
              <span className="text-[14px] text-[#7a6f63]">{t.sub}</span>
            </div>
            <p className="mt-3 text-[15px] text-[#4a423a] leading-[1.55]">{t.blurb}</p>
            <a href="#" className="mt-6 inline-flex items-center justify-center w-full px-5 py-3 rounded-full text-[14px] font-medium" style={{ background: t.featured ? KT.accent : "transparent", color: t.featured ? "#fff" : "#1f1b16", boxShadow: t.featured ? "none" : "inset 0 0 0 1px rgba(40,28,14,0.18)" }}>
              {t.cta}
            </a>
            <div className="mt-6 pt-6 border-t" style={{ borderColor: KT.line }}>
              <ul className="space-y-3">
                {t.features.map(f => (
                  <li key={f} className="flex items-start gap-3 text-[14.5px] text-[#4a423a]">
                    <span className="mt-0.5 shrink-0"><HandCheck color={KT.accent} size={16} /></span>
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

function KTTestimonials() {
  const t = [
    { q: "I have 14 years of WhatsApp recipes from my mum. Kettle ate them all in one weekend and now I cook from my phone like a normal person.", n: "Meera L.", role: "London, home cook", color: KT.accent },
    { q: "We're a two-cook house. The shared list ended a small forever-fight about cilantro. Kettle quietly fixed our marriage. Sort of.", n: "Jonas &amp; Priya", role: "Berlin, Sunday cooks", color: "#7CA982" },
    { q: "The handwriting reader is witchcraft. It read my grandfather's index cards. He passed two years ago. I cried a little, then ate dal.", n: "Karthik S.", role: "Toronto, dad of one", color: "#E0A85B" },
  ];
  return (
    <section className="px-8 lg:px-14 py-20" style={{ background: KT.bgAlt }}>
      <div className="max-w-2xl">
        <Eyebrow color={KT.accentDeep}>From the kitchen table</Eyebrow>
        <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
          Notes from people<br/>who actually cook.
        </h2>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {t.map(it => (
          <figure key={it.n} className="rounded-[14px] bg-white p-7 warm-shadow-sm hairline flex flex-col">
            <StarRow color={KT.accent} />
            <blockquote className="mt-4 text-[16px] leading-[1.55] text-[#1f1b16] flex-1">"<span dangerouslySetInnerHTML={{__html: it.q}} />"</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <Avatar name={it.n.replace("&amp;", "&")} bg={it.color} ring="#fff" />
              <div>
                <div className="text-[14px] font-medium text-[#1f1b16]" dangerouslySetInnerHTML={{__html: it.n}} />
                <div className="text-[12.5px] text-[#7a6f63]">{it.role}</div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function KTFAQSection() {
  const items = [
    { q: "Can Kettle really read a handwritten card?", a: "Yes — and weirdly well. We trained it on three years of family recipe cards (with permission). If it's not sure, it asks you instead of guessing." },
    { q: "Does it work with TikTok / Instagram / YouTube?", a: "Paste any link or screenshot. Kettle reads captions, on-screen text, and the spoken steps in short videos. It pulls out ingredients and method — you confirm before saving." },
    { q: "What about dietary needs and swaps?", a: "Tell Kettle once — gluten-free, no shellfish, your kid's egg allergy — and every recipe respects it. We'll suggest swaps with a small note about why." },
    { q: "Where is my data stored?", a: "Encrypted at rest, never sold, never trained on without your opt-in. You can export your whole library as a tidy PDF or Markdown bundle anytime." },
    { q: "Is there a tablet view for the stove?", a: "Yes. Big buttons, step-by-step timers, voice-only navigation for when your hands are covered in flour." },
    { q: "Who's behind Kettle?", a: "Three cooks and an engineer. We're based out of a kitchen in Lisbon and a small office in Mumbai. We answer emails between meal times." },
  ];
  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="grid lg:grid-cols-[0.9fr_1.4fr] gap-14">
        <div>
          <Eyebrow color={KT.accentDeep}>Questions</Eyebrow>
          <h2 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-tight text-[#1f1b16]">
            Things we get<br/>asked at dinner.
          </h2>
          <p className="mt-5 text-[15.5px] text-[#4a423a] leading-[1.6] max-w-[360px]">
            Something else? Write us at <a className="underline decoration-2 underline-offset-2" style={{ color: KT.accentDeep, textDecorationColor: KT.accent }} href="#">hello@kettle.kitchen</a>. We read everything.
          </p>
        </div>
        <FAQ items={items} accent={KT.accent} />
      </div>
    </section>
  );
}

function KTFinalCTA() {
  return (
    <section className="px-8 lg:px-14 py-24">
      <div className="relative rounded-[24px] overflow-hidden warm-shadow-xl" style={{ background: KT.accent }}>
        <div className="absolute inset-0 grain opacity-30"></div>
        {/* subtle steam shape */}
        <svg className="absolute top-0 right-0 opacity-20" width="240" height="240" viewBox="0 0 240 240" fill="none">
          <path d="M40 200 Q 80 150, 60 100 T 120 30" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round"/>
          <path d="M100 200 Q 140 150, 120 100 T 180 30" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round"/>
        </svg>
        <div className="relative px-10 lg:px-16 py-16 lg:py-20 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
          <div>
            <h2 className="font-display text-[50px] lg:text-[62px] leading-[1.02] font-semibold tracking-[-0.02em] text-white">
              That recipe your<br/>aunt sent? <span className="font-serif italic font-normal">We've got it.</span>
            </h2>
            <p className="mt-6 text-[18px] text-white/85 leading-[1.55] max-w-md">
              Bring your screenshots, your bookmarks, the dal that lives in your texts.
              Kettle puts them all in one quiet, warm place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium bg-white" style={{ color: KT.accentDeep }}>Get Kettle — free</a>
              <a href="#" className="px-6 py-3.5 rounded-full text-[15px] font-medium text-white" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)" }}>iOS · Android · Web</a>
            </div>
            <div className="mt-6 text-[13px] text-white/70">No card. Free forever for one cook.</div>
          </div>
          <div className="hidden lg:flex justify-end">
            <div className="rounded-[18px] bg-white/95 p-4 w-[260px] rotate-[3deg] warm-shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.08em] text-[#7a6f63]">Today</div>
              <div className="font-display text-[16px] font-semibold mt-0.5 text-[#1f1b16]">Aunt Reet's dal · 8/10 ⭐</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["red lentils","ghee","onion","cumin","turmeric"].map(c => (
                  <span key={c} className="px-2 py-1 rounded-full text-[10.5px] font-medium" style={{ background: KT.bgSoft, color: KT.accentDeep }}>{c}</span>
                ))}
              </div>
              <div className="mt-3 text-[11.5px] text-[#4a423a]">"Add a tiny pinch of sugar at the end — Reet."</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KTFooter() {
  return (
    <footer className="px-8 lg:px-14 py-16 border-t" style={{ borderColor: KT.line }}>
      <div className="grid lg:grid-cols-[1.2fr_1fr_1fr_1fr] gap-10">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px]" style={{ background: KT.accent }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M5 12 Q 5 8, 9 8 L 16 8 Q 19 8, 19 12 L 19 17 Q 19 19, 17 19 L 7 19 Q 5 19, 5 17 Z" fill="#fff"/>
                <path d="M16 8 Q 18 5, 14 5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="font-display text-[19px] font-semibold tracking-tight">Kettle</span>
          </div>
          <p className="mt-4 text-[14.5px] text-[#4a423a] leading-[1.55]">
            Get one thoughtful email a month — a single recipe we cooked twice, with the
            small things we'd change. No marketing, ever.
          </p>
          <div className="mt-5">
            <Newsletter accent={KT.accent} placeholder="you@your-table.com" />
          </div>
        </div>

        {[
          { h: "Product", l: ["Recipes","Shopping","Plan","Apple Watch","Tablet stove mode"] },
          { h: "Try", l: ["Import a recipe","Sample kitchen","Changelog","System status"] },
          { h: "Kettle", l: ["Our manifesto","Privacy","Terms","Careers"] },
        ].map(c => (
          <div key={c.h}>
            <div className="text-[12.5px] uppercase tracking-[0.08em] font-medium text-[#7a6f63]">{c.h}</div>
            <ul className="mt-4 space-y-2.5">
              {c.l.map(x => <li key={x}><a className="text-[14.5px] text-[#1f1b16] hover:text-[#7a6f63]" href="#">{x}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 pt-6 border-t flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#7a6f63]" style={{ borderColor: KT.line }}>
        <span>© Kettle Kitchen Ltd. — Lisbon &amp; Mumbai. Three cooks, one engineer.</span>
        <span>v1.6 — Handwriting reader</span>
      </div>
    </footer>
  );
}

function Kettle() {
  return (
    <div data-screen-label="03 Kettle" style={{ background: KT.bg, color: KT.ink }}>
      <KTNav />
      <KTHero />
      <PaperDivider color={KT.bgSoft} />
      <KTLogos />
      <KTFeatures />
      <PaperDivider color={KT.bgSoft} />
      <KTHowItWorks />
      <KTPricing />
      <KTTestimonials />
      <KTFAQSection />
      <KTFinalCTA />
      <KTFooter />
    </div>
  );
}

window.Kettle = Kettle;