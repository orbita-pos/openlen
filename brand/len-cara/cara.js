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

   look: lo que Len lleva puesto, aparte del estado — { cabeza, cara }.
     c.setLook({ cabeza: "chef", cara: "lentes" }) · LenCara.HEAD / FACE (id → nombre)
     LenCara.icon(cabeza, cara) → un SVG quieto, para los botones de elegir.
   Va dentro del cuerpo: salta, se aplasta y gira con él. Lo de la cara sigue la
   mirada (está EN la cara); lo de la cabeza se queda un poco atrás en los saltos.

   Cuerpo blando (Jesús, 2026-10-01, elegido en una maqueta): respira en reposo
   y cada salto o toque acaba en un rebote de gelatina. Se probaron también
   boca, brillo en los ojos y orejitas, y los descartó: sin boca se ve más bot.
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
    // respira: se estira un poco hacia arriba y vuelve (el cuerpo blando)
    const br = Math.sin(TAU * t / 3.4);
    p.body.sy *= 1 + k * 0.018 * br; p.body.sx *= 1 - k * 0.014 * br;
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
  /* ───────── el look: lo que se pone ─────────
     En el espacio del anillo: centro (32,32), borde de fuera r=27 SIEMPRE (el
     grosor cambia hacia dentro), así que la coronilla está en y=5 en todos los
     estados. slot: "head" encima del anillo · "back" detrás (las orejas asoman
     por fuera) · "face" delante de los ojos · "face-back" detrás de los ojos. */
  let LKN = 0;
  // luz arriba a la izquierda: cada pieza lleva su brillo y su sombra, y los
  // sombreros una sombra de contacto (el filtro) que los asienta en la cabeza
  const HI = (d, w = 1.6, o = 0.3) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${o}" stroke-width="${w}" stroke-linecap="round"/>`;
  const PUFF = "M21.4 3.5C14.2 2.6 12.8-8 19.8-9.6C20.4-16.4 28.4-18 32-12.8C35.6-18 43.6-16.4 44.2-9.6C51.2-8 49.8 2.6 42.6 3.5Z";
  const HORN = `<path d="M16.6 6.2C10.6 5 5.4.6 3.6-7.8C3.2-9.8 2.2-12 .6-13.2C4.8-12.8 8.4-9.6 10.4-5.6C12-2.4 14.6-.4 18 .6Z" fill="#F4E6CC"/>
      <path d="M6.6-5.6L9.4-7.2M8.8-2.6L11.8-3.8M11.8.2L14.6-1" stroke="#D5BE96" stroke-width="1" stroke-linecap="round"/>`;
  const HEAD = {
    chef: { name: "Gorro de chef", svg: (k) => `<g transform="rotate(-6 32 8)">
      <clipPath id="cf-${k}"><path d="${PUFF}"/></clipPath>
      <path class="lk-wf" d="${PUFF}"/>
      <rect class="lk-wsh" clip-path="url(#cf-${k})" x="10" y="-1.4" width="44" height="6"/>
      <path class="lk-wo" d="${PUFF}"/>
      <path class="lk-wl" d="M26.5-4.8V2.4M32-6.4V2.4M37.5-4.8V2.4"/>
      <rect class="lk-wf lk-wo" x="20" y="2.2" width="24" height="7.6" rx="2.4"/>
      <rect class="lk-wsh" x="21" y="6.8" width="22" height="2.2" rx="1.1"/></g>` },
    vaquero: { name: "Sombrero", svg: () => `<g transform="rotate(-9 32 8)">
      <path d="M19.8 10.5C18.8-1 19.8-9.4 25.2-10.6C28.6-8.6 35.4-8.6 38.8-10.6C44.2-9.4 45.2-1 44.2 10.5Z" fill="#A86A3A"/>
      <path d="M38.6-10C43.2-8.4 44.8-1.4 44 8.5H40.6C41.2-1 40.8-6.4 38.6-10Z" fill="#8C5530"/>
      ${HI("M22.4 6.5C21.9-.6 22.4-6.4 25-9", 1.8, 0.22)}
      <path d="M27.6-9.4C29.8-6 34.2-6 36.4-9.4" fill="none" stroke="#7A4524" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M19.5 1.6C27 3.3 37 3.3 44.5 1.6L44.4 5.4C37 7 27 7 19.6 5.4Z" fill="#3E2412"/>
      <circle cx="39.4" cy="4.3" r="1.3" fill="#FFC53D"/>
      <path d="M3.5 1C8 7.6 19 10 32 10C45 10 56 7.6 60.5 1C59.5 7.6 49 13.2 32 13.2C15 13.2 4.5 7.6 3.5 1Z" fill="#86502A"/>
      ${HI("M7.4 5.2C13 8.6 21 10 30 10.1", 1, 0.2)}</g>` },
    gorra: { name: "Gorra", svg: () => `<g transform="rotate(-4 32 10)">
      <path d="M42 10.4C49.5 8.4 59 8.8 65 12.4C63.8 14.6 56.6 15.2 49.6 14.4C45.6 14 42.8 12.9 42 10.4Z" fill="#E0508A"/>
      <path d="M44 12.6C50 13.6 58 13.6 63.6 13.4C61 14.8 55.4 15 49.6 14.4C47.2 14.1 45.3 13.5 44 12.6Z" fill="#B93A6E"/>
      <path d="M15.2 11.8C14.2-1.2 22-4.6 32-4.6C42-4.6 49.8-1.2 48.8 11.8C38 9.6 26 9.6 15.2 11.8Z" fill="#FF6FA5"/>
      <path d="M41-3.4C46.4-1 49.4 3.6 48.8 11.8C46.8 11.4 44.8 11 42.8 10.8C43.4 4.6 42.8.2 41-3.4Z" fill="#EC5C98"/>
      <path d="M32-4.4C30.2 1 29.6 6 30 9.6" fill="none" stroke="#E0508A" stroke-width=".9"/>
      ${HI("M18.2 1.4C19.2-1.4 21.8-3 25-3.7", 1.5, 0.4)}
      <circle cx="23.4" cy="5.4" r="2.2" fill="none" stroke="#fff" stroke-width="1.4"/>
      <path d="M15.2 11.8C26 9.6 38 9.6 48.8 11.8" fill="none" stroke="#C94579" stroke-width="1.2"/>
      <circle cx="32" cy="-4.6" r="1.9" fill="#E0508A"/></g>` },
    lana: { name: "Gorro de lana", svg: () => `<g>
      <g fill="#FF7FB0"><circle cx="32" cy="-9.4" r="4.4"/><circle cx="28.8" cy="-10.6" r="2.3"/><circle cx="35.2" cy="-10.8" r="2.3"/><circle cx="32" cy="-13.2" r="2.4"/></g>
      <circle cx="30.2" cy="-11.8" r="1.3" fill="#fff" opacity=".45"/>
      <path d="M13.4 12C12.2-2.4 21.8-7.6 32-7.6C42.2-7.6 51.8-2.4 50.6 12Z" fill="#FFD24D"/>
      <path d="M42.4-5.2C48.4-2 51.4 3.6 50.6 12H45.8C46.4 4.6 45.2-1.6 42.4-5.2Z" fill="#F7C336"/>
      <path d="M14.6 1.8C26-.8 38-.8 49.4 1.8" fill="none" stroke="#FF7FB0" stroke-width="2.6"/>
      <path d="M17.2-2.4C26-4.4 38-4.4 46.8-2.4" fill="none" stroke="#fff" stroke-width="1.2" stroke-opacity=".85"/>
      <path d="M11.6 8.4C25 5.4 39 5.4 52.4 8.4L52.8 15.2C39 12.4 25 12.4 11.2 15.2Z" fill="#F6B92B"/>
      <path d="M16 7.6V13.8M20.5 6.9V13.1M25 6.4V12.6M29.5 6.2V12.4M34.5 6.2V12.4M39 6.4V12.6M43.5 6.9V13.1M48 7.6V13.8" stroke="#DF9A14" stroke-width=".9" stroke-linecap="round"/></g>` },
    boina: { name: "Boina", svg: () => `<g transform="rotate(-12 30 7)">
      <path d="M30-3.2C30.2-6 31.6-7.2 33.6-7.4" fill="none" stroke="#C93A43" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="30" cy="3.6" rx="19.5" ry="7.4" fill="#E5484D"/>
      <path d="M40.6-2.8C46.6-1 49.8 1.8 49.4 4.8C48.8 8 42.8 10.4 34.4 11C40.8 8.4 43.4 3.2 40.6-2.8Z" fill="#CC3942"/>
      <path d="M13.6 7.6C22 11.4 38 11.4 46.4 7.6" fill="none" stroke="#B02E37" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="23" cy=".6" rx="7.5" ry="2.3" fill="#fff" opacity=".24"/></g>` },
    fiesta: { name: "Gorro de fiesta", svg: (k) => `<g transform="rotate(16 38 7)">
      <clipPath id="fz-${k}"><path d="M29.5 7.5L38-18L46.5 7.5Z"/></clipPath>
      <path d="M29.5 7.5L38-18L46.5 7.5Z" fill="#FFD24D"/>
      <path clip-path="url(#fz-${k})" d="M24 2L52-8M24-6L52-16M24 10L52 0" stroke="#FF6FA5" stroke-width="3.2"/>
      <path clip-path="url(#fz-${k})" d="M41-18L50 8H43.4Z" fill="#E8A91A" opacity=".35"/>
      <circle cx="35.4" cy="-3.2" r=".85" fill="#5DB2FF"/><circle cx="40.6" cy="-8.6" r=".75" fill="#fff"/><circle cx="41.4" cy="1.6" r=".85" fill="#fff"/><circle cx="36.8" cy="-11" r=".7" fill="#5DB2FF"/>
      <rect x="28.6" y="5.4" width="18.8" height="3.6" rx="1.8" fill="#fff"/>
      <g fill="#FF6FA5"><circle cx="38" cy="-18.6" r="2.6"/><circle cx="36.2" cy="-19.8" r="1.6"/><circle cx="39.8" cy="-19.8" r="1.6"/><circle cx="38" cy="-21" r="1.6"/></g></g>` },
    corona: { name: "Corona", svg: () => `<g transform="rotate(-10 32 8)">
      <path d="M20.2 9.5L19.2-2.6L25.8 2.6L32-7L38.2 2.6L44.8-2.6L43.8 9.5Z" fill="#FFC53D" stroke="#DB930E" stroke-width=".9" stroke-linejoin="round"/>
      <path d="M21 8.6L20.4.2L24.4 3.6ZM32-5.2L27.4 2.2L32 1.4Z" fill="#FFE39A"/>
      <path d="M38.8 3.4L43.8-.6L43 8.6Z" fill="#E9A51C"/>
      <rect x="20" y="5.6" width="24" height="3.9" rx="1" fill="#F2AA1C"/>
      <circle cx="32" cy="7.55" r="1.35" fill="#FF4F8B"/><circle cx="25.6" cy="7.55" r="1" fill="#5DB2FF"/><circle cx="38.4" cy="7.55" r="1" fill="#5DB2FF"/>
      <circle cx="19.2" cy="-2.9" r="1.5" fill="#FFE08A"/><circle cx="32" cy="-7.4" r="1.7" fill="#FFE08A"/><circle cx="44.8" cy="-2.9" r="1.5" fill="#FFE08A"/></g>` },
    mago: { name: "Sombrero de mago", svg: () => `<g transform="rotate(-6 32 8)">
      <ellipse cx="32" cy="9.6" rx="21.5" ry="4.4" fill="#4A31B8"/>
      <path d="M19.5 8.5C22-2 25-12 30-19C32.5-22.5 36-24.5 41-23C37.5-21.5 35.4-19 34.6-15C33.6-8 38 2 44.5 8.5Z" fill="#5B3FD6"/>
      <path d="M34.6-15C33.6-8 38 2 44.5 8.5H39.6C35.6 2.6 33.4-6 34.6-15Z" fill="#4C33C0"/>
      ${HI("M20.8 5.2C22.8-1.8 25-8.4 28.6-14", 1.6, 0.24)}
      <path d="M20.8 4.4C28 6.2 36 6.2 43.4 4.4L44.3 7.8C36 9.8 28 9.8 19.8 7.8Z" fill="#FFC53D"/>
      <path d="M27.4-3.8A3.2 3.2 0 1 0 30.2 1.4A2.6 2.6 0 0 1 27.4-3.8Z" fill="#FFD24D"/>
      <path d="${STAR}" transform="translate(35.2 -8) scale(.62)" fill="#FFD24D"/>
      <path d="${STAR}" transform="translate(31.6 -15) scale(.42)" fill="#fff"/></g>` },
    vikingo: { name: "Casco vikingo", svg: () => `<g>
      ${HORN}<g transform="translate(64 0) scale(-1 1)">${HORN}</g>
      <path d="M13.6 13C13-1 22-7 32-7C42-7 51-1 50.4 13Z" fill="#A7B0BA"/>
      <path d="M41.6-4.6C47.6-1.4 51 4.6 50.4 13H45.6C46.2 5 45.2-.6 41.6-4.6Z" fill="#8F99A4"/>
      <path d="M30.4-6.9H33.6V10H30.4Z" fill="#8F99A4"/>
      ${HI("M17.6 6.4C18.4 1 21.6-2.6 26-4.4", 1.5, 0.5)}
      <path d="M12.4 10C25 7.2 39 7.2 51.6 10L51.8 15C39 12.2 25 12.2 12.2 15Z" fill="#7B8591"/>
      <g fill="#CBD2D9"><circle cx="16.4" cy="11.4" r=".8"/><circle cx="22.2" cy="10.4" r=".8"/><circle cx="28" cy="9.9" r=".8"/><circle cx="36" cy="9.9" r=".8"/><circle cx="41.8" cy="10.4" r=".8"/><circle cx="47.6" cy="11.4" r=".8"/></g></g>` },
    birrete: { name: "Birrete", svg: () => `<g transform="rotate(-8 32 4)">
      <path d="M18.6-1.2V7C24 9.8 40 9.8 45.4 7V-1.2Z" fill="#221C30"/>
      <path class="lk-rim" d="M32-9.6L56-2.6L32 4.4L8-2.6Z" fill="#3A3150"/>
      <path d="M32-9.6L56-2.6L32 4.4Z" fill="#2B2440"/>
      <path d="M32-2.6L50.8-.6V7.4" fill="none" stroke="#FFC53D" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M49.5 6.8H52.1L52.8 12.6H48.8Z" fill="#FFC53D"/>
      <circle cx="32" cy="-2.6" r="1.4" fill="#FFC53D"/></g>` },
    santa: { name: "Gorro navideño", svg: () => `<g>
      <path d="M13 9.5C12.5-2 21-9 31-9.5C41-10 51-5 56.5 8.8C54 6 51.5 5 49.5 5.4C50.6 6.6 51 7.6 51 8.6Z" fill="#E5484D"/>
      <path d="M44-6.8C50.4-3.8 54.6 1.6 56.5 8.8C54 6 51.5 5 49.5 5.4C48.4 1 46.6-3 44-6.8Z" fill="#C2333C"/>
      ${HI("M16.6 3C18.4-3.4 23-7 28.4-8.2", 1.6, 0.3)}
      <path class="lk-wf lk-wo" d="M11.8 9.6C25 5.8 39 5.8 52.2 9.6L52.6 15.2C39 11.6 25 11.6 11.4 15.2Z"/>
      <circle class="lk-wf lk-wo" cx="57.6" cy="11" r="3.9"/></g>` },
    pirata: { name: "Pañuelo pirata", svg: () => `<g>
      <path d="M51 13.4C54.6 14.6 57.6 17 59.4 20.6C56.6 20.4 53.8 18.8 51.6 16.6Z" fill="#B82F38"/>
      <path d="M51.4 12.6C55.4 12 59.2 12.8 62.2 15C59.6 16.2 56 16 52.6 15Z" fill="#D63E47"/>
      <path d="M13.6 14C12.8 1 21.6-4.6 32-4.6C42.4-4.6 51.2 1 50.4 14C39 11 25 11 13.6 14Z" fill="#E5484D"/>
      <path d="M42-2.6C47.8.4 51 6 50.4 14C48.6 13.4 46.6 12.9 44.6 12.6C45.4 6.6 44.6 1.6 42-2.6Z" fill="#CC3942"/>
      <g fill="#fff"><circle cx="21.6" cy="3.4" r="1.1"/><circle cx="28.4" cy="-1.4" r="1.1"/><circle cx="36" cy="1.6" r="1.1"/><circle cx="26.4" cy="8" r="1.1"/><circle cx="41" cy="7" r="1"/><circle cx="33" cy="-3" r=".7"/><circle cx="17.4" cy="9.6" r=".8"/></g>
      <circle cx="51" cy="13.2" r="2.8" fill="#D63E47"/></g>` },
    flor: { name: "Flor", svg: () => `<g transform="translate(50.6 12.6) rotate(-18)">
      <path d="M-2 3.4C-5.6 6.4-9.4 6.2-11.4 4C-8.6 2.6-5.6 2.4-2 3.4Z" fill="#3DBB7A"/>
      ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-3.8" rx="2.9" ry="3.9" fill="#FF9EC4" transform="rotate(${a})"/>`).join("")}
      ${[36, 108, 180, 252, 324].map((a) => `<ellipse cx="0" cy="-2.6" rx="1" ry="1.8" fill="#FFC4DB" transform="rotate(${a})"/>`).join("")}
      <circle r="2.4" fill="#FFD24D"/><circle cx="-.7" cy="-.7" r=".8" fill="#fff" opacity=".65"/></g>` },
    michi: { name: "Orejas de gato", slot: "back", svg: (k, u) => `<g stroke="url(#lg-${u})" stroke-width="2.4" stroke-linejoin="round" fill="url(#lg-${u})">
      <path d="M14.7 15.3L12.4-.6L25.4 8.9Z"/><path class="lk-ear-in" d="M15.2 10.6L14.2 2.6L21.2 6.6Z"/>
      <g class="lk-ear-r"><path d="M49.3 15.3L51.6-.6L38.6 8.9Z"/><path class="lk-ear-in" d="M48.8 10.6L49.8 2.6L42.8 6.6Z"/></g></g>` },
    audifonos: { name: "Audífonos", svg: () => `<g>
      <path d="M3.4 31A28.6 28.6 0 0 1 60.6 31" fill="none" class="lk-hp-s" stroke-width="3.6" stroke-linecap="round"/>
      ${HI("M8.6 14.6A28.6 28.6 0 0 1 22.2 4.1", 1.1, 0.3)}
      <rect class="lk-hp2" x="4.6" y="24" width="6" height="16" rx="3"/><rect class="lk-hp" x="-1.4" y="21.5" width="8.6" height="21" rx="4.3"/>
      <rect class="lk-hp2" x="53.4" y="24" width="6" height="16" rx="3"/><rect class="lk-hp" x="56.8" y="21.5" width="8.6" height="21" rx="4.3"/>
      <rect x=".6" y="24.5" width="2" height="8" rx="1" fill="#fff" opacity=".28"/><rect x="58.8" y="24.5" width="2" height="8" rx="1" fill="#fff" opacity=".28"/></g>` },
    mono: { name: "Moño", svg: () => `<g transform="translate(47.5 10.5) rotate(36)">
      <path d="M0 0C-2.4-5.6-10.2-7-10.2 0C-10.2 7-2.4 5.6 0 0ZM0 0C2.4-5.6 10.2-7 10.2 0C10.2 7 2.4 5.6 0 0Z" fill="#FF4F8B"/>
      <g fill="#fff" opacity=".85"><circle cx="-6.4" cy="-1.8" r=".95"/><circle cx="-4.4" cy="2.4" r=".75"/><circle cx="6.4" cy="-1.8" r=".95"/><circle cx="4.4" cy="2.4" r=".75"/><circle cx="-8.4" cy="1.4" r=".6"/><circle cx="8.4" cy="1.4" r=".6"/></g>
      <path d="M-2.2-.4C-4.6-3-7.6-3.4-8.4-.6M2.2-.4C4.6-3 7.6-3.4 8.4-.6" fill="none" stroke="#D93570" stroke-width=".9" stroke-linecap="round"/>
      <rect x="-2.6" y="-2.8" width="5.2" height="5.6" rx="2" fill="#D93570"/></g>` },
  };
  const FACE = {
    lentes: { name: "Lentes", slot: "face", svg: () => `<g fill="none" class="lk-frame" stroke-width="1.4" stroke-linecap="round">
      <path d="M21.1 31.6L9 30M42.9 31.6L55 30M31.4 31.2Q32 30.2 32.6 31.2"/>
      <circle cx="26.4" cy="32.5" r="5.35"/><circle cx="37.6" cy="32.5" r="5.35"/>
      <path d="M23.1 30.1Q23.9 28.6 25.5 28.2M34.3 30.1Q35.1 28.6 36.7 28.2" stroke="#fff" stroke-opacity=".7" stroke-width="1"/></g>` },
    // cristal oscuro con el reflejo del atardecer abajo: se ve sobre crema, naranja y negro
    sol: { name: "Lentes de sol", slot: "face-back", svg: (k) => `<g>
      <linearGradient id="sg-${k}" x1="0" y1="27" x2="0" y2="38.5" gradientUnits="userSpaceOnUse">
        <stop offset="0" style="stop-color:var(--shade,#1C120D)"/><stop offset=".55" style="stop-color:var(--shade,#1C120D)"/><stop offset="1" style="stop-color:#8A2E62"/></linearGradient>
      <path d="M8.5 28.2L19.8 28.8M55.5 28.2L44.2 28.8" class="lk-shade-s" stroke-width="1.8" stroke-linecap="round"/>
      <path class="lk-shade" fill="url(#sg-${k})" d="M19.9 27.4H31.3C31.9 27.4 32.2 27.9 32.1 28.5L31.4 34.5C31.1 36.9 29.7 38.1 27.6 38.1H24.7C22.5 38.1 21.1 36.9 20.7 34.6L19.5 28.6C19.4 27.9 19.5 27.4 19.9 27.4ZM44.1 27.4H32.7C32.1 27.4 31.8 27.9 31.9 28.5L32.6 34.5C32.9 36.9 34.3 38.1 36.4 38.1H39.3C41.5 38.1 42.9 36.9 43.3 34.6L44.5 28.6C44.6 27.9 44.5 27.4 44.1 27.4Z"/>
      <path d="M22.4 36.2L28.6 29.6M35.6 36.2L41.8 29.6" stroke="#fff" stroke-opacity=".16" stroke-width="2.2" stroke-linecap="round"/></g>` },
    rubor: { name: "Chapitas", slot: "face-back", svg: () => `<g class="lk-blush">
      <ellipse cx="20.4" cy="39.6" rx="3.5" ry="2.1"/><ellipse cx="43.6" cy="39.6" rx="3.5" ry="2.1"/></g>` },
    bigote: { name: "Bigote", slot: "face", svg: () => `<path class="lk-stache" d="M32 40.2C30 38.6 26.8 38.8 25 40.6C23.4 42.2 21.2 42.4 19.6 41.2C20.4 44.4 24 45.4 27 44.2C29.2 43.4 31 42.2 32 41.4C33 42.2 34.8 43.4 37 44.2C40 45.4 43.6 44.4 44.4 41.2C42.8 42.4 40.6 42.2 39 40.6C37.2 38.8 34 38.6 32 40.2Z"/>` },
    // el cordón pasa POR ENCIMA del ojo que queda libre, nunca por delante
    parche: { name: "Parche", slot: "face", svg: () => `<g>
      <path d="M33.6 28.4L15.5 21.2M41.8 36L50.5 41.5" class="lk-strap" fill="none" stroke-width="1.3" stroke-linecap="round"/>
      <ellipse class="lk-patch" cx="37.6" cy="32.6" rx="4.9" ry="5.7" transform="rotate(-12 37.6 32.6)"/></g>` },
    gato: { name: "Bigotes de gato", slot: "face", svg: () => `<g class="lk-whisk" fill="none" stroke-width=".9" stroke-linecap="round">
      <path d="M22.8 38.4L15.2 36.8M23 40.2L15.4 41.4M41.2 38.4L48.8 36.8M41 40.2L48.6 41.4"/>
      <path d="M30.7 37.9Q32 37.4 33.3 37.9L32 39.3Z" fill="#FF7FB0" stroke="none"/></g>` },
  };
  /* los TIPOS: una cabeza + una cara, con su etiqueta. Len se llama Len siempre;
     «Chef» o «Michi» dicen qué lleva puesto, no le cambian el nombre. */
  const LOOKS = [
    { id: "clasico", name: "Clásico", tag: "El de siempre.", cabeza: "", cara: "" },
    { id: "profe", name: "Profe", tag: "Con lentes redonditos.", cabeza: "", cara: "lentes" },
    { id: "chef", name: "Chef", tag: "Recién salido del horno.", cabeza: "chef", cara: "" },
    { id: "michi", name: "Michi", tag: "Miau.", cabeza: "michi", cara: "gato" },
    { id: "cool", name: "Cool", tag: "Nada lo despeina.", cabeza: "", cara: "sol" },
    { id: "vaquero", name: "Vaquero", tag: "Yija.", cabeza: "vaquero", cara: "" },
    { id: "mago", name: "Mago", tag: "Con estrellitas y todo.", cabeza: "mago", cara: "" },
    { id: "dj", name: "DJ", tag: "Con su música puesta.", cabeza: "audifonos", cara: "" },
    { id: "pirata", name: "Pirata", tag: "Al abordaje.", cabeza: "pirata", cara: "parche" },
    { id: "invierno", name: "Invierno", tag: "Calientito, calientito.", cabeza: "lana", cara: "rubor" },
    { id: "vikingo", name: "Vikingo", tag: "Con cuernos y sin miedo.", cabeza: "vikingo", cara: "" },
    { id: "artista", name: "Artista", tag: "Boina y bigote, como debe ser.", cabeza: "boina", cara: "bigote" },
    { id: "graduado", name: "Graduado", tag: "Birrete y todo.", cabeza: "birrete", cara: "lentes" },
    { id: "fiesta", name: "Fiesta", tag: "Todo lo celebra.", cabeza: "fiesta", cara: "" },
    { id: "skater", name: "Skater", tag: "Gorra de lado.", cabeza: "gorra", cara: "" },
    { id: "primavera", name: "Primavera", tag: "Con flor en la cabeza.", cabeza: "flor", cara: "rubor" },
    { id: "navidad", name: "Navidad", tag: "Jo, jo, jo.", cabeza: "santa", cara: "rubor" },
    { id: "rey", name: "Rey", tag: "Con corona, por si acaso.", cabeza: "corona", cara: "" },
    { id: "monito", name: "Moñito", tag: "Con su detallito.", cabeza: "mono", cara: "rubor" },
    { id: "bigoton", name: "Bigotón", tag: "Serio, pero no tanto.", cabeza: "", cara: "bigote" },
  ];
  const SHADOW = (u) => `<filter id="lsh-${u}" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="1.1" stdDeviation=".5" flood-color="#5A1E00" flood-opacity=".26"/></filter>`;
  const lookItem = (id) => HEAD[id] || FACE[id] || null;
  const slotOf = (id) => { const it = lookItem(id); return it ? it.slot || "head" : null; };
  // un botón de elegir: el anillo quieto, dos ojos y lo que lleve puesto
  function icon(cabeza, cara) {
    const u = "i" + (++UID), k = u + "-" + (++LKN);
    const put = (slot) => [cabeza, cara].filter((id) => slotOf(id) === slot).map((id) => lookItem(id).svg(k, u)).join("");
    const eye = (x) => eyePath(E(x), x, 32.5, 1, 0);
    return `<svg class="len len-ic" viewBox="-4 -21 72 84" aria-hidden="true" data-cara="${cara || ""}">
  <defs><linearGradient id="lg-${u}" gradientUnits="userSpaceOnUse" x1="14" y1="11" x2="52" y2="55">${STOPS}</linearGradient>
  <clipPath id="face-${u}"><circle cx="32" cy="32" r="17.2"/></clipPath>${SHADOW(u)}</defs>
  ${put("back")}<circle class="glass" cx="32" cy="32" r="17.5"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="url(#lg-${u})" stroke-width="10"/>
  <g clip-path="url(#face-${u})">${put("face-back")}<path class="eye" d="${eye(26.4)}"/><path class="eye" d="${eye(37.6)}"/>${put("face")}</g>
  <g filter="url(#lsh-${u})">${put("head")}</g>
