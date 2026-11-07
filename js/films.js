/* ==========================================================================
   SPOOLO · 成片效果引擎 (spectral effects engine)
   - 色彩：完全交给 spektrafilm 移植层（js/spektra.js 的 3D LUT）
   - 颗粒 / 光晕 / 暗角 / 漏光 / 镜头柔化：在 LUT 之后做参数化合成
   - 原先那套「自有胶卷预设 + 1D 曲线 LUT + 合成调色」已移除
   ========================================================================== */
(function (global) {
  'use strict';

  /* --- P2 镜头光学 -------------------------------------------------------
     轻微的边缘柔化 + 横向色差（CA）：中心保持锐利，越靠边越明显。
     单位是「1080px 短边时的像素」，成片会按短边等比缩放；这样 1080×1440
     和 1920×1280 的镜头观感一致。 */
  var LENS_MODEL = { softness: 0.8, ca: 0.8 };

  function lensModel(film) {
    if (film.lens === false) return { softness: 0, ca: 0 };
    var l = film.lens || LENS_MODEL;
    return {
      softness: l.softness != null ? l.softness : LENS_MODEL.softness,
      ca: film.bw ? 0 : (l.ca != null ? l.ca : LENS_MODEL.ca)
    };
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
  /* P2 镜头采样：最近邻用于柔化 taps，双线性用于色差中心，兼顾速度和边缘 */
  function nearestAt(buf, w, h, x, y, ch) {
    x = x < 0 ? 0 : x >= w ? w - 1 : x | 0;
    y = y < 0 ? 0 : y >= h ? h - 1 : y | 0;
    return buf[(y * w + x) * 4 + ch];
  }
  function bilinearAt(buf, w, h, x, y, ch) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    var x0 = x | 0, y0 = y | 0;
    var x1 = x0 + 1 < w ? x0 + 1 : x0;
    var y1 = y0 + 1 < h ? y0 + 1 : y0;
    var fx = x - x0, fy = y - y0;
    var i00 = (y0 * w + x0) * 4 + ch, i10 = (y0 * w + x1) * 4 + ch;
    var i01 = (y1 * w + x0) * 4 + ch, i11 = (y1 * w + x1) * 4 + ch;
    var a = buf[i00] + (buf[i10] - buf[i00]) * fx;
    var b = buf[i01] + (buf[i11] - buf[i01]) * fx;
    return a + (b - a) * fy;
  }

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

  /* 颗粒的亮度权重预先查表：中间调最强，高光收敛 */
  var GRAIN_TONE = new Float32Array(256);
  var GRAIN_HL = new Float32Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var l = i / 255;
      GRAIN_TONE[i] = 0.62 + 0.62 * Math.sin(Math.PI * l);
      GRAIN_HL[i] = 1 - 0.35 * smoothstep(0.72, 1, l);
    }
  })();

  /* 低频颗粒团块：双线性 value noise，比 block 噪声更像胶片结块 */
  function valueNoise(x, y, seed) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var a = hash(x0, y0, seed);
    var b = hash(x0 + 1, y0, seed);
    var c = hash(x0, y0 + 1, seed);
    var d = hash(x0 + 1, y0 + 1, seed);
    var top = a + (b - a) * fx;
    var bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  /* --- 主渲染 -----------------------------------------------------------
     data: RGBA Uint8ClampedArray（原地修改）
     opt: { ev, spectralLut, halation, bloom, grain, vignette, leak, seed, flash }
     色彩由 spektrafilm 烘焙的 3D LUT 负责；本函数只叠加空间效果。      */
  function render(data, w, h, film, opt) {
    opt = opt || {};
    var specLut = opt.spectralLut || null;
    var specApi = global.SPOOLO && global.SPOOLO.Spektra;
    if (!specLut || !specApi || !film) return data;

    var ev = opt.ev || 0;
    var specOut = [0, 0, 0];
    var i, x, y, r, g, b, l, m, mi, lum, nrm, shw, hiw;
    var cx = w / 2, cy = h / 2;
    var normR = Math.sqrt(cx * cx + cy * cy);

    /* 第一遍：光谱 LUT 直接输出显示 sRGB；EV 在 LUT 采样前按线性光缩放 */
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i += 4) {
        specApi.sampleSrgb(specLut, data[i], data[i + 1], data[i + 2], ev, specOut);
        data[i] = specOut[0];
        data[i + 1] = specOut[1];
        data[i + 2] = specOut[2];
      }
    }

    var grain = film.grain || { amount: 0 };
    var halation = film.halation || null;
    var wantHalo = !!opt.halation && !!halation && halation.amount > 0;
    /* 全局 bloom 不依赖 film.halation：细粒卷也需要一点光学扩散 */
    var wantBloom = !!opt.bloom;
    var wantMask = wantHalo || wantBloom;
    var wantGrain = !!opt.grain && grain.amount > 0;
    var wantVig = !!opt.vignette && film.vignette > 0;
    var wantLeak = !!opt.leak && film.leak > 0;
    var wantFlash = opt.flash ? opt.flash : 0;

    var bloomAmt = wantBloom ? (film.bloom && film.bloom.amount != null ? film.bloom.amount : 0.12) : 0;
    var bloomCol = film.bloom && film.bloom.color ? film.bloom.color : [1, 0.96, 0.90];

    var hw = 0, hh = 0, mask = null, maskBloom = null, haloR = 0, haloAmt = 0, haloCol = null, haloT = 0;
    if (wantMask) {
      hw = Math.max(2, w >> 1); hh = Math.max(2, h >> 1);
      mask = new Uint8ClampedArray(hw * hh * 4);
      haloR = wantHalo ? Math.max(1, Math.round(halation.radius / 2)) : 4;
      haloAmt = wantHalo ? halation.amount : 0;
      haloCol = wantHalo ? halation.color : null;
      haloT = wantHalo ? halation.threshold : 0.72;
    }

    var seed = opt.seed == null ? 7 : opt.seed;
    /* 细粒只承担质地的“沙感”，主体起伏交给低频团块；总量再压一档，
       否则 1px 白噪声在灰场里会像电视雪花，而不是胶片颗粒 */
    var gAmt = grain.amount * (opt.grainScale || 1) * 255 * 0.70;
    var gShadow = grain.shadow;
    var gSize = grain.size || 1;
    /* 细粒保持 1px，另叠一层 2–5px 的团块；高 ISO 团块更大更明显 */
    var gCoarseScale = grain.coarseScale || (film.iso >= 1600 ? 5 : film.iso >= 800 ? 4 : film.iso >= 400 ? 3 : 2);
    var gCoarseAmt = grain.coarse != null ? grain.coarse
      : (film.iso >= 800 ? 0.55 : film.iso >= 400 ? 0.50 : 0.38);
    var seedC = (seed * 13 + 29) | 0;
    var vig = film.vignette;
    var leak = film.leak;

    /* 漏光的横向系数只算一次，避免每个像素都做 pow */
    var leakCol = null;
    if (wantLeak) {
      leakCol = new Float32Array(w);
      for (var xi = 0; xi < w; xi++) {
        var lx0 = 1 - xi / w;
        leakCol[xi] = Math.pow(lx0 > 0 ? lx0 : 0, 1.6) * 255;
      }
    }

    /* 第一遍已经写完色彩；若没有任何空间效果，直接返回 */
    if (!wantHalo && !wantBloom && !wantGrain && !wantVig && !wantLeak && !wantFlash && !opt.lens) return data;

    /* P2：镜头柔化 + 横向色差。先处理颜色，再从处理后的颜色生成亮部遮罩，
       这样 bloom/halation 看到的是经过镜头后的高光边缘。 */
    var lens = lensModel(film);
    var lensScale = Math.min(w, h) / 1080;
    var lensSoft = lens.softness * lensScale;
    var lensCA = lens.ca * lensScale;
    if (lensSoft < 0.01 && lensCA < 0.01) opt.lens = false;
    if (opt.lens) {
      var lensSrc = new Uint8ClampedArray(data);
      for (y = 0, i = 0; y < h; y++) {
        var ldy = (y - cy) / normR;
        for (x = 0; x < w; x++, i += 4) {
          var ldx = (x - cx) / normR;
          var lrr = ldx * ldx + ldy * ldy;
          if (lrr < 0.000001) continue;
          var lr = Math.sqrt(lrr);
          var caX = (ldx / lr) * lensCA * lrr;
          var caY = (ldy / lr) * lensCA * lrr;
          var sxi = Math.round(lensSoft * lrr);
          var rx = x + caX, ry = y + caY;
          var bx = x - caX, by = y - caY;
          var rv = bilinearAt(lensSrc, w, h, rx, ry, 0);
          var gv = bilinearAt(lensSrc, w, h, x, y, 1);
          var bv = bilinearAt(lensSrc, w, h, bx, by, 2);
          if (sxi > 0) {
            /* 4 邻域柔化 + 原值：比 GPU 的 4-tap 稍轻，成本低很多 */
            rv = (rv + nearestAt(lensSrc, w, h, rx - sxi, ry, 0) +
              nearestAt(lensSrc, w, h, rx + sxi, ry, 0) +
              nearestAt(lensSrc, w, h, rx, ry - sxi, 0) +
              nearestAt(lensSrc, w, h, rx, ry + sxi, 0)) / 5;
            gv = (gv + nearestAt(lensSrc, w, h, x - sxi, y, 1) +
              nearestAt(lensSrc, w, h, x + sxi, y, 1) +
              nearestAt(lensSrc, w, h, x, y - sxi, 1) +
              nearestAt(lensSrc, w, h, x, y + sxi, 1)) / 5;
            bv = (bv + nearestAt(lensSrc, w, h, bx - sxi, by, 2) +
              nearestAt(lensSrc, w, h, bx + sxi, by, 2) +
              nearestAt(lensSrc, w, h, bx, by - sxi, 2) +
              nearestAt(lensSrc, w, h, bx, by + sxi, 2)) / 5;
          }
          data[i] = rv;
          data[i + 1] = gv;
          data[i + 2] = bv;
        }
      }
    }

    if (wantMask) {
      /* 半分辨率遮罩：取每个 2×2 源块的左上角，和 GPU 亮部 pass 的采样一致 */
      for (y = 0, mi = 0; y < hh; y++) {
        var sy = y * 2;
        var srow = sy * w * 4;
        for (x = 0; x < hw; x++, mi += 4) {
          var si = srow + (x * 2) * 4;
          lum = data[si] * 0.2126 + data[si + 1] * 0.7152 + data[si + 2] * 0.0722;
          nrm = lum / 255;
          m = nrm > haloT ? (nrm - haloT) / (1 - haloT) : 0;
          m = m * m * 255;
          mask[mi] = m; mask[mi + 1] = m; mask[mi + 2] = m; mask[mi + 3] = 255;
        }
      }
      boxBlur(mask, hw, hh, haloR, 2);
      if (wantBloom) {
        /* 在紧光晕的基础上再糊一次，得到更宽、更柔的镜头辉光 */
        maskBloom = new Uint8ClampedArray(mask);
        boxBlur(maskBloom, hw, hh, Math.max(3, Math.round(Math.min(hw, hh) / 60)), 2);
      }
    }

    /* 第二遍：光晕 / bloom + 颗粒 + 暗角 + 漏光 */
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

        if (wantMask) {
          mi = (((y >> 1) < hh ? (y >> 1) : hh - 1) * hw + ((x >> 1) < hw ? (x >> 1) : hw - 1)) * 4;
          var maskV = mask[mi] / 255;
          if (wantHalo) {
            m = maskV * haloAmt;
            r = 255 - (255 - r) * (1 - m * haloCol[0]);
            g = 255 - (255 - g) * (1 - m * haloCol[1]);
            b = 255 - (255 - b) * (1 - m * haloCol[2]);
          }
          if (wantBloom) {
            var mb = (maskBloom[mi] / 255) * bloomAmt;
            r = 255 - (255 - r) * (1 - mb * bloomCol[0]);
            g = 255 - (255 - g) * (1 - mb * bloomCol[1]);
            b = 255 - (255 - b) * (1 - mb * bloomCol[2]);
          }
        }

        if (wantGrain) {
          lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
          var li = (lum * 255) | 0;
          if (li < 0) li = 0; else if (li > 255) li = 255;
          var ga = gAmt * GRAIN_TONE[li] * (1 + gShadow * (1 - lum)) * GRAIN_HL[li];
          /* 软限幅：高感卷可以更粗，但不能把画面打成噪点墙 */
          if (ga > 32) ga = 32 + (ga - 32) * 0.35;
          var gx = gSize > 1 ? (x / gSize) | 0 : x;
          var n1 = hash(gx, gy, seedA);
          var n2 = hash(gx + 53, gy + 97, seedB);
          var nC = valueNoise(gx / gCoarseScale, gy / gCoarseScale, seedC) * gCoarseAmt;
          /* 细粒降权 + 低频团块，空间上更接近银盐结块 */
          var nFine = n1 * 0.78;
          /* 以亮度颗粒为主，只留很弱的通道差；否则放大后全是彩色数码噪点 */
          var nL = nFine + nC;
          var nCh = n2 * 0.30;
          r += (nL + nCh * 0.55) * ga;
          g += (nL - nCh * 0.10) * ga;
          b += (nL - nCh * 0.55) * ga;
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
  global.SPOOLO.LENS_MODEL = LENS_MODEL;
  global.SPOOLO.lensModel = lensModel;
  global.SPOOLO.render = render;
})(window);
