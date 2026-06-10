// ─────────────────────────────────────────────────────────────────────────────
// Motion Looks — Apple-style scroll choreography as pure CSS + a tiny runtime.
//
// A second row of beads next to the Looks orbs. The page looks IDENTICAL in a
// screenshot; what changes is what happens as you scroll: sections rise in
// staggered, the hero parallaxes, a headline pins, stat numbers count up.
//
// This module is the SINGLE SOURCE of the motion CSS + runtime, shared by:
//   - publish (lib/publish/motion.ts → injected into the static HTML, the
//     runtime <script> sealed by the CSP pass like the analytics snippet)
//   - the editor preview (components/workspace-v2/use-motion-preview.ts →
//     applied live in the iframe when a bead is picked)
//
// Moat: Framer/Webflow ship hundreds of KB of JS runtime for this. OpenLen
// does it with ~5KB of CSS + a ~1.5KB IntersectionObserver fallback, baked
// into a static file. No framework, no runtime hop.
//
// Fail-safety + a11y are non-negotiable:
//   - All reveal CSS lives inside @media (prefers-reduced-motion: no-preference)
//     so reduced-motion visitors get the static page, untouched.
//   - The "start hidden" state is gated on @supports (animation-timeline:view())
//     OR a JS-applied marker class. A browser with NEITHER scroll-driven
//     animations NOR JS shows every element fully visible — motion is an
//     enhancement, never a prerequisite for seeing the content.
// ─────────────────────────────────────────────────────────────────────────────

export type MotionPreset = "calm" | "editorial" | "dramatic";

export const MOTION_PRESETS: readonly MotionPreset[] = [
  "calm",
  "editorial",
  "dramatic",
] as const;

export function isMotionPreset(v: unknown): v is MotionPreset {
  return v === "calm" || v === "editorial" || v === "dramatic";
}

// Per-preset feel. `reveal` = the transform applied before an item scrolls in;
// `counters`/`parallax`/`pin` toggle the richer (layout-aware, gracefully
// degrading) effects. Editorial is the balanced default; Calm is quiet;
// Dramatic is the cinematic keynote.
interface PresetSpec {
  /** translateY (px) the reveal starts from. */
  rise: number;
  /** scale the reveal starts from (1 = no scale). */
  scale: number;
  /** reveal duration in seconds (the "weight"). */
  dur: number;
  /** per-item stagger step in seconds (0 = no stagger). */
  step: number;
  counters: boolean;
  parallax: boolean;
  pin: boolean;
}

const SPECS: Record<MotionPreset, PresetSpec> = {
  calm: { rise: 16, scale: 1, dur: 0.9, step: 0, counters: false, parallax: false, pin: false },
  editorial: { rise: 30, scale: 1, dur: 1.0, step: 0.08, counters: true, parallax: true, pin: false },
  dramatic: { rise: 52, scale: 0.965, dur: 1.15, step: 0.11, counters: true, parallax: true, pin: true },
};

// The content blocks we reveal. Targets sections as whole blocks (covers
// deeply-nested layouts) AND the immediate item-children of the common
// content containers (gives the staggered feel on flatter layouts). :where()
// keeps specificity at zero so author styles always win, and the set is
// block-level only — inline links/buttons ride in with their parent.
const ITEM =
  ":where(section,article,figure,header,footer,h1,h2,h3,h4,p,img,picture,ul,ol,blockquote,.card,[class*='card'])";
const REVEAL_TARGETS = [
  `[data-ol-motion] :where(body,main,section,article,header,footer,.container,[class*='container'],[class*='grid'],[class*='wrapper']) > ${ITEM}`,
  `[data-ol-motion] > main > ${ITEM}`,
].join(",\n");

function staggerRules(step: number, max = 8): string {
  if (step <= 0) return "";
  const lines: string[] = [];
  for (let i = 2; i <= max; i++) {
    // nth-child stagger, scoped to the immediate-children selector only.
    lines.push(
      `[data-ol-motion] :where(body,main,section,article,header,footer,.container,[class*='container'],[class*='grid'],[class*='wrapper']) > ${ITEM}:nth-child(${i}){animation-delay:${(
        (i - 1) *
        step
      ).toFixed(2)}s}`,
    );
  }
  return lines.join("\n");
}

