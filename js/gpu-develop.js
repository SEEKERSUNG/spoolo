/* ==========================================================================
   SPOOLO · 成片 GPU 管线
   - 色彩：LUT / 饱和 / 分离调色
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
    'uniform sampler2D uSrc, uLut;',
    'uniform float uMono, uSat, uVib;',
    'uniform vec3 uST, uHT;',
    'float lutR(float v){ return texture2D(uLut, vec2(v * 0.99609375 + 0.001953125, 0.5)).r; }',
    'float lutG(float v){ return texture2D(uLut, vec2(v * 0.99609375 + 0.001953125, 0.5)).g; }',
    'float lutB(float v){ return texture2D(uLut, vec2(v * 0.99609375 + 0.001953125, 0.5)).b; }',
    'void main(){',
    '  vec3 c = texture2D(uSrc, vUv).rgb;',
    '  vec3 col;',
    '  if (uMono > 0.5) {',
    '    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '    col = vec3(lutR(l));',
    '  } else {',
    '    vec3 t = vec3(lutR(c.r), lutG(c.g), lutB(c.b));',
    '    float lum = dot(t, vec3(0.2126, 0.7152, 0.0722));',
    '    float mx = max(max(t.r, t.g), t.b);',
    '    float mn = min(min(t.r, t.g), t.b);',
    '    float s = uSat + uVib * (1.0 - (mx - mn));',
    '    col = vec3(lum) + (t - vec3(lum)) * s;',
    '  }',
    '  float nrm = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col += uST * (1.0 - nrm) + uHT * nrm;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
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
    'uniform sampler2D uColor, uMask, uNoise;',
    'uniform vec2 uRes, uNoiseOff;',
    'uniform float uHalo, uGrain, uGrainShadow, uGrainSize;',
    'uniform float uVig, uLeak, uLeakTop, uLeakBot, uFlash;',
    'uniform vec3 uHaloColor;',
    'void main(){',
    '  vec3 c = texture2D(uColor, vUv).rgb;',
    '  vec2 px = vUv * uRes;',
    '  float yTop = (1.0 - vUv.y) * uRes.y;',
    '  float m = texture2D(uMask, vUv).r * uHalo;',
    '  c = 1.0 - (1.0 - c) * (1.0 - m * uHaloColor);',
    '  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float ga = uGrain * (1.0 + uGrainShadow * (1.0 - lum));',
    '  vec2 gp = floor(px / uGrainSize);',
    '  vec3 nA = texture2D(uNoise, (gp + uNoiseOff) * (1.0 / 512.0)).rgb;',
    '  vec3 nB = texture2D(uNoise, (gp * 0.61 + uNoiseOff.yx + 17.0) * (1.0 / 512.0)).rgb;',
    '  float n1 = nA.r * 2.0 - 1.0;',
    '  float n2 = (nA.b * 0.65 + nB.g * 0.35) * 2.0 - 1.0;',
    '  c.r += n1 * ga;',
    '  c.g += (n1 * 0.62 + n2 * 0.38) * ga;',
    '  c.b += n2 * ga;',
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
    var brightP = makeProgram(gl, BRIGHT_FS);
    var blurP = makeProgram(gl, BLUR_FS);
    var compP = makeProgram(gl, COMP_FS);
    if (!colorP || !brightP || !blurP || !compP) return null;

    var U = {
      color: {
        src: gl.getUniformLocation(colorP, 'uSrc'),
        lut: gl.getUniformLocation(colorP, 'uLut'),
        mono: gl.getUniformLocation(colorP, 'uMono'),
        sat: gl.getUniformLocation(colorP, 'uSat'),
        vib: gl.getUniformLocation(colorP, 'uVib'),
        st: gl.getUniformLocation(colorP, 'uST'),
        ht: gl.getUniformLocation(colorP, 'uHT')
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
        noise: gl.getUniformLocation(compP, 'uNoise'),
        res: gl.getUniformLocation(compP, 'uRes'),
        noiseOff: gl.getUniformLocation(compP, 'uNoiseOff'),
        halo: gl.getUniformLocation(compP, 'uHalo'),
        haloColor: gl.getUniformLocation(compP, 'uHaloColor'),
        grain: gl.getUniformLocation(compP, 'uGrain'),
        grainShadow: gl.getUniformLocation(compP, 'uGrainShadow'),
        grainSize: gl.getUniformLocation(compP, 'uGrainSize'),
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
    gl.uniform1i(U.color.lut, 1);
    gl.useProgram(brightP);
    gl.uniform1i(U.bright.color, 0);
    gl.useProgram(blurP);
    gl.uniform1i(U.blur.tex, 0);
    gl.useProgram(compP);
    gl.uniform1i(U.comp.color, 0);
    gl.uniform1i(U.comp.mask, 1);
    gl.uniform1i(U.comp.noise, 2);

    var W = 0, H = 0, HW = 0, HH = 0;
    var srcTex = null, lutTex = null, noiseTex = null;
    var colorT = null, colorFbo = null;
    var maskA = null, maskAFbo = null;
    var maskB = null, maskBFbo = null;

    /* CPU 生成的噪声纹理：比浮点 hash 稳定，不会在大坐标上出现周期网格 */
    function hashNoise(x, y, seed) {
      var n = Math.imul(x, 1619) ^ Math.imul(y, 31337) ^ Math.imul(seed, 6971);
      n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
      n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
      n ^= n >>> 15;
      return (n >>> 0) / 2147483647.5 - 1;
    }

    function getNoise() {
      if (noiseTex) return noiseTex;
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
      noiseTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return noiseTex;
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
      [srcTex, lutTex, colorT, maskA, maskB].forEach(function (t) { if (t) gl.deleteTexture(t); });
      [colorFbo, maskAFbo, maskBFbo].forEach(function (f) { if (f) gl.deleteFramebuffer(f); });
      srcTex = lutTex = colorT = maskA = maskB = null;
      colorFbo = maskAFbo = maskBFbo = null;
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
      maskA = tex(HW, HH, gl.LINEAR);
      maskAFbo = fbo(maskA);
      maskB = tex(HW, HH, gl.LINEAR);
      maskBFbo = fbo(maskB);

      lutTex = tex(256, 1, gl.NEAREST);
    }

    function draw(target, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target || null);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function render(srcCanvas, w, h, film, opts) {
      if (!srcCanvas || !w || !h || !film || !SP.buildLUT) return false;
      opts = opts || {};
      try {
        ensureSize(w, h);

        /* 源图 */
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

        /* LUT */
        var L = SP.buildLUT(film, opts.ev || 0);
        var data = new Uint8Array(1024);
        for (var i = 0; i < 256; i++) {
          if (L.mono) {
            var v = L.mono[i];
            data[i * 4] = v;
            data[i * 4 + 1] = v;
            data[i * 4 + 2] = v;
          } else {
            data[i * 4] = L.lut[i];
            data[i * 4 + 1] = L.lut[i + 256];
            data[i * 4 + 2] = L.lut[i + 512];
          }
          data[i * 4 + 3] = 255;
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

        /* 1. 色彩到全分辨率纹理 */
        gl.useProgram(colorP);
        gl.uniform1f(U.color.mono, film.bw ? 1 : 0);
        gl.uniform1f(U.color.sat, film.bw ? 0 : film.sat);
        gl.uniform1f(U.color.vib, film.bw ? 0 : film.vibrance);
        gl.uniform3f(U.color.st, film.shadowTint[0], film.shadowTint[1], film.shadowTint[2]);
        gl.uniform3f(U.color.ht, film.highTint[0], film.highTint[1], film.highTint[2]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        draw(colorFbo, W, H);

        var wantHalo = !!opts.halation && !!film.halation;
        if (wantHalo) {
          /* 2. 半分辨率亮部遮罩 */
          gl.useProgram(brightP);
          gl.uniform1f(U.bright.thr, film.halation.threshold);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, colorT);
          draw(maskAFbo, HW, HH);

          /* 3. 两轮可分离模糊，近似 CPU 的两遍盒式模糊 */
          var hr = Math.max(1, Math.round(film.halation.radius / 2));
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
        }

        /* 4. 合成到默认帧缓冲 */
        gl.useProgram(compP);
        gl.uniform2f(U.comp.res, W, H);
        gl.uniform1f(U.comp.halo, wantHalo ? film.halation.amount : 0);
        if (wantHalo) {
          gl.uniform3f(U.comp.haloColor,
            film.halation.color[0], film.halation.color[1], film.halation.color[2]);
        } else {
          gl.uniform3f(U.comp.haloColor, 0, 0, 0);
        }
        gl.uniform1f(U.comp.grain, opts.grain ? film.grain.amount * (opts.grainScale || 1) : 0);
        gl.uniform1f(U.comp.grainShadow, film.grain.shadow || 0);
        gl.uniform1f(U.comp.grainSize, film.grain.size || 1);
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
        gl.bindTexture(gl.TEXTURE_2D, colorT);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskA);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, getNoise());
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
