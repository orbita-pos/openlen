// Streamer overlay renderer — pure string→string. The OBS/browser-source
// page at /ov/[id] and its inline polling script are both built here so the
// route stays a thin auth/lookup shell (see app/ov/[id]/route.ts). `screen`
// WINS over `goal` (mirrors settings-patch.ts precedence: a streamer flips to
// a brand screen to hide the numbers, not to layer text on top of them).
//
// Brand tokens (--ol-accent, data-ol-mode) are read straight off the
// project's own <html> tag via lib/agent/theme-apply.ts, so the overlay
// always matches the page's current theme without a second source of truth.

import { readThemeModeFromHtml, readThemeTokenFromHtml } from "@/lib/agent/theme-apply";
import type { OverlayGoal } from "@/lib/projects/types";

export interface OverlayRenderInput {
  goal: OverlayGoal | null;
  screen: "brb" | "start" | "end" | null;
  /** HTML of the project — source of --ol-accent / mode (readThemeTokenFromHtml). */
  projectHtml: string;
  /** URL of the state endpoint the polling script fetches. */
  stateUrl: string;
  title: string;
}

const DEFAULT_ACCENT = "#e8743a";

const SCREEN_COPY: Record<"brb" | "start" | "end", string> = {
  brb: "Ya volvemos",
  start: "Empezamos pronto",
  end: "Gracias por ver",
};

export function renderOverlayHtml(input: OverlayRenderInput): string {
  const { goal, screen, projectHtml, stateUrl, title } = input;

  const rawAccent = readThemeTokenFromHtml(projectHtml, "--ol-accent");
  // Belt-and-suspenders: a value carrying < or > could break out of the
  // <style> block it's interpolated into below. Never expected from a
  // legitimate CSS color, so falling back is a no-op in practice.
  const accent = rawAccent && !/[<>]/.test(rawAccent) ? rawAccent.trim() : DEFAULT_ACCENT;
  const mode = readThemeModeFromHtml(projectHtml);
  const textColor = mode === "dark" ? "#f5f5f5" : "#141414";

  const rootHtml = screen ? renderScreenHtml(screen) : goal ? renderGoalHtml(goal) : "";

  return `<!doctype html>
<html lang="es" data-ol-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root{--ov-accent:${accent};}
html,body{margin:0;padding:0;height:100%;background:transparent;}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:${textColor};display:flex;align-items:flex-end;min-height:100vh;box-sizing:border-box;}
#ov-root{padding:1.25rem;}
.ov-goal{display:flex;flex-direction:column;gap:.4rem;min-width:16rem;}
.ov-label{font-size:1rem;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.35);}
.ov-numbers{font-size:1.4rem;font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.35);}
.ov-bar{width:100%;height:.6rem;border-radius:999px;background:rgba(128,128,128,.35);overflow:hidden;}
.ov-bar-fill{height:100%;background:var(--ov-accent);border-radius:999px;transition:width .6s ease;}
.ov-screen{font-size:3rem;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,.4);}
</style>
</head>
<body style="background:transparent">
<div id="ov-root">${rootHtml}</div>
<script>${pollScript(stateUrl)}</script>
</body>
</html>`;
}

function renderGoalHtml(goal: OverlayGoal): string {
  const pct = goalPct(goal.current, goal.target);
  return `<div class="ov-goal" id="ov-goal"><div class="ov-label">${escapeHtml(goal.label)}</div><div class="ov-numbers">${goal.current} / ${goal.target}</div><div class="ov-bar"><div class="ov-bar-fill" style="width:${pct}%"></div></div></div>`;
}

function renderScreenHtml(screen: "brb" | "start" | "end"): string {
  return `<div class="ov-screen" id="ov-screen">${escapeHtml(SCREEN_COPY[screen])}</div>`;
}

function goalPct(current: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal inline polling script: fetches `stateUrl` every 10s and rebuilds
// #ov-root from the JSON — same goal/screen precedence as the server render,
// so a streamer flipping the screen mid-stream (or editing the goal) updates
// the open OBS browser source without a reload. Uses textContent, never
// innerHTML, so a poll response can't inject markup. Network failures are
// swallowed — a stale-but-valid overlay beats a blank one.
function pollScript(stateUrl: string): string {
  const safeUrl = JSON.stringify(stateUrl).replace(/<\//g, "<\\/");
  return `(function(){
var STATE_URL=${safeUrl};
var SCREEN_COPY={brb:"Ya volvemos",start:"Empezamos pronto",end:"Gracias por ver"};
var root=document.getElementById("ov-root");
function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}
function renderGoal(goal){
clear(root);
var wrap=document.createElement("div");wrap.className="ov-goal";wrap.id="ov-goal";
var label=document.createElement("div");label.className="ov-label";label.textContent=goal.label;
var nums=document.createElement("div");nums.className="ov-numbers";nums.textContent=goal.current+" / "+goal.target;
var barOuter=document.createElement("div");barOuter.className="ov-bar";
var barFill=document.createElement("div");barFill.className="ov-bar-fill";
var pct=goal.target>0?Math.max(0,Math.min(100,(goal.current/goal.target)*100)):0;
barFill.style.width=pct+"%";
barOuter.appendChild(barFill);
wrap.appendChild(label);wrap.appendChild(nums);wrap.appendChild(barOuter);
root.appendChild(wrap);
}
function renderScreen(screen){
clear(root);
var text=SCREEN_COPY[screen];
if(!text)return;
var wrap=document.createElement("div");wrap.className="ov-screen";wrap.id="ov-screen";
wrap.textContent=text;
root.appendChild(wrap);
}
function apply(state){
if(!state)return;
if(state.screen){renderScreen(state.screen);return;}
if(state.goal){renderGoal(state.goal);return;}
clear(root);
}
function poll(){
fetch(STATE_URL,{cache:"no-store"}).then(function(r){return r.json();}).then(apply).catch(function(){});
}
poll();
setInterval(poll,10000);
})();`;
}
