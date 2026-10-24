(() => {
  'use strict';

  /* ============================ setup ============================ */

  const canvas  = document.getElementById('gl');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionPreference.matches;
  const coarse  = matchMedia('(pointer: coarse)').matches;

  const fallback = () => {
    document.documentElement.classList.add('no-gl');
  };

  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });
  } catch (_) { gl = null; }
  if (!gl) { fallback(); return; }

  /* ============================ shaders ============================ */

  const VS = `#version 300 es
  void main(){
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const FS = `#version 300 es
  precision highp float;

  uniform vec2  uRes;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uSeed;

  out vec4 fragColor;

  /* ------------------------- tunables ------------------------- */
  #define PLANET_R         0.378   // planet radius
  #define PLANET_CY        0.462   // planet centre Y
  #define HORIZON_BASE     0.395   // horizon Y before wave
  #define RIM_SHARP      750.0     // tight rim gaussian
  #define RIM_SOFT       140.0     // wide rim gaussian
  #define HALO_FAST       22.0
  #define HALO_SLOW        6.0
  #define HZ_GLOW_W      110.0     // horizon glow width
  #define RIM_GLOW_W      55.0     // rim-end glow width
  #define GLOW_DECAY      55.0     // blue glow decay above horizon
  #define STAR_GRID       80.0
  #define DUST_GRID      150.0
  #define REF_H          941.0     // filament width reference height (px)
  #define GRAIN          0.012
  #define VIGNETTE        0.95
  #define WATER_BRANCH_MIN -0.010   // water runs from here down â€” see main()

  const vec3 BASE_LUMA = vec3(0.00006, 0.00007, 0.0001);
  const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

  /* ------------------------- noise ------------------------- */

  float hash21(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float gnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(hash22(i) * 2.0 - 1.0, f);
    float b = dot(hash22(i + vec2(1, 0)) * 2.0 - 1.0, f - vec2(1, 0));
    float c = dot(hash22(i + vec2(0, 1)) * 2.0 - 1.0, f - vec2(0, 1));
    float d = dot(hash22(i + vec2(1, 1)) * 2.0 - 1.0, f - vec2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
  }

  float fbm(vec2 p, int oct){
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 6; i++){
      if (i >= oct) break;
      s += a * gnoise(p);
      n += a;
      a *= 0.5;
      p = ROT * p * 2.03;
    }
    return s / n;
  }

  /* ------------------------- sky ------------------------- */

  float horizon(float xn, float t){
    float k = xn < 0.0 ? 0.172 : 0.140;
    float e = smoothstep(0.10, 1.0, abs(xn));
    return HORIZON_BASE + k * e
         + (fbm(vec2(xn * 1.7 + t * 0.02, 2.3), 3) - 0.5) * 0.04 * (0.25 + e);
  }

  // No derivative ops in here â†’ safe to call from a divergent branch.
  vec3 skyColor(vec2 uv, vec2 p, vec2 mP){
    vec2  c  = p - vec2(0.0, PLANET_CY) - (uMouse - 0.5) * 0.03;
    float d  = length(c);
    float dd = d - PLANET_R;
    vec3 col = vec3(0.0);

    /* planet + rim */
    float ang  = atan(c.y, c.x);
    float rimI = clamp(0.5 + 0.5 * cos(ang - atan(mP.y - PLANET_CY, mP.x)), 0.0, 1.0);
    rimI = 0.10 + 0.90 * pow(rimI, 1.5);
    rimI *= 0.92 + 0.16 * gnoise(vec2(cos(ang), sin(ang)) * 2.0 + 1.3);

    float out_ = smoothstep(PLANET_R - 0.0015, PLANET_R + 0.0015, d);
    float rim  = exp(-pow(dd * RIM_SHARP, 2.0)) * 3.0
               + exp(-pow(dd * RIM_SOFT,  2.0)) * 0.28;
    float halo = exp(-max(dd, 0.0) * HALO_FAST) * 0.014
               + exp(-max(dd, 0.0) * HALO_SLOW) * 0.0016;

    col += vec3(0.92, 0.95, 1.0) * (rim * rimI * (1.0 + 0.06 * sin(uTime * 1.3))
         + halo * (0.4 + rimI) * out_ * (1.0 + 0.25 * sin(uTime * 0.9)));

    /* faint limb light + mottled surface inside the disc */
    float inside = 1.0 - out_;
    float limb   = exp(-max(-dd, 0.0) * 38.0);
    col += vec3(0.7, 0.76, 0.9) * inside
         * (limb * 0.022 * rimI + fbm(c * 5.0 + 3.0, 4) * 0.0035 * (0.4 + limb));

    /* stars */
    float mask = smoothstep(PLANET_R * 1.05, PLANET_R * 1.3, d) * smoothstep(0.50, 0.62, uv.y);
    vec2  sp   = (p - (uMouse - 0.5) * 0.05) * STAR_GRID;
    vec2  ip   = floor(sp), fp = fract(sp);
    float h    = hash21(ip);
    float pa   = smoothstep(0.9965, 0.998, h);
    vec2  o    = hash22(ip + 3.7) * 0.6 + 0.2;
    float tw   = 0.6 + 0.4 * sin(uTime * 1.6 + h * 90.0);
    vec2  sw   = (ip + o) / STAR_GRID + (uMouse - 0.5) * 0.05 - mP;
    float bst  = exp(-dot(sw, sw) * 22.0);
    col += vec3(0.85, 0.9, 1.0) * pa * exp(-dot(fp - o, fp - o) * 300.0 / (1.0 + 3.0 * bst))
         * tw * (0.3 + 0.7 * h) * 0.5 * (1.0 + 6.0 * bst) * mask;

    /* cursor glow */
    vec2 gd = p - mP;
    col += vec3(0.6, 0.7, 1.0) * exp(-dot(gd, gd) * 90.0) * 0.014 * out_;

    /* drifting dust layer with fast twinkle */
    vec2 spD = (vec2(p.x + uTime * 0.008, p.y) - (uMouse - 0.5) * 0.02) * DUST_GRID;
    vec2 iD  = floor(spD), fD = fract(spD);
    float hD  = hash21(iD + 41.7);
    float paD = smoothstep(0.9955, 0.998, hD);
    vec2  oD  = hash22(iD + 9.1) * 0.6 + 0.2;
    float twD = 0.5 + 0.5 * sin(uTime * 3.2 + hD * 200.0);
    col += vec3(0.8, 0.88, 1.0) * paD * exp(-dot(fD - oD, fD - oD) * 420.0) * twD * 0.4 * mask;

    /* faint drifting cosmic mist */
    float mist = smoothstep(0.50, 0.78,
                   fbm(p * vec2(1.6, 2.2) + vec2(uTime * 0.03, -uTime * 0.012), 4));
    col += vec3(0.55, 0.63, 0.88) * mist * 0.016 * out_
         * smoothstep(0.5, 0.85, uv.y) * (0.6 + 0.4 * sin(uTime * 0.5));

    return col;
  }

  /* ------------------------- water ------------------------- */

  float swell(vec2 q){
    vec2 b = q * vec2(0.30, 0.45);
    vec2 r = q + (vec2(fbm(b + vec2(0.0, uTime * 0.05), 3),
                       fbm(b + vec2(5.2, 1.3 - uTime * 0.04), 3)) - 0.5) * 2.2;
    return fbm(vec2(r.x * 0.22, r.y * 0.9), 4);
  }

  // r is already domain-warped by the caller.
  float fil(vec2 r, vec2 fr, float wpx, float off, float amp){
    float n  = gnoise(vec2(r.x * fr.x + off * 3.1,
                           r.y * fr.y + uTime * 0.05 * (1.0 + off * 0.3))) - 0.5;
    float fw = max(fwidth(n), 1e-4);
    float px = abs(n) / fw / (wpx * uRes.y / REF_H);
    float ln = exp(-px * px);
    float dens = 1.0 - smoothstep(0.012, 0.06, fw);
    float v = smoothstep(0.15, 0.85, gnoise(vec2(r.x * 0.5 + off, r.y * 0.8 + off * 2.0)));
    return ln * dens * amp * (0.04 + 0.96 * v * v);
  }

  float filaments(vec2 q){
    // one domain warp shared by all five layers (was 2 lookups per layer)
    vec2 w  = q * vec2(0.4, 0.9);
    vec2 wp = vec2(gnoise(w), gnoise(w + 7.1)) - 0.5;
    vec2 qs = vec2(q.x + q.y * 0.55, q.y);

    float f = 0.0;
    f += fil(q  + wp * 0.9, vec2(0.10, 1.3), 0.9,  0.0, 0.95);
    f += fil(q  + wp * 0.8, vec2(0.28, 3.6), 0.8,  3.0, 0.80);
    f += fil(q  + wp * 0.6, vec2(0.70, 9.0), 0.7,  6.0, 0.60);
    f += fil(q  + wp * 0.7, vec2(0.20, 2.2), 0.8,  9.0, 0.70);
    f += fil(qs + wp * 0.8, vec2(0.12, 1.7), 0.8, 12.0, 0.80);
    return f;
  }

  // Uses dFdx / fwidth â€” only ever called from the guarded branch in main().
  vec3 waterColor(vec2 p, float xn, float w, vec2 mP){
    float zz = 1.0 / (max(w, 0.0) * 3.0 + 0.04);
    vec2  q  = vec2(p.x * zz * 0.5, zz * 0.55);

    float h = swell(q);
    vec2  g = vec2(dFdx(h), dFdy(h)) * uRes / 300.0;
    g /= (1.0 + length(g) * 2.0);
    vec3 n  = normalize(vec3(-g.x, -g.y, 0.42));
    vec3 L  = normalize(vec3(-p.x * 0.6, 0.85, 0.6));
    vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));

    float detailFade = smoothstep(0.0, 0.03, w);   // kills horizon shimmer
    float spec = pow(max(dot(n, Hv), 0.0), 46.0) * detailFade;
    float crest = filaments(q) * 1.5 * smoothstep(0.004, 0.05, w);
    float body  = smoothstep(0.3, 0.8, h) * detailFade;

    float m = (0.04 + 0.96 * exp(-w * 4.0))
            * (0.30 + 0.70 * exp(-xn * xn * 1.8))
            * (0.45 + 1.20 * pow(h, 1.6))
            * (1.00 + 0.90 * exp(-pow((p.x - mP.x) * 2.2, 2.0)));

    vec3 wc = vec3(crest + spec * 0.3 + body * 0.015) * m;

    /* vertical reflection streaks under the rim ends */
    float ex = exp(-pow((abs(p.x) - PLANET_R * 0.99) * 9.0, 2.0));
    float sn = gnoise(vec2(p.x * 4.0, w * 16.0 + uTime * 0.3));
    float st = ex * exp(-w * 3.2) * smoothstep(0.35, 0.8, sn + 0.1)
             * (0.15 + 3.0 * min(crest, 1.0)) * smoothstep(0.0, 0.03, w);
    wc += vec3(1.0) * st * 2.0 + vec3(0.8, 0.86, 1.0) * pow(h, 3.0) * 0.035 * m;

    float ex2 = exp(-pow(p.x * 3.5, 2.0)) * exp(-w * 7.0);
    wc += vec3(0.8, 0.85, 1.0) * ex2
        * smoothstep(0.5, 0.9, gnoise(vec2(p.x * 45.0, w * 5.0))) * 0.12;

    return wc;
  }

  /* ------------------------- glow ------------------------- */

  // Straddles the horizon, no derivatives â†’ computed unconditionally.
  vec3 horizonGlow(vec2 p, float xn, float w, float under, float above){
    float hzSparkle = 0.55 + 0.9 * gnoise(vec2(p.x * 18.0, uTime * 0.4));
    float hb = exp(-pow(w * HZ_GLOW_W, 2.0))
             * (0.18 + 0.82 * exp(-pow((abs(p.x) - 0.30) * 2.8, 2.0))) * hzSparkle;
    float rb = exp(-pow((abs(p.x) - PLANET_R) * 20.0, 2.0)) * exp(-pow(w * RIM_GLOW_W, 2.0));

    vec3 col = vec3(hb * 0.3 * under + rb * 1.6);
    col += vec3(0.55, 0.62, 0.8) * exp(-max(-w, 0.0) * GLOW_DECAY) * 0.02
         * (0.3 + exp(-xn * xn * 2.0)) * above;
    return col;
  }

  /* ------------------------- post ------------------------- */

  vec3 post(vec3 col, vec2 uv){
    col *= 1.0 - 0.12 * smoothstep(0.16, 0.0, uv.y);
    col *= 1.05;
    col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);

    /* Elliptical vignette in uv space â€” matches the wide composition.
       Circular alternative:
         vec2 dir = (uv - 0.5) * vec2(ar, 1.0);
         dir /= length(vec2(0.5 * ar, 0.5));
         col *= 1.0 - dot(dir, dir) * 0.475;   // keeps the corners as dark as now
    */
    vec2 dir = uv - 0.5;
    col *= 1.0 - dot(dir, dir) * VIGNETTE;

    col = pow(col, vec3(1.0 / 2.2));
    col *= vec3(0.985, 0.995, 1.012);
    col += (hash21(gl_FragCoord.xy + uSeed) - 0.5) * GRAIN;
    return col;
  }

  /* ------------------------- main ------------------------- */

  void main(){
    vec2  uv = gl_FragCoord.xy / uRes;
    float ar = uRes.x / uRes.y;
    vec2  p  = vec2((uv.x - 0.5) * ar, uv.y);
    float xn = (uv.x - 0.5) * 2.0;
    vec2  mP = vec2((uMouse.x - 0.5) * ar, uMouse.y);

    float H     = horizon(xn, uTime);
    float w     = H - uv.y;
    float below = smoothstep(-0.003, 0.004, w);
    float above = 1.0 - below;

    float under = 1.0 - 0.55 * exp(-pow(p.x / (PLANET_R * 0.85), 2.0)) * exp(-w * 2.2);

    vec3 col = BASE_LUMA;

    /* sky â€” no derivatives inside, safe to skip */
    if (above > 0.0) col += skyColor(uv, p, mP) * above;

    /* water â€” uses dFdx/fwidth. The branch starts ~9 px ABOVE the horizon where
       \`below\` is already exactly 0, so any quad-lane divergence is multiplied out. */
    vec3 wc = vec3(0.0);
    if (w > WATER_BRANCH_MIN) wc = waterColor(p, xn, w, mP);
    col += wc * below * 0.5 * under;

    col += horizonGlow(p, xn, w, under, above);

    fragColor = vec4(post(col, uv), 1.0);
  }`;

  /* ============================ GL plumbing ============================ */

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'shader compile failed');
    }
    return s;
  }

  function buildProgram(){
    const p  = gl.createProgram();
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(log || 'program link failed');
    }
    gl.useProgram(p);
    return {
      prog: p,
      uRes:   gl.getUniformLocation(p, 'uRes'),
      uTime:  gl.getUniformLocation(p, 'uTime'),
      uMouse: gl.getUniformLocation(p, 'uMouse'),
      uSeed:  gl.getUniformLocation(p, 'uSeed')
    };
  }

  let U;
  try { U = buildProgram(); }
  catch (err){ console.error('[NTOX] WebGL init failed:', err); fallback(); return; }

  /* ============================ sizing ============================ */

  let cssW = canvas.clientWidth  || innerWidth;
  let cssH = canvas.clientHeight || innerHeight;
  let scale = 1;

  function syncSize(){
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2.25) * scale;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
    return [w, h];
  }

  function measure(){
    cssW = canvas.clientWidth  || innerWidth;
    cssH = canvas.clientHeight || innerHeight;
    syncSize();
  }

  syncSize();
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(canvas);
  else addEventListener('resize', measure);
  addEventListener('orientationchange', measure);

  /* ============================ input ============================ */

  let t = 0, last = performance.now();
  let tm = [0.38, 0.85], sm = [0.38, 0.85];
  let moved = -1e9;
  let schedule = () => {};

  const setM = e => {
    tm = [e.clientX / innerWidth, 1 - e.clientY / innerHeight];
    moved = performance.now();
    schedule();
  };

  addEventListener('pointermove', setM);
  addEventListener('pointerdown', setM);

  /* ============================ draw ============================ */

  let frames = 0, acc = 0, seedN = 0;

  function draw(now){
    const dtMs = now - last;
    const dt   = Math.min(dtMs / 1000, 0.05);
    last = now;
    if (!reduced) t += dt;

    const size = syncSize();
    gl.viewport(0, 0, size[0], size[1]);
    gl.uniform2f(U.uRes, size[0], size[1]);
    gl.uniform1f(U.uTime, t * 0.5);

    if (now - moved > 4000){
      tm = [0.5 + 0.2 * Math.sin(t * 0.2), 0.72 + 0.13 * Math.cos(t * 0.17)];
    }
    const k = 1 - Math.pow(0.001, dt);
    sm[0] += (tm[0] - sm[0]) * k;
    sm[1] += (tm[1] - sm[1]) * k;
    gl.uniform2f(U.uMouse, sm[0], sm[1]);
    gl.uniform1f(U.uSeed, (seedN++ % 64) * 17.0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* adaptive resolution: 0.5 â€“ 1.0 */
    if (!reduced){
      acc += dtMs;
      frames++;
      if (frames >= 30){
        const avg = acc / frames;
        acc = 0; frames = 0;
        const next = avg > 20 ? Math.max(0.72, scale - 0.05)
                   : avg < 11 ? Math.min(1.0, scale + 0.05)
                   : scale;
        if (next !== scale) scale = next;   // picked up next frame by syncSize()
      }
    }
  }

  /* ============================ loop + context loss ============================ */

  let rafId = 0, running = true;
  const host = document.querySelector('.console');

  const launchVisible = () => {
    if (document.hidden || !canvas.isConnected) return false;
    if (host && !host.classList.contains('landing-mode')) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(canvas);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  function stop(){ if (rafId){ cancelAnimationFrame(rafId); rafId = 0; } }

  function sync(){
    if (!running || !launchVisible()){ stop(); return; }
    if (!rafId){ last = performance.now(); rafId = requestAnimationFrame(loop); }
  }

  function loop(now){
    rafId = 0;
    if (!running || !launchVisible()) return;
    draw(now);
    if (!reduced) sync();
  }

  document.addEventListener('visibilitychange', sync);
  if (host && 'MutationObserver' in window) new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['class'] });

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    running = false;
    stop();
  });

  canvas.addEventListener('webglcontextrestored', () => {
    try {
      U = buildProgram();
      running = true;
      sync();
    } catch (err){
      console.error('[NTOX] context restore failed:', err);
      fallback();
    }
  });

  /* ============================ start ============================ */

  schedule = sync;
  addEventListener('resize', sync);
  if ('ResizeObserver' in window) new ResizeObserver(sync).observe(canvas);
  motionPreference.addEventListener('change', event => {
    reduced = event.matches;
    stop();
    sync();
  });
  sync();
})();
