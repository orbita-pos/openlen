// THE FIGURE'S SHADERS (spec local 2026-11-10-figuras-del-asistente, §5.2). GLSL ES 3.00, ours, written for the
// browser: one program draws every piece.
//
// A piece is the unit sphere pushed through `shape()` — a silhouette as a function of the angle, so a heart or a
// flower is a set of numbers and not a mesh — and fur is that same surface drawn `uLayers` times, each layer a
// little further out, with the fragment shader deciding where a strand is. The camera is orthographic: at 72 px
// perspective buys nothing, and without it there are no matrices to ship.
//
// Output is PREMULTIPLIED alpha (the canvas is transparent; its host owns the background). Straight alpha would
// leave a halo on every strand's edge.

export const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aDir;
uniform mat3 uRot, uPartRot;
uniform vec3 uPos, uScale, uOffset, uLag, uStretch;
uniform vec4 uSilA; // superellipse power, lobes, lobe depth, notch at the top
uniform vec4 uSilB; // point at the bottom, taper to the bottom, taper to the top, squash of the lower half
uniform float uWiden, uFurLen, uLayers, uTime;
uniform vec2 uView; // world → clip, per axis
out vec3 vDir, vN, vW;
out float vH;

float wrap(float a) { return atan(sin(a), cos(a)); }

vec3 shape(vec3 d) {
  float th = abs(d.x) + abs(d.y) < 1e-5 ? 0.0 : atan(d.y, d.x);
  float n = uSilA.x;
  float r = pow(pow(abs(cos(th)), n) + pow(abs(sin(th)), n), -1.0 / n);
  r *= 1.0 + uSilA.z * cos(uSilA.y * (th - 1.5708));
  float up = wrap(th - 1.5708), down = wrap(th + 1.5708);
  r *= 1.0 - uSilA.w * exp(-up * up / 0.08);
  r *= 1.0 + uSilB.x * exp(-down * down / 0.12);
  vec3 p = vec3(d.xy * r, d.z);
  p.x *= 1.0 - uSilB.y * smoothstep(0.1, -1.0, d.y);
  p.x *= 1.0 - uSilB.z * smoothstep(-0.1, 1.0, d.y);
  p.xz *= 1.0 + uWiden * smoothstep(0.2, -0.8, d.y);
  p.y *= 1.0 - uSilB.w * smoothstep(0.0, -0.6, d.y);
  return p * uScale;
}

void main() {
  vec3 d = aDir;
  vec3 p = shape(d);
  // The normal of whatever shape() made, by finite differences: the fur must leave the SILHOUETTE square, not a sphere.
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  vec3 n = normalize(cross(shape(normalize(d + 0.02 * t1)) - p, shape(normalize(d + 0.02 * t2)) - p));
  if (dot(n, p) < 0.0) n = -n;

  float h = uLayers > 1.0 ? float(gl_InstanceID) / (uLayers - 1.0) : 0.0;
  float h2 = h * h;
  vec3 wn = uRot * (uPartRot * n);
  vec3 w = uRot * ((uPos + uPartRot * p) * uStretch);
  w += wn * h * uFurLen;
  w.y -= h2 * uFurLen * 0.35;
  w += vec3(sin(uTime * 1.7 + w.y * 3.0), 0.0, cos(uTime * 1.3 + w.x * 3.0)) * h2 * uFurLen * 0.07;
  w += uLag * h2 * uFurLen;
  w += uOffset;
  vDir = d; vN = wn; vW = w; vH = h;
  gl_Position = vec4(w.x * uView.x, (w.y - 0.25) * uView.y, -w.z * 0.25, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vDir, vN, vW;
in float vH;
uniform vec3 uColor;
uniform float uDensity, uLayers, uKind; // kind: 0 fur, 1 solid, 2 gloss
out vec4 o;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

void main() {
  vec3 n = normalize(vN);
  const vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.6));
  float ndv = max(n.z, 0.0);
  if (uKind > 1.5) {
    float spec = pow(max(dot(reflect(-L, n), V), 0.0), 50.0);
    o = vec4(uColor + spec * 0.9 + pow(1.0 - ndv, 3.0) * 0.12, 1.0);
    return;
  }
  float fur = uKind < 0.5 && uLayers > 1.0 ? 1.0 : 0.0;
  vec3 a = abs(vDir);
  vec2 uv = vDir.xz / (a.x + a.y + a.z);
  if (vDir.y < 0.0) uv = (1.0 - abs(uv.yx)) * vec2(uv.x >= 0.0 ? 1.0 : -1.0, uv.y >= 0.0 ? 1.0 : -1.0);
  vec2 g = uv * uDensity + vec2(sin(uv.y * 9.0 + 1.0), cos(uv.x * 8.0)) * 0.9 * vH * vH;
  vec2 r = hash22(floor(g));
  float alpha = 1.0;
  if (fur > 0.5 && vH > 0.0) {
    float t = vH / mix(0.7, 1.0, r.x);
    float rad = 0.5 * (1.0 - t * t * 0.8) * mix(1.7, 1.0, smoothstep(0.0, 0.55, ndv));
    alpha = t > 1.0 ? 0.0 : smoothstep(rad, rad - 0.3, length(fract(g) - 0.5 - (r - 0.5) * 0.25));
    if (alpha < 0.02) discard;
  }
  vec3 base = max(uColor, vec3(0.06)) * (0.93 + 0.14 * r.y * fur);
  float root = mix(1.0, mix(0.7, 1.0, pow(vH, 0.6)), fur);
  float wrapped = dot(n, L) * 0.5 + 0.5;
  float light = clamp(0.32 + 0.78 * wrapped * wrapped, 0.0, 1.0) * root * mix(0.76, 1.0, n.y * 0.5 + 0.5);
  vec3 col = mix(base * base * 0.5 + base * 0.22, base * 1.03 + 0.05, light);
  col += (base * 0.5 + 0.5) * 0.1 * pow(wrapped, 6.0) * vH * fur;
  col += (base * 0.6 + 0.4) * pow(1.0 - ndv, 2.5) * vH * 0.22 * fur;
  o = vec4(col * alpha, alpha);
}`;
