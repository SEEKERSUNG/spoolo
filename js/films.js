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
      grain: { amount: 0.100, size: 1, shadow: 2.2 }, vignette: 0.26, leak: 0
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
      note: '高饱和、重颗粒、重暗角，还会偷偷漏一点光进来。',
      tone: '#d94f2b',
      contrast: [1.16, 1.06, 1.02], lift: [0.020, 0.026, 0.034],
      gamma: [0.98, 1.00, 1.00], gain: [1.06, 0.99, 0.96],
      sat: 1.34, vibrance: 0.22,
      shadowTint: [-0.008, 0.014, 0.026], highTint: [0.040, 0.012, -0.020],
      shoulder: 0.70,
      halation: { amount: 0.26, radius: 12, threshold: 0.62, color: [1, 0.40, 0.28] },
      grain: { amount: 0.120, size: 1, shadow: 2.4 }, vignette: 0.40, leak: 0.34
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
      grain: { amount: 0.110, size: 1, shadow: 2.4 }, vignette: 0.30, leak: 0.10
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
    },
    {
      code: 'PM-400', name: '粉彩薄荷', en: 'PASTEL MINT', process: 'C-41', iso: 400,
      note: '薄荷色的空气感：黑位轻抬、反差极低，肤色像蒙了一层薄雾。',
      tone: '#a9c0b4',
      contrast: [0.90, 0.91, 0.91], lift: [0.028, 0.032, 0.032],
      gamma: [0.98, 0.99, 1.00], gain: [1.00, 1.02, 1.02],
      sat: 0.86, vibrance: 0.10,
      shadowTint: [0.000, 0.014, 0.020], highTint: [0.012, 0.008, 0.010],
      shoulder: 0.66,
      halation: { amount: 0.12, radius: 8, threshold: 0.75, color: [1, 0.50, 0.36] },
      grain: { amount: 0.026, size: 1, shadow: 1.2 }, vignette: 0.13, leak: 0
    },
    {
      code: 'ER-200', name: '欧陆赤调', en: 'EURO RED', process: 'C-41', iso: 200,
      note: '欧陆底片的赤红体温：红先声夺人，蓝绿退后半步。',
      tone: '#b44a33',
      contrast: [1.10, 1.01, 0.95], lift: [0.010, 0.012, 0.014],
      gamma: [0.98, 1.00, 1.01], gain: [1.08, 0.99, 0.93],
      sat: 1.20, vibrance: 0.16,
      shadowTint: [0.018, 0.000, 0.002], highTint: [0.030, 0.004, -0.016],
      shoulder: 0.70,
      halation: { amount: 0.17, radius: 9, threshold: 0.71, color: [1, 0.36, 0.22] },
      grain: { amount: 0.068, size: 1, shadow: 1.9 }, vignette: 0.23, leak: 0
    },
    {
      code: 'NH-1600', name: '高感暖光', en: 'AVAILABLE LIGHT', process: 'C-41', iso: 1600,
      note: '把路灯和室内灯当太阳：高感、暖调，颗粒像砂纸。',
      tone: '#c08a62',
      contrast: [0.96, 0.95, 0.94], lift: [0.030, 0.026, 0.030],
      gamma: [1.00, 0.99, 0.98], gain: [1.06, 1.00, 1.00],
      sat: 1.02, vibrance: 0.12,
      shadowTint: [0.016, 0.000, 0.010], highTint: [0.026, 0.006, -0.008],
      shoulder: 0.78,
      halation: { amount: 0.34, radius: 13, threshold: 0.58, color: [1, 0.38, 0.24] },
      grain: { amount: 0.115, size: 1, shadow: 2.4 }, vignette: 0.26, leak: 0
    },
    {
      code: 'CT-100', name: '中性正片', en: 'NEUTRAL CHROME', process: 'E-6', iso: 100,
      note: '中性通透的现代反转片：颜色准、颗粒极细，亮部干净又有细节。',
      tone: '#4b7fa8',
      contrast: [1.12, 1.10, 1.08], lift: [0.002, 0.002, 0.004],
      gamma: [0.99, 1.00, 1.00], gain: [1.01, 1.01, 1.03],
      sat: 1.12, vibrance: 0.22,
      shadowTint: [-0.006, 0.004, 0.014], highTint: [0.010, 0.004, 0.006],
      shoulder: 0.80,
      halation: { amount: 0.08, radius: 6, threshold: 0.82, color: [1, 0.42, 0.28] },
      grain: { amount: 0.024, size: 1, shadow: 1.2 }, vignette: 0.12, leak: 0
    },
    {
      code: 'SF-100', name: '柔调正片', en: 'SOFT CHROME', process: 'E-6', iso: 100,
      note: '柔和的正片：肤色准确、高光柔顺，像自然光婚礼的底片。',
      tone: '#c9b9a8',
      contrast: [0.98, 0.97, 0.96], lift: [0.006, 0.006, 0.008],
      gamma: [1.00, 1.00, 1.01], gain: [1.01, 1.00, 0.99],
      sat: 1.02, vibrance: 0.10,
      shadowTint: [0.004, 0.006, 0.010], highTint: [0.012, 0.008, 0.004],
      shoulder: 0.72,
      halation: { amount: 0.10, radius: 7, threshold: 0.78, color: [1, 0.48, 0.32] },
      grain: { amount: 0.022, size: 1, shadow: 1.2 }, vignette: 0.10, leak: 0
    },
    {
      code: 'DY-250', name: '日光电影', en: 'DAYLIGHT CINE', process: 'ECN-2', iso: 250,
      note: '日光电影负片：低反差、宽容度大，肤色中性偏暖，高光很耐拉。',
      tone: '#6f8f86',
      contrast: [0.94, 0.93, 0.92], lift: [0.020, 0.018, 0.016],
      gamma: [1.00, 1.00, 1.01], gain: [1.02, 1.00, 0.98],
      sat: 0.98, vibrance: 0.14,
      shadowTint: [0.004, 0.010, 0.016], highTint: [0.014, 0.008, -0.006],
      shoulder: 0.62,
      halation: { amount: 0.16, radius: 8, threshold: 0.72, color: [1, 0.48, 0.30] },
      grain: { amount: 0.048, size: 1, shadow: 1.7 }, vignette: 0.10, leak: 0
    },
    {
      code: 'TN-500', name: '钨丝电影', en: 'TUNGSTEN CINE', process: 'ECN-2', iso: 500,
      note: '钨丝电影负片：青蓝阴影配暖高光，低反差、宽容度大，夜色干净。',
      tone: '#3f6f8f',
      contrast: [0.96, 0.95, 0.94], lift: [0.024, 0.026, 0.030],
      gamma: [1.00, 1.00, 0.99], gain: [0.99, 1.00, 1.03],
      sat: 1.02, vibrance: 0.16,
      shadowTint: [-0.010, 0.002, 0.020], highTint: [0.016, 0.002, 0.004],
      shoulder: 0.66,
      halation: { amount: 0.14, radius: 9, threshold: 0.70, color: [1, 0.46, 0.30] },
      grain: { amount: 0.058, size: 1, shadow: 1.8 }, vignette: 0.14, leak: 0
    },
    {
      code: 'NG-3200', name: '夜间颗粒', en: 'NIGHT GRAIN', process: 'B&W', iso: 3200,
      note: '高感粗粒，暗部发灰，夜拍和演唱会专用的噪点质感。',
      tone: '#5e5b55', bw: true,
      contrast: 1.12, lift: 0.018, gamma: 1.00, gain: 1.02, shoulder: 0.80,
      shadowTint: [0.004, 0.003, 0.007], highTint: [0.005, 0.005, 0.004],
      grain: { amount: 0.160, size: 1, shadow: 2.4 }, vignette: 0.30, leak: 0
    },
    {
      code: 'XC-400', name: '宽容黑白', en: 'LATITUDE MONO', process: 'C-41', iso: 400,
      note: 'C-41 染料型黑白，宽容度极高，高光柔和、阴影轻。',
      tone: '#7f8386', bw: true,
      contrast: 0.94, lift: 0.014, gamma: 1.02, gain: 0.99, shoulder: 0.66,
      shadowTint: [0.000, 0.002, 0.006], highTint: [0.003, 0.004, 0.003],
      grain: { amount: 0.038, size: 1, shadow: 1.2 }, vignette: 0.12, leak: 0
    },
    {
      code: 'PN-50', name: '锐利细粒', en: 'CRISP MONO', process: 'B&W', iso: 50,
      note: '50 度极细颗粒，中高反差，三脚架风光的硬朗黑白。',
      tone: '#8c8f92', bw: true,
      contrast: 1.34, lift: -0.004, gamma: 0.98, gain: 1.03, shoulder: 0.78,
      shadowTint: [0.002, 0.002, 0.004], highTint: [0.006, 0.006, 0.006],
      grain: { amount: 0.018, size: 1, shadow: 1.1 }, vignette: 0.16, leak: 0
    },
    {
      code: 'WT-200', name: '棕调暖黑白', en: 'WARM TONE MONO', process: 'B&W', iso: 200,
      note: '暖调相纸式黑白，阴影偏棕、高光乳白，像手工放大的旧照片。',
      tone: '#a8825c', bw: true,
      contrast: 1.08, lift: 0.022, gamma: 1.04, gain: 0.97, shoulder: 0.68,
      shadowTint: [0.012, 0.005, -0.003], highTint: [0.030, 0.016, -0.012],
      grain: { amount: 0.055, size: 1, shadow: 1.7 }, vignette: 0.22, leak: 0
    }
  ];

  /* --- P1 色彩模型 -------------------------------------------------------
     3×3 串扰矩阵：行和为 1，保证中性灰不被染色；用很小的正负交叉项
     模拟染料层之间的互相吸收，让颜色不是“三个独立通道”那么简单。
     随色相变化的饱和度：用两个余弦谐波做平滑的色相权重，暖黄/肤色
     略抬，青绿/蓝略收。两者都可通过乳剂对象覆盖：
       matrix: [9 个数字，行优先]
       hueSat: 强度倍率，0 关闭
     黑白乳剂强制关闭，避免给灰阶引入无意义的颜色。 */
  var COLOR_MODEL = {
    matrix: [
      1.000, 0.0225, -0.0225,
      -0.015, 1.000, 0.015,
      0.010, -0.010, 1.000
    ],
    hue: { a1: 0.035, p1: 0.60, a2: 0.014, p2: 2.40 }
  };

  function colorModel(film) {
    if (film.bw) return { matrix: null, hueSat: 0 };
    return {
      matrix: film.matrix && film.matrix.length === 9 ? film.matrix : COLOR_MODEL.matrix,
      hueSat: film.hueSat != null ? film.hueSat : 1
    };
  }

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
     opt: { ev, halation, bloom, grain, vignette, leak, seed, flash }       */
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
    /* 全局 bloom 不依赖 film.halation：黑白和细粒卷也需要一点光学扩散 */
    var wantBloom = !!opt.bloom;
    var wantMask = wantHalo || wantBloom;
    var wantGrain = !!opt.grain && film.grain.amount > 0;
    var wantVig = !!opt.vignette && film.vignette > 0;
    var wantLeak = !!opt.leak && film.leak > 0;
    var wantFlash = opt.flash ? opt.flash : 0;

    var bloomAmt = wantBloom ? (film.bloom && film.bloom.amount != null ? film.bloom.amount : (bw ? 0.10 : 0.12)) : 0;
    var bloomCol = film.bloom && film.bloom.color ? film.bloom.color : (bw ? [1, 1, 1] : [1, 0.96, 0.90]);

    var hw = 0, hh = 0, mask = null, maskBloom = null, haloR = 0, haloAmt = 0, haloCol = null, haloT = 0;
    if (wantMask) {
      hw = Math.max(2, w >> 1); hh = Math.max(2, h >> 1);
      mask = new Uint8ClampedArray(hw * hh * 4);
      haloR = wantHalo ? Math.max(1, Math.round(film.halation.radius / 2)) : 4;
      haloAmt = wantHalo ? film.halation.amount : 0;
      haloCol = wantHalo ? film.halation.color : null;
      haloT = wantHalo ? film.halation.threshold : 0.72;
    }

    var seed = opt.seed == null ? 7 : opt.seed;
    /* 细粒只承担质地的“沙感”，主体起伏交给低频团块；总量再压一档，
       否则 1px 白噪声在灰场里会像电视雪花，而不是胶片颗粒 */
    var gAmt = film.grain.amount * (opt.grainScale || 1) * 255 * 0.70;
    var gShadow = film.grain.shadow;
    var gSize = film.grain.size || 1;
    /* 细粒保持 1px，另叠一层 2–5px 的团块；高 ISO 团块更大更明显 */
    var gCoarseScale = film.grain.coarseScale || (film.iso >= 1600 ? 5 : film.iso >= 800 ? 4 : film.iso >= 400 ? 3 : 2);
    var gCoarseAmt = film.grain.coarse != null ? film.grain.coarse
      : (film.iso >= 800 ? 0.55 : film.iso >= 400 ? 0.50 : 0.38);
    var seedC = (seed * 13 + 29) | 0;
    var vig = film.vignette;
    var leak = film.leak;
    var cx = w / 2, cy = h / 2;
    var normR = Math.sqrt(cx * cx + cy * cy);

    /* P1 色彩模型：串扰矩阵 + 色相相关饱和度 */
    var model = colorModel(film);
    var cm = model.matrix;
    var cm0 = 0, cm1 = 0, cm2 = 0, cm3 = 0, cm4 = 0, cm5 = 0, cm6 = 0, cm7 = 0, cm8 = 0;
    if (cm) {
      cm0 = cm[0]; cm1 = cm[1]; cm2 = cm[2];
      cm3 = cm[3]; cm4 = cm[4]; cm5 = cm[5];
      cm6 = cm[6]; cm7 = cm[7]; cm8 = cm[8];
    }
    var hueSat = model.hueSat;
    var hueA1 = COLOR_MODEL.hue.a1, hueP1 = COLOR_MODEL.hue.p1;
    var hueA2 = COLOR_MODEL.hue.a2, hueP2 = COLOR_MODEL.hue.p2;
    var PI3 = Math.PI / 3;
    /* CPU 用 512 级色相权重表，避免每个像素算两次 cos；GPU 仍用解析式，
       两者在 0.7° 的量化误差内一致 */
    var HUE_N = 512, HUE_SCALE = HUE_N / (Math.PI * 2);
    var hueTable = null;
    if (hueSat) {
      hueTable = new Float32Array(HUE_N);
      for (var hi = 0; hi < HUE_N; hi++) {
        var ha = hi / HUE_SCALE;
        var hueWt = 1 + hueSat * (hueA1 * Math.cos(ha - hueP1) + hueA2 * Math.cos(2 * ha - hueP2));
        hueTable[hi] = hueWt < 0.5 ? 0.5 : hueWt > 1.5 ? 1.5 : hueWt;
      }
    }

    var i, x, y, r, g, b, l, mx, mn, s, lum, nrm, shw, hiw, m, mi, mxh, myh;
    var matR, matG, matB, hueCh, hueAng, hueW, hueIdx;

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

          /* 3×3 串扰：先记下原值，再一次性混合，避免行间互相污染 */
          if (cm) {
            matR = r; matG = g; matB = b;
            r = matR * cm0 + matG * cm1 + matB * cm2;
            g = matR * cm3 + matG * cm4 + matB * cm5;
            b = matR * cm6 + matG * cm7 + matB * cm8;
            if (r < 0) r = 0; else if (r > 255) r = 255;
            if (g < 0) g = 0; else if (g > 255) g = 255;
            if (b < 0) b = 0; else if (b > 255) b = 255;
          }

          lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
          mx = r > g ? r : g; if (b > mx) mx = b;
          mn = r < g ? r : g; if (b < mn) mn = b;
          s = sat + vib * (1 - (mx - mn) / 255);
          r = lum + (r - lum) * s;
          g = lum + (g - lum) * s;
          b = lum + (b - lum) * s;

          /* 色相相关饱和度：只缩放围绕亮度的色度，不改变亮度和色相 */
          if (hueSat) {
            mx = r > g ? r : g; if (b > mx) mx = b;
            mn = r < g ? r : g; if (b < mn) mn = b;
            hueCh = mx - mn;
            if (hueCh > 0.0255) {
              if (mx === r) hueAng = (g - b) / hueCh;
              else if (mx === g) hueAng = (b - r) / hueCh + 2;
              else hueAng = (r - g) / hueCh + 4;
              if (hueAng < 0) hueAng += 6;
              hueAng *= PI3;
              hueIdx = (hueAng * HUE_SCALE) | 0;
              if (hueIdx >= HUE_N) hueIdx = HUE_N - 1;
              hueW = hueTable[hueIdx];
              lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
              r = lum + (r - lum) * hueW;
              g = lum + (g - lum) * hueW;
              b = lum + (b - lum) * hueW;
            }
          }
        }
        lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        nrm = lum / 255;
        shw = 1 - nrm; hiw = nrm;
        r += st0 * shw + ht0 * hiw;
        g += st1 * shw + ht1 * hiw;
        b += st2 * shw + ht2 * hiw;

        /* 高光去饱和：胶片的高光不会像数码那样一直保持鲜艳 */
        if (!bw) {
          lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
          nrm = lum / 255;
          var hl = smoothstep(0.62, 1, nrm);
          var ds = hl * (film.highlightDesat != null ? film.highlightDesat : 0.28);
          if (ds > 0) {
            r += (lum - r) * ds;
            g += (lum - g) * ds;
            b += (lum - b) * ds;
          }
          lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
          nrm = lum / 255;
        }
        /* 高光轻微向白抬一点，黑白和彩色一致 */
        lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        nrm = lum / 255;
        var hl2 = smoothstep(0.62, 1, nrm);
        var wl = hl2 * 0.03;
        r += (255 - r) * wl;
        g += (255 - g) * wl;
        b += (255 - b) * wl;
        lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        nrm = lum / 255;

        if (wantMask) {
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

    if (wantMask) {
      boxBlur(mask, hw, hh, haloR, 2);
      if (wantBloom) {
        /* 在紧光晕的基础上再糊一次，得到更宽、更柔的镜头辉光 */
        maskBloom = new Uint8ClampedArray(mask);
        boxBlur(maskBloom, hw, hh, Math.max(3, Math.round(Math.min(hw, hh) / 60)), 2);
      }
    }

    /* 取景预览只跑第一遍色彩；没有空间效果时不必再扫一遍全画面 */
    if (!wantHalo && !wantBloom && !wantGrain && !wantVig && !wantLeak && !wantFlash) return data;

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
          if (bw) {
            /* 黑白胶片颗粒是单色的，不能给 R/G/B 不同噪声 */
            var n = nFine + nC;
            r += n * ga;
            g += n * ga;
            b += n * ga;
          } else {
            /* 以亮度颗粒为主，只留很弱的通道差；否则放大后全是彩色数码噪点 */
            var nL = nFine + nC;
            var nCh = n2 * 0.30;
            r += (nL + nCh * 0.55) * ga;
            g += (nL - nCh * 0.10) * ga;
            b += (nL - nCh * 0.55) * ga;
          }
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
  global.SPOOLO.COLOR_MODEL = COLOR_MODEL;
  global.SPOOLO.colorModel = colorModel;
  global.SPOOLO.meters = meters;
  global.SPOOLO.render = render;
  global.SPOOLO.buildLUT = buildLUT;
})(window);
