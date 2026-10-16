"use client";

// THE APP-BIRTH WORKSHOP — what the canvas shows while an app is born, instead
// of the skeleton's blank «App» page (Jesús, 16/10). An architectural section
// of Len's workshop drawn in the workspace's own ink and paper: five stations
// under five lamps, and Len at the one he is working at. What lights a station
// is Len's real tool call (`lib/workspace-v2/app-birth.ts`), and the board
// ticks his real step list. No clicks: the detail of every step is already in
// the chat, and keeping two of them would be one too many.
//
// With reduced motion everything stands still; only the lit lamp, Len's place
// and the sentence change.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Chivo_Mono, Schibsted_Grotesk } from "next/font/google";

import { nextTodo } from "@/lib/agent/todo-list";
import {
  WORKSHOP_STATIONS,
  boardWindow,
  progressOf,
  type WorkshopStation,
  type WorkshopView,
} from "@/lib/workspace-v2/app-birth";

const headFont = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "700"],
  display: "swap",
  preload: false,
  variable: "--ab-head",
});
const noteFont = Chivo_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
  variable: "--ab-note",
});

type Point = readonly [number, number];

// The drawing is 1600 × 860. Each station: its lamp's x, where Len stands,
// where his eyes look, and the light cone under the lamp.
const PLACES: Readonly<Record<WorkshopStation, { lamp: number; len: Point; look: Point; cone: string }>> = {
  board: { lamp: 300, len: [300, 584], look: [0, -6], cone: "262,215 338,215 500,740 100,740" },
  files: { lamp: 545, len: [664, 446], look: [-6, 4], cone: "507,215 583,215 720,740 370,740" },
  desk: { lamp: 830, len: [830, 668], look: [0, -6], cone: "792,215 868,215 1040,740 620,740" },
  terminal: { lamp: 1100, len: [1100, 396], look: [0, 6], cone: "1062,215 1138,215 1290,740 910,740" },
  bench: { lamp: 1350, len: [1250, 470], look: [6, 1], cone: "1312,215 1388,215 1520,740 1180,740" },
};
const FINISHED_AT: Point = [800, 340];
const FLOOR_Y = 737;
const CODE_BARS = [92, 58, 112, 70, 98, 46];
/** What fits on the terminal's screen, prompt included. */
const TERMINAL_CHARS = 15;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

