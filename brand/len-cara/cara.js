/* ─────────────────────────────────────────────────────────────────────────
   cara.js — el motor de la cara de Len. Un solo archivo, sin librerías.

     const c = LenCara.create(host, { props: "all" | "compact" | "none", onchange })
     c.set("buscando") · c.poke() · c.state
     LenCara.setSpeed(0.3) · LenCara.setReduced(true) · LenCara.STATES

   Cada cara tiene su propio cerebro (estado, transición, parpadeo), así que
   varias caras en la misma página no parpadean a la vez. Un solo bucle las
   mueve a todas.

   Técnica, sacada del orbe de Grok: cada estado es una POSE en números; cambiar
   de estado es interpolar pose → pose con cubic-bezier(.77,0,.175,1) y un medio
   parpadeo a mitad que tapa el morph; la deriva de fondo son senos de periodos
   que no se sincronizan nunca.

   props: "all" = todos los accesorios · "compact" = encogidos junto al anillo y
   sin los que van debajo (para el chat) · "none" = sólo la cara.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* ───────── utilidades ───────── */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const frac = (x) => x - Math.floor(x);
  const rand = (a, b) => a + Math.random() * (b - a);

  function bezier(p1x, p1y, p2x, p2y) {
    const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= (sx(t) - x) / d; }
      return sy(clamp(t, 0, 1));
    };
  }
  const EASE = bezier(0.77, 0, 0.175, 1);

  let SPEED = 1;
  let REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let T = 0;
  const M = () => (REDUCED ? 0.2 : 1);

  /* ───────── la pose ───────── */
  function E(x, o) {
    // ojo = superelipse (a, b, n) + giro + párpado de arriba (lt, lts, ltc) + de abajo (lb, lbc)
    return Object.assign({ x, y: 32.5, a: 2.7, b: 4.8, n: 2.2, r: 0, lt: 0, lts: 0, ltc: 0, lb: 0, lbc: 0, s: 1 }, o || {});
  }
  function pose() {
    return {
      body: { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, stroke: 10, glass: 1, spin: 8, desat: 0 },
      L: E(26.4), R: E(37.6),
      gaze: [0, 0], blink: 1, follow: 0, scan: 0, burstS: 1, burstO: 0,
    };
  }
  const eyes = (p, o) => { Object.assign(p.L, o); Object.assign(p.R, o); };
  const squash = (p, sy) => { p.body.sy = sy; p.body.sx = 1 / Math.pow(sy, 0.8); };

  function ambient(p, t, k = 1) {
    if (REDUCED) return;
    p.body.tx += k * 0.42 * Math.sin(TAU * t / 18.29 - 3.07);
    p.body.ty += k * 0.40 * Math.sin(TAU * t / 7.835 - 0.83);
    p.body.rot += k * 1.9 * Math.sin(TAU * t / 13.71 + 2.27);
    p.body.stroke += k * 0.22 * Math.sin(TAU * t / 4.6);
    p.L.x += k * 0.22 * Math.sin(t * 0.71); p.L.y += k * 0.16 * Math.sin(t * 0.93 + 1.1);
    p.R.x += k * 0.20 * Math.sin(t * 0.66 + 2.1); p.R.y += k * 0.15 * Math.sin(t * 0.87 + 2.4);
  }
  function idle(c, t) {
    if (t >= c.nextGlance) {
      c.nextGlance = t + rand(1.3, 4);
      c.glance = Math.random() < 0.35 ? [0, 0] : [rand(-0.7, 0.7), rand(-0.5, 0.5)];
    }
    return c.glance;
  }
  const HOP = [[0, 0, 1], [0.14, 0, 0.84], [0.24, -0.45, 1.14], [0.37, -1, 1], [0.5, -0.45, 1.08], [0.58, 0, 0.8], [0.7, 0, 1.07], [0.82, 0, 0.98], [1, 0, 1]];
  function hop(p, H) {
    if (REDUCED) return { y: 0, sy: 1 };
    p = clamp(p, 0, 1);
    for (let i = 1; i < HOP.length; i++) {
      if (p <= HOP[i][0]) {
        const [p0, y0, s0] = HOP[i - 1], [p1, y1, s1] = HOP[i];
        const q = smooth((p - p0) / (p1 - p0));
        return { y: lerp(y0, y1, q) * H, sy: lerp(s0, s1, q) };
      }
    }
    return { y: 0, sy: 1 };
  }

  /* ───────── los estados ───────── */
  const ST = {
    logo: { fn() {
      const p = pose(); p.body.stroke = 15; p.body.glass = 0; p.body.spin = 0;
      p.L.x = p.R.x = 32; eyes(p, { s: 0 }); p.blink = 0; return p;
    } },
    reposo: { fn(t, lt, c) {
      const p = pose(); ambient(p, t); p.gaze = idle(c, t); p.follow = 1; return p;
    } },
    saludando: { replay: true, fn(t, lt) {
      const p = pose(); ambient(p, t, 0.6); const h = hop(lt / 0.9, 3.5);
      p.body.ty += h.y; squash(p, h.sy);
      p.body.rot += -7 + 7 * M() * Math.sin(lt * 8) * Math.exp(-lt * 1.2);
      Object.assign(p.L, { a: 3.3, b: 3.1, lb: 1.45, lbc: 1, y: 31.5 }); // guiño
      Object.assign(p.R, { a: 2.95, b: 5.1 });
      p.blink = 0; p.gaze = [-0.05, -0.2]; p.body.spin = 30; return p;
    } },
    escuchando: { fn(t, lt) {
      const p = pose(); p.body.stroke = 8.6; p.L.x = 25.9; p.R.x = 38.1; eyes(p, { a: 3.05, b: 5.3 });
      ambient(p, t, 0.8);
      const q = frac(lt / 1.8); p.body.ty += 0.9 * M() * Math.sin(Math.PI * clamp(q / 0.22, 0, 1));
      p.body.rot += 4; p.gaze = [0.12, 0.5]; p.follow = 1; return p;
    } },
    pensando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.7);
      p.body.ty -= 0.5; p.body.rot += -5 + 1.6 * M() * Math.sin(lt * 1.1); p.body.spin = 80;
      p.L.b = 4.2; p.L.lt = 0.14; p.R.b = 4.7;
      p.gaze = [0.5 + 0.14 * Math.cos(lt * 1.7), -0.66 + 0.12 * Math.sin(lt * 1.7)]; return p;
    } },
    escribiendo: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.5);
      const q = frac(lt / 1.25), line = Math.floor(lt / 1.25) % 4;
      p.gaze = [0.3 + 0.45 * Math.floor(q * 4) / 3, 0.35 + line * 0.14];
      eyes(p, { a: 2.6, b: 4.2, lt: 0.2 });
      p.body.ty -= 0.5 * M() * Math.abs(Math.sin(lt * 9)); p.body.rot += 3; p.body.spin = 20; return p;
    } },
    buscando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.4); const w = lt * 1.9, m = M();
      p.body.tx += 2.8 * m * Math.sin(w); p.body.rot += 7 * m * Math.sin(w - 0.5);
      p.gaze = [0.85 * Math.sin(w + 0.45), -0.12 + 0.22 * Math.sin(2 * w)];
      p.R.s = 1.3; p.L.lt = 0.24; p.body.spin = 30; return p;
    } },
    mirando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.5); const ph = frac(lt / 2.6); p.scan = ph;
      p.gaze = [Math.floor(ph * 5) % 2 ? 0.42 : -0.42, 0.5 + 0.5 * ph];
      eyes(p, { a: 2.8, b: 4.4, lt: 0.18 }); p.body.ty += 0.8; squash(p, 0.985); return p;
    } },
    revisando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.5); const ph = frac(lt / 2.8);
      p.gaze = ph > 0.74 ? [0.85, 0.65] : [-0.35 + 0.35 * Math.floor(frac(lt / 1.1) * 3), 0.9];
      eyes(p, { a: 2.8, b: 4.4, lt: 0.16 }); p.body.rot += 3; p.body.ty += 0.4; p.body.spin = 25; return p;
    } },
    preguntando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.6); p.body.rot += 11 + 2 * M() * Math.sin(lt * 2.3);
      p.L.a = 3.1; p.L.b = 4.8; p.R.a = 3; p.R.b = 4; p.R.lt = 0.26; p.gaze = [-0.1, -0.28]; return p;
    } },
    avisando: { fn(t, lt) {
      const p = pose(); ambient(p, t, 0.6);
      const ph = frac(lt / 2.4), h = ph < 0.5 ? hop(ph / 0.5, 2.6) : { y: 0, sy: 1 };
      p.body.ty += h.y; squash(p, h.sy);
      p.L.x = 26; p.R.x = 38; eyes(p, { a: 3.1, b: 5.4 });
      const s = smooth((ph - 0.52) / 0.12) - smooth((ph - 0.94) / 0.06);
      p.gaze = s > 0.5 ? [0.9, -0.35] : [-0.1, -0.15];
      p.body.rot += -2 + 8 * s * M(); p.body.spin = 40; return p;
    } },
    terminado: { replay: true, fn(t, lt) {
      const p = pose(); ambient(p, t, 0.6); const h = hop(lt / 1.05, 5);
      p.body.ty += h.y; squash(p, h.sy); p.body.ty += 0.35 * M() * Math.sin(lt * 3.2) * smooth(lt - 1.05);
      eyes(p, { a: 3.3, b: 3.1, lb: 1.45, lbc: 1, y: 31.5 }); p.blink = 0; p.gaze = [0, -0.3]; p.body.spin = 25; return p;
    } },
    publicado: { replay: true, fn(t, lt) {
      const p = pose(); ambient(p, t, 0.5); const ph = frac(lt / 1.9), h = hop(ph, 7.5);
      p.body.ty += h.y; squash(p, h.sy); p.L.x = 25.6; p.R.x = 38.4;
      eyes(p, { n: 0.62, a: 4.4, b: 4.4 }); p.L.r = 18 * Math.sin(lt * 3); p.R.r = -p.L.r;
      p.blink = 0; p.gaze = [0, -0.2]; p.body.spin = 220;
      if (ph > 0.56) { const q = clamp((ph - 0.56) / 0.36, 0, 1); p.burstS = 0.8 + 0.5 * (1 - Math.pow(1 - q, 3)); p.burstO = 1 - q; }
      return p;
    } },
    error: { replay: true, fn(t, lt) {
      const p = pose(); ambient(p, t, 0.4);
      p.body.tx += 2.4 * M() * Math.sin(lt * 44) * Math.exp(-lt * 5.5); p.body.ty += 0.8; squash(p, 0.97);
      eyes(p, { a: 2.8, b: 3.9, lt: 0.38 }); p.L.lts = -0.45; p.R.lts = 0.45;
      p.gaze = [0, 0.55]; p.body.desat = 0.6; p.body.spin = 0; return p;
    } },
    dormido: { fn(t) {
      const p = pose(); const br = Math.sin(t * 1.25);
      p.body.stroke = 12; p.body.ty += 0.8; p.body.rot += -7 + 1.2 * M() * br;
      squash(p, 1 + 0.03 * M() * br);
      eyes(p, { a: 3, b: 4.8, lt: 1.125, ltc: -0.375, lb: 0.625, lbc: -0.375, y: 33 }); // ‿ ‿
      p.blink = 0; p.gaze = [0, 0.2]; p.body.spin = 0; return p;
    } },
  };

  /* ───────── el ojo ───────── */
  const N = 72;
  function eyePath(e, cx, cy, sc, blink) {
    const a = e.a * e.s * sc, b = e.b * e.s * sc;
    if (a < 0.06 || b < 0.06) return "";
    const k = 2 / Math.max(e.n, 0.3);
    const cr = Math.cos(e.r * Math.PI / 180), sr = Math.sin(e.r * Math.PI / 180);
    const open = 1 - clamp(blink, 0, 0.96);
    let d = "";
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU, c = Math.cos(th), s = Math.sin(th);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), k);
      let y = b * Math.sign(s) * Math.pow(Math.abs(s), k);
      const u = x / a;
      const top = b * (-(1 - e.lt) + e.lts * u + e.ltc * u * u);
      const bot = b * ((1 - e.lb) + e.lbc * u * u);
      y = top <= bot ? clamp(y, top, bot) : (top + bot) / 2;
      y *= open;
      const X = cx + x * cr - y * sr, Y = cy + x * sr + y * cr;
      d += (i ? "L" : "M") + X.toFixed(2) + " " + Y.toFixed(2);
    }
    return d + "Z";
  }

  const lerpObj = (a, b, t) => {
    const o = Array.isArray(b) ? [] : {};
    for (const k in b) o[k] = typeof b[k] === "number" ? lerp(a && a[k] != null ? a[k] : b[k], b[k], t) : lerpObj(a ? a[k] : null, b[k], t);
    return o;
  };
  const HOT = [[255, 126, 85], [255, 90, 54], [229, 57, 26]];
  const GRAY = [[185, 173, 168], [160, 147, 142], [135, 122, 117]];

  /* ───────── el dibujo ───────── */
  // Modo compacto: cada accesorio se encoge hacia una esquina del anillo [x, y, escala]
  const COMPACT = {
    pensando: [50, 12, 0.55], escuchando: [59, 32, 0.6], escribiendo: [56, 44, 0.5],
    saludando: [50, 6, 0.7], avisando: [58, 18, 0.5],
  };
  const STOPS = '<stop offset="0" stop-color="#FF7E55"/><stop offset=".52" stop-color="#FF5A36"/><stop offset="1" stop-color="#E5391A"/>';
  const STAR = "M0 -3.4Q.5 -.5 3.4 0Q.5 .5 0 3.4Q-.5 .5 -3.4 0Q-.5 -.5 0 -3.4Z";
  function rays() {
    let s = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 + 22.5) * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
      s += `<line x1="${(32 + 33 * c).toFixed(2)}" y1="${(32 + 33 * n).toFixed(2)}" x2="${(32 + 38.5 * c).toFixed(2)}" y2="${(32 + 38.5 * n).toFixed(2)}"/>`;
    }
    return s;
  }
  function template(u, mode) {
    const C = mode === "compact";
    const fit = (p) => {
      const f = C && COMPACT[p];
      return f ? ` class="fit" transform="translate(${f[0]} ${f[1]}) scale(${f[2]}) translate(${-f[0]} ${-f[1]})"` : "";
    };
    const mini = C ? "translate(67 24) scale(.85)" : "translate(60 61)";
    return `
<svg class="len" viewBox="0 0 64 64" overflow="visible" aria-hidden="true" data-props="${mode}" style="--len-grad:url(#lg-${u})">
  <defs>
    <linearGradient id="lg-${u}" gradientUnits="userSpaceOnUse" x1="14" y1="11" x2="52" y2="55">${STOPS}</linearGradient>
    <linearGradient id="lm-${u}" x1=".2" y1=".15" x2=".8" y2=".85">${STOPS}</linearGradient>
    <linearGradient id="ls-${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF5A36" stop-opacity="0"/><stop offset="1" stop-color="#FF5A36" stop-opacity=".35"/>
    </linearGradient>
    <clipPath id="face-${u}"><circle class="clip" cx="32" cy="32" r="17"/></clipPath>
    <clipPath id="scr-${u}"><rect x="12" y="64" width="40" height="24" rx="3"/></clipPath>
  </defs>

  <g class="prop below" data-p="mirando">
    <rect class="card" x="12" y="64" width="40" height="24" rx="3"/>
    <rect class="fill2" x="16" y="68" width="13" height="2.4" rx="1.2"/>
    <rect class="fill2" x="16" y="73" width="32" height="7" rx="1.6"/>
    <rect class="fill2" x="16" y="82.5" width="15" height="2.6" rx="1.2"/>
    <rect class="fill2" x="33" y="82.5" width="15" height="2.6" rx="1.2"/>
    <g clip-path="url(#scr-${u})"><g class="scan">
      <rect x="12" y="58" width="40" height="6" fill="url(#ls-${u})"/>
      <rect x="12" y="63.4" width="40" height="1.2" fill="#FF5A36"/>
    </g></g>
  </g>

  <g class="prop" data-p="escribiendo"><g${fit("escribiendo")}>
    <rect class="card" x="55" y="42" width="22" height="26" rx="3.2"/>
    <rect class="wl" x="59" y="48" width="14" height="1.9" rx=".95"/>
    <rect class="wl" x="59" y="52.8" width="10" height="1.9" rx=".95" style="animation-delay:.55s"/>
    <rect class="wl" x="59" y="57.6" width="13" height="1.9" rx=".95" style="animation-delay:1.1s"/>
    <rect class="wl hot" x="59" y="62.4" width="7" height="1.9" rx=".95" style="animation-delay:1.65s"/>
  </g></g>

  <g class="body">
    <g class="prop" data-p="buscando">
      <line class="handle" x1="50.5" y1="50.5" x2="60" y2="60" stroke="url(#lg-${u})" stroke-width="6.4" stroke-linecap="round" pathLength="1"/>
    </g>
    <circle class="glass" cx="32" cy="32" r="17"/>
    <circle class="ring" cx="32" cy="32" r="22" fill="none" stroke="url(#lg-${u})" stroke-width="10"/>
    <g clip-path="url(#face-${u})"><path class="eye eye-l"/><path class="eye eye-r"/></g>
    <g class="prop" data-p="error"><g transform="translate(56 10)">
      <path class="drop" d="M0 -3.4C1.5 -1.2 2.6 .3 2.6 1.5A2.6 2.6 0 0 1 -2.6 1.5C-2.6 .3 -1.5 -1.2 0 -3.4Z"/>
    </g></g>
  </g>

  <g class="prop" data-p="pensando"><g${fit("pensando")}>
    <g class="bub"><circle class="bl" cx="53.5" cy="12.5" r="2.1"/><circle class="bf" cx="53.5" cy="12.5" r="1.4"/></g>
    <g class="bub b2"><circle class="bl" cx="58.5" cy="5.5" r="3"/><circle class="bf" cx="58.5" cy="5.5" r="2.2"/></g>
    <g class="bub b3">
      <circle class="bl" cx="64" cy="-5" r="5.4"/><circle class="bl" cx="69.5" cy="-10.5" r="6.6"/>
      <circle class="bl" cx="77" cy="-10" r="6.2"/><circle class="bl" cx="82" cy="-4.5" r="5.2"/>
      <rect class="bl" x="63.2" y="-7.8" width="19.6" height="8.6" rx="4.3"/>
      <circle class="bf" cx="64" cy="-5" r="4.6"/><circle class="bf" cx="69.5" cy="-10.5" r="5.8"/>
      <circle class="bf" cx="77" cy="-10" r="5.4"/><circle class="bf" cx="82" cy="-4.5" r="4.4"/>
      <rect class="bf" x="64" y="-7" width="18" height="7" rx="3.5"/>
      <circle class="dot" cx="67.5" cy="-5.6" r="1.35"/><circle class="dot d2" cx="73" cy="-5.6" r="1.35"/><circle class="dot d3" cx="78.5" cy="-5.6" r="1.35"/>
    </g>
  </g></g>

  <g class="prop" data-p="escuchando"><g${fit("escuchando")}>
    <path class="wave" d="M62.5 26Q65.5 32 62.5 38"/>
    <path class="wave w2" d="M67 21.5Q72 32 67 42.5"/>
  </g></g>

  <g class="prop" data-p="preguntando"><text class="q" x="54" y="10">?</text></g>

  <g class="prop" data-p="saludando"><g${fit("saludando")}>
    <rect class="hola-b" x="46" y="-14" width="30" height="13" rx="6.5"/>
    <path class="hola-b" d="M51.5 -1.8L49 4L57.5 -1.8Z"/>
    <text class="hola-t" x="61" y="-5.3" text-anchor="middle">¡Hola!</text>
  </g></g>

  <g class="prop" data-p="dormido">
    <text class="zz" x="52" y="12">z</text>
    <text class="zz z2" x="56" y="8">z</text>
    <text class="zz z3" x="60" y="4">Z</text>
  </g>

  <g class="prop" data-p="revisando">
    <g class="below">
      <rect class="card" x="16" y="64" width="30" height="21" rx="3"/>
      <rect class="fill2" x="20" y="68.5" width="16" height="2" rx="1"/>
      <rect class="fill2" x="20" y="73.5" width="19" height="2" rx="1"/>
      <rect class="fill2" x="20" y="78.5" width="13" height="2" rx="1"/>
      <circle class="tick" cx="41.5" cy="69.5" r="1.6"/>
      <circle class="tick k2" cx="41.5" cy="74.5" r="1.6"/>
      <circle class="tick k3" cx="41.5" cy="79.5" r="1.6"/>
    </g>
    <g class="fit" transform="${mini}"><g class="mini">
      <circle class="mini-glass" r="4.9"/>
      <circle class="mini-ring" r="6.4" stroke="url(#lm-${u})"/>
      <g class="mini-eyes">
        <ellipse class="mini-eye" cx="-1.7" cy=".2" rx=".8" ry="1.35"/>
        <ellipse class="mini-eye" cx="1.7" cy=".2" rx=".8" ry="1.35"/>
      </g>
    </g></g>
  </g>

  <g class="prop" data-p="avisando"><g${fit("avisando")}>
    <rect class="card" x="60" y="16" width="30" height="24" rx="3.4"/>
    <rect class="fill2" x="64" y="21" width="16" height="2.4" rx="1.2"/>
    <rect class="fill2" x="64" y="26" width="22" height="1.8" rx=".9"/>
    <rect x="64" y="31.5" width="9.5" height="4.6" rx="2.3" fill="#FF5A36"/>
    <rect class="pill-no" x="75.5" y="31.5" width="9.5" height="4.6" rx="2.3"/>
    <g transform="translate(90 16)"><g class="badge2">
      <circle r="3.6" fill="#FF5A36"/><text class="badge-t" y="1.55" text-anchor="middle">1</text>
    </g></g>
  </g></g>

  <g class="prop" data-p="terminado">
    <g class="conf">
      <circle cx="32" cy="6" r="1.4" fill="var(--gold,#FFB547)" style="--dx:-16px;--dy:-9px;--d:.18s"/>
      <rect x="31" y="5" width="2.6" height="1.4" rx=".4" fill="#FF5A36" style="--dx:14px;--dy:-12px;--d:.22s"/>
      <circle cx="32" cy="6" r="1.1" fill="var(--ok,#1FA967)" style="--dx:-6px;--dy:-16px;--d:.26s"/>
      <rect x="31" y="5" width="2.2" height="1.3" rx=".4" fill="var(--gold,#FFB547)" style="--dx:22px;--dy:-2px;--d:.2s"/>
      <circle cx="32" cy="6" r="1.2" fill="#FF5A36" style="--dx:-22px;--dy:2px;--d:.24s"/>
    </g>
    <g class="badge"><circle cx="55" cy="9" r="7" fill="var(--ok,#1FA967)"/><path class="chk" d="M51.6 9.2L54 11.6L58.4 6.6" pathLength="1"/></g>
  </g>

  <g class="prop" data-p="publicado">
    <g class="rays fit" opacity="0">${rays()}</g>
    <g transform="translate(3 4)"><path class="tw" d="${STAR}"/></g>
    <g transform="translate(62 1)"><path class="tw t2" d="${STAR}"/></g>
    <g transform="translate(65 46)"><path class="tw t3" d="${STAR}"/></g>
    <g transform="translate(-1 50)"><path class="tw t4" d="${STAR}"/></g>
  </g>
</svg>`;
  }

  /* ───────── estilos (se inyectan una vez) ───────── */
  const CSS = `
.len{width:100%;height:100%;display:block;overflow:visible}
.len .glass{fill:var(--glass,#FFF1EA)}
.len .eye{fill:var(--eye,#2A1A13)}
[data-eyes="coral"] .len .eye{fill:var(--len-grad)}
.len .card{fill:var(--card,#fff);stroke:var(--card-line,#E3D6D0);stroke-width:.7}
.len .fill2{fill:var(--fill-2,#EBDFD9)}
.len .prop{display:none}
.len .prop.on,.len .prop.off{display:inline}
.len .prop.on{animation:lcPropIn .42s cubic-bezier(.34,1.56,.64,1) both}
.len .prop.off{animation:lcPropOut .2s ease both}
.len .prop,.len .prop *{transform-box:fill-box;transform-origin:center}
.len .prop .fit{transform-box:view-box;transform-origin:0 0}
@keyframes lcPropIn{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:none}}
@keyframes lcPropOut{to{opacity:0;transform:scale(.8)}}
.len[data-props="none"] .prop{display:none!important}
.len[data-props="compact"] .below{display:none!important}

.len .bl{fill:var(--card-line,#E3D6D0)} .len .bf{fill:var(--card,#fff)}
.len .prop.on .bub{animation:lcPop .32s cubic-bezier(.34,1.56,.64,1) both}
.len .prop.on .b2{animation-delay:.1s} .len .prop.on .b3{animation-delay:.2s}
@keyframes lcPop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}
.len .dot{fill:var(--muted,#7B6B64);animation:lcDot 1.1s ease-in-out infinite}
.len .dot.d2{animation-delay:.15s} .len .dot.d3{animation-delay:.3s}
@keyframes lcDot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-1.6px);opacity:1}}

.len .wave{fill:none;stroke:#FF5A36;stroke-width:2;stroke-linecap:round;animation:lcWave 1.5s ease-in-out infinite}
.len .wave.w2{animation-delay:.22s}
@keyframes lcWave{0%{opacity:0;transform:translateX(-1.5px)}35%{opacity:1}100%{opacity:0;transform:translateX(2px)}}

.len .wl{fill:var(--fill-2,#EBDFD9);transform-origin:0 50%;animation:lcWrite 3.2s cubic-bezier(.4,0,.2,1) infinite}
.len .wl.hot{fill:#FF5A36}
@keyframes lcWrite{0%{transform:scaleX(0);opacity:1}18%{transform:scaleX(1)}86%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1)}}

.len .handle{stroke-dasharray:1;stroke-dashoffset:0}
.len .prop.on .handle{animation:lcDraw .34s .06s cubic-bezier(.3,.7,.3,1) both}
@keyframes lcDraw{from{stroke-dashoffset:1}}

.len .q{font:800 17px ui-sans-serif,system-ui,sans-serif;fill:#FF5A36;transform-origin:50% 100%;animation:lcQ 1.4s ease-in-out infinite alternate}
@keyframes lcQ{from{transform:translateY(0) rotate(-9deg)}to{transform:translateY(-1.6px) rotate(9deg)}}

.len .chk{fill:none;stroke:#fff;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0}
.len .prop.on .chk{animation:lcDraw .34s .28s cubic-bezier(.3,.7,.3,1) both}
.len .prop.on .badge{animation:lcPop .4s .12s cubic-bezier(.34,1.56,.64,1) both}
.len .conf>*{opacity:0}
.len .prop.on .conf>*{animation:lcConf .95s var(--d,0s) cubic-bezier(.2,.7,.3,1) both}
@keyframes lcConf{from{opacity:1;transform:translate(0,0) scale(.4)}70%{opacity:1}to{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(220deg) scale(1)}}

.len .rays line{stroke:#FF5A36;stroke-width:2.2;stroke-linecap:round}
.len .tw{fill:var(--gold,#FFB547);animation:lcTw 1.3s ease-in-out infinite}
.len .tw.t2{animation-delay:.35s} .len .tw.t3{animation-delay:.7s} .len .tw.t4{animation-delay:1s}
@keyframes lcTw{0%,100%{transform:scale(0) rotate(0);opacity:0}45%{transform:scale(1) rotate(45deg);opacity:1}}

.len .drop{fill:var(--drop,#5DB2FF);animation:lcSweat 2.3s ease-in infinite}
@keyframes lcSweat{0%{transform:translateY(-1px);opacity:0}15%{opacity:1}80%{transform:translateY(6px);opacity:.9}100%{transform:translateY(8px);opacity:0}}

.len .hola-b{fill:var(--ink,#1E1612)}
.len .hola-t{font:700 6.2px ui-sans-serif,system-ui,sans-serif;fill:var(--bg,#F7F3F1)}

.len .zz{font:800 7px ui-sans-serif,system-ui,sans-serif;fill:var(--muted,#7B6B64);opacity:.8;animation:lcZz 2.6s ease-out infinite backwards}
.len .zz.z2{animation-delay:.85s;font-size:8.5px} .len .zz.z3{animation-delay:1.7s;font-size:10px}
@keyframes lcZz{0%{opacity:0;transform:translate(0,0) scale(.6)}20%{opacity:1}100%{opacity:0;transform:translate(5px,-12px) scale(1.1)}}

.len .mini-ring{fill:none;stroke-width:3.4}
.len .mini-glass{fill:var(--glass,#FFF1EA)}
.len .mini-eyes{animation:lcMscan 2.4s ease-in-out infinite}
.len .mini-eye{fill:var(--eye,#2A1A13);animation:lcMblink 3.3s infinite}
@keyframes lcMscan{0%,100%{transform:translate(-1.1px,.7px)}50%{transform:translate(.4px,.9px)}}
@keyframes lcMblink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.len .prop.on .mini{animation:lcPop .45s .2s cubic-bezier(.34,1.56,.64,1) both}
.len .tick{fill:var(--ok,#1FA967);animation:lcTick 2.6s infinite backwards}
.len .tick.k2{animation-delay:.6s} .len .tick.k3{animation-delay:1.2s}
@keyframes lcTick{0%{opacity:0;transform:scale(0)}12%{opacity:1;transform:scale(1.25)}20%{transform:scale(1)}85%{opacity:1}100%{opacity:0}}

.len .pill-no{fill:none;stroke:var(--card-line,#E3D6D0);stroke-width:.7}
.len .badge-t{font:800 4.4px ui-sans-serif,system-ui,sans-serif;fill:#fff}
.len .badge2{animation:lcPing 1.6s ease-in-out infinite}
@keyframes lcPing{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}

.len-reduced .len .prop,.len-reduced .len .prop *{animation:none!important}
`;
  function injectCSS() {
    if (document.getElementById("len-cara-css")) return;
    const s = document.createElement("style");
    s.id = "len-cara-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ───────── una cara ───────── */
  const mouse = { x: 0, y: 0, t: -1e9 };
  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); });

  const ALL = [];
  let UID = 0;

  class Cara {
    constructor(host, opts = {}) {
      injectCSS();
      const u = "c" + (++UID);
      this.host = host;
      this.onchange = null; // el estado inicial no se anuncia: la página aún se está montando
      host.innerHTML = template(u, opts.props || "all");
      const q = (s) => host.querySelector(s);
      this.svg = q("svg"); this.body = q(".body"); this.ring = q(".ring"); this.glass = q(".glass");
      this.clip = q(".clip"); this.eyeL = q(".eye-l"); this.eyeR = q(".eye-r");
      this.scan = q(".scan"); this.rays = q(".rays");
      this.grad = q(`#lg-${u}`); this.stops = [...this.grad.querySelectorAll("stop")];
      this.props = [...host.querySelectorAll(".prop")];
      this.g = [0, 0];
      this.state = null; this.enter = 0; this.t0 = -9; this.from = null; this.P = null; this.target = null;
      this.transP = 1; this.transBlink = 0;
      this.blinkNext = T + rand(0.8, 2.5); this.blinkStart = -9; this.blinkV = 0;
      this.gradA = 0; this.desat = -1; this.ctx = { nextGlance: 0, glance: [0, 0] };
      this.pokeAt = -9;
      this.set(opts.state || "reposo");
      this.update(0); this.render(0);
      this.onchange = opts.onchange || null;
      ALL.push(this);
    }
    poke() {
      if (this.state === "dormido") { this.set("reposo"); return; }
      this.pokeAt = T;
    }
    set(name) {
      if (!ST[name]) return;
      if (name === this.state && !ST[name].replay) return;
      this.from = this.P ? JSON.parse(JSON.stringify(this.P)) : null;
      this.state = name; this.enter = T; this.t0 = T;
      this.showProp(name);
      if (this.onchange) this.onchange(name);
    }
    update(dt) {
      const lt = T - this.enter;
      const tgt = ST[this.state].fn(T, lt, this.ctx);
      this.target = tgt;
      const raw = this.from ? clamp((T - this.t0) / 0.46, 0, 1) : 1;
      this.P = raw < 1 ? lerpObj(this.from, tgt, EASE(raw)) : tgt;
      if (raw >= 1) this.from = null;
      // cosquillas: por encima de cualquier estado
      const pq = (T - this.pokeAt) / 0.9;
      if (pq >= 0 && pq < 1) {
        const P = this.P, h = pq < 0.15 ? smooth(pq / 0.15) : 1 - smooth((pq - 0.55) / 0.45);
        for (const e of [P.L, P.R]) {
          e.a = lerp(e.a, 3.3, h); e.b = lerp(e.b, 3.1, h); e.n = lerp(e.n, 2.2, h); e.s = lerp(e.s, 1, h);
          e.lt = lerp(e.lt, 0, h); e.lts = lerp(e.lts, 0, h); e.ltc = lerp(e.ltc, 0, h);
          e.lb = lerp(e.lb, 1.45, h); e.lbc = lerp(e.lbc, 1, h);
        }
        const sq = REDUCED ? 0 : Math.sin(Math.PI * clamp(pq / 0.35, 0, 1)) * (1 - pq);
        P.body.sy *= 1 - 0.16 * sq; P.body.sx *= 1 + 0.12 * sq;
        P.blink *= 1 - h;
      }
      this.transP = raw;
      this.transBlink = raw < 1 ? Math.pow(Math.sin(Math.PI * raw), 10) * 0.6 : 0;
      this.gradA = (this.gradA + this.P.body.spin * dt) % 360;
      if (T >= this.blinkNext) {
        this.blinkStart = T;
        this.blinkNext = T + (Math.random() < 0.18 ? 0.3 : rand(2.4, 5.8));
      }
      const q = (T - this.blinkStart) / 0.18;
      this.blinkV = q >= 0 && q <= 1 ? (q < 0.42 ? smooth(q / 0.42) : 1 - smooth((q - 0.42) / 0.58)) : 0;
    }
    showProp(name) {
      for (const g of this.props) {
        clearTimeout(g._t);
        if (g.dataset.p === name) {
          g.classList.remove("on", "off");
          this.svg.getBoundingClientRect(); // reinicia sus animaciones CSS
          g.classList.add("on");
        } else if (g.classList.contains("on")) {
          g.classList.remove("on"); g.classList.add("off");
          g._t = setTimeout(() => g.classList.remove("off"), 220);
        } else g.classList.remove("off");
      }
      applyRate(this.svg);
    }
    mouseGaze() {
      const r = this.svg.getBoundingClientRect();
      const dx = mouse.x - (r.left + r.width / 2), dy = mouse.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / Math.max(120, r.width * 1.4));
      return [(dx / d) * m, (dy / d) * m * 0.9];
    }
    render(dt) {
      const P = this.P, b = P.body, tg = this.target;
      let goal = P.gaze;
      if (tg.follow > 0.5 && performance.now() - mouse.t < 2500) goal = this.mouseGaze();
      const k = 1 - Math.exp(-dt * 15);
      this.g[0] += (goal[0] - this.g[0]) * k; this.g[1] += (goal[1] - this.g[1]) * k;

      const inner = 27 - b.stroke;
      this.ring.setAttribute("r", (27 - b.stroke / 2).toFixed(3));
      this.ring.setAttribute("stroke-width", b.stroke.toFixed(3));
      this.glass.setAttribute("r", (inner + 0.5).toFixed(3));
      this.glass.style.opacity = b.glass.toFixed(3);
      this.clip.setAttribute("r", (inner + 0.2).toFixed(3));
      this.body.setAttribute("transform",
        `translate(${b.tx.toFixed(3)} ${b.ty.toFixed(3)}) rotate(${b.rot.toFixed(3)} 32 32) translate(32 59) scale(${b.sx.toFixed(4)} ${b.sy.toFixed(4)}) translate(-32 -59)`);

      const rx = Math.max(0, inner - 9.4), ry = Math.max(0, inner - 6.6);
      let g0 = this.g[0], g1 = this.g[1]; const m = Math.hypot(g0, g1); if (m > 1) { g0 /= m; g1 /= m; }
      const gx = g0 * rx, gy = g1 * ry, spread = 1 - 0.1 * Math.abs(g0);
      const ov = 1 + 0.05 * Math.sin(Math.PI * this.transP);
      const bl = Math.max(this.blinkV * clamp(P.blink, 0, 1), this.transBlink);
      this.eyeL.setAttribute("d", eyePath(P.L, 32 + (P.L.x - 32) * spread + gx, P.L.y + gy, ov * (1 + 0.06 * g0), bl));
      this.eyeR.setAttribute("d", eyePath(P.R, 32 + (P.R.x - 32) * spread + gx, P.R.y + gy, ov * (1 - 0.06 * g0), bl));

      this.grad.setAttribute("gradientTransform", `rotate(${this.gradA.toFixed(2)} 32 32)`);
      if (Math.abs(b.desat - this.desat) >= 0.002) {
        this.desat = b.desat;
        this.stops.forEach((s, i) => {
          const c = HOT[i].map((v, j) => Math.round(lerp(v, GRAY[i][j], b.desat)));
          s.setAttribute("stop-color", `rgb(${c})`);
        });
      }
      if (this.state === "mirando") this.scan.setAttribute("transform", `translate(0 ${(tg.scan * 24).toFixed(2)})`);
      if (this.state === "publicado") {
        this.rays.setAttribute("transform", `translate(32 32) scale(${tg.burstS.toFixed(3)}) translate(-32 -32)`);
        this.rays.setAttribute("opacity", tg.burstO.toFixed(3));
      }
    }
  }

  function applyRate(root) {
    requestAnimationFrame(() => {
      if (root.getAnimations) root.getAnimations({ subtree: true }).forEach((a) => (a.playbackRate = SPEED));
    });
  }

  /* ───────── bucle único ───────── */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * SPEED; last = now; T += dt;
    for (const c of ALL) {
      if (!c.host.isConnected) continue;
      c.update(dt); c.render(dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const setReducedClass = () => document.documentElement.classList.toggle("len-reduced", REDUCED);
  setReducedClass();

  window.LenCara = {
    create: (host, opts) => new Cara(host, opts),
    STATES: Object.keys(ST),
    get speed() { return SPEED; },
    get reduced() { return REDUCED; },
    setSpeed(x) { SPEED = x; applyRate(document.body); },
    setReduced(v) { REDUCED = !!v; setReducedClass(); },
  };
})();
