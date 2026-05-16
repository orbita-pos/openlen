import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

function Thumb({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-zinc-950",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ThumbChrome() {
  return (
    <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      <span className="ml-2 h-2.5 flex-1 rounded-sm bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800" />
    </div>
  );
}

export function ThumbAcme() {
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-[#0c0c0d] text-zinc-100 p-3 mini-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-emerald-400" />
            <span className="font-semibold tracking-tight">Acme Cloud</span>
          </div>
          <div className="flex items-center gap-2 opacity-70">
            <span>Docs</span>
            <span>Pricing</span>
            <span>Login</span>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-emerald-400/90 text-[5px] mb-1">
            v2 — now with edge runtime
          </div>
          <div className="text-[10px] font-bold leading-tight tracking-tight">
            Ship serverless<br />in one command.
          </div>
          <div className="opacity-60 mt-1 text-[5px] leading-snug max-w-[80%]">
            Deploy to 280 edge regions. Zero config. Pay only for what you use.
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded bg-emerald-400 text-black px-1.5 py-[2px] text-[5px] font-semibold">
              npm i acme
            </span>
            <span className="rounded ring-1 ring-zinc-700 px-1.5 py-[2px] text-[5px]">
              Read docs
            </span>
          </div>
        </div>
        <div className="mt-3 rounded-md bg-zinc-900/80 ring-1 ring-zinc-800 p-1.5 font-mono text-[4.5px] text-emerald-300/90">
          <div>$ acme deploy</div>
          <div className="opacity-60">→ building…</div>
          <div className="opacity-80">✓ deployed in 1.4s</div>
        </div>
      </div>
    </Thumb>
  );
}

export function ThumbBloom() {
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-[#F5EFE6] text-stone-900 p-3 mini-md">
        <div className="flex items-center justify-between mb-2">
          <div className="font-serif italic text-[10px] tracking-tight">bloom.</div>
          <div className="flex gap-2 opacity-70 text-[5px]">Shop · Journal · Cart (2)</div>
        </div>
        <div className="grid grid-cols-5 gap-2 items-center mt-3">
          <div className="col-span-3">
            <div className="text-[5px] uppercase tracking-[0.2em] text-stone-500">
              No. 04 — Serum
            </div>
            <div className="text-[11px] leading-tight font-serif mt-1">
              Skin, but<br />quieter.
            </div>
            <div className="text-[5px] opacity-70 mt-1.5 leading-snug">
              Hand-pressed botanicals. Made in small batches in Oslo.
            </div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-stone-900 text-white px-2 py-[3px] text-[5px]">
              Shop $42 →
            </div>
          </div>
          <div className="col-span-2 aspect-[3/4] rounded-md bg-gradient-to-b from-stone-300 to-stone-500 relative overflow-hidden">
            <div className="absolute inset-x-2 bottom-1 h-3 rounded-sm bg-stone-100/40 backdrop-blur" />
          </div>
        </div>
      </div>
    </Thumb>
  );
}

export function ThumbDrift() {
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-white text-zinc-900 p-3 mini-md relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-md bg-coral-500" />
            <span className="font-bold tracking-tight">drift</span>
          </div>
          <div className="flex gap-2 opacity-70 text-[5px]">Product · Customers · Login</div>
        </div>
        <div className="text-center mt-2">
          <div className="inline-block rounded-full ring-1 ring-zinc-200 px-1.5 py-[2px] text-[5px] mb-1.5">
            New · Inbox Zero AI
          </div>
          <div className="text-[10px] font-bold tracking-tight leading-tight">
            Your inbox,<br />but already replied.
          </div>
          <div className="text-[5px] opacity-60 mt-1 max-w-[70%] mx-auto leading-snug">
            AI that drafts, prioritizes, and archives — so you don&apos;t have to.
          </div>
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-coral-500 text-white px-1.5 py-[3px] text-[5px] font-semibold">
            Try free →
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded ring-1 ring-zinc-200 p-1">
              <div className="h-0.5 w-3 bg-zinc-900 rounded mb-0.5" />
              <div className="h-0.5 w-4 bg-zinc-200 rounded" />
              <div className="h-0.5 w-2 bg-zinc-200 rounded mt-0.5" />
            </div>
          ))}
        </div>
      </div>
    </Thumb>
  );
}

export function ThumbLumen() {
  const bars = [3, 5, 4, 7, 6, 8, 7, 9, 8, 11, 10, 12];
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-gradient-to-b from-indigo-50 to-white dark:from-indigo-950 dark:to-zinc-950 text-zinc-900 dark:text-zinc-100 p-3 mini-md">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold tracking-tight">◆ Lumen</div>
          <div className="flex gap-2 opacity-70 text-[5px]">Features · Pricing · Sign in</div>
        </div>
        <div className="text-[10px] font-bold tracking-tight leading-tight">
          Analytics<br />without the spreadsheet.
        </div>
        <div className="text-[5px] opacity-70 mt-1 max-w-[70%] leading-snug">
          Real-time product metrics with AI summaries every morning.
        </div>
        <div className="mt-2 rounded-md bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 p-1.5">
          <div className="flex items-end justify-between gap-0.5 h-8">
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h * 6}%`,
                  background: i % 3 === 0 ? "#FF5A36" : "#a5b4fc",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Thumb>
  );
}

export function ThumbForge() {
  const colors = ["#FF5A36", "#22d3ee", "#a78bfa", "#facc15", "#fb7185", "#34d399"];
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-3 mini-md">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold">/forge</div>
          <div className="flex gap-1.5 opacity-70 text-[5px]">
            manifesto · members · sign in
          </div>
        </div>
        <div className="text-[10px] font-bold leading-tight tracking-tight">
          Build with the<br />internet&apos;s best engineers.
        </div>
        <div className="text-[5px] opacity-60 mt-1 leading-snug">
          A members-only community of 2,400 senior engineers.
        </div>
        <div className="mt-2 flex -space-x-1">
          {colors.map((c, i) => (
            <span
              key={i}
              className="h-3 w-3 rounded-full ring-2 ring-zinc-50 dark:ring-zinc-950"
              style={{ background: c }}
            />
          ))}
          <span className="ml-2 text-[5px] opacity-70 self-center">+2.3k members</span>
        </div>
        <div className="mt-2 inline-flex rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-1.5 py-[3px] text-[5px] font-semibold">
          Apply for membership
        </div>
      </div>
    </Thumb>
  );
}

export function ThumbPostcard() {
  return (
    <Thumb>
      <ThumbChrome />
      <div className="bg-white text-zinc-900 p-3 mini-md">
        <div className="flex items-center justify-between mb-2">
          <div className="font-serif text-[11px] tracking-tight">Postcard.</div>
          <div className="opacity-70 text-[5px]">Issues · About · Subscribe</div>
        </div>
        <div className="border-t border-b border-zinc-200 py-2 my-1.5">
          <div className="text-[5px] opacity-50 uppercase tracking-[0.18em]">
            Issue 47 · weekly
          </div>
          <div className="text-[10px] font-serif leading-tight mt-1">
            The slow software<br />movement is winning.
          </div>
          <div className="text-[5px] opacity-60 mt-1 leading-snug">
            A 6-minute essay on why local-first apps are eating SaaS.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1 rounded ring-1 ring-zinc-200 h-3 px-1 flex items-center text-[5px] opacity-50">
            you@email.com
          </div>
          <div className="rounded h-3 px-2 bg-coral-500 text-white text-[5px] font-semibold flex items-center">
            Subscribe
          </div>
        </div>
      </div>
    </Thumb>
  );
}
