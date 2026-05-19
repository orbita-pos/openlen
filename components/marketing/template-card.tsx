"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TEMPLATE_FAMILY_META, type TemplateEntry } from "@/components/templates/_registry";

interface TemplateCardProps {
  template: TemplateEntry;
  /** When true, render a larger detail-page-style preview. */
  large?: boolean;
}

export function TemplateCard({ template, large = false }: TemplateCardProps) {
  const wrapperRef = useRef<HTMLAnchorElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0);
  const nativeWidth = 1280;
  const nativeHeight = large ? 880 : 800;

  useEffect(() => {
    if (!wrapperRef.current || mounted) return;
    const el = wrapperRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const compute = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / nativeWidth);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageHeight = nativeHeight * scale;
  const family = TEMPLATE_FAMILY_META[template.family];

  return (
    <Link
      ref={wrapperRef}
      href={`/templates/${template.id}`}
      className="group relative block rounded-xl overflow-hidden ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-zinc-900 hover:ring-zinc-300 dark:hover:ring-zinc-700 hover:shadow-lg transition-all"
    >
      {/* Browser chrome strip */}
      <div className="relative z-10 flex items-center gap-1.5 h-6 px-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/60 backdrop-blur-sm">
        <span className="w-2 h-2 rounded-full bg-[#FF5F57]" aria-hidden />
        <span className="w-2 h-2 rounded-full bg-[#FEBC2E]" aria-hidden />
        <span className="w-2 h-2 rounded-full bg-[#28C840]" aria-hidden />
        <span className="ml-1 truncate text-[10px] text-zinc-500 dark:text-zinc-500 font-medium tracking-tight">
          {template.id}.openlen.com
        </span>
      </div>

      {/* Iframe stage */}
      <div
        ref={stageRef}
        className="relative bg-zinc-50 dark:bg-zinc-950"
        style={{ height: stageHeight > 0 ? stageHeight : nativeHeight * 0.25 }}
      >
        <div
          aria-hidden
          className={`absolute inset-0 ${loaded ? "opacity-0" : "opacity-100"} transition-opacity duration-500 ease-out`}
          style={{
            background:
              "linear-gradient(110deg, rgba(0,0,0,0.04) 8%, rgba(0,0,0,0.08) 18%, rgba(0,0,0,0.04) 33%)",
            backgroundSize: "200% 100%",
            animation: loaded ? "none" : "marketingTplShimmer 1.6s ease-in-out infinite",
          }}
        />
        {mounted && scale > 0 && (
          <iframe
            src={`/templates/curated/${template.fileName}`}
            title={`${template.name} live preview`}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            style={{
              width: nativeWidth,
              height: nativeHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
              pointerEvents: "none",
              opacity: loaded ? 1 : 0,
              transition: "opacity 380ms cubic-bezier(.2,.7,.2,1)",
              willChange: "transform",
            }}
          />
        )}
      </div>

      {/* Card metadata footer */}
      <div className="p-4 sm:p-5 border-t border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 shrink-0 inline-block w-2 h-2 rounded-full"
            style={{ background: template.accent }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {template.name}
              </h3>
              <span className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-medium">
                {family.label}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
              {template.pitch}
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes marketingTplShimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </Link>
  );
}