/** The motion CSS for one preset — the inner text of the injected
 *  `<style data-ol-motion>`. Self-contained; safe to inline as-is. */
export function motionCss(preset: MotionPreset): string {
  const s = SPECS[preset];
  const heroParallax = s.parallax
    ? `
  /* Hero parallax — the first big image drifts slower than the scroll.
     Pure CSS scroll-timeline; degrades to static where unsupported. */
  @supports (animation-timeline: scroll()) {
    [data-ol-motion] :where(header,section):first-of-type :where(img,picture):first-of-type {
      animation: ol-parallax linear both;
      animation-timeline: scroll(root);
      will-change: transform;
    }
  }
  @keyframes ol-parallax {
    from { transform: translateY(-4%); }
    to   { transform: translateY(4%); }
  }`
    : "";
  const pin = s.pin
    ? `
  /* Dramatic only: the first hero headline pins briefly as content scrolls
     past. position:sticky is universally supported and never hides content. */
  [data-ol-motion] :where(header,section):first-of-type :where(h1,h2):first-of-type {
    position: sticky;
    top: clamp(8px, 4vh, 48px);
  }`
    : "";

  return `
@media (prefers-reduced-motion: no-preference) {
  /* Start state — ONLY where the page can actually reveal it again
     (scroll-driven CSS, or the JS fallback marker). No support + no JS =
     content stays fully visible. */
  @supports (animation-timeline: view()) {
    ${REVEAL_TARGETS} {
      animation: ol-reveal ${s.dur}s cubic-bezier(0.22, 0.61, 0.36, 1) both;
      animation-timeline: view();
      animation-range: entry 0% cover 30%;
    }
  }
  html.ol-motion-js:not(.ol-motion-native) ${REVEAL_TARGETS} {
    opacity: 0;
    transform: translateY(${s.rise}px) scale(${s.scale});
    transition: opacity ${s.dur}s cubic-bezier(0.22,0.61,0.36,1),
                transform ${s.dur}s cubic-bezier(0.22,0.61,0.36,1);
    transition-delay: inherit;
  }
  html.ol-motion-js:not(.ol-motion-native) ${REVEAL_TARGETS}.ol-in {
    opacity: 1;
    transform: none;
  }
${staggerRules(s.step)}
${heroParallax}
${pin}
  @keyframes ol-reveal {
    from { opacity: 0; transform: translateY(${s.rise}px) scale(${s.scale}); }
    to   { opacity: 1; transform: none; }
  }
}`;
}