</svg>`;
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
    ${SHADOW(u)}
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
    <g class="look" data-slot="back"></g>
    <circle class="glass" cx="32" cy="32" r="17"/>
    <circle class="ring" cx="32" cy="32" r="22" fill="none" stroke="url(#lg-${u})" stroke-width="10"/>
    <g clip-path="url(#face-${u})">
      <g class="gz"><g class="look" data-slot="face-back"></g></g>
      <path class="eye eye-l"/><path class="eye eye-r"/>
      <g class="gz"><g class="look" data-slot="face"></g></g>
    </g>
    <g class="hat"><g class="look" data-slot="head" filter="url(#lsh-${u})"></g></g>
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

/* el look: ponerse (cae y rebota), quitarse (sube y se va) */
.len .eye{transition:fill .25s}
.len[data-cara="sol"] .eye{fill:#fff}
.len .look .lk{transform-box:fill-box;transform-origin:50% 100%}
.len .look[data-slot^="face"] .lk{transform-origin:50% 50%}
.len .lk.lk-in{animation:lkIn .5s cubic-bezier(.34,1.56,.64,1) both}
.len .look[data-slot="head"] .lk.lk-in,.len .look[data-slot="back"] .lk.lk-in{animation:lkDrop .62s cubic-bezier(.3,1.2,.5,1) both}
.len .lk.lk-off{animation:lkOut .24s ease-in both}
@keyframes lkIn{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
@keyframes lkDrop{0%{opacity:0;transform:translateY(-16px) scale(.8)}45%{opacity:1;transform:translateY(1.5px) scale(1.05,.9)}70%{transform:translateY(-1px) scale(.98,1.03)}100%{transform:none}}
@keyframes lkOut{to{opacity:0;transform:translateY(-7px) scale(.85)}}
.len .lk-wf{fill:var(--lk-white,#fff)}
.len .lk-wo{stroke:var(--lk-white-line,#E6D2C2);stroke-width:.8}
.len .lk-wo:not(.lk-wf){fill:none}
.len .lk-wsh{fill:var(--lk-white-sh,#F4E7DB)}
.len .lk-wl{fill:none;stroke:var(--lk-white-line,#E6D2C2);stroke-width:.9;stroke-linecap:round}
.len .lk-rim{stroke:var(--lk-rim,rgba(255,255,255,.14));stroke-width:.7}
.len .lk-stache{fill:var(--eye,#2A1A13)}
.len .lk-strap{stroke:var(--eye,#2A1A13)}
.len .lk-patch{fill:var(--shade,#1C120D);stroke:var(--shade-rim,rgba(255,255,255,.14));stroke-width:.6}
.len .lk-whisk{stroke:var(--eye,#2A1A13);opacity:.75}
.len .lk-hp{fill:var(--hp,#2E2833)} .len .lk-hp-s{stroke:var(--hp,#2E2833)} .len .lk-hp2{fill:var(--hp2,#FF7FB0)}
.len .lk-frame{stroke:var(--eye,#2A1A13)}
.len .lk-shade{stroke:var(--shade-rim,rgba(255,255,255,.14));stroke-width:.6}
.len .lk-shade-s{stroke:var(--shade,#1C120D)}
.len .lk-blush{fill:var(--blush,#FF7FB0);opacity:.62}
.len .lk-ear-in{fill:var(--blush,#FF7FB0);stroke:none}
.len .lk-ear-r{transform-box:fill-box;transform-origin:40% 95%;animation:lkTwitch 5.3s ease-in-out infinite}
@keyframes lkTwitch{0%,84%,100%{transform:none}87%{transform:rotate(11deg)}90%{transform:rotate(-4deg)}93%{transform:rotate(6deg)}96%{transform:none}}

.len-reduced .len .prop,.len-reduced .len .prop *,.len-reduced .len .look *{animation:none!important}
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
      this.jel = { sx: 1, sy: 1, vx: 0, vy: 0 };
      this.scan = q(".scan"); this.rays = q(".rays");
      this.grad = q(`#lg-${u}`); this.stops = [...this.grad.querySelectorAll("stop")];
      this.props = [...host.querySelectorAll(".prop")];
      this.u = u; this.slots = {};
      host.querySelectorAll(".look").forEach((g) => (this.slots[g.dataset.slot] = g));
      this.gz = [...host.querySelectorAll(".gz")]; this.hat = q(".hat");
      this.lagY = 0; this.lookO = 1; this.look = { cabeza: "", cara: "" };
      this.setLook(opts.look, false);
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
    // { cabeza, cara } — cada slot cambia por separado: lo que no cambia no se mueve
    setLook(look, animate = true) {
      look = look || {};
      const want = { head: "", back: "", face: "", "face-back": "" };
      const cab = HEAD[look.cabeza] ? look.cabeza : "", car = FACE[look.cara] ? look.cara : "";
      if (cab) want[slotOf(cab)] = cab;
      if (car) want[slotOf(car)] = car;
      for (const slot in want) {
        const box = this.slots[slot], id = want[slot];
        if ((box.dataset.id || "") === id) continue;
        box.dataset.id = id;
        for (const old of [...box.children]) {
          if (!animate || REDUCED) { old.remove(); continue; }
          if (old.classList.contains("lk-off")) continue;
          old.classList.add("lk-off"); setTimeout(() => old.remove(), 260);
        }
        if (id) box.insertAdjacentHTML("beforeend", `<g class="lk${animate ? " lk-in" : ""}" data-lk="${id}">${lookItem(id).svg(this.u + "-" + (++LKN), this.u)}</g>`);
      }
      this.svg.dataset.cabeza = cab; this.svg.dataset.cara = car;
      this.look = { cabeza: cab, cara: car };
      if (animate) applyRate(this.svg);
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
      // cuerpo blando: el estirar y aplastar de la pose llega por un muelle con
      // poco freno, así que cada salto o toque acaba en un rebote de gelatina
      const J = this.jel;
      if (REDUCED || dt <= 0) { J.sx = b.sx; J.sy = b.sy; J.vx = J.vy = 0; }
      else {
        J.vx += (520 * (b.sx - J.sx) - 13 * J.vx) * dt; J.sx += J.vx * dt;
        J.vy += (520 * (b.sy - J.sy) - 13 * J.vy) * dt; J.sy += J.vy * dt;
      }
      this.body.setAttribute("transform",
        `translate(${b.tx.toFixed(3)} ${b.ty.toFixed(3)}) rotate(${b.rot.toFixed(3)} 32 32) translate(32 59) scale(${J.sx.toFixed(4)} ${J.sy.toFixed(4)}) translate(-32 -59)`);

      const rx = Math.max(0, inner - 9.4), ry = Math.max(0, inner - 6.6);
      let g0 = this.g[0], g1 = this.g[1]; const m = Math.hypot(g0, g1); if (m > 1) { g0 /= m; g1 /= m; }
      const gx = g0 * rx, gy = g1 * ry, spread = 1 - 0.1 * Math.abs(g0);
      const ov = 1 + 0.05 * Math.sin(Math.PI * this.transP);
      const bl = Math.max(this.blinkV * clamp(P.blink, 0, 1), this.transBlink);
      this.eyeL.setAttribute("d", eyePath(P.L, 32 + (P.L.x - 32) * spread + gx, P.L.y + gy, ov * (1 + 0.06 * g0), bl));
      this.eyeR.setAttribute("d", eyePath(P.R, 32 + (P.R.x - 32) * spread + gx, P.R.y + gy, ov * (1 - 0.06 * g0), bl));

      // el look: lo de la cara va con la mirada; lo de la cabeza llega tarde a los saltos
      // (al subir se aprieta contra la cabeza, al caer flota) · en «logo» no lleva nada
      if (this.look.cara) {
        const t = `translate(${gx.toFixed(3)} ${gy.toFixed(3)})`;
        this.gz.forEach((g) => g.setAttribute("transform", t));
      }
      if (this.look.cabeza) {
        this.lagY += (b.ty - this.lagY) * (1 - Math.exp(-dt * 14));
        const off = REDUCED ? 0 : clamp((this.lagY - b.ty) * 0.9, -3.2, 1);
        this.hat.setAttribute("transform", `translate(0 ${off.toFixed(3)})`);
      } else this.lagY = b.ty;
      if (Math.abs(b.glass - this.lookO) >= 0.002) {
        this.lookO = b.glass;
        for (const k in this.slots) this.slots[k].style.opacity = b.glass.toFixed(3);
      }

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
    HEAD: Object.fromEntries(Object.entries(HEAD).map(([k, v]) => [k, v.name])),
    FACE: Object.fromEntries(Object.entries(FACE).map(([k, v]) => [k, v.name])),
    LOOKS: LOOKS.map((l) => ({ ...l })),
    icon,
    get speed() { return SPEED; },
    get reduced() { return REDUCED; },
    setSpeed(x) { SPEED = x; applyRate(document.body); },
    setReduced(v) { REDUCED = !!v; setReducedClass(); },
  };
})();
