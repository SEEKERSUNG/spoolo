/* ==========================================================================
   SPOOLO · 成片 GPU 管线
   - 色彩：spektrafilm 移植层烘焙的 3D LUT（不再有自有胶卷曲线）
   - 光晕：半分辨率亮部遮罩 + 可分离高斯模糊 + screen 混合
   - 颗粒 / 暗角 / 漏光 / 闪光
   源画布由 grabFrame 裁好，这里只做像素处理；失败时 app.js 回退 CPU 管线。
   ========================================================================== */
(function (global) {
  'use strict';

  var SP = global.SPOOLO = global.SPOOLO || {};

  var VS = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = (aPos + 1.0) * 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';

  var PRECISION = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif'
  ].join('\n') + '\n';

  var COLOR_FS = PRECISION + [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc, uSpec;',
    'uniform float uSpecExp, uSpecSize, uSpecTiles, uSpecRows;',
    'float s2l(float x){ return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4); }',
    'float l2s(float x){ return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }',
    'vec3 specSlice(float z, vec2 p){',
    '  float tx = mod(z, uSpecTiles) * uSpecSize;',
    '  float ty = floor(z / uSpecTiles) * uSpecSize;',
    '  return texture2D(uSpec, vec2((tx + 0.5 + p.x) / (uSpecTiles * uSpecSize),',
    '                               (ty + 0.5 + p.y) / (uSpecRows * uSpecSize))).rgb;',
    '}',
    'vec3 specSample(vec3 c){',
    '  vec3 lin = vec3(s2l(c.r), s2l(c.g), s2l(c.b)) * uSpecExp;',
    '  lin = clamp(lin, 0.0, 1.0);',
    '  vec3 t = vec3(l2s(lin.r), l2s(lin.g), l2s(lin.b));',
    '  float S = uSpecSize;',
    '  vec2 p = t.rg * (S - 1.0);',
    '  float z = t.b * (S - 1.0);',
    '  float z0 = floor(z);',
    '  if (z0 > S - 2.0) z0 = S - 2.0;',
    '  vec3 a = specSlice(z0, p);',
    '  vec3 b = specSlice(z0 + 1.0, p);',
    '  return mix(a, b, z - z0);',
    '}',
    'void main(){',
    '  vec3 c = texture2D(uSrc, vUv).rgb;',
    '  gl_FragColor = vec4(clamp(specSample(c), 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  /* P2 镜头：中心锐利，越靠边越柔，R/B 通道沿径向反向偏移形成横向色差。
     softness / ca 单位是 1080px 短边时的像素，由 JS 按成片尺寸缩放。 */
  var LENS_FS = PRECISION + [
    'varying vec2 vUv;',
    'uniform sampler2D uColor;',
    'uniform vec2 uRes;',
    'uniform float uSoft, uCA;',
    'vec3 softSample(vec2 uv, float soft){',
    '  if (soft < 0.001) return texture2D(uColor, clamp(uv, 0.0, 1.0)).rgb;',
    '  vec2 o = vec2(soft) / uRes;',
    '  return 0.25 * (',
    '    texture2D(uColor, clamp(uv + vec2(o.x, 0.0), 0.0, 1.0)).rgb +',
    '    texture2D(uColor, clamp(uv - vec2(o.x, 0.0), 0.0, 1.0)).rgb +',
    '    texture2D(uColor, clamp(uv + vec2(0.0, o.y), 0.0, 1.0)).rgb +',
    '    texture2D(uColor, clamp(uv - vec2(0.0, o.y), 0.0, 1.0)).rgb',
    '  );',
    '}',
    'void main(){',
    '  vec2 p = (vUv - 0.5) * uRes;',
    '  float rr = dot(p, p) / dot(uRes * 0.5, uRes * 0.5);',
    '  float pl = length(p);',
    '  vec2 dir = pl > 0.0001 ? p / pl : vec2(0.0);',
    '  float soft = uSoft * rr;',
    '  float ca = uCA * rr;',
    '  vec2 off = dir * ca / uRes;',
    '  vec3 cr = softSample(vUv + off, soft);',
    '  vec3 cg = softSample(vUv, soft);',
    '  vec3 cb = softSample(vUv - off, soft);',
    '  gl_FragColor = vec4(cr.r, cg.g, cb.b, 1.0);',
    '}'
  ].join('\n');

  var BRIGHT_FS = PRECISION + [
    'varying vec2 vUv;',
    'uniform sampler2D uColor;',
    'uniform float uThr;',
    'void main(){',
    '  vec3 c = texture2D(uColor, vUv).rgb;',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float m = l > uThr ? (l - uThr) / (1.0 - uThr) : 0.0;',
    '  m *= m;',
    '  gl_FragColor = vec4(m, m, m, 1.0);',
    '}'
  ].join('\n');

  var BLUR_FS = PRECISION + [
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  s += texture2D(uTex, vUv - uDir * 4.0).rgb * 0.0162;',
    '  s += texture2D(uTex, vUv - uDir * 3.0).rgb * 0.0540;',
    '  s += texture2D(uTex, vUv - uDir * 2.0).rgb * 0.1216;',
    '  s += texture2D(uTex, vUv - uDir * 1.0).rgb * 0.1946;',
    '  s += texture2D(uTex, vUv).rgb * 0.2270;',
    '  s += texture2D(uTex, vUv + uDir * 1.0).rgb * 0.1946;',
    '  s += texture2D(uTex, vUv + uDir * 2.0).rgb * 0.1216;',
    '  s += texture2D(uTex, vUv + uDir * 3.0).rgb * 0.0540;',
    '  s += texture2D(uTex, vUv + uDir * 4.0).rgb * 0.0162;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var COMP_FS = PRECISION + [
    'varying vec2 vUv;',
    'uniform sampler2D uColor, uMask, uMaskBloom, uNoise, uNoiseSoft;',
    'uniform vec2 uRes, uNoiseOff;',
    'uniform float uHalo, uBloom, uGrain, uGrainShadow, uGrainSize;',
    'uniform float uGrainMono, uGrainCoarseScale, uGrainCoarseAmt;',
    'uniform float uVig, uLeak, uLeakTop, uLeakBot, uFlash;',
    'uniform vec3 uHaloColor, uBloomColor;',
    'void main(){',
    '  vec3 c = texture2D(uColor, vUv).rgb;',
    '  vec2 px = vUv * uRes;',
    '  float yTop = (1.0 - vUv.y) * uRes.y;',
    '  float maskV = texture2D(uMask, vUv).r;',
    '  float maskBV = texture2D(uMaskBloom, vUv).r;',
    '  float m = maskV * uHalo;',
    '  c = 1.0 - (1.0 - c) * (1.0 - m * uHaloColor);',
    '  float mb = maskBV * uBloom;',
    '  c = 1.0 - (1.0 - c) * (1.0 - mb * uBloomColor);',
    '  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float toneW = 0.62 + 0.62 * sin(3.14159265 * lum);',
    '  float hlW = 1.0 - 0.35 * smoothstep(0.72, 1.0, lum);',
    '  float ga = uGrain * 0.70 * toneW * (1.0 + uGrainShadow * (1.0 - lum)) * hlW;',
    '  ga = min(ga, 0.125 + max(0.0, ga - 0.125) * 0.35);',
    '  vec2 gp = floor(px / uGrainSize);',
    '  /* 512 纹理直接平铺会每 512px 重复同一片颗粒；按纹理块给不同的整数位移，',
    '     既保持随机分布，又打散平铺周期 */',
    '  vec2 gt = floor(gp / 512.0);',
    '  vec2 gj = vec2(137.0, 71.0) * gt + vec2(53.0, 29.0) * gt.yx;',
    '  vec3 nA = texture2D(uNoise, (gp + uNoiseOff + gj) * (1.0 / 512.0)).rgb;',
    '  float n1 = nA.r * 2.0 - 1.0;',
    '  float n2 = nA.b * 2.0 - 1.0;',
    '  vec2 cp = px / (uGrainSize * uGrainCoarseScale);',
    '  vec2 ct = floor(cp / 512.0);',
    '  vec2 cj = vec2(191.0, 83.0) * ct + vec2(31.0, 109.0) * ct.yx;',
    '  float nC = texture2D(uNoiseSoft, (cp + uNoiseOff + cj) * (1.0 / 512.0)).g * 2.0 - 1.0;',
    '  float nL = n1 * 0.78 + nC * uGrainCoarseAmt;',
    '  float nCh = n2 * 0.30;',
    '  if (uGrainMono > 0.5) {',
    '    c += vec3(nL * ga);',
    '  } else {',
    '    c.r += (nL + nCh * 0.55) * ga;',
    '    c.g += (nL - nCh * 0.10) * ga;',
    '    c.b += (nL - nCh * 0.55) * ga;',
    '  }',
    '  vec2 d = (px - uRes * 0.5) / length(uRes * 0.5);',
    '  float dv = length(d);',
    '  float vf = 1.0 - uVig * smoothstep(0.45, 1.02, dv);',
    '  c *= vf;',
    '  float leakV = (1.0 - smoothstep(uLeakTop, uLeakBot, yTop)) * uLeak;',
    '  if (leakV > 0.0) {',
    '    float lf = leakV * pow(1.0 - vUv.x, 1.6);',
    '    c += vec3(lf, lf * 0.42, lf * 0.10);',
    '  }',
    '  if (uFlash > 0.0) {',
    '    float fw = 1.0 - smoothstep(0.12, 0.92, dv);',
    '    float fa = fw * uFlash;',
    '    c += vec3(fa, fa * 0.94, fa * 0.86);',
    '  }',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (window.console) console.warn('SPOOLO gpu shader:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function makeProgram(gl, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, VS);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (window.console) console.warn('SPOOLO gpu program:', gl.getProgramInfoLog(p));
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return p;
  }

  function GLDevelop() {
    var canvas = document.createElement('canvas');
    var gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      gl = null;
    }
    if (!gl) return null;

    var colorP = makeProgram(gl, COLOR_FS);
    var lensP = makeProgram(gl, LENS_FS);
    var brightP = makeProgram(gl, BRIGHT_FS);
    var blurP = makeProgram(gl, BLUR_FS);
    var compP = makeProgram(gl, COMP_FS);
    if (!colorP || !lensP || !brightP || !blurP || !compP) return null;

    var U = {
      color: {
        src: gl.getUniformLocation(colorP, 'uSrc'),
        spec: gl.getUniformLocation(colorP, 'uSpec'),
        specExp: gl.getUniformLocation(colorP, 'uSpecExp'),
        specSize: gl.getUniformLocation(colorP, 'uSpecSize'),
        specTiles: gl.getUniformLocation(colorP, 'uSpecTiles'),
        specRows: gl.getUniformLocation(colorP, 'uSpecRows')
      },
      lens: {
        src: gl.getUniformLocation(lensP, 'uColor'),
        res: gl.getUniformLocation(lensP, 'uRes'),
        soft: gl.getUniformLocation(lensP, 'uSoft'),
        ca: gl.getUniformLocation(lensP, 'uCA')
      },
      bright: {
        color: gl.getUniformLocation(brightP, 'uColor'),
        thr: gl.getUniformLocation(brightP, 'uThr')
      },
      blur: {
        tex: gl.getUniformLocation(blurP, 'uTex'),
        dir: gl.getUniformLocation(blurP, 'uDir')
      },
      comp: {
        color: gl.getUniformLocation(compP, 'uColor'),
        mask: gl.getUniformLocation(compP, 'uMask'),
        maskBloom: gl.getUniformLocation(compP, 'uMaskBloom'),
        noise: gl.getUniformLocation(compP, 'uNoise'),
        noiseSoft: gl.getUniformLocation(compP, 'uNoiseSoft'),
        res: gl.getUniformLocation(compP, 'uRes'),
        noiseOff: gl.getUniformLocation(compP, 'uNoiseOff'),
        halo: gl.getUniformLocation(compP, 'uHalo'),
        bloom: gl.getUniformLocation(compP, 'uBloom'),
        haloColor: gl.getUniformLocation(compP, 'uHaloColor'),
        bloomColor: gl.getUniformLocation(compP, 'uBloomColor'),
        grain: gl.getUniformLocation(compP, 'uGrain'),
        grainShadow: gl.getUniformLocation(compP, 'uGrainShadow'),
        grainSize: gl.getUniformLocation(compP, 'uGrainSize'),
        grainMono: gl.getUniformLocation(compP, 'uGrainMono'),
        grainCoarseScale: gl.getUniformLocation(compP, 'uGrainCoarseScale'),
        grainCoarseAmt: gl.getUniformLocation(compP, 'uGrainCoarseAmt'),
        vig: gl.getUniformLocation(compP, 'uVig'),
        leak: gl.getUniformLocation(compP, 'uLeak'),
        leakTop: gl.getUniformLocation(compP, 'uLeakTop'),
        leakBot: gl.getUniformLocation(compP, 'uLeakBot'),
        flash: gl.getUniformLocation(compP, 'uFlash')
      }
    };

    /* 共用全屏四边形；所有程序都把 aPos 绑到 0 */
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(colorP);
    gl.uniform1i(U.color.src, 0);
    gl.uniform1i(U.color.spec, 2);
    gl.useProgram(lensP);
    gl.uniform1i(U.lens.src, 0);
    gl.useProgram(brightP);
    gl.uniform1i(U.bright.color, 0);
    gl.useProgram(blurP);
    gl.uniform1i(U.blur.tex, 0);
    gl.useProgram(compP);
    gl.uniform1i(U.comp.color, 0);
    gl.uniform1i(U.comp.mask, 1);
    gl.uniform1i(U.comp.maskBloom, 4);
    gl.uniform1i(U.comp.noise, 2);
    gl.uniform1i(U.comp.noiseSoft, 3);

    var W = 0, H = 0, HW = 0, HH = 0;
    var srcTex = null, specTex = null, noiseTex = null, noiseSoftTex = null, noiseData = null;
    var colorT = null, colorFbo = null;
    var lensT = null, lensFbo = null;
    var maskA = null, maskAFbo = null;
    var maskB = null, maskBFbo = null;
    var maskC = null, maskCFbo = null;

    /* CPU 生成的噪声纹理：比浮点 hash 稳定，不会在大坐标上出现周期网格 */
    function hashNoise(x, y, seed) {
      var n = Math.imul(x, 1619) ^ Math.imul(y, 31337) ^ Math.imul(seed, 6971);
      n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
      n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
      n ^= n >>> 15;
      return (n >>> 0) / 2147483647.5 - 1;
    }

    function getNoiseData() {
      if (noiseData) return noiseData;
      var N = 512;
      var data = new Uint8Array(N * N * 4);
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var i = (y * N + x) * 4;
          data[i] = (hashNoise(x, y, 17) + 1) * 127.5;
          data[i + 1] = (hashNoise(x, y, 29) + 1) * 127.5;
          data[i + 2] = (hashNoise(x, y, 43) + 1) * 127.5;
          data[i + 3] = 255;
        }
      }
      noiseData = data;
      return data;
    }

    function makeNoiseTexture(filter) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, getNoiseData());
      return t;
    }

    function getNoise() {
      if (!noiseTex) noiseTex = makeNoiseTexture(gl.NEAREST);
      return noiseTex;
    }

    /* 同一份噪声数据的线性过滤版本：采样在更粗的尺度上，得到柔和的颗粒团块 */
    function getSoftNoise() {
      if (!noiseSoftTex) noiseSoftTex = makeNoiseTexture(gl.LINEAR);
      return noiseSoftTex;
    }

    function tex(w, h, filter) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    }

    function fbo(t) {
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return f;
    }

    function dispose() {
      [srcTex, specTex, colorT, lensT, maskA, maskB, maskC].forEach(function (t) { if (t) gl.deleteTexture(t); });
      [colorFbo, lensFbo, maskAFbo, maskBFbo, maskCFbo].forEach(function (f) { if (f) gl.deleteFramebuffer(f); });
      srcTex = specTex = colorT = lensT = maskA = maskB = maskC = null;
      colorFbo = lensFbo = maskAFbo = maskBFbo = maskCFbo = null;
    }

    function ensureSize(w, h) {
      if (w === W && h === H && colorT) return;
      dispose();
      W = w;
      H = h;
      HW = Math.max(2, w >> 1);
      HH = Math.max(2, h >> 1);
      canvas.width = w;
      canvas.height = h;

      srcTex = tex(w, h, gl.LINEAR);
      colorT = tex(w, h, gl.LINEAR);
      colorFbo = fbo(colorT);
      lensT = tex(w, h, gl.LINEAR);
      lensFbo = fbo(lensT);
      maskA = tex(HW, HH, gl.LINEAR);
      maskAFbo = fbo(maskA);
      maskB = tex(HW, HH, gl.LINEAR);
      maskBFbo = fbo(maskB);
      maskC = tex(HW, HH, gl.LINEAR);
      maskCFbo = fbo(maskC);

      specTex = tex(1, 1, gl.LINEAR);
    }

    function draw(target, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target || null);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(srcCanvas, w, h, film, opts) {
      if (!srcCanvas || !w || !h || !film) return false;
      opts = opts || {};
      try {
        ensureSize(w, h);

        /* 源图 */
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

        /* 色彩：spektrafilm 的 3D LUT，以 2D 图集承载 */
        var spec = opts.spectralLut || null;
        if (!spec) return false;

        /* 1. 色彩到全分辨率纹理 */
        gl.useProgram(colorP);
        gl.uniform1f(U.color.specExp, Math.pow(2, opts.ev || 0));
        gl.uniform1f(U.color.specSize, spec.size);
        gl.uniform1f(U.color.specTiles, spec.tiles);
        gl.uniform1f(U.color.specRows, spec.rows);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, specTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, spec.atlasW, spec.atlasH, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, spec.atlas);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        draw(colorFbo, W, H);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        /* P2 镜头：柔化 + 横向色差，输出到 lensT；后面所有步骤都读这张 */
        var lens = SP.lensModel ? SP.lensModel(film) : { softness: 0, ca: 0 };
        var lensScale = Math.min(W, H) / 1080;
        var lensSoft = lens.softness * lensScale;
        var lensCA = lens.ca * lensScale;
        var wantLens = !!opts.lens && (lensSoft > 0.01 || lensCA > 0.01);
        var colorTex = colorT;
        if (wantLens) {
          gl.useProgram(lensP);
          gl.uniform2f(U.lens.res, W, H);
          gl.uniform1f(U.lens.soft, lensSoft);
          gl.uniform1f(U.lens.ca, lensCA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, colorT);
          draw(lensFbo, W, H);
          colorTex = lensT;
        }

        var wantHalo = !!opts.halation && !!film.halation && film.halation.amount > 0;
        var wantBloom = !!opts.bloom;
        var wantMask = wantHalo || wantBloom;
        var bloomAmt = wantBloom ? (film.bloom && film.bloom.amount != null ? film.bloom.amount : 0.12) : 0;
        var bloomCol = film.bloom && film.bloom.color ? film.bloom.color : [1, 0.96, 0.90];
        if (wantMask) {
          /* 2. 半分辨率亮部遮罩：halation 和全局 bloom 共用 */
          gl.useProgram(brightP);
          gl.uniform1f(U.bright.thr, wantHalo ? film.halation.threshold : 0.72);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, colorTex);
          draw(maskAFbo, HW, HH);

          /* 3. 两轮可分离模糊，近似 CPU 的两遍盒式模糊 */
          var hr = wantHalo ? Math.max(1, Math.round(film.halation.radius / 2)) : 4;
          var step = hr / 4;
          gl.useProgram(blurP);
          for (var pass = 0; pass < 2; pass++) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, maskA);
            gl.uniform2f(U.blur.dir, step / HW, 0);
            draw(maskBFbo, HW, HH);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, maskB);
            gl.uniform2f(U.blur.dir, 0, step / HH);
            draw(maskAFbo, HW, HH);
          }

          /* 全局 bloom 用更大半径再糊一次：从紧贴高光的光晕扩散成柔和的镜头辉光 */
          if (wantBloom) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, maskA);
            gl.uniform2f(U.blur.dir, 0, 0);
            draw(maskCFbo, HW, HH);

            var br = Math.max(3, Math.round(Math.min(HW, HH) / 60));
            var bstep = br / 4;
            for (var bp = 0; bp < 2; bp++) {
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, maskC);
              gl.uniform2f(U.blur.dir, bstep / HW, 0);
              draw(maskBFbo, HW, HH);

              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, maskB);
              gl.uniform2f(U.blur.dir, 0, bstep / HH);
              draw(maskCFbo, HW, HH);
            }
          }
        }

        /* 4. 合成到默认帧缓冲 */
        gl.useProgram(compP);
        gl.uniform2f(U.comp.res, W, H);
        gl.uniform1f(U.comp.halo, wantHalo ? film.halation.amount : 0);
        gl.uniform1f(U.comp.bloom, bloomAmt);
        gl.uniform3f(U.comp.bloomColor, bloomCol[0], bloomCol[1], bloomCol[2]);
        if (wantHalo) {
          gl.uniform3f(U.comp.haloColor,
            film.halation.color[0], film.halation.color[1], film.halation.color[2]);
        } else {
          gl.uniform3f(U.comp.haloColor, 0, 0, 0);
        }
        var grain = film.grain || { amount: 0 };
        gl.uniform1f(U.comp.grain, opts.grain ? grain.amount * (opts.grainScale || 1) : 0);
        gl.uniform1f(U.comp.grainShadow, grain.shadow || 0);
        gl.uniform1f(U.comp.grainSize, grain.size || 1);
        gl.uniform1f(U.comp.grainMono, 0);
        gl.uniform1f(U.comp.grainCoarseScale,
          grain.coarseScale || (film.iso >= 1600 ? 5 : film.iso >= 800 ? 4 : film.iso >= 400 ? 3 : 2));
        gl.uniform1f(U.comp.grainCoarseAmt,
          grain.coarse != null ? grain.coarse : (film.iso >= 800 ? 0.55 : film.iso >= 400 ? 0.50 : 0.38));
        var noiseSeed = (opts.seed == null ? 7 : opts.seed) | 0;
        gl.uniform2f(U.comp.noiseOff,
          ((noiseSeed % 512) + 512) % 512,
          (((noiseSeed * 7) % 512) + 512) % 512);
        gl.uniform1f(U.comp.vig, opts.vignette ? film.vignette : 0);
        gl.uniform1f(U.comp.leak, opts.leak ? film.leak : 0);
        gl.uniform1f(U.comp.leakTop, H * 0.34);
        gl.uniform1f(U.comp.leakBot, H * 0.94);
        gl.uniform1f(U.comp.flash, (opts.flash || 0) * 56 / 255);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colorTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskA || colorT);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, getNoise());
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, getSoftNoise());
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, maskC);
        draw(null, W, H);

        return true;
      } catch (e) {
        return false;
      }
    }

    return { canvas: canvas, render: render };
  }

  SP.GLDevelop = GLDevelop;
})(window);
