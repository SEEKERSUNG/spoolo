/* ==========================================================================
   SPOOLO · 胶卷引擎 (film stock engine)
   - 每种胶卷用「缩写代号」命名，仿色自经典乳剂，但不直接使用其商标名
   - 色彩科学：分通道 LUT 曲线 + 饱和/鲜艳度 + 阴影高光分离调色
   - 颗粒 / 光晕(halation) / 暗角 / 漏光 实时合成
   ========================================================================== */
(function (global) {
  'use strict';

  /* --- 胶卷预设 --------------------------------------------------------- */
  /* contrast/lift/gamma/gain 均为 [R,G,B]；lift/gain 为 0-1 域的微量偏移
     shadowTint/highTint 为按亮度加权的通道微调（1 = 255 级） */
  var FILMS = [
    {
      code: 'PT-400', name: '暖肤人像', en: 'SOFT PORTRAIT', process: 'C-41', iso: 400,
      note: '奶油般的低反差，肤色通透、高光柔和不刺眼。',
      tone: '#c9a888',
      contrast: [0.93, 0.92, 0.90], lift: [0.030, 0.024, 0.016],
      gamma: [1.00, 1.00, 1.02], gain: [1.05, 1.00, 0.96],
      sat: 0.97, vibrance: 0.12,
      shadowTint: [0.016, 0.008, -0.004], highTint: [0.030, 0.010, -0.022],
      shoulder: 0.68,
      halation: { amount: 0.16, radius: 9, threshold: 0.70, color: [1, 0.45, 0.26] },
      grain: { amount: 0.045, size: 1, shadow: 1.6 }, vignette: 0.18, leak: 0
    },
    {
      code: 'GD-200', name: '暖金日常', en: 'GOLDEN DAY', process: 'C-41', iso: 200,
      note: '金黄厚重，中调饱满，日常与街拍都很有年代感。',
      tone: '#d8a24a',
      contrast: [1.06, 1.02, 0.96], lift: [0.018, 0.026, 0.010],
      gamma: [0.98, 1.00, 1.04], gain: [1.08, 1.00, 0.90],
      sat: 1.14, vibrance: 0.16,
      shadowTint: [0.006, 0.014, 0.004], highTint: [0.040, 0.020, -0.030],
      shoulder: 0.72,
      halation: { amount: 0.14, radius: 8, threshold: 0.74, color: [1, 0.50, 0.28] },
      grain: { amount: 0.060, size: 1, shadow: 1.8 }, vignette: 0.22, leak: 0
    },
    {
      code: 'EK-100', name: '浓艳风光', en: 'VIVID SCENE', process: 'C-41', iso: 100,
      note: '极高饱和与通透深蓝，颗粒细到几乎看不见。',
      tone: '#a8533f',
      contrast: [1.14, 1.10, 1.08], lift: [0.004, 0.004, 0.010],
      gamma: [0.99, 1.00, 0.98], gain: [1.06, 1.00, 1.02],
      sat: 1.30, vibrance: 0.20,
      shadowTint: [0.000, 0.004, 0.014], highTint: [0.020, 0.000, -0.010],
      shoulder: 0.76,
      halation: { amount: 0.10, radius: 7, threshold: 0.80, color: [1, 0.40, 0.24] },
      grain: { amount: 0.028, size: 1, shadow: 1.3 }, vignette: 0.16, leak: 0
    },
    {
      code: 'SP-400', name: '青绿街拍', en: 'GREEN STREET', process: 'C-41', iso: 400,
      note: '阴影偏青绿、高光带洋红，日系街拍的标志性偏色。',
      tone: '#5f9e6a',
      contrast: [1.02, 1.03, 1.00], lift: [0.016, 0.024, 0.020],
      gamma: [1.00, 0.99, 1.00], gain: [1.02, 1.03, 0.96],
      sat: 1.08, vibrance: 0.14,
      shadowTint: [-0.006, 0.020, 0.012], highTint: [0.026, -0.006, 0.010],
      shoulder: 0.70,
      halation: { amount: 0.15, radius: 9, threshold: 0.72, color: [1, 0.42, 0.30] },
      grain: { amount: 0.065, size: 1, shadow: 1.9 }, vignette: 0.22, leak: 0
    },
    {
      code: 'VL-50', name: '极致浓郁', en: 'MAX COLOR', process: 'E-6', iso: 50,
      note: '反转片式的浓烈，红与绿几乎要溢出，蓝得发紫。',
      tone: '#b62b3a',
      contrast: [1.26, 1.16, 1.12], lift: [-0.004, 0.000, 0.006],
      gamma: [1.00, 1.00, 0.98], gain: [1.04, 0.99, 1.02],
      sat: 1.52, vibrance: 0.28,
      shadowTint: [0.006, 0.000, 0.008], highTint: [0.045, -0.010, 0.010],
      shoulder: 0.82,
      halation: { amount: 0.12, radius: 8, threshold: 0.78, color: [1, 0.35, 0.28] },
      grain: { amount: 0.030, size: 1, shadow: 1.4 }, vignette: 0.24, leak: 0
    },
    {
      code: 'CS-800', name: '钨丝夜灯', en: 'TUNGSTEN NIGHT', process: 'C-41', iso: 800,
      note: '夜色冷青底子，强光处晕出大片橙红，霓虹片首选。',
      tone: '#2f6f8f',
      contrast: [1.02, 1.00, 1.04], lift: [0.030, 0.032, 0.042],
      gamma: [1.00, 1.00, 0.97], gain: [0.97, 1.00, 1.06],
      sat: 1.06, vibrance: 0.18,
      shadowTint: [-0.010, 0.004, 0.022], highTint: [0.010, -0.004, 0.020],
      shoulder: 0.74,
      halation: { amount: 0.40, radius: 14, threshold: 0.58, color: [1, 0.35, 0.22] },
      grain: { amount: 0.100, size: 2, shadow: 2.2 }, vignette: 0.26, leak: 0
    },
    {
      code: 'TX-400', name: '粗粒黑白', en: 'GRITTY MONO', process: 'B&W', iso: 400,
      note: '黑白、硬朗、颗粒粗，阴影压得下去也有细节。',
      tone: '#6d6a63', bw: true,
      contrast: 1.30, lift: -0.006, gamma: 1.00, gain: 1.04, shoulder: 0.74,
      shadowTint: [0.004, 0.002, 0.010], highTint: [0.008, 0.006, 0.004],
      grain: { amount: 0.085, size: 1, shadow: 2.0 }, vignette: 0.22, leak: 0
    },
    {
      code: 'AC-100', name: '细腻黑白', en: 'FINE MONO', process: 'B&W', iso: 100,
      note: '极细颗粒与超长灰阶，安静、克制的黑白。',
      tone: '#8d8f92', bw: true,
      contrast: 1.06, lift: 0.006, gamma: 1.02, gain: 1.00, shoulder: 0.80,
      shadowTint: [-0.002, 0.000, 0.010], highTint: [0.006, 0.006, 0.010],
      grain: { amount: 0.028, size: 1, shadow: 1.2 }, vignette: 0.14, leak: 0
    },
    {
      code: 'AV-200', name: '褪色柔调', en: 'FADED SOFT', process: 'C-41', iso: 200,
      note: '黑位抬起、彩度收敛的旧照片气，粉调温柔。',
      tone: '#c07a86',
      contrast: [0.92, 0.92, 0.90], lift: [0.040, 0.032, 0.030],
      gamma: [1.02, 1.00, 1.00], gain: [1.02, 1.00, 0.99],
      sat: 0.90, vibrance: 0.10,
      shadowTint: [0.014, 0.004, 0.012], highTint: [0.030, 0.010, 0.014],
      shoulder: 0.66,
      halation: { amount: 0.18, radius: 10, threshold: 0.70, color: [1, 0.50, 0.34] },
      grain: { amount: 0.050, size: 1, shadow: 1.6 }, vignette: 0.20, leak: 0.10
    },
    {
      code: 'LC-800', name: '野性漏光', en: 'WILD LEAK', process: 'C-41', iso: 800,
      note: '高饱和、大颗粒、重暗角，还会偷偷漏一点光进来。',
      tone: '#d94f2b',
      contrast: [1.16, 1.06, 1.02], lift: [0.020, 0.026, 0.034],
      gamma: [0.98, 1.00, 1.00], gain: [1.06, 0.99, 0.96],
      sat: 1.34, vibrance: 0.22,
      shadowTint: [-0.008, 0.014, 0.026], highTint: [0.040, 0.012, -0.020],
      shoulder: 0.70,
      halation: { amount: 0.26, radius: 12, threshold: 0.62, color: [1, 0.40, 0.28] },
      grain: { amount: 0.120, size: 2, shadow: 2.4 }, vignette: 0.40, leak: 0.34
    },
    {
      code: 'PR-160', name: '清透人像', en: 'CLEAN PORTRAIT', process: 'C-41', iso: 160,
      note: '低反差、极细颗粒，肤色干净通透，室内外人像都稳。',
      tone: '#d4b49c',
      contrast: [0.97, 0.96, 0.95], lift: [0.020, 0.016, 0.012],
      gamma: [1.00, 1.00, 1.01], gain: [1.02, 1.00, 0.99],
      sat: 1.02, vibrance: 0.10,
      shadowTint: [0.010, 0.008, 0.004], highTint: [0.014, 0.006, -0.006],
      shoulder: 0.72,
      halation: { amount: 0.10, radius: 7, threshold: 0.76, color: [1, 0.50, 0.32] },
      grain: { amount: 0.020, size: 1, shadow: 1.2 }, vignette: 0.13, leak: 0
    },
    {
      code: 'EV-100', name: '经典正片', en: 'CLASSIC CHROME', process: 'E-6', iso: 100,
      note: '通透正片：青蓝干净、绿色挺括，强光下也不容易发灰。',
      tone: '#3f7fa6',
      contrast: [1.13, 1.08, 1.05], lift: [0.004, 0.004, 0.008],
      gamma: [0.99, 1.00, 0.99], gain: [1.02, 1.01, 1.04],
      sat: 1.24, vibrance: 0.20,
      shadowTint: [-0.006, 0.006, 0.016], highTint: [0.012, 0.004, 0.008],
      shoulder: 0.78,
      halation: { amount: 0.08, radius: 6, threshold: 0.82, color: [1, 0.42, 0.26] },
      grain: { amount: 0.026, size: 1, shadow: 1.3 }, vignette: 0.16, leak: 0
    },
    {
      code: 'HP-400', name: '纪实黑白', en: 'DOCUMENTARY MONO', process: 'B&W', iso: 400,
      note: '中灰厚实、颗粒可见，街头与纪实黑白的主力。',
      tone: '#7a766d', bw: true,
      contrast: 1.16, lift: 0.002, gamma: 1.03, gain: 1.02, shoulder: 0.72,
      shadowTint: [0.002, 0.002, 0.006], highTint: [0.006, 0.006, 0.008],
      grain: { amount: 0.078, size: 1, shadow: 1.9 }, vignette: 0.20, leak: 0
    },
    {
      code: 'FL-200', name: '复古暖调', en: 'VINTAGE WARM', process: 'C-41', iso: 200,
      note: '金黄偏暖、黑位略抬，像翻出二十年前的旅行照片。',
      tone: '#c58a52',
      contrast: [1.00, 0.97, 0.93], lift: [0.028, 0.024, 0.020],
      gamma: [1.00, 1.00, 1.02], gain: [1.04, 1.00, 0.93],
      sat: 1.04, vibrance: 0.12,
      shadowTint: [0.010, 0.010, 0.000], highTint: [0.036, 0.018, -0.020],
      shoulder: 0.70,
      halation: { amount: 0.15, radius: 9, threshold: 0.72, color: [1, 0.48, 0.28] },
      grain: { amount: 0.052, size: 1, shadow: 1.6 }, vignette: 0.20, leak: 0.08
    },
    {
      code: 'NS-800', name: '霓虹夜色', en: 'NEON NIGHT', process: 'C-41', iso: 800,
      note: '紫红高光配青蓝阴影，大片光晕，专拍霓虹与夜景。',
      tone: '#8b3fa8',
      contrast: [1.00, 0.97, 1.06], lift: [0.034, 0.030, 0.048],
      gamma: [1.01, 1.00, 0.97], gain: [1.00, 0.98, 1.07],
      sat: 1.16, vibrance: 0.22,
      shadowTint: [-0.012, 0.002, 0.030], highTint: [0.030, -0.010, 0.034],
      shoulder: 0.72,
      halation: { amount: 0.50, radius: 16, threshold: 0.54, color: [1, 0.30, 0.40] },
      grain: { amount: 0.110, size: 2, shadow: 2.4 }, vignette: 0.30, leak: 0.10
    },
    {
      code: 'BL-400', name: '蓝调时刻', en: 'BLUE HOUR', process: 'C-41', iso: 400,
      note: '冷蓝阴影、克制的暖高光，黄昏之后的安静色调。',
      tone: '#3d6f9e',
      contrast: [1.04, 1.02, 0.98], lift: [0.024, 0.026, 0.034],
      gamma: [1.00, 1.00, 0.99], gain: [0.98, 1.00, 1.05],
      sat: 1.08, vibrance: 0.16,
      shadowTint: [-0.008, 0.004, 0.022], highTint: [0.010, 0.000, 0.016],
      shoulder: 0.74,
      halation: { amount: 0.22, radius: 11, threshold: 0.66, color: [1, 0.44, 0.30] },
      grain: { amount: 0.062, size: 1, shadow: 1.8 }, vignette: 0.24, leak: 0
    }
  ];

  /* --- 显示用指标（1-5 格）--------------------------------------------- */
  function meters(f) {
    var contrast = f.bw ? f.contrast * 0.98
      : (f.contrast[0] + f.contrast[1] + f.contrast[2]) / 3;
    var sat = f.bw ? 0 : f.sat;
    return {
      contrast: clampMeter((contrast - 0.86) / 0.45),
      sat: f.bw ? 0 : clampMeter((sat - 0.85) / 0.72),
      grain: clampMeter(f.grain.amount / 0.13),
      halo: f.halation ? clampMeter(f.halation.amount / 0.44) : 0
    };
  }
  function clampMeter(v) { return Math.max(1, Math.min(5, Math.round(v * 4) + 1)); }

  /* --- 曲线 ------------------------------------------------------------- */
  function softClip(y, s) {
    if (y <= s) return y;
    return s + (1 - s) * Math.tanh((y - s) / (1 - s));
  }

  /* shoulder 为高光肩部起点（每种乳剂自带，0.66–0.82）：数值越大，高光越亮、
     滚降越晚。全部曲线共用这一入口，不再写死 0.70 */
  function curve(x, contrast, lift, gamma, gain, shoulder) {
    var y = (x - 0.5) * contrast + 0.5 + lift;
    if (y < 0) y = 0;
    y = softClip(y, shoulder);
    if (gamma !== 1) y = Math.pow(y, gamma);
    y = y * gain;
    return y < 0 ? 0 : y > 1 ? 1 : y;
  }

  var lutCache = Object.create(null);

  /* 曝光补偿折进曲线，ISO 抽出「增感」换取颗粒与反差 */
  function buildLUT(film, ev) {
    var key = film.code + '|' + ev.toFixed(2);
    var hit = lutCache[key];
    if (hit) return hit;

    var expo = Math.pow(2, ev);
    var lut = new Uint8ClampedArray(768);
    var mono = film.bw ? new Uint8ClampedArray(256) : null;
    /* 老预设若没写 shoulder，仍按原来的 0.70 兜底 */
    var shoulder = film.shoulder > 0 && film.shoulder < 1 ? film.shoulder : 0.70;

    for (var i = 0; i < 256; i++) {
      var x = (i / 255) * expo;
      if (film.bw) {
        mono[i] = curve(x, film.contrast, film.lift, film.gamma, film.gain, shoulder) * 255;
      } else {
        lut[i] = curve(x, film.contrast[0], film.lift[0], film.gamma[0], film.gain[0], shoulder) * 255;
        lut[i + 256] = curve(x, film.contrast[1], film.lift[1], film.gamma[1], film.gain[1], shoulder) * 255;
        lut[i + 512] = curve(x, film.contrast[2], film.lift[2], film.gamma[2], film.gain[2], shoulder) * 255;
      }
    }
    var out = { lut: lut, mono: mono };
    lutCache[key] = out;
    return out;
  }

  /* --- 噪声 ------------------------------------------------------------- */
  function hash(x, y, seed) {
    var n = Math.imul(x, 1619) ^ Math.imul(y, 31337) ^ Math.imul(seed, 6971);
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    n ^= n >>> 15;
    return (n >>> 0) / 2147483647.5 - 1;
  }

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  /* --- 分离式盒式模糊（用于光晕）--------------------------------------- */
  function boxBlur(buf, w, h, r, passes) {
    if (r < 1) return;
    var tmp = new Uint8ClampedArray(buf.length);
    var i, x, y, c, sum, n, off;
    for (var p = 0; p < passes; p++) {
      /* 横向 */
      for (y = 0; y < h; y++) {
        off = y * w * 4;
        for (c = 0; c < 3; c++) {
          sum = 0; n = 0;
          for (x = 0; x <= r && x < w; x++) { sum += buf[off + x * 4 + c]; n++; }
          for (x = 0; x < w; x++) {
            tmp[off + x * 4 + c] = sum / n;
            var add = x + r + 1, rem = x - r;
            if (add < w) { sum += buf[off + add * 4 + c]; n++; }
            if (rem >= 0) { sum -= buf[off + rem * 4 + c]; n--; }
          }
        }
        /* 保留 alpha 占位，避免未初始化 */
        for (x = 0; x < w; x++) tmp[off + x * 4 + 3] = 255;
      }
      /* 纵向 */
      var stride = w * 4;
      for (x = 0; x < w; x++) {
        for (c = 0; c < 3; c++) {
          sum = 0; n = 0;
          for (y = 0; y <= r && y < h; y++) { sum += tmp[y * stride + x * 4 + c]; n++; }
          for (y = 0; y < h; y++) {
            buf[y * stride + x * 4 + c] = sum / n;
            var addY = y + r + 1, remY = y - r;
            if (addY < h) { sum += tmp[addY * stride + x * 4 + c]; n++; }
            if (remY >= 0) { sum -= tmp[remY * stride + x * 4 + c]; n--; }
          }
        }
      }
    }
    /* 修正纵向写回时未处理 alpha */
    for (i = 3; i < buf.length; i += 4) buf[i] = 255;
  }

  /* --- 主渲染 -----------------------------------------------------------
     data: RGBA Uint8ClampedArray（原地修改）
     opt: { ev, halation, grain, vignette, leak, seed }                     */
  function render(data, w, h, film, opt) {
    opt = opt || {};
    var ev = opt.ev || 0;
    var L = buildLUT(film, ev);
    var lut = L.lut, mono = L.mono;
    var bw = !!film.bw;

    var sat = bw ? 0 : film.sat;
    var vib = bw ? 0 : film.vibrance;
    var st = film.shadowTint, ht = film.highTint;
    var st0 = st[0] * 255, st1 = st[1] * 255, st2 = st[2] * 255;
    var ht0 = ht[0] * 255, ht1 = ht[1] * 255, ht2 = ht[2] * 255;

    var wantHalo = !!opt.halation && !!film.halation;
    var wantGrain = !!opt.grain && film.grain.amount > 0;
    var wantVig = !!opt.vignette && film.vignette > 0;
    var wantLeak = !!opt.leak && film.leak > 0;
    var wantFlash = opt.flash ? opt.flash : 0;

    var hw = 0, hh = 0, mask = null, haloR = 0, haloAmt = 0, haloCol = null, haloT = 0;
    if (wantHalo) {
      hw = Math.max(2, w >> 1); hh = Math.max(2, h >> 1);
      mask = new Uint8ClampedArray(hw * hh * 4);
      haloR = Math.max(1, Math.round(film.halation.radius / 2));
      haloAmt = film.halation.amount;
      haloCol = film.halation.color;
      haloT = film.halation.threshold;
    }

    var seed = opt.seed == null ? 7 : opt.seed;
    var gAmt = film.grain.amount * (opt.grainScale || 1) * 255;
    var gShadow = film.grain.shadow;
    var gSize = film.grain.size || 1;
    var vig = film.vignette;
    var leak = film.leak;
    var cx = w / 2, cy = h / 2;
    var normR = Math.sqrt(cx * cx + cy * cy);

    var i, x, y, r, g, b, l, mx, mn, s, lum, nrm, shw, hiw, m, mi, mxh, myh;

    /* 漏光的横向系数只算一次，避免每个像素都做 pow */
    var leakCol = null;
    if (wantLeak) {
      leakCol = new Float32Array(w);
      for (var xi = 0; xi < w; xi++) {
        var lx0 = 1 - xi / w;
        leakCol[xi] = Math.pow(lx0 > 0 ? lx0 : 0, 1.6) * 255;
      }
    }

    /* 第一遍：曲线 + 饱和 + 分离调色，同时生成光晕亮部遮罩 */
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i += 4) {
        if (bw) {
          l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
          var v = mono[l | 0];
          r = g = b = v;
        } else {
          r = lut[data[i]];
          g = lut[data[i + 1] + 256];
          b = lut[data[i + 2] + 512];
          lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
          mx = r > g ? r : g; if (b > mx) mx = b;
          mn = r < g ? r : g; if (b < mn) mn = b;
          s = sat + vib * (1 - (mx - mn) / 255);
          r = lum + (r - lum) * s;
          g = lum + (g - lum) * s;
          b = lum + (b - lum) * s;
        }
        lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        nrm = lum / 255;
        shw = 1 - nrm; hiw = nrm;
        r += st0 * shw + ht0 * hiw;
        g += st1 * shw + ht1 * hiw;
        b += st2 * shw + ht2 * hiw;

        if (wantHalo) {
          m = nrm > haloT ? (nrm - haloT) / (1 - haloT) : 0;
          m = m * m * 255;
          mxh = x >> 1; myh = y >> 1;
          if (mxh < hw && myh < hh) {
            mi = (myh * hw + mxh) * 4;
            mask[mi] = m; mask[mi + 1] = m; mask[mi + 2] = m; mask[mi + 3] = 255;
          }
        }

        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }

    if (wantHalo) boxBlur(mask, hw, hh, haloR, 2);

    /* 取景预览只跑第一遍色彩；没有空间效果时不必再扫一遍全画面 */
    if (!wantHalo && !wantGrain && !wantVig && !wantLeak && !wantFlash) return data;

    /* 第二遍：光晕 + 颗粒 + 暗角 + 漏光 */
    var seedA = seed, seedB = (seed * 7 + 13) | 0;
    var bodyTop = h * 0.34, bodyBot = h * 0.94;
    for (y = 0, i = 0; y < h; y++) {
      var dy = (y - cy) / normR;
      var dy2 = dy * dy;
      var gy = gSize > 1 ? (y / gSize) | 0 : y;
      var leakV = 0;
      if (wantLeak) {
        leakV = smoothstep(bodyBot, bodyTop, y) * leak;
      }
      for (x = 0; x < w; x++, i += 4) {
        r = data[i]; g = data[i + 1]; b = data[i + 2];

        if (wantHalo) {
          mi = (((y >> 1) < hh ? (y >> 1) : hh - 1) * hw + ((x >> 1) < hw ? (x >> 1) : hw - 1)) * 4;
          m = (mask[mi] / 255) * haloAmt;
          r = 255 - (255 - r) * (1 - m * haloCol[0]);
          g = 255 - (255 - g) * (1 - m * haloCol[1]);
          b = 255 - (255 - b) * (1 - m * haloCol[2]);
        }

        if (wantGrain) {
          lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
          var ga = gAmt * (1 + gShadow * (1 - lum));
          var gx = gSize > 1 ? (x / gSize) | 0 : x;
          var n1 = hash(gx, gy, seedA);
          var n2 = hash(gx + 53, gy + 97, seedB);
          r += n1 * ga;
          g += (n1 * 0.62 + n2 * 0.38) * ga;
          b += n2 * ga;
        }

        var dx, d;
        if (wantVig || wantFlash) {
          dx = (x - cx) / normR;
          d = Math.sqrt(dx * dx + dy2);
        }

        if (wantVig) {
          var f = 1 - vig * smoothstep(0.45, 1.02, d);
          r *= f; g *= f; b *= f;
        }

        if (leakV > 0) {
          var lf = leakV * leakCol[x];
          r += lf; g += lf * 0.42; b += lf * 0.10;
        }

        if (wantFlash) {
          var fw = 1 - smoothstep(0.12, 0.92, d);
          var fa = fw * wantFlash * 56;
          r += fa; g += fa * 0.94; b += fa * 0.86;
        }

        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
    return data;
  }

  global.SPOOLO = global.SPOOLO || {};
  global.SPOOLO.FILMS = FILMS;
  global.SPOOLO.meters = meters;
  global.SPOOLO.render = render;
})(window);
