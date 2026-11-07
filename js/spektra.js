/* SPOOLO · 光谱胶片模拟（spektrafilm 移植层）
 * ---------------------------------------------------------------------------
 * 算法与胶片 / 相纸数据来自 spektrafilm：
 *   https://github.com/andreavolpato/spektrafilm
 *   Copyright (c) Andrea Volpato，GPL-3.0-or-later（代码）/ CC BY-SA 4.0（profile 数据）
 *   本文件是 GPL-3.0-or-later 衍生作品；数据修改说明见 THIRD_PARTY.md。
 *
 * 这里移植的是它的“负片 → 相纸 → 扫描”色彩链，空间效果（颗粒、光晕、暗角、
 * 漏光）仍由 SPOOLO 自己的管线完成；裁切、自定义调色、Raw 解码等没有移植。
 *
 * 数据文件 js/spektra-data.js 由 tools/build-spektra-data.py 从上游 profile
 * 生成，包含：逐胶片的光谱灵敏度和密度曲线、相纸的感光 / 密度模型、D50 /
 * D55 / D65 / TH-KG3 光源、CIE 1931 CMF、放大机二向色滤色片和中性滤色值。
 *
 * 运行时不逐像素做光谱积分，而是把整条色彩链烘焙成 33³ 的 3D LUT：
 *   显示 sRGB → 线性 RGB → 胶片曝光 → 显影密度 → 相纸曝光 → 相纸密度
 *   → 观察光源下的 XYZ → 显示 sRGB
 * 一次烘焙约 3.6 万个格点，切换胶片 / 相纸时重算；CPU 与 GPU 共用同一份
 * LUT，保证两条成片路径一致。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var SP = global.SPOOLO = global.SPOOLO || {};

  var PLANCK_LOG10E = Math.LOG10E;
  var EXP10_N = 2048, EXP10_X0 = 0, EXP10_X1 = 8;
  var CDF_N = 1024, CDF_X0 = -7, CDF_X1 = 7;

  var DATA = null;
  var shared = null;
  var exp10Tab = null;
  var cdfTab = null;
  var filmById = Object.create(null);
  var paperById = Object.create(null);

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */

  function decodeF32(b64) {
    if (!b64) return new Float32Array(0);
    var bin = global.atob(b64);
    var n = bin.length;
    var bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer, 0, n >> 2);
  }

  function decodeU16(b64) {
    if (!b64) return new Uint16Array(0);
    var bin = global.atob(b64);
    var n = bin.length;
    var bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Uint16Array(bytes.buffer, 0, n >> 1);
  }

  function mat3(v, i) {
    return [v[i], v[i + 1], v[i + 2]];
  }

  function applyMat3(m, r, g, b, out) {
    out[0] = m[0] * r + m[1] * g + m[2] * b;
    out[1] = m[3] * r + m[4] * g + m[5] * b;
    out[2] = m[6] * r + m[7] * g + m[8] * b;
    return out;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function buildTables() {
    exp10Tab = new Float32Array(EXP10_N + 1);
    for (var i = 0; i <= EXP10_N; i++) {
      var x = EXP10_X0 + (EXP10_X1 - EXP10_X0) * i / EXP10_N;
      exp10Tab[i] = Math.pow(10, -x);
    }
    cdfTab = new Float32Array(CDF_N + 1);
    for (var j = 0; j <= CDF_N; j++) {
      var z = CDF_X0 + (CDF_X1 - CDF_X0) * j / CDF_N;
      cdfTab[j] = 0.5 * (1 + erf(z / Math.SQRT2));
    }
  }

  /* 10^-x；光谱密度超过 8 时透射光视为 0（与参考实现的 NaN→0 一致） */
  function pow10neg(x) {
    if (x <= EXP10_X0) return Math.pow(10, -x);
    if (x >= EXP10_X1) return 0;
    var p = (x - EXP10_X0) * (EXP10_N / (EXP10_X1 - EXP10_X0));
    var i = p | 0;
    var f = p - i;
    return exp10Tab[i] + (exp10Tab[i + 1] - exp10Tab[i]) * f;
  }

  /* 标准正态 CDF，查表 + 线性插值 */
  function normCdf(z) {
    if (z <= CDF_X0) return 0;
    if (z >= CDF_X1) return 1;
    var p = (z - CDF_X0) * (CDF_N / (CDF_X1 - CDF_X0));
    var i = p | 0;
    var f = p - i;
    return cdfTab[i] + (cdfTab[i + 1] - cdfTab[i]) * f;
  }

  /* Abramowitz & Stegun 7.1.26，精度约 1.5e-7；只用于建表 */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  /* np.interp：端点钳制，线性插值；xs 必须递增 */
  function interp1(x, xs, ys, n) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    var t = (x - xs[lo]) / (xs[lo + 1] - xs[lo]);
    return ys[lo] + (ys[lo + 1] - ys[lo]) * t;
  }

  /* 单通道曲线插值；curves 为 n×3 行主序 */
  function interpCurve(x, xs, curves, n, c) {
    if (x <= xs[0]) return curves[c];
    if (x >= xs[n - 1]) return curves[(n - 1) * 3 + c];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    var t = (x - xs[lo]) / (xs[lo + 1] - xs[lo]);
    var y0 = curves[lo * 3 + c], y1 = curves[(lo + 1) * 3 + c];
    return y0 + (y1 - y0) * t;
  }

  /* 三通道各用各的 x；out[c] = interp(x[c], xs, curves[:, c]) */
  function interp3c(xr, xg, xb, xs, curves, n, out) {
    out[0] = interpCurve(xr, xs, curves, n, 0);
    out[1] = interpCurve(xg, xs, curves, n, 1);
    out[2] = interpCurve(xb, xs, curves, n, 2);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 注册 / 解码数据                                                     */

  function setData(d) {
    DATA = d;
    shared = d.shared;
    shared.cmf = decodeF32(shared.cmf);
    shared.illu = {
      D50: decodeF32(shared.illu.D50),
      D55: decodeF32(shared.illu.D55),
      D65: decodeF32(shared.illu.D65),
      'TH-KG3': decodeF32(shared.illu['TH-KG3'])
    };
    shared.dichroic = decodeF32(shared.dichroic);
    shared.logExposure = decodeF32(shared.logExposure);
    shared.kg3 = decodeF32(shared.kg3);
    if (shared.oklabCmax) shared.oklabCmax.data = decodeU16(shared.oklabCmax.data);
    if (!exp10Tab) buildTables();

    filmById = Object.create(null);
    paperById = Object.create(null);
    d.films.forEach(function (f) {
      f.tc = decodeU16(f.tc);
      f.tcMax = new Float32Array(f.tcMax);
      f.dc = decodeF32(f.dc);
      f.cd = decodeF32(f.cd);
      f.bd = decodeF32(f.bd);
      f.mIn = new Float32Array(f.mIn);
      f.dcMin = new Float32Array(3);
      f.dcMax = new Float32Array(3);
      for (var c = 0; c < 3; c++) {
        var mn = Infinity, mx = -Infinity;
        for (var i = 0; i < 256; i++) {
          var v = f.dc[i * 3 + c];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        f.dcMin[c] = mn;
        f.dcMax[c] = mx;
      }
      f.coupler = new Float32Array(f.coupler);
      precomputeCurves(f);
      filmById[f.id] = f;
    });
    d.papers.forEach(function (p) {
      p.sens = decodeF32(p.sens);
      p.cd = decodeF32(p.cd);
      p.bd = decodeF32(p.bd);
      p.centers = new Float32Array(p.centers);
      p.amps = new Float32Array(p.amps);
      p.sigmas = new Float32Array(p.sigmas);
      p.mOut = new Float32Array(p.mOut);
      paperById[p.id] = p;
    });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 胶片曝光：hanatos2025 的 tc LUT 版本                                */
  /* linear sRGB → 参考光源下的 XYZ → xy → 方形坐标 → raw（× b）          */

  function filmRaw(f, lin, out) {
    var xyz = [0, 0, 0];
    applyMat3(f.mIn, lin[0], lin[1], lin[2], xyz);
    var b = xyz[0] + xyz[1] + xyz[2];
    var inv = b > 1e-12 ? 1 / b : 0;
    var x = clamp01(xyz[0] * inv), y = xyz[1] * inv;
    /* 上游的 _tri2quad 实际把 CIE xy 映射到方形坐标：
       xq = (1 - x)^2，yq = y / (1 - x)；tc 数组就是按 (xq, yq) 索引的 */
    var ax = 1 - x;
    var xq = clamp01(ax * ax);
    var yq = clamp01(ax > 1e-8 ? y / ax : 0);
    var S = f.tcSize;
    var px = xq * (S - 1), py = yq * (S - 1);
    var x0 = px | 0, y0 = py | 0;
    if (x0 > S - 2) x0 = S - 2;
    if (y0 > S - 2) y0 = S - 2;
    var fx = px - x0, fy = py - y0;
    /* tc 数组的轴顺序是 [tx, ty]，与 quad 坐标一致 */
    var i00 = (x0 * S + y0) * 3, i10 = i00 + S * 3;
    var i01 = i00 + 3, i11 = i10 + 3;
    for (var c = 0; c < 3; c++) {
      var sc = f.tcMax[c] / 65535;
      var a = (f.tc[i00 + c] + (f.tc[i10 + c] - f.tc[i00 + c]) * fx) * sc;
      var bb = (f.tc[i01 + c] + (f.tc[i11 + c] - f.tc[i01 + c]) * fx) * sc;
      var v = a + (bb - a) * fy;
      out[c] = (v > 0 ? v : 0) * b;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 胶片显影：density curves + DIR couplers（空间版在 lut_mode 下关闭）  */

  /* 每条曲线的 DIR 反推只与胶片参数有关，切换胶片时算一次 */
  function precomputeCurves(f) {
    var dcN = f.dcN = new Float32Array(768);
    var c, i;
    for (c = 0; c < 3; c++) {
      var mn = f.dcMin[c];
      for (i = 0; i < 256; i++) dcN[i * 3 + c] = f.dc[i * 3 + c] - mn;
    }
    var M = f.coupler;
    var positive = f.positive;
    var logE = shared.logExposure;
    var logE0 = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    for (i = 0; i < 256; i++) {
      var silver = [0, 0, 0];
      for (c = 0; c < 3; c++) {
        silver[c] = positive ? (f.dcMax[c] - f.dcMin[c]) - dcN[i * 3 + c] : dcN[i * 3 + c];
      }
      for (c = 0; c < 3; c++) {
        var amt = silver[0] * M[c] + silver[1] * M[3 + c] + silver[2] * M[6 + c];
        logE0[c][i] = logE[i] - amt;
      }
    }
    var dc0 = f.dc0 = new Float32Array(768);
    var tmp = new Float32Array(256);
    for (c = 0; c < 3; c++) {
      for (i = 0; i < 256; i++) tmp[i] = positive ? -dcN[i * 3 + c] : dcN[i * 3 + c];
      for (i = 0; i < 256; i++) {
        var v = interp1(logE[i], logE0[c], tmp, 256);
        dc0[i * 3 + c] = positive ? -v : v;
      }
    }
  }

  function developFilm(f, logRaw, out) {
    var M = f.coupler;
    var positive = f.positive;
    var d0 = [0, 0, 0];
    interp3c(logRaw[0], logRaw[1], logRaw[2], shared.logExposure, f.dcN, 256, d0);

    /* 实际像素：按当前密度释放抑制剂，再查反推后的曲线 */
    var silverPx = [0, 0, 0];
    for (var c = 0; c < 3; c++) silverPx[c] = positive ? (f.dcMax[c] - f.dcMin[c]) - d0[c] : d0[c];
    var corr0 = silverPx[0] * M[0] + silverPx[1] * M[3] + silverPx[2] * M[6];
    var corr1 = silverPx[0] * M[1] + silverPx[1] * M[4] + silverPx[2] * M[7];
    var corr2 = silverPx[0] * M[2] + silverPx[1] * M[5] + silverPx[2] * M[8];
    interp3c(logRaw[0] - corr0, logRaw[1] - corr1, logRaw[2] - corr2,
             shared.logExposure, f.dc0, 256, out);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 相纸曝光 / 显影 / 扫描                                              */

  function makePrintIlluminant(paper, film) {
    var neutral = DATA.neutral[paper.id] && DATA.neutral[paper.id][film.id];
    if (!neutral) neutral = [0, 65, 55];
    var th = shared.illu['TH-KG3'];
    var dich = shared.dichroic;
    var illu = new Float32Array(81);
    var tC = pow10neg(neutral[0] / 100);
    var tM = pow10neg(neutral[1] / 100);
    var tY = pow10neg(neutral[2] / 100);
    for (var i = 0; i < 81; i++) {
      /* DichroicFilters.apply_cc：dimmed = 1-(1-filter)*(1-transmittance) */
      var dC = 1 - (1 - dich[i * 3]) * (1 - tC);
      var dM = 1 - (1 - dich[i * 3 + 1]) * (1 - tM);
      var dY = 1 - (1 - dich[i * 3 + 2]) * (1 - tY);
      illu[i] = th[i] * dC * dM * dY;
    }
    return illu;
  }

  function spectralDensity(cd, bd, cmy, out) {
    for (var i = 0; i < 81; i++) {
      var v = bd[i] + cmy[0] * cd[i * 3] + cmy[1] * cd[i * 3 + 1] + cmy[2] * cd[i * 3 + 2];
      /* 参考实现：NaN 处透射光按 0 处理 */
      out[i] = v === v ? v : 99;
    }
  }

  function integrateLight(density, illu, sens, out) {
    var acc0 = 0, acc1 = 0, acc2 = 0;
    for (var i = 0; i < 81; i++) {
      var light = pow10neg(density[i]) * illu[i];
      acc0 += light * sens[i * 3];
      acc1 += light * sens[i * 3 + 1];
      acc2 += light * sens[i * 3 + 2];
    }
    out[0] = acc0; out[1] = acc1; out[2] = acc2;
    return out;
  }

  function printExposure(f, p, filmDensity, illu, expFactor, out) {
    var dens = new Float32Array(81);
    spectralDensity(f.cd, f.bd, filmDensity, dens);
    integrateLight(dens, illu, p.sens, out);
    out[0] *= expFactor; out[1] *= expFactor; out[2] *= expFactor;
    return out;
  }

  function developPrint(p, logRaw, out) {
    var positive = p.positive;
    for (var c = 0; c < 3; c++) {
      var total = 0;
      for (var i = 0; i < 3; i++) {
        var mu = p.centers[c * 3 + i], sig = p.sigmas[c * 3 + i], amp = p.amps[c * 3 + i];
        var z = (logRaw[c] - mu) / sig;
        var cdf = normCdf(z);
        total += amp * (positive ? 1 - cdf : cdf);
      }
      out[c] = total;
    }
    return out;
  }

  function scanDensity(p, printDensity, out) {
    var dens = new Float32Array(81);
    spectralDensity(p.cd, p.bd, printDensity, dens);
    var view = p.viewKey || 'D50';
    var illu = shared.illu[view] || shared.illu.D50;
    var cmf = shared.cmf;
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < 81; i++) {
      var light = pow10neg(dens[i]) * illu[i];
      nx += light * cmf[i * 3];
      ny += light * cmf[i * 3 + 1];
      nz += light * cmf[i * 3 + 2];
    }
    /* norm = Σ illuminant * CMF_y */
    var norm = 0;
    for (i = 0; i < 81; i++) norm += illu[i] * cmf[i * 3 + 1];
    nx /= norm; ny /= norm; nz /= norm;
    applyMat3(p.mOut, nx, ny, nz, out);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 输出色域映射（上游 gamut_compression.py 的 OkLch 变体）              */
  /* 上游默认是 CAM16-UCS；OkLch 是它提供的同一 Reinhard 膝部的轻量算法。 */

  var PI = Math.PI;

  /* Ottosson OkLab（线性 sRGB ↔ OkLab） */
  function oklabFromLinear(r, g, b, out) {
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    out[0] = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    out[1] = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    out[2] = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    return out;
  }

  function linearFromOklab(L, a, b, out) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return out;
  }

  function reinhardKnee(d, threshold, limit, power) {
    if (d <= threshold) return d;
    var x = (d - threshold) / (limit - threshold);
    return threshold + (limit - threshold) * x / Math.pow(1 + Math.pow(x, power), 1 / power);
  }

  /* sRGB 输出色域的 C_max(L,h) 表，由构建脚本用上游同一二分法生成 */
  function cmaxAt(L, h) {
    var t = shared.oklabCmax;
    if (!t || !t.data) return 0.5;
    var nL = t.nL, nH = t.nH;
    var u = (L - t.l0) / (t.l1 - t.l0) * (nL - 1);
    if (u < 0) u = 0; else if (u > nL - 1) u = nL - 1;
    var i0 = u | 0; if (i0 > nL - 2) i0 = nL - 2;
    var fu = u - i0;
    var v = (h + PI) / (2 * PI) * nH;
    v = v - Math.floor(v / nH) * nH;
    var j0 = v | 0, j1 = (j0 + 1) % nH;
    var fv = v - j0;
    var d = t.data, scale = t.max / 65535;
    var a = d[i0 * nH + j0], b = d[i0 * nH + j1];
    var c = d[(i0 + 1) * nH + j0], e = d[(i0 + 1) * nH + j1];
    var top = a + (b - a) * fv, bot = c + (e - c) * fv;
    return (top + (bot - top) * fu) * scale;
  }

  /* 原地压缩线性 sRGB：先压 J/L，再按 C_max(L,h) 压色度 */
  function compressRgbOkLch(rgb) {
    var lab = [0, 0, 0];
    oklabFromLinear(rgb[0], rgb[1], rgb[2], lab);
    var L = reinhardKnee(lab[0], 0.7, 1.0, 2.2);
    var a = lab[1], b = lab[2];
    var C = Math.sqrt(a * a + b * b);
    var h = Math.atan2(b, a);
    var cmax = cmaxAt(L, h);
    if (cmax > 1e-9) {
      var cn = reinhardKnee(C / cmax, 0.0, 1.0, 6.0);
      C = cn * cmax;
      a = C * Math.cos(h);
      b = C * Math.sin(h);
    } else {
      a = 0; b = 0;
    }
    return linearFromOklab(L, a, b, rgb);
  }

  /* ------------------------------------------------------------------ */
  /* 烘焙 3D LUT                                                         */

  function bake(filmId, paperId, size) {
    if (!DATA) throw new Error('spektra-data-not-loaded');
    var f = filmById[filmId], p = paperById[paperId];
    if (!f) throw new Error('unknown-film:' + filmId);
    if (!p) throw new Error('unknown-paper:' + paperId);
    size = size || 33;

    var illu = makePrintIlluminant(p, f);

    /* 反转片按幻灯片直接扫描，不经过负片相纸；否则相纸会把正像再反一次。
       扫描矩阵仍借用相纸的 D50 → sRGB 矩阵（目前所有相纸观看光源都是 D50）。 */
    var directScan = !!f.positive;
    var scanP = directScan
      ? { cd: f.cd, bd: f.bd, mOut: p.mOut, viewKey: f.view }
      : null;
    var scanScale = 1, scanOffset = 0;

    /* 负片：中灰曝光归一化，与 Reference 的 _compute_exposure_factor_midgray 一致 */
    var midLin = [0.184, 0.184, 0.184];
    var midRaw = [0, 0, 0];
    filmRaw(f, midLin, midRaw);
    var midLog = [0, 0, 0];
    for (var c = 0; c < 3; c++) midLog[c] = Math.log(Math.max(midRaw[c], 1e-10)) * PLANCK_LOG10E;
    /* 注意：这里用未归一化曲线，和参考实现的 develop_simple 一致 */
    var midDensity = [0, 0, 0];
    interp3c(midLog[0], midLog[1], midLog[2], shared.logExposure, f.dc, 256, midDensity);
    var midPrint = [0, 0, 0];
    printExposure(f, p, midDensity, illu, 1, midPrint);
    var logSum = 0;
    for (c = 0; c < 3; c++) logSum += Math.log(Math.max(midPrint[c], 1e-10));
    var expFactor = 1 / Math.exp(logSum / 3);

    /* 反转片：用显影后的最黑 / 最白密度归一化扫描亮度，避免整张发灰 */
    if (directScan) {
      var edgeIn = [0, 0, 0], edgeRaw = [0, 0, 0], edgeLog = [0, 0, 0];
      var edgeDens = [0, 0, 0], edgeXyz = [0, 0, 0];
      var edgeY = [0, 0];
      for (var e = 0; e < 2; e++) {
        var ev = e ? 1 : 0;
        edgeIn[0] = edgeIn[1] = edgeIn[2] = ev;
        filmRaw(f, edgeIn, edgeRaw);
        for (c = 0; c < 3; c++) edgeLog[c] = Math.log(Math.max(edgeRaw[c], 1e-10)) * PLANCK_LOG10E;
        developFilm(f, edgeLog, edgeDens);
        scanDensity(scanP, edgeDens, edgeXyz);
        edgeY[e] = 0.2126 * edgeXyz[0] + 0.7152 * edgeXyz[1] + 0.0722 * edgeXyz[2];
      }
      if (edgeY[1] > edgeY[0] + 1e-8) {
        scanScale = (0.98 - 0.01) / (edgeY[1] - edgeY[0]);
        scanOffset = 0.01 - scanScale * edgeY[0];
      }
    }

    var n = size * size * size;
    var data = new Float32Array(n * 3);
    var lin = [0, 0, 0], raw = [0, 0, 0], logRaw = [0, 0, 0];
    var dens = [0, 0, 0], pRaw = [0, 0, 0], pLog = [0, 0, 0], pDens = [0, 0, 0];
    var xyz = [0, 0, 0], rgbLin = [0, 0, 0];
    var idx = 0, scanY = 0, scanGain = 1;

    for (var bi = 0; bi < size; bi++) {
      var bv = bi / (size - 1);
      var bl = srgbToLinear(bv);
      for (var gi = 0; gi < size; gi++) {
        var gv = gi / (size - 1);
        var gl = srgbToLinear(gv);
        for (var ri = 0; ri < size; ri++) {
          lin[0] = srgbToLinear(ri / (size - 1));
          lin[1] = gl;
          lin[2] = bl;
          filmRaw(f, lin, raw);
          for (c = 0; c < 3; c++) logRaw[c] = Math.log(Math.max(raw[c], 1e-10)) * PLANCK_LOG10E;
          developFilm(f, logRaw, dens);
          if (directScan) {
            scanDensity(scanP, dens, xyz);
            scanY = 0.2126 * xyz[0] + 0.7152 * xyz[1] + 0.0722 * xyz[2];
            scanGain = scanY > 1e-10
              ? Math.max(0, Math.min(1, scanScale * scanY + scanOffset)) / scanY
              : 0;
            xyz[0] *= scanGain; xyz[1] *= scanGain; xyz[2] *= scanGain;
          } else {
            printExposure(f, p, dens, illu, expFactor, pRaw);
            for (c = 0; c < 3; c++) pLog[c] = Math.log(Math.max(pRaw[c], 1e-10)) * PLANCK_LOG10E;
            developPrint(p, pLog, pDens);
            scanDensity(p, pDens, xyz);
          }
          compressRgbOkLch(xyz);
          for (c = 0; c < 3; c++) rgbLin[c] = linearToSrgb(clamp01(xyz[c]));
          data[idx++] = rgbLin[0];
          data[idx++] = rgbLin[1];
          data[idx++] = rgbLin[2];
        }
      }
    }

    return makeLut(data, size, filmId + '|' + paperId);
  }

  /* 8-bit 2D atlas：每行放 tiles 个 z 切片，用于 WebGL1 的 3D LUT 采样 */
  function makeLut(data, size, key) {
    var tiles = Math.ceil(Math.sqrt(size));
    var rows = Math.ceil(size / tiles);
    var atlasW = tiles * size, atlasH = rows * size;
    var atlas = new Uint8Array(atlasW * atlasH * 4);
    for (var z = 0; z < size; z++) {
      var tx = (z % tiles) * size;
      var ty = ((z / tiles) | 0) * size;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var src = ((z * size + y) * size + x) * 3;
          var dst = ((ty + y) * atlasW + tx + x) * 4;
          atlas[dst] = (data[src] * 255 + 0.5) | 0;
          atlas[dst + 1] = (data[src + 1] * 255 + 0.5) | 0;
          atlas[dst + 2] = (data[src + 2] * 255 + 0.5) | 0;
          atlas[dst + 3] = 255;
        }
      }
    }
    return {
      key: key, size: size, data: data,
      atlas: atlas, atlasW: atlasW, atlasH: atlasH,
      tiles: tiles, rows: rows
    };
  }

  function sampleLut(lut, r, g, b, out) {
    var S = lut.size, d = lut.data;
    var px = r * (S - 1), py = g * (S - 1), pz = b * (S - 1);
    var x0 = px | 0, y0 = py | 0, z0 = pz | 0;
    if (x0 > S - 2) x0 = S - 2;
    if (y0 > S - 2) y0 = S - 2;
    if (z0 > S - 2) z0 = S - 2;
    var fx = px - x0, fy = py - y0, fz = pz - z0;
    var x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
    out = out || [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var i000 = ((z0 * S + y0) * S + x0) * 3 + c;
      var i100 = ((z0 * S + y0) * S + x1) * 3 + c;
      var i010 = ((z0 * S + y1) * S + x0) * 3 + c;
      var i110 = ((z0 * S + y1) * S + x1) * 3 + c;
      var i001 = ((z1 * S + y0) * S + x0) * 3 + c;
      var i101 = ((z1 * S + y0) * S + x1) * 3 + c;
      var i011 = ((z1 * S + y1) * S + x0) * 3 + c;
      var i111 = ((z1 * S + y1) * S + x1) * 3 + c;
      var a = d[i000] + (d[i100] - d[i000]) * fx;
      var bb = d[i010] + (d[i110] - d[i010]) * fx;
      var cc = d[i001] + (d[i101] - d[i001]) * fx;
      var dd = d[i011] + (d[i111] - d[i011]) * fx;
      var e = a + (bb - a) * fy;
      var fv = cc + (dd - cc) * fy;
      out[c] = e + (fv - e) * fz;
    }
    return out;
  }

  /* 8-bit 显示 sRGB 输入 → 曝光补偿 → 3D LUT → 8-bit 显示 sRGB 输出。
     LUT 本身按显示 sRGB 烘焙；EV 在线性光上缩放，等价于上游在胶片 raw 上乘 2^EV。 */
  function sampleSrgb(lut, r8, g8, b8, ev, out) {
    var e = ev ? Math.pow(2, ev) : 1;
    var lr = srgbToLinear(clamp01(r8 / 255)) * e;
    var lg = srgbToLinear(clamp01(g8 / 255)) * e;
    var lb = srgbToLinear(clamp01(b8 / 255)) * e;
    /* 3D LUT 只覆盖显示白点以内的输入；更高光直接钳到 1，避免采样越界 */
    sampleLut(lut,
      linearToSrgb(lr > 1 ? 1 : lr),
      linearToSrgb(lg > 1 ? 1 : lg),
      linearToSrgb(lb > 1 ? 1 : lb), out);
    out[0] *= 255; out[1] *= 255; out[2] *= 255;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 供 UI 使用的元数据与效果参数                                        */

  function films() {
    return DATA ? DATA.films.map(function (f) {
      return { id: f.id, name: f.name, code: f.code, iso: f.iso, type: f.type };
    }) : [];
  }

  function papers() {
    return DATA ? DATA.papers.map(function (p) {
      return { id: p.id, name: p.name, type: p.type, kind: p.kind || '' };
    }) : [];
  }

  function defaultPaper(filmId) {
    var f = filmById[filmId];
    if (f && f.target && paperById[f.target]) return f.target;
    return DATA && DATA.papers.length ? DATA.papers[0].id : '';
  }

  /* 光谱胶片只负责色彩；颗粒 / 光晕 / 暗角沿用 SPOOLO 的参数化实现 */
  function effectsFor(filmId) {
    var f = filmById[filmId];
    if (!f) return null;
    var iso = f.iso || 400;
    var grainAmt = 0.030 + 0.000045 * Math.min(iso, 1600);
    if (f.consumer) grainAmt += 0.006;
    if (f.cine) grainAmt -= 0.005;
    if (f.push) grainAmt += 0.012 * f.push;
    if (f.positive) grainAmt *= 0.8;
    var hal = f.antihalation === 'no' ? 0.32 : f.antihalation === 'weak' ? 0.20 : 0.12;
    if (f.cine) hal *= 0.9;
    if (f.positive) hal *= 0.55;
    return {
      code: f.code,
      name: f.name,
      en: f.en || '',
      process: f.process || (f.positive ? 'E-6' : 'C-41'),
      iso: iso,
      positive: !!f.positive,
      tone: f.tone || '#c9a888',
      grain: {
        amount: grainAmt,
        size: 1,
        shadow: 1.4 + iso / 1200,
        coarse: iso >= 800 ? 0.55 : iso >= 400 ? 0.50 : 0.38,
        coarseScale: iso >= 1600 ? 5 : iso >= 800 ? 4 : iso >= 400 ? 3 : 2
      },
      halation: { amount: hal, radius: 9, threshold: 0.72, color: [1, 0.45, 0.26] },
      vignette: 0.18,
      leak: 0,
      spectral: true
    };
  }

  SP.Spektra = {
    setData: setData,
    bake: bake,
    sampleLut: sampleLut,
    sampleSrgb: sampleSrgb,
    films: films,
    papers: papers,
    defaultPaper: defaultPaper,
    effectsFor: effectsFor,
    isReady: function () { return !!DATA; },
    _internals: {
      film: function (id) { return filmById[id]; },
      paper: function (id) { return paperById[id]; },
      filmRaw: filmRaw,
      developFilm: developFilm,
      makePrintIlluminant: makePrintIlluminant,
      printExposure: printExposure,
      developPrint: developPrint,
      scanDensity: scanDensity,
      compressRgbOkLch: compressRgbOkLch,
      cmaxAt: cmaxAt,
      pow10neg: pow10neg
    }
  };
})(window);