/** Len and his shadow, which shrinks the higher he is off the floor. */
function placeLen(len: SVGGElement | null, shadow: SVGEllipseElement | null, x: number, y: number) {
  len?.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  if (!shadow) return;
  const s = Math.max(0.35, 1 - Math.max(0, FLOOR_Y - y) / 520);
  shadow.setAttribute("cx", x.toFixed(1));
  shadow.setAttribute("rx", (48 * s).toFixed(1));
  shadow.setAttribute("ry", (8 * s).toFixed(1));
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface AppBirthWorkshopProps {
  readonly view: WorkshopView;
  /** The turn ended well: every lamp on and «Your app is ready». */
  readonly finished: boolean;
  readonly appName: string;
  /** When the turn started (`Date.now()`), for the clock. */
  readonly startedAt: number;
}

export function AppBirthWorkshop({ view, finished, appName, startedAt }: AppBirthWorkshopProps) {
  const t = useTranslations("wsChrome.appBirth");
  const reduce = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `ab-${uid}-${name}`;

  const station = view.station;
  const target: Point = finished ? FINISHED_AT : PLACES[station].len;

  // ── Len: a hop between stations and a slow bob, drawn straight onto the
  // nodes from a frame loop (no React render per frame).
  const lenRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const motion = useRef<{ pos: Point; tween: { from: Point; to: Point; t0: number; ms: number } | null }>({
    pos: target,
    tween: null,
  });
  const place = (x: number, y: number) => placeLen(lenRef.current, shadowRef.current, x, y);
  const [tx, ty] = target;
  useEffect(() => {
    const m = motion.current;
    if (reduce) {
      m.pos = [tx, ty];
      m.tween = null;
      place(tx, ty);
      return;
    }
    if (m.pos[0] === tx && m.pos[1] === ty && !m.tween) return;
    m.tween = { from: m.pos, to: [tx, ty], t0: performance.now(), ms: 1150 };
  }, [tx, ty, reduce]);
  useEffect(() => {
    if (reduce) {
      place(motion.current.pos[0], motion.current.pos[1]);
      return;
    }
    let raf = 0;
    const frame = (now: number) => {
      const m = motion.current;
      if (m.tween) {
        const { from, to, t0, ms } = m.tween;
        const k = Math.min(1, (now - t0) / ms);
        const e = ease(k);
        const lift = Math.min(from[1], to[1]) - 140;
        m.pos = [from[0] + (to[0] - from[0]) * e, (1 - e) * (1 - e) * from[1] + 2 * (1 - e) * e * lift + e * e * to[1]];
        if (k >= 1) m.tween = null;
      }
      place(m.pos[0], m.pos[1] + (m.tween ? 0 : Math.sin(now / 420) * 4));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // ── His eyes: they turn to the work once he lands, and blink now and then.
  const [look, setLook] = useState<Point>(finished ? [0, 0] : PLACES[station].look);
  const [blink, setBlink] = useState(false);
  const [lx, ly] = finished ? [0, 0] : PLACES[station].look;
  useEffect(() => {
    if (reduce) {
      setLook([lx, ly]);
      return;
    }
    const id = window.setTimeout(() => setLook([lx, ly]), 900);
    return () => window.clearTimeout(id);
  }, [lx, ly, reduce]);
  useEffect(() => {
    if (reduce) return;
    let open = 0;
    const id = window.setInterval(() => {
      setBlink(true);
      open = window.setTimeout(() => setBlink(false), 130);
    }, 3700);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(open);
    };
  }, [reduce]);
  const eyeStyle = { transform: `translate(${look[0]}px, ${look[1]}px)${blink ? " scaleY(0.12)" : ""}` };

  // ── What each station does while Len works at it.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fileOut, setFileOut] = useState(false);
  const [bars, setBars] = useState(0);
  const [typed, setTyped] = useState("");
  const [tap, setTap] = useState<{ x: number; y: number; k: number } | null>(null);
  const live = finished ? null : station;
  const command = live === "terminal" ? terminalLine(view.note) : "";
  useEffect(() => {
    setDrawerOpen(false);
    setFileOut(false);
    setBars(0);
    setTyped("");
    setTap(null);
    const timers: number[] = [];
    const intervals: number[] = [];
    if (live === "files") {
      timers.push(window.setTimeout(() => setDrawerOpen(true), reduce ? 0 : 700));
      timers.push(window.setTimeout(() => setFileOut(true), reduce ? 0 : 1300));
    } else if (live === "desk") {
      if (reduce) setBars(4);
      else intervals.push(window.setInterval(() => setBars((n) => (n >= CODE_BARS.length ? 1 : n + 1)), 480));
    } else if (live === "terminal") {
      if (reduce) setTyped(command);
      else {
        let n = 0;
        intervals.push(
          window.setInterval(() => {
            n = Math.min(command.length, n + 1);
            setTyped(command.slice(0, n));
          }, 70),
        );
      }
    } else if (live === "bench" && !reduce) {
      let k = 0;
      intervals.push(
        window.setInterval(() => {
          k += 1;
          setTap({ x: 1334 + Math.round(Math.random() * 32), y: 470 + Math.round(Math.random() * 80), k });
        }, 1100),
      );
    }
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      intervals.forEach((id) => window.clearInterval(id));
    };
  }, [live, command, reduce]);

  // ── The clock, stopped once the app is ready.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [finished]);

  // ── The words.
  const step = finished ? null : view.todos ? nextTodo(view.todos) : null;
  const stationSentence = t(`station.${station}`);
  const who = finished ? t("doneWho") : step ? stationSentence : t("working");
  const headline = finished ? t("done") : (step?.content ?? stationSentence);
  const note = finished ? null : view.note;
  const progress = progressOf(view.todos);
  const progressText = finished
    ? t("block.finished")
    : progress
      ? t("block.step", { current: progress.current, total: progress.total })
      : t("block.noSteps");
  const rows = boardWindow(view.todos);
  const lit = (s: WorkshopStation) => finished || s === station;

  return (
    <div className={`ab-root ${headFont.variable} ${noteFont.variable}`} data-testid="app-birth-workshop">
      <div className="ab-sheet">
        <header className="ab-head">
          <p className="ab-who">{who}</p>
          <h2 className="ab-now" aria-live="polite">
            {headline}
          </h2>
          <p className="ab-note">{note ?? " "}</p>
        </header>

        <figure className="ab-figure">
          <svg viewBox="0 0 1600 860" role="img" aria-label={t("drawing")} preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id={ref("dots")} width="10" height="10" patternUnits="userSpaceOnUse">
                <circle cx="5" cy="5" r="1.7" className="ab-solid" />
              </pattern>
              <pattern id={ref("dotsFine")} width="7" height="7" patternUnits="userSpaceOnUse">
                <circle cx="3.5" cy="3.5" r="1.1" className="ab-solid" />
              </pattern>
              <pattern id={ref("hatch")} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="12" className="ab-ink" strokeWidth="2" />
              </pattern>
              <linearGradient id={ref("fade")} gradientUnits="userSpaceOnUse" x1="0" y1="215" x2="0" y2="740">
                <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
                <stop offset="0.65" stopColor="#fff" stopOpacity="0.35" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id={ref("fadeMask")} maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="860">
                <rect x="0" y="200" width="1600" height="560" fill={`url(#${ref("fade")})`} />
              </mask>
            </defs>

            {/* the sheet's frame */}
            <rect x="6" y="6" width="1588" height="848" className="ab-ink" strokeWidth="1.5" />

            {/* light cones, behind everything in the room */}
            <g mask={`url(#${ref("fadeMask")})`}>
              {WORKSHOP_STATIONS.map((s) => (
                <polygon key={s} className={`ab-cone${lit(s) ? " ab-on" : ""}`} points={PLACES[s].cone} fill={`url(#${ref("dots")})`} />
              ))}
            </g>

            {/* the cut slabs and walls */}
            {[
              [40, 40, 1520, 34],
              [40, 740, 1520, 46],
              [40, 74, 34, 666],
              [1526, 74, 34, 666],
            ].map(([x, y, w, h]) => (
              <g key={`${x}-${y}`}>
                <rect x={x} y={y} width={w} height={h} fill={`url(#${ref("hatch")})`} />
                <rect x={x} y={y} width={w} height={h} className="ab-ink" strokeWidth="3.5" />
              </g>
            ))}
            <line x1="74" y1="724" x2="1526" y2="724" className="ab-ink" strokeWidth="1.2" />

            {/* the lamps */}
            {WORKSHOP_STATIONS.map((s) => {
              const x = PLACES[s].lamp;
              return (
                <g key={s} className={`ab-lamp${lit(s) ? " ab-on" : ""}`}>
                  <line x1={x} y1="74" x2={x} y2="168" className="ab-ink" strokeWidth="2" />
                  <polygon
                    points={`${x - 15},168 ${x + 15},168 ${x + 42},210 ${x - 42},210`}
                    className="ab-ink ab-shade"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <circle cx={x} cy="216" r="9" className="ab-ink ab-bulb" strokeWidth="2" />
                  <g className="ab-rays">
                    {[
                      [-24, 226, -34, 236],
                      [24, 226, 34, 236],
                      [0, 232, 0, 246],
                    ].map(([x1, y1, x2, y2]) => (
                      <line key={`${x1}-${y1}`} x1={x + x1} y1={y1} x2={x + x2} y2={y2} className="ab-ink" strokeWidth="2" strokeLinecap="round" />
                    ))}
                  </g>
                </g>
              );
            })}

            {/* the board: Len's steps, a box and a hand-drawn line each */}
            <g>
              <rect x="170" y="250" width="260" height="190" rx="6" className="ab-ink ab-paper" strokeWidth="3" />
              <rect x="186" y="440" width="228" height="9" rx="2" className="ab-ink ab-paper" strokeWidth="2" />
              <rect x="372" y="433" width="26" height="7" rx="2" className="ab-solid" />
              {rows.map((todo, i) => {
                const y = 284 + i * 31;
                const w = 96 + Math.min(todo.content.length, 40) * 2.2;
                const d = `M 222 ${y} q ${w * 0.25} -4 ${w * 0.5} 0 t ${w * 0.5} 0`;
                const writing = !finished && todo.status === "in_progress";
                const drawn = finished || todo.status === "completed";
                return (
                  <g key={`${i}-${todo.content}`}>
                    <rect x="192" y={y - 8} width="14" height="14" rx="2" className="ab-ink" strokeWidth="2" />
                    <path d={d} strokeWidth="2.5" strokeLinecap="round" className="ab-ghost" />
                    <path
                      d={d}
                      className={`ab-ink${writing && !reduce ? " ab-writing" : ""}`}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      pathLength={1}
                      strokeDasharray="1 1"
                      strokeDashoffset={drawn ? 0 : writing ? 0.45 : 1}
                    />
                    <path
                      d={`M 194 ${y - 1} l 4 5 l 8 -11`}
                      className={`ab-ink ab-tick${drawn ? " ab-on" : ""}`}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              })}
            </g>

            {/* the files */}
            <g>
              <rect x="610" y="524" width="16" height="200" fill={`url(#${ref("dotsFine")})`} />
              <rect x="480" y="520" width="130" height="220" className="ab-ink ab-paper" strokeWidth="3" />
              <line x1="480" y1="666" x2="610" y2="666" className="ab-ink" strokeWidth="2" />
              <rect x="530" y="694" width="30" height="7" rx="2" className="ab-solid" />
              <rect x="482" y="595" width="126" height="71" className="ab-ink ab-paper" strokeWidth="2" />
              <rect x="530" y="623" width="30" height="7" rx="2" className="ab-solid" />
              <g className="ab-slide" style={{ opacity: fileOut ? 1 : 0, transform: `translate(0px, ${fileOut ? -34 : 40}px)` }}>
                <rect x="513" y="470" width="64" height="44" rx="4" className="ab-ink ab-paper" strokeWidth="2.5" />
                <line x1="524" y1="484" x2="566" y2="484" className="ab-ink" strokeWidth="2" />
                <line x1="524" y1="494" x2="556" y2="494" className="ab-ink" strokeWidth="2" />
                <line x1="524" y1="504" x2="560" y2="504" className="ab-ink" strokeWidth="2" />
              </g>
              <g className="ab-slide" style={{ transform: `translate(${drawerOpen ? 46 : 0}px, 0px)` }}>
                <rect x="482" y="522" width="126" height="71" className="ab-ink ab-paper" strokeWidth="2" />
                <rect x="530" y="550" width="30" height="7" rx="2" className="ab-solid" />
              </g>
            </g>

            {/* the desk */}
            <g>
              <rect x="690" y="728" width="270" height="12" fill={`url(#${ref("dotsFine")})`} />
              <rect x="696" y="614" width="10" height="126" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="944" y="614" width="10" height="126" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="680" y="600" width="290" height="14" rx="2" className="ab-ink ab-paper" strokeWidth="3" />
              <rect x="822" y="550" width="16" height="40" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="790" y="588" width="80" height="12" rx="3" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="706" y="590" width="74" height="10" rx="3" className="ab-ink ab-paper" strokeWidth="2.5" />
              <line x1="716" y1="595" x2="770" y2="595" className="ab-ink" strokeWidth="1.2" strokeDasharray="4 3" />
              <rect x="740" y="430" width="180" height="120" rx="8" className="ab-ink ab-paper" strokeWidth="3" />
              <rect x="754" y="444" width="152" height="92" rx="3" className="ab-ink" strokeWidth="1.5" />
              {CODE_BARS.map((w, i) => (
                <rect
                  key={i}
                  x={766 + (i === 2 || i === 3 ? 14 : 0)}
                  y={456 + i * 13}
                  width={w}
                  height="6"
                  rx="3"
                  className={`ab-solid ab-bar${i < bars ? " ab-on" : ""}`}
                />
              ))}
              {bars > 0 && (
                <rect
                  className={`ab-solid${reduce ? "" : " ab-cursor"}`}
                  x={766 + (bars - 1 === 2 || bars - 1 === 3 ? 14 : 0) + CODE_BARS[bars - 1]! + 4}
                  y={456 + (bars - 1) * 13 - 1}
                  width="5"
                  height="8"
                />
              )}
            </g>

            {/* the terminal */}
            <g>
              <rect x="1180" y="474" width="14" height="250" fill={`url(#${ref("dotsFine")})`} />
              <rect x="1020" y="470" width="160" height="270" rx="6" className="ab-ink ab-paper" strokeWidth="3" />
              <rect x="1036" y="488" width="128" height="98" rx="4" className="ab-ink ab-paper" strokeWidth="2.5" />
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <line key={v} x1="1044" y1={614 + v * 14} x2="1156" y2={614 + v * 14} className="ab-ink" strokeWidth="1.5" />
              ))}
              <circle cx="1160" cy="716" r="5" className={live === "terminal" ? "ab-solid" : "ab-ink"} strokeWidth="2" />
              <text x="1048" y="512" className="ab-screen">
                {typed}
              </text>
              {live === "terminal" && typed.length === command.length && (
                <rect className={`ab-solid${reduce ? "" : " ab-cursor"}`} x="1048" y="522" width="8" height="12" />
              )}
            </g>

            {/* the test bench */}
            <g>
              <rect x="1258" y="728" width="190" height="12" fill={`url(#${ref("dotsFine")})`} />
              <rect x="1265" y="602" width="10" height="138" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="1425" y="602" width="10" height="138" className="ab-ink ab-paper" strokeWidth="2.5" />
              <rect x="1250" y="590" width="200" height="12" rx="2" className="ab-ink ab-paper" strokeWidth="3" />
              <polyline points="1338,590 1372,470 1404,590" className="ab-ink" strokeWidth="2.5" strokeLinejoin="round" />
              <rect x="1315" y="440" width="70" height="134" rx="12" className="ab-ink ab-paper" strokeWidth="3" />
              <rect x="1322" y="452" width="56" height="110" rx="6" className="ab-ink" strokeWidth="1.5" />
              <rect x="1328" y="460" width="44" height="8" rx="2" className="ab-solid" />
              {[476, 490, 504, 518].map((y) => (
                <rect key={y} x="1328" y={y} width="44" height="7" rx="2" className="ab-ink" strokeWidth="1.5" />
              ))}
              <rect x="1328" y="540" width="44" height="13" rx="3" className="ab-solid" />
              {tap && <circle key={tap.k} className="ab-ink ab-tap" cx={tap.x} cy={tap.y} r="7" strokeWidth="2" />}
            </g>

            {/* Len */}
            <ellipse ref={shadowRef} cx={target[0]} cy={FLOOR_Y} rx="34" ry="6" fill={`url(#${ref("dots")})`} />
            <g ref={lenRef} transform={`translate(${target[0]} ${target[1]})`}>
              <circle r="54" className="ab-solid" />
              <circle r="37" className="ab-paper" />
              <ellipse className="ab-solid ab-eye" cx="-13" cy="-3" rx="6" ry="11" style={eyeStyle} />
              <ellipse className="ab-solid ab-eye" cx="13" cy="-3" rx="6" ry="11" style={eyeStyle} />
            </g>

            {/* the labels, with leader ticks under the floor */}
            {WORKSHOP_STATIONS.map((s) => (
              <g key={s}>
                <line x1={PLACES[s].lamp} y1="788" x2={PLACES[s].lamp} y2="806" className="ab-ink" strokeWidth="1.5" />
                <text x={PLACES[s].lamp} y="836" textAnchor="middle" className={`ab-label${lit(s) ? " ab-on" : ""}`}>
                  {t(`label.${s}`)}
                </text>
              </g>
            ))}
          </svg>
        </figure>

        <div className="ab-block" aria-label={t("block.label")}>
          <div>
            <span>{t("block.workshop")}</span>
            <b>Len</b>
          </div>
          <div>
            <span>{t("block.app")}</span>
            <b title={appName}>{appName}</b>
          </div>
          <div>
            <span>{t("block.progress")}</span>
            <b>{progressText}</b>
          </div>
          <div>
            <span>{t("block.time")}</span>
            <b>{clockOf((finished ? now : Math.max(now, startedAt)) - startedAt)}</b>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .ab-root {
          --ab-paper: var(--bg-preview);
          --ab-ink: var(--fg);
          --ab-ink-2: var(--fg-muted);
          --ab-ink-3: color-mix(in oklch, var(--fg) 18%, transparent);
          position: absolute;
          inset: 0;
          container-type: inline-size;
          display: flex;
          justify-content: center;
          padding: clamp(16px, 2.5vw, 32px) clamp(16px, 3vw, 40px);
          background: var(--ab-paper);
          color: var(--ab-ink);
          font-family: var(--ab-head), "Helvetica Neue", Arial, sans-serif;
          overflow: hidden;
        }
        .ab-sheet {
          width: 100%;
          max-width: 1180px;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ab-head {
          flex: none;
        }
        .ab-who,
        .ab-note {
          margin: 0;
          font-family: var(--ab-note), ui-monospace, Menlo, Consolas, monospace;
          font-size: 13px;
          color: var(--ab-ink-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ab-note {
          margin-top: 8px;
          font-size: 12px;
        }
        .ab-now {
          margin: 6px 0 0;
          font-weight: 700;
          font-size: clamp(22px, 4.2cqw, 46px);
          line-height: 1.06;
          letter-spacing: -0.022em;
          text-wrap: balance;
          overflow-wrap: anywhere;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ab-figure {
          flex: 1 1 auto;
          min-height: 0;
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ab-figure svg {
          display: block;
          width: 100%;
          height: 100%;
        }
        .ab-block {
          flex: none;
          align-self: flex-end;
          display: grid;
          grid-template-columns: repeat(4, auto);
          border: 2px solid var(--ab-ink);
          font-family: var(--ab-note), ui-monospace, Menlo, Consolas, monospace;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          max-width: 100%;
        }
        .ab-block div {
          padding: 8px 14px;
          border-left: 1px solid var(--ab-ink);
          min-width: 0;
        }
        .ab-block div:first-child {
          border-left: 0;
        }
        .ab-block span {
          display: block;
          color: var(--ab-ink-2);
          font-size: 11px;
          margin-bottom: 2px;
        }
        .ab-block b {
          display: block;
          font-weight: 500;
          max-width: 28ch;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container (max-width: 560px) {
          .ab-block {
            align-self: stretch;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .ab-block div:nth-child(3) {
            border-left: 0;
          }
          .ab-block div:nth-child(n + 3) {
            border-top: 1px solid var(--ab-ink);
          }
        }

        .ab-root .ab-ink {
          stroke: var(--ab-ink);
          fill: none;
        }
        .ab-root .ab-solid {
          fill: var(--ab-ink);
        }
        .ab-root .ab-paper {
          fill: var(--ab-paper);
        }
        .ab-root .ab-ghost {
          fill: none;
          stroke: var(--ab-ink-3);
        }
        .ab-root .ab-label {
          font-family: var(--ab-note), ui-monospace, Menlo, Consolas, monospace;
          font-size: 23px;
          fill: var(--ab-ink-2);
        }
        .ab-root .ab-label.ab-on {
          fill: var(--ab-ink);
          font-weight: 500;
        }
        .ab-root .ab-screen {
          font-family: var(--ab-note), ui-monospace, Menlo, Consolas, monospace;
          font-size: 13px;
          fill: var(--ab-ink);
        }
        .ab-root .ab-cone {
          opacity: 0;
          transition: opacity 0.7s ease;
        }
        .ab-root .ab-cone.ab-on {
          opacity: 1;
        }
        .ab-root .ab-shade {
          fill: var(--ab-paper);
          transition: fill 0.4s;
        }
        .ab-root .ab-lamp.ab-on .ab-shade {
          fill: var(--ab-ink);
        }
        .ab-root .ab-bulb {
          fill: var(--ab-ink-3);
          transition: fill 0.4s;
        }
        .ab-root .ab-lamp.ab-on .ab-bulb {
          fill: var(--ab-paper);
        }
        .ab-root .ab-rays {
          opacity: 0;
          transition: opacity 0.4s;
        }
        .ab-root .ab-lamp.ab-on .ab-rays {
          opacity: 1;
        }
        .ab-root .ab-eye {
          transform-box: fill-box;
          transform-origin: center;
          transition: transform 0.3s ease-out;
        }
        .ab-root .ab-slide {
          transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s;
        }
        .ab-root .ab-bar,
        .ab-root .ab-tick {
          opacity: 0;
          transition: opacity 0.25s;
        }
        .ab-root .ab-bar.ab-on,
        .ab-root .ab-tick.ab-on {
          opacity: 1;
        }
        .ab-root .ab-writing {
          animation: ab-write 3.2s ease-out infinite;
        }
        @keyframes ab-write {
          0% {
            stroke-dashoffset: 1;
          }
          70%,
          100% {
            stroke-dashoffset: 0;
          }
        }
        .ab-root .ab-cursor {
          animation: ab-blink 1s steps(1) infinite;
        }
        @keyframes ab-blink {
          50% {
            opacity: 0;
          }
        }
        .ab-root .ab-tap {
          transform-box: fill-box;
          transform-origin: center;
          opacity: 0;
          animation: ab-ripple 0.8s ease-out;
        }
        @keyframes ab-ripple {
          from {
            transform: scale(0.2);
            opacity: 1;
          }
          to {
            transform: scale(2.2);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ab-root .ab-cone,
          .ab-root .ab-shade,
          .ab-root .ab-bulb,
          .ab-root .ab-rays,
          .ab-root .ab-eye,
          .ab-root .ab-slide,
          .ab-root .ab-bar,
          .ab-root .ab-tick {
            transition: none;
          }
          .ab-root .ab-writing,
          .ab-root .ab-cursor {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/** The command as the terminal's small screen can show it: `$ ` and what fits. */
function terminalLine(command: string | null): string {
  const c = (command ?? "").trim();
  if (!c) return "$ ";
  const line = `$ ${c}`;
  return line.length <= TERMINAL_CHARS ? line : `${line.slice(0, TERMINAL_CHARS - 1)}…`;
}
