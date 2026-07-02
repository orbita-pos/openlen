"use strict";(()=>{var f=`
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
`,D=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${f}
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
}`,B=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
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
}`,M=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${f}
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
}`,q=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${f}
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
}`,I=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
void main(){
  float ar = iResolution.x/iResolution.y;
  vec2 uv=vUv*vec2(ar,1.0); float t=iTime*0.35;
  float v = sin(uv.x*5.0+t) + sin(uv.y*5.0+t*1.1) + sin((uv.x+uv.y)*4.0+t*0.7) + sin(length(uv-vec2(0.5*ar,0.5))*8.0-t*1.2);
  v = v*0.125+0.5;
  vec3 a=vec3(0.15,0.08,0.35), b=vec3(0.86,0.35,0.55), c=vec3(0.20,0.70,0.96);
  vec3 col = mix(a,b, smoothstep(0.2,0.6,v));
  col = mix(col,c, smoothstep(0.55,0.95,v));
  gl_FragColor=vec4(col,1.0);
}`,H=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${f}
void main(){
  vec2 uv=vUv; float t=iTime*0.16;
  float n = fbm(vec2(uv.x*3.0, uv.y*4.0 - t*2.2));
  float heat = smoothstep(0.0,1.0, (1.0-uv.y) + n*0.45 - 0.25);
  vec3 col = mix(vec3(0.03,0.01,0.0), vec3(0.92,0.24,0.05), heat);
  col = mix(col, vec3(1.0,0.76,0.22), pow(heat,3.0)*0.85);
  col += vec3(0.04,0.008,0.0);
  gl_FragColor=vec4(col,1.0);
}`,O=`precision highp float; uniform float iTime; uniform vec2 iResolution; varying vec2 vUv;
${f}
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
}`,P={gradient:D,fluid:B,aurora:M,plasma:I,ember:H,dots:O,silk:q},$=Object.keys(P);function z(i){var m;return(m=P[i])!=null?m:D}var N="attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }",V=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);function G(i,m,p={}){var F;let v=(F=i.parentElement)!=null?F:i,u=v.clientWidth||800,d=v.clientHeight||600,x=Math.min(window.devicePixelRatio||1,2),o=0,l=!0,b=!0,W=performance.now(),y=()=>{var t;b&&(b=!1,(t=p.onReady)==null||t.call(p),window.dispatchEvent(new Event("three-ready")))},e=i.getContext("webgl",{antialias:!0})||i.getContext("experimental-webgl",{antialias:!0});if(!e)return y(),{dispose(){}};let c=null,a=null,w=null,g=null,h=!1;function R(){i.width=Math.max(1,Math.floor(u*x)),i.height=Math.max(1,Math.floor(d*x)),e.viewport(0,0,i.width,i.height),g&&e.uniform2f(g,u*x,d*x)}function A(){var C;c=null,a=null,w=null,g=null;let t=e.createShader(e.VERTEX_SHADER),r=e.createShader(e.FRAGMENT_SHADER);if(!t||!r)return!1;e.shaderSource(t,N),e.compileShader(t),e.shaderSource(r,z((C=m.shader)!=null?C:"gradient")),e.compileShader(r);let n=e.createProgram();if(!n)return!1;if(e.attachShader(n,t),e.attachShader(n,r),e.linkProgram(n),e.deleteShader(t),e.deleteShader(r),!e.getProgramParameter(n,e.LINK_STATUS))return e.deleteProgram(n),!1;c=n,a=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,a),e.bufferData(e.ARRAY_BUFFER,V,e.STATIC_DRAW),e.useProgram(c);let _=e.getAttribLocation(c,"position");return e.enableVertexAttribArray(_),e.vertexAttribPointer(_,2,e.FLOAT,!1,0,0),w=e.getUniformLocation(c,"iTime"),g=e.getUniformLocation(c,"iResolution"),R(),!0}function s(){h&&!e.isContextLost()&&(e.uniform1f(w,6+(performance.now()-W)/1e3),e.drawArrays(e.TRIANGLES,0,6)),y(),l?o=requestAnimationFrame(s):o=0}function E(){u=v.clientWidth||u,d=v.clientHeight||d,R()}if(h=A(),!h){let t=e.getExtension("WEBGL_lose_context");return t&&t.loseContext(),y(),{dispose(){}}}let L=t=>{t.preventDefault(),cancelAnimationFrame(o),o=0,window.dispatchEvent(new Event("three-context-lost"))},T=()=>{h=A(),l&&!o&&(o=requestAnimationFrame(s)),window.dispatchEvent(new Event("three-context-restored"))};i.addEventListener("webglcontextlost",L),i.addEventListener("webglcontextrestored",T);let S=new IntersectionObserver(t=>{var r,n;l=(n=(r=t[0])==null?void 0:r.isIntersecting)!=null?n:!0,l&&!o&&(o=requestAnimationFrame(s))});S.observe(v);let U=()=>{document.visibilityState==="hidden"?(cancelAnimationFrame(o),o=0):l&&!o&&(o=requestAnimationFrame(s))};return document.addEventListener("visibilitychange",U),window.addEventListener("resize",E),o=requestAnimationFrame(s),{dispose(){i.removeEventListener("webglcontextlost",L),i.removeEventListener("webglcontextrestored",T),cancelAnimationFrame(o),o=0,S.disconnect(),document.removeEventListener("visibilitychange",U),window.removeEventListener("resize",E),a&&e.deleteBuffer(a),c&&e.deleteProgram(c);let t=e.getExtension("WEBGL_lose_context");t&&t.loseContext()}}}window.OpenLen3D={mount:G};})();
