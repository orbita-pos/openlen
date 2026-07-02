// lib/three3d/runtime/shaders.ts
// Shared shader GLSL, extracted verbatim from mount.ts (Task 11 — zero behavior
// change). mount.ts's three-flavored ShaderMaterial consumes SHADER_VERT +
// shaderFragment(); a future three-free lite runtime (Task 12) reuses the same
// GLSL without pulling in three.

// ── Shader background constants ────────────────────────────────────────────
export const SHADER_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const NOISE = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x - floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s += a*snoise(p); p=p*2.0; a*=0.5; } return s; }
`;

const GRADIENT = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv = vUv; float t = iTime*0.04;
  vec2 q = vec2(fbm(uv*1.1 + t), fbm(uv*1.1 + vec2(3.1,1.7) - t));
  float f = fbm(uv*1.3 + 0.9*q + t);
  vec3 c1=vec3(0.20,0.10,0.42), c2=vec3(0.92,0.46,0.55), c3=vec3(0.20,0.75,0.98), c4=vec3(0.45,0.35,0.95);
  vec3 col = mix(c1,c2, smoothstep(-0.6,0.8,f));
  col = mix(col,c3, 0.55*smoothstep(-0.3,0.9, q.x));
  col = mix(col,c4, 0.55*smoothstep(-0.3,0.9, q.y));
  col *= 1.0 - 0.25*length(uv-0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const METABALL = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
void main(){
  vec2 uv = (vUv-0.5)*vec2(iResolution.x/iResolution.y,1.0); float t=iTime*0.4; float m=0.0;
  for(int i=0;i<5;i++){ float fi=float(i);
    vec2 c=0.34*vec2(sin(t*0.8+fi*1.6), cos(t*0.7+fi*2.3));
    float r=0.12+0.03*sin(t+fi);
    m += r*r/max(dot(uv-c,uv-c),0.0008);
  }
  float s=smoothstep(0.75,1.35,m);
  vec3 base=vec3(0.04,0.03,0.11);
  vec3 col = mix(base, vec3(0.42,0.28,1.0), s);
  col = mix(col, vec3(0.30,0.70,1.0), smoothstep(1.4,2.8,m));
  col += vec3(1.0,0.60,0.90)*smoothstep(3.2,5.5,m)*0.6;
  col *= 1.0 - 0.18*length(uv);
  gl_FragColor = vec4(col,1.0);
}`;

const AURORA = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv = vUv; float t=iTime*0.15; vec3 col=vec3(0.02,0.03,0.08);
  for(int i=0;i<4;i++){ float fi=float(i);
    float band = uv.y + 0.12*sin(uv.x*3.0 + t + fi*1.7) + 0.06*fbm(vec2(uv.x*3.0 + t, fi));
    float center = 0.32 + fi*0.16;
    float glow = exp(-pow((band-center)*7.0,2.0));
    vec3 c = mix(vec3(0.1,0.9,0.7), vec3(0.5,0.3,1.0), fi/3.0);
    col += c*glow*0.6;
  }
  col += vec3(0.6,0.4,1.0)*pow(max(0.0,1.0-uv.y),3.0)*0.15;
  gl_FragColor = vec4(col,1.0);
}`;

const SILK = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv=vUv; float t=iTime*0.09;
  float flow = uv.x*2.3 + uv.y*1.1 + 0.7*fbm(uv*1.7 + t) + t;
  float bands = sin(flow*3.14159*1.5);
  float sheen = 0.5+0.5*bands;
  float ridge = pow(smoothstep(0.72,1.0, sheen), 3.0);
  vec3 c1=vec3(0.09,0.06,0.22), c2=vec3(0.44,0.29,0.80), c3=vec3(0.86,0.56,0.92);
  vec3 col = mix(c1,c2, sheen);
  col = mix(col, c3, smoothstep(0.5,0.96,sheen)*0.7);
  col += vec3(1.0,0.92,1.0)*ridge*0.35;
  col *= 1.0 - 0.16*length(uv-0.5);
  gl_FragColor=vec4(col,1.0);
}`;

const PLASMA = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
void main(){
  float ar = iResolution.x/iResolution.y;
  vec2 uv=vUv*vec2(ar,1.0); float t=iTime*0.35;
  float v = sin(uv.x*5.0+t) + sin(uv.y*5.0+t*1.1) + sin((uv.x+uv.y)*4.0+t*0.7) + sin(length(uv-vec2(0.5*ar,0.5))*8.0-t*1.2);
  v = v*0.125+0.5;
  vec3 a=vec3(0.15,0.08,0.35), b=vec3(0.86,0.35,0.55), c=vec3(0.20,0.70,0.96);
  vec3 col = mix(a,b, smoothstep(0.2,0.6,v));
  col = mix(col,c, smoothstep(0.55,0.95,v));
  gl_FragColor=vec4(col,1.0);
}`;

const EMBER = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv=vUv; float t=iTime*0.16;
  float n = fbm(vec2(uv.x*3.0, uv.y*4.0 - t*2.2));
  float heat = smoothstep(0.0,1.0, (1.0-uv.y) + n*0.45 - 0.25);
  vec3 col = mix(vec3(0.03,0.01,0.0), vec3(0.92,0.24,0.05), heat);
  col = mix(col, vec3(1.0,0.76,0.22), pow(heat,3.0)*0.85);
  col += vec3(0.04,0.008,0.0);
  gl_FragColor=vec4(col,1.0);
}`;

const DOTS = `precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${NOISE}
void main(){
  float ar=iResolution.x/iResolution.y;
  vec2 uv=vUv*vec2(ar,1.0); float t=iTime*0.03;
  vec3 col=vec3(0.02,0.02,0.06);
  col += vec3(0.10,0.05,0.22)*max(fbm(uv*2.0+t),0.0)*0.6;
  for(int i=0;i<3;i++){ float fi=float(i);
    vec2 g = (uv + vec2(t*(0.2+fi*0.1),0.0))*(22.0+fi*16.0);
    vec2 id=floor(g); vec2 f=fract(g)-0.5;
    float rnd=fract(sin(dot(id,vec2(12.9,78.2)))*43758.5);
    float tw=0.5+0.5*sin(iTime*3.0+rnd*30.0);
    float star=smoothstep(0.07,0.0,length(f))*step(0.93,rnd)*tw;
    col += vec3(0.85,0.9,1.0)*star;
  }
  gl_FragColor=vec4(col,1.0);
}`;

const SHADER_FRAG: Record<string, string> = { gradient: GRADIENT, fluid: METABALL, aurora: AURORA, plasma: PLASMA, ember: EMBER, dots: DOTS, silk: SILK };

export const SHADER_VARIANT_KEYS: readonly string[] = Object.keys(SHADER_FRAG);

/** Returns exactly what mount.ts fed ShaderMaterial's fragmentShader for a given
 *  variant, including the unknown-variant fallback to GRADIENT. */
export function shaderFragment(variant: string): string {
  return SHADER_FRAG[variant] ?? GRADIENT;
}