// The runtime BODY: applied in BOTH the published page and the editor
// preview. Reads the chosen preset from <html data-ol-motion="…"> and:
//   - flags ol-motion-native when scroll-driven animations are supported (so
//     the JS-fallback CSS stays dormant), else ol-motion-js + an
//     IntersectionObserver that adds .ol-in as items enter
//   - animates stat-shaped numbers (editorial/dramatic) from 0 on first view,
//     stashing the original text in data-ol-orig so the editor preview can
//     restore it when switching presets
// Bails entirely under prefers-reduced-motion. No deps. Wrapped in an IIFE
// for publish (MOTION_RUNTIME_JS); re-invoked by the editor preview injector.
export const MOTION_RUNTIME_BODY = `
  try{
    var root=document.documentElement;
    var preset=root.getAttribute('data-ol-motion');
    if(!preset)return;
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    var native=false;
    try{native=CSS&&CSS.supports&&CSS.supports('animation-timeline','view()');}catch(_){}
    var ITEM=':where(section,article,figure,header,footer,h1,h2,h3,h4,p,img,picture,ul,ol,blockquote,.card,[class*=card])';
    var SEL='[data-ol-motion] :where(body,main,section,article,header,footer,.container,[class*=container],[class*=grid],[class*=wrapper]) > '+ITEM+', [data-ol-motion] > main > '+ITEM;
    if(native){root.classList.add('ol-motion-native');}
    else{
      root.classList.add('ol-motion-js');
      var items;try{items=document.querySelectorAll(SEL);}catch(_){items=[];}
      if('IntersectionObserver'in window){
        var io=new IntersectionObserver(function(es){
          for(var i=0;i<es.length;i++){if(es[i].isIntersecting){es[i].target.classList.add('ol-in');io.unobserve(es[i].target);}}
        },{rootMargin:'0px 0px -8% 0px',threshold:0.05});
        for(var j=0;j<items.length;j++){
          var r=items[j].getBoundingClientRect();
          if(r.top<(window.innerHeight||0)&&r.bottom>0)items[j].classList.add('ol-in');
          else io.observe(items[j]);
        }
      }else{for(var k=0;k<items.length;k++)items[k].classList.add('ol-in');}
    }
    if(preset==='calm')return;
    // Stat counters — leaf elements whose text is a single stat-shaped number.
    var RE=/^([^0-9]{0,2})(\\d{1,3}(?:[,. ]\\d{3})*|\\d+)(?:([.,])(\\d+))?\\s*([%+kKmMxX]{0,2}\\+?)$/;
    var nodes;try{nodes=document.querySelectorAll('[data-ol-motion] h1,[data-ol-motion] h2,[data-ol-motion] h3,[data-ol-motion] span,[data-ol-motion] strong,[data-ol-motion] b,[data-ol-motion] em,[data-ol-motion] p,[data-ol-motion] div,[data-ol-motion] li,[data-ol-motion] dd,[data-ol-motion] dt');}catch(_){nodes=[];}
    var stats=[];
    for(var n=0;n<nodes.length;n++){
      var el=nodes[n];
      if(el.children.length||el.getAttribute('data-ol-counted'))continue;
      var txt=(el.textContent||'').trim();
      if(txt.length>10)continue;
      var m=RE.exec(txt);if(!m)continue;
      var intPart=m[2].replace(/[ ,.]/g,'');var target=parseInt(intPart,10);
      if(!isFinite(target)||target<=0||target>1e9)continue;
      // Skip bare 4-digit years (e.g. "2024") — no suffix, no decimals.
      if(target>=1900&&target<=2100&&!m[5]&&!m[4]&&intPart.length===4)continue;
      el.setAttribute('data-ol-counted','');el.setAttribute('data-ol-orig',txt);
      stats.push({el:el,pre:m[1]||'',target:target,dec:m[4]||'',suf:m[5]||'',sep:(m[2].indexOf(',')>-1?',':'')});
    }
    function fmt(v,sep){v=Math.round(v).toString();return sep?v.replace(/\\B(?=(\\d{3})+(?!\\d))/g,sep):v;}
    function run(s){
      var start=null,dur=1200;
      function tick(ts){
        if(start===null)start=ts;var p=Math.min(1,(ts-start)/dur);
        var e=1-Math.pow(1-p,3);
        s.el.textContent=s.pre+fmt(s.target*e,s.sep)+(p>=1&&s.dec?'.'+s.dec:'')+s.suf;
        if(p<1)requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if(stats.length){
      if('IntersectionObserver'in window){
        var io2=new IntersectionObserver(function(es){
          for(var i=0;i<es.length;i++){if(es[i].isIntersecting){run(es[i].target.__ols);io2.unobserve(es[i].target);}}
        },{threshold:0.6});
        for(var q=0;q<stats.length;q++){stats[q].el.__ols=stats[q];stats[q].el.textContent=stats[q].pre+'0'+stats[q].suf;io2.observe(stats[q].el);}
      }else{for(var w=0;w<stats.length;w++)run(stats[w]);}
    }
  }catch(_){}
`;

/** Publish-time runtime: the body wrapped in a run-once IIFE. */
export const MOTION_RUNTIME_JS = `(function(){${MOTION_RUNTIME_BODY}})();`;
