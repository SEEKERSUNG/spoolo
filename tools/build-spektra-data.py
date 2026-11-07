#!/usr/bin/env python3
"""Build js/spektra-data.js from upstream spektrafilm profiles.

数据来源（必须保留）：
  spektrafilm — https://github.com/andreavolpato/spektrafilm
  Copyright (c) Andrea Volpato
  code: GPL-3.0-or-later · profiles: CC BY-SA 4.0
  Modified by the SPOOLO project (SEEKERSUNG), 2026:
  profiles are re-encoded as base64 Float32/Uint16 arrays; the hanatos2025
  tc LUT is resampled to 49x49; the output OkLch gamut-compression table is
  quantized; only the negative/positive → paper → scan colour chain is kept.

用法：
  python tools/build-spektra-data.py \
      --upstream E:/tmp/spektrafilm-src \
      --out js/spektra-data.js

The upstream checkout must contain:
  src/spektrafilm/data/profiles/*.json
  src/spektrafilm/data/luts/spectral_upsampling/irradiance_xy_tc.npy
  src/spektrafilm/data/filters/neutral_print_filters.json
  src/spektrafilm/data/filters/heat_absorbing/schott/KG3.csv

Only the per-pixel colour chain is exported. Grain / halation / glare are not
baked into the data; SPOOLO keeps its own spatial effects.

Build dependencies: numpy, scipy, colour-science (the runtime app itself has no
dependencies).
"""
import argparse
import base64
import csv
import json
import math
import os
import re
import sys

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.special import erf
import colour

WL = np.arange(380, 781, 5, dtype=float)
LOG_EXPOSURE = np.linspace(-3, 4, 256)
D65_XY = np.array([0.3127, 0.3290])

# 界面上给光谱胶片用的短代号、色标与英文名（不改动上游 stock 名）
FILM_META = {
    'kodak_ektar_100': ('EKT100', 'EKTAR 100', '#c04a34', 'C-41'),
    'kodak_portra_160': ('P160', 'PORTRA 160', '#d8b49a', 'C-41'),
    'kodak_portra_400': ('P400', 'PORTRA 400', '#d9b79c', 'C-41'),
    'kodak_portra_800': ('P800', 'PORTRA 800', '#d2a98f', 'C-41'),
    'kodak_portra_800_push1': ('P800+1', 'PORTRA 800 PUSH +1', '#c99f86', 'C-41'),
    'kodak_portra_800_push2': ('P800+2', 'PORTRA 800 PUSH +2', '#c0957c', 'C-41'),
    'kodak_gold_200': ('G200', 'GOLD 200', '#d8a24a', 'C-41'),
    'kodak_ultramax_400': ('UM400', 'ULTRAMAX 400', '#c86a3a', 'C-41'),
    'kodak_vision3_50d': ('V50D', 'VISION3 50D', '#8a9a8a', 'ECN-2'),
    'kodak_vision3_250d': ('V250D', 'VISION3 250D', '#7a9a9a', 'ECN-2'),
    'kodak_verita_200d': ('V200D', 'VERITA 200D', '#8a9a7a', 'ECN-2'),
    'kodak_vision3_200t': ('V200T', 'VISION3 200T', '#6a8a9a', 'ECN-2'),
    'kodak_vision3_500t': ('V500T', 'VISION3 500T', '#5a7a8a', 'ECN-2'),
    'fujifilm_pro_400h': ('400H', 'PRO 400H', '#7aa88a', 'C-41'),
    'fujifilm_c200': ('C200', 'C200', '#6a9a8a', 'C-41'),
    'fujifilm_xtra_400': ('X400', 'XTRA 400', '#8a9a5a', 'C-41'),
    'kodak_ektachrome_100': ('E100', 'EKTACHROME 100', '#3a6a8a', 'E-6'),
    'kodak_kodachrome_64': ('K64', 'KODACHROME 64', '#a84a3a', 'K-14'),
    'fujifilm_velvia_100': ('V100', 'VELVIA 100', '#b62b3a', 'E-6'),
    'fujifilm_provia_100f': ('P100F', 'PROVIA 100F', '#4a7a9a', 'E-6'),
}

PAPER_META = {
    'kodak_portra_endura': ('Portra Endura', '负片相纸'),
    'kodak_endura_premier': ('Endura Premier', '负片相纸'),
    'kodak_supra_endura': ('Supra Endura', '负片相纸'),
    'kodak_ektacolor_edge': ('Ektacolor Edge', '负片相纸'),
    'kodak_ultra_endura': ('Ultra Endura', '负片相纸'),
    'fujifilm_crystal_archive_typeii': ('Crystal Archive Type II', '负片相纸'),
    'kodak_2383': ('Kodak 2383', '电影正片'),
    'kodak_2393': ('Kodak 2393', '电影正片'),
}

FILM_ORDER = [
    'kodak_ektar_100', 'kodak_portra_160', 'kodak_portra_400', 'kodak_portra_800',
    'kodak_portra_800_push1', 'kodak_portra_800_push2', 'kodak_gold_200',
    'kodak_ultramax_400', 'kodak_vision3_50d', 'kodak_vision3_250d',
    'kodak_verita_200d', 'kodak_vision3_200t', 'kodak_vision3_500t',
    'fujifilm_pro_400h', 'fujifilm_c200', 'fujifilm_xtra_400',
    'kodak_ektachrome_100', 'kodak_kodachrome_64', 'fujifilm_velvia_100',
    'fujifilm_provia_100f',
]

PAPER_ORDER = [
    'kodak_portra_endura', 'kodak_endura_premier', 'kodak_supra_endura',
    'kodak_ektacolor_edge', 'kodak_ultra_endura',
    'fujifilm_crystal_archive_typeii', 'kodak_2383', 'kodak_2393',
]

CONSUMER = {'kodak_gold_200', 'kodak_ultramax_400', 'fujifilm_c200', 'fujifilm_xtra_400'}
CINE = {'kodak_vision3_50d', 'kodak_vision3_250d', 'kodak_verita_200d',
        'kodak_vision3_200t', 'kodak_vision3_500t'}
# 片名里的数字不总是 ISO（Vision3 50D 的第一个数字是 3），这里显式给出。
FILM_ISO = {
    'kodak_vision3_50d': 50,
    'kodak_vision3_250d': 250,
    'kodak_vision3_200t': 200,
    'kodak_vision3_500t': 500,
}


def b64(arr):
    a = np.asarray(arr, dtype='<f4')
    return base64.b64encode(a.tobytes()).decode('ascii')


def b64u16(arr):
    a = np.asarray(arr, dtype='<u2')
    return base64.b64encode(a.tobytes()).decode('ascii')


def load_shared(upstream, shared_path=None):
    """Prefer an explicit JSON dump; otherwise derive everything from
    colour-science + the upstream KG3 filter CSV so the build is reproducible."""
    if shared_path and os.path.exists(shared_path):
        with open(shared_path, 'r', encoding='utf-8') as f:
            shared = json.load(f)
        cmf = np.array(shared['cmfs'], dtype=float)
        illu = {k: np.array(v, dtype=float) for k, v in shared['illuminants'].items()}
        dichroic = np.array(shared['dichroic_cmy'], dtype=float)
        return shared.get('kg3') and np.array(shared['kg3'], dtype=float), cmf, illu, dichroic

    shape = colour.SpectralShape(380, 780, 5)
    cmf = np.array(colour.MSDS_CMFS['CIE 1931 2 Degree Standard Observer'].copy().align(shape)[:], dtype=float)
    illu = {}
    for name in ('D50', 'D55', 'D65'):
        v = np.array(colour.SDS_ILLUMINANTS[name].copy().align(shape)[:], dtype=float)
        illu[name] = v / np.mean(v)
    # TH-KG3 = 3400 K black body through the Schott KG3 heat filter
    kg3_path = os.path.join(upstream, 'src/spektrafilm/data/filters/heat_absorbing/schott/KG3.csv')
    xs, ys = [], []
    with open(kg3_path, 'r', encoding='utf-8') as f:
        for row in csv.reader(f):
            if len(row) < 2:
                continue
            try:
                xs.append(float(row[0]))
                ys.append(float(row[1]))
            except ValueError:
                pass
    kg3 = np.interp(WL, np.array(xs), np.array(ys))
    bb = colour.colorimetry.blackbody_spectral_radiance(WL * 1e-9, 3400)
    th = bb * kg3
    illu['TH-KG3'] = th / np.mean(th)
    # Custom dichroic filters (same analytic model as spektrafilm)
    def combined(wavelength, transitions, edges):
        d = np.zeros((np.size(wavelength), 3))
        d[:, 2] = erf((wavelength - edges[0]) / transitions[0])
        d[:, 0] = -erf((wavelength - edges[3]) / transitions[3])
        d[wavelength <= 550, 1] = -erf((wavelength[wavelength <= 550] - edges[1]) / transitions[1])
        d[wavelength > 550, 1] = erf((wavelength[wavelength > 550] - edges[2]) / transitions[2])
        return d / 2 + 0.5
    dichroic = combined(WL, [12, 8, 8, 8], [516, 500, 610, 607])
    return kg3, cmf, illu, dichroic


def illuminant_xy(illu, cmf):
    xyz = np.sum(illu[:, None] * cmf, axis=0)
    return xyz[:2] / np.sum(xyz)


def cat_matrix(src_xy, dst_xy, method):
    return np.array(colour.adaptation.matrix_chromatic_adaptation_VonKries(
        colour.xy_to_XYZ(src_xy), colour.xy_to_XYZ(dst_xy), method), dtype=float)


def parse_profile(path):
    with open(path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    def clean(x):
        if isinstance(x, list) and x and isinstance(x[0], list):
            return np.array([[np.nan if v is None else v for v in row] for row in x], dtype=float)
        return np.array([np.nan if v is None else v for v in x], dtype=float)

    d = raw['data']
    out = {
        'info': raw['info'],
        'log_sensitivity': clean(d['log_sensitivity']),
        'channel_density': clean(d['channel_density']),
        'base_density': clean(d['base_density']),
        'log_exposure': clean(d['log_exposure']),
        'density_curves': clean(d['density_curves']),
        'window': clean(d.get('hanatos2025_adaptation_window_params', [])),
    }
    m = d.get('density_curves_model')
    if m:
        out['model'] = {
            'centers': np.array(m['centers'], dtype=float),
            'amplitudes': np.array(m['amplitudes'], dtype=float),
            'sigmas': np.array(m['sigmas'], dtype=float),
        }
    return raw, out


def spectral_window(params):
    if params is None or len(params) < 4:
        return np.ones((81, 3), dtype=float)
    c_uv, sigma_uv, c_ir, sigma_ir = (float(v) for v in params[:4])
    edge_uv = 0.5 * (1 + erf((WL - c_uv) / (sigma_uv * math.sqrt(2))))
    edge_ir = 0.5 * (1 - erf((WL - c_ir) / (sigma_ir * math.sqrt(2))))
    return np.repeat((edge_uv * edge_ir)[:, None], 3, axis=1)


def coupler_matrix(stock, positive):
    if positive:
        gs = (0.12, 0.08, 0.06)
        r_gb = (0.12, 0.06)
        g_rb = (0.08, 0.06)
        b_rg = (0.06, 0.06)
        if stock == 'fujifilm_velvia_100':
            gs = (0.108, 0.072, 0.054)
            r_gb = (0.108, 0.054)
            g_rb = (0.072, 0.054)
            b_rg = (0.054, 0.054)
        elif stock == 'fujifilm_provia_100f':
            gs = (0.156, 0.104, 0.078)
            r_gb = (0.156, 0.078)
            g_rb = (0.104, 0.078)
            b_rg = (0.078, 0.078)
    else:
        gs = (0.336, 0.319, 0.273)
        r_gb = (0.353, 0.302)
        g_rb = (0.154, 0.353)
        b_rg = (0.168, 0.226)
    return np.array([
        [gs[0], r_gb[0], r_gb[1]],
        [g_rb[0], gs[1], g_rb[1]],
        [b_rg[0], b_rg[1], gs[2]],
    ], dtype=float)


def build_tc_lut(spectra, sensitivity, window, illu, size):
    """Replicates compute_hanatos2025_tc_lut(no surface)."""
    sens = np.nan_to_num(sensitivity)
    norm = (np.sum(sens * illu[:, None] * window, axis=0) /
            np.sum(sens * illu[:, None], axis=0))
    weighted = sens * window / norm
    raw = spectra.reshape(-1, spectra.shape[-1]) @ weighted
    raw = raw.reshape(spectra.shape[0], spectra.shape[1], 3)
    if size == raw.shape[0]:
        return raw.astype(np.float32)
    src = raw.shape[0]
    coords = np.linspace(0, src - 1, size)
    gi, gj = np.meshgrid(coords, coords, indexing='ij')
    out = np.empty((size, size, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = map_coordinates(raw[..., c], [gi, gj], order=3, mode='nearest')
    return out


# ---------------------------------------------------------------------------
# 输入色域压缩（spektrafilm InputGamutCompressSpec，默认 xy 径向压缩）
# 这部分在数据生成时烘进 tc LUT，运行时不再做逐像素压缩。

def spectral_locus_xy(cmf):
    wl = np.arange(380, 705, 5)
    idx = ((wl - 380) / 5).astype(int)
    xyz = cmf[idx]
    total = xyz.sum(axis=1)
    xy = xyz[:, :2] / np.maximum(total[:, None], 1e-12)
    return np.concatenate([xy, xy[:1]], axis=0)


def ray_polygon_distance(origin, direction, polygon):
    flat = direction.reshape(-1, 2)
    t_min = np.full(flat.shape[0], np.inf)
    a = polygon[:-1]
    b = polygon[1:]
    edge = b - a
    for k in range(len(edge)):
        ex, ey = edge[k]
        ax, ay = a[k]
        dx = flat[:, 0]
        dy = flat[:, 1]
        denom = dx * ey - dy * ex
        valid = np.abs(denom) > 1e-12
        ox = origin[0] - ax
        oy = origin[1] - ay
        t = np.where(valid, (-ox * ey + oy * ex) / np.where(valid, denom, 1.0), np.inf)
        s = np.where(valid, (-ox * dy + oy * dx) / np.where(valid, denom, 1.0), np.inf)
        good = valid & (t > 1e-9) & (s >= 0.0) & (s <= 1.0)
        t_min = np.where(good & (t < t_min), t, t_min)
    return t_min.reshape(direction.shape[:-1])


def reinhard_knee(d, threshold, limit, power):
    out = np.array(d, dtype=float, copy=True)
    mask = out > threshold
    if np.any(mask):
        scale = limit - threshold
        x = (out[mask] - threshold) / scale
        out[mask] = threshold + scale * x / np.power(1.0 + np.power(x, power), 1.0 / power)
    return out


def compress_xy_radial(xy, white_xy, locus, threshold=0.0, limit=1.0, power=6.0):
    delta = xy - white_xy
    dist = np.linalg.norm(delta, axis=-1)
    with np.errstate(invalid='ignore', divide='ignore'):
        safe = np.fmax(dist, 1e-12)
        direction = delta / safe[..., None]
        boundary = ray_polygon_distance(white_xy, direction, locus)
        d_norm = dist / np.fmax(boundary, 1e-12)
        d_comp = reinhard_knee(d_norm, threshold, limit, power)
        new_xy = white_xy + direction * (d_comp * boundary)[..., None]
    return np.where((dist < 1e-9)[..., None], xy, new_xy)


def remap_tc_lut(tc_lut, ref_xy, locus):
    """new_lut[grid] = old_lut[compress_xy(grid)]，与上游 remap 一致。"""
    H, W, C = tc_lut.shape
    i_idx, j_idx = np.meshgrid(np.arange(H, dtype=float), np.arange(W, dtype=float), indexing='ij')
    xq = i_idx / (H - 1)
    yq = j_idx / (W - 1)
    sx = np.sqrt(np.clip(xq, 0, 1))          # 1 - xy.x
    xy = np.stack([1.0 - sx, yq * sx], axis=-1)
    xy_c = compress_xy_radial(xy.reshape(-1, 2), ref_xy, locus).reshape(H, W, 2)
    sx2 = 1.0 - np.clip(xy_c[..., 0], 0, 1)  # 1 - xy.x
    xq2 = np.clip(sx2 * sx2, 0, 1)
    yq2 = np.clip(np.where(sx2 > 1e-8, xy_c[..., 1] / np.maximum(sx2, 1e-8), 0), 0, 1)
    coords = [xq2.ravel() * (H - 1), yq2.ravel() * (W - 1)]
    out = np.empty_like(tc_lut)
    for c in range(C):
        out[..., c] = map_coordinates(tc_lut[..., c], coords, order=1, mode='nearest').reshape(H, W)
    return out


def oklch_cmax_table(nL=48, nH=360, n_bisect=18):
    """sRGB cube C_max(L, h) for the OkLch output gamut mapping.

    Same bisection as spektrafilm.utils.gamut_compression's
    _build_polar_perceptual_c_max_table('oklch', 'sRGB').
    """
    L_grid = np.linspace(0.02, 1.0, nL)
    h_grid = np.linspace(-np.pi, np.pi, nH, endpoint=False)
    L_mesh, h_mesh = np.meshgrid(L_grid, h_grid, indexing='ij')
    lo = np.zeros_like(L_mesh)
    hi = np.full_like(L_mesh, 0.5)
    white = colour.RGB_COLOURSPACES['sRGB'].whitepoint
    for _ in range(n_bisect):
        mid = (lo + hi) * 0.5
        a = mid * np.cos(h_mesh)
        b = mid * np.sin(h_mesh)
        lab = np.stack([L_mesh, a, b], axis=-1).reshape(-1, 3)
        xyz = np.asarray(colour.Oklab_to_XYZ(lab))
        rgb = np.asarray(colour.XYZ_to_RGB(
            xyz, colourspace='sRGB', illuminant=white, apply_cctf_encoding=False))
        in_gamut = np.all((rgb >= -1e-6) & (rgb <= 1.0 + 1e-6), axis=-1).reshape(L_mesh.shape)
        lo = np.where(in_gamut, mid, lo)
        hi = np.where(in_gamut, hi, mid)
    return L_grid, h_grid, lo


def profile_metadata(stock):
    meta = FILM_META.get(stock)
    if not meta:
        code = re.sub(r'[^A-Z0-9]', '', stock.upper())[-7:]
        meta = (code, stock.replace('_', ' ').upper(), '#c9a888', 'C-41')
    m = re.search(r'(\d+)', stock)
    iso = FILM_ISO.get(stock, int(m.group(1)) if m else 400)
    push = 0
    if stock.endswith('push1'):
        push = 1
    elif stock.endswith('push2'):
        push = 2
    return meta, iso, push


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upstream', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--tc-size', type=int, default=49)
    ap.add_argument('--shared', default=None)
    args = ap.parse_args()

    up = args.upstream
    prof_dir = os.path.join(up, 'src/spektrafilm/data/profiles')
    kg3, cmf, illu, dichroic = load_shared(up, args.shared)
    spectra = np.load(os.path.join(
        up, 'src/spektrafilm/data/luts/spectral_upsampling/irradiance_xy_tc.npy')).astype(np.float64)
    print('spectra LUT', spectra.shape, spectra.min(), spectra.max())

    neutral_path = os.path.join(up, 'src/spektrafilm/data/filters/neutral_print_filters.json')
    with open(neutral_path, 'r', encoding='utf-8') as f:
        neutral_raw = json.load(f)

    films = []
    papers = []
    paper_by_id = {}

    for stock in PAPER_ORDER:
        path = os.path.join(prof_dir, stock + '.json')
        if not os.path.exists(path):
            print('missing paper', stock)
            continue
        raw, p = parse_profile(path)
        info = p['info']
        view = info.get('viewing_illuminant', 'D50')
        view_illu = illu.get(view)
        if view_illu is None:
            view_illu = illu['D50']
            view = 'D50'
        m_out = colour.RGB_COLOURSPACES['sRGB'].matrix_XYZ_to_RGB @ cat_matrix(
            illuminant_xy(view_illu, cmf), D65_XY, 'CAT02')
        model = p.get('model')
        if model is None:
            raise RuntimeError('paper missing density_curves_model: ' + stock)
        name, kind = PAPER_META.get(stock, (stock.replace('_', ' ').title(), '相纸'))
        paper = {
            'id': stock,
            'name': name,
            'kind': kind,
            'type': info.get('type', 'negative'),
            'positive': info.get('type') == 'positive',
            'view': view,
            'mOut': m_out.flatten().tolist(),
            'sens': b64(np.nan_to_num(10 ** p['log_sensitivity'])),
            'cd': b64(p['channel_density']),
            'bd': b64(p['base_density']),
            'centers': model['centers'].flatten().tolist(),
            'amps': model['amplitudes'].flatten().tolist(),
            'sigmas': model['sigmas'].flatten().tolist(),
        }
        papers.append(paper)
        paper_by_id[stock] = paper

    for stock in FILM_ORDER:
        path = os.path.join(prof_dir, stock + '.json')
        if not os.path.exists(path):
            print('missing film', stock)
            continue
        raw, p = parse_profile(path)
        info = p['info']
        ref = info.get('reference_illuminant', 'D55')
        ref_illu = illu.get(ref)
        if ref_illu is None:
            ref_illu = illu['D55']
            ref = 'D55'
        m_in = cat_matrix(D65_XY, illuminant_xy(ref_illu, cmf), 'CAT16') @ \
            colour.RGB_COLOURSPACES['sRGB'].matrix_RGB_to_XYZ
        positive = info.get('type') == 'positive'
        meta, iso, push = profile_metadata(stock)
        code, en, tone, process = meta
        window = spectral_window(p['window'])
        tc_full = build_tc_lut(spectra, 10 ** p['log_sensitivity'], window, ref_illu, spectra.shape[0])
        tc_full = remap_tc_lut(tc_full, illuminant_xy(ref_illu, cmf), spectral_locus_xy(cmf))
        if args.tc_size != spectra.shape[0]:
            coords = np.linspace(0, spectra.shape[0] - 1, args.tc_size)
            gi, gj = np.meshgrid(coords, coords, indexing='ij')
            tc = np.empty((args.tc_size, args.tc_size, 3), dtype=np.float32)
            for c in range(3):
                tc[..., c] = map_coordinates(tc_full[..., c], [gi, gj], order=3, mode='nearest')
        else:
            tc = tc_full
        tc_max = np.maximum(tc.max(axis=(0, 1)), 1e-9)
        tc_q = np.clip(np.rint(tc / tc_max * 65535), 0, 65535).astype(np.uint16)
        film = {
            'id': stock,
            'name': info.get('name', stock),
            'code': code,
            'en': en,
            'tone': tone,
            'process': process,
            'iso': iso,
            'type': info.get('type', 'negative'),
            'positive': positive,
            'ref': ref,
            'view': info.get('viewing_illuminant', 'D50'),
            'antihalation': info.get('antihalation', 'weak'),
            'use': info.get('use', 'still'),
            'consumer': stock in CONSUMER,
            'cine': stock in CINE,
            'push': push,
            'target': info.get('target_print'),
            'mIn': m_in.flatten().tolist(),
            'tcSize': args.tc_size,
            'tcMax': tc_max.tolist(),
            'tc': b64u16(tc_q),
            'dc': b64(p['density_curves']),
            'cd': b64(p['channel_density']),
            'bd': b64(p['base_density']),
            'coupler': coupler_matrix(stock, positive).flatten().tolist(),
        }
        films.append(film)

    neutral = {}
    for paper in papers:
        per = neutral_raw.get(paper['id'], {}).get('TH-KG3', {})
        keep = {f['id']: per[f['id']] for f in films if f['id'] in per}
        if keep:
            neutral[paper['id']] = keep

    cmax_nL, cmax_nH = 48, 360
    _, _, cmax = oklch_cmax_table(cmax_nL, cmax_nH)
    cmax_max = 0.5
    cmax_q = np.clip(np.rint(cmax / cmax_max * 65535), 0, 65535).astype(np.uint16)

    out = {
        'version': '1.0',
        'source': {
            'project': 'spektrafilm',
            'url': 'https://github.com/andreavolpato/spektrafilm',
            'author': 'Andrea Volpato',
            'code_license': 'GPL-3.0-or-later',
            'profile_license': 'CC BY-SA 4.0',
        },
        'shared': {
            'cmf': b64(cmf),
            'illu': {k: b64(v) for k, v in illu.items()},
            'dichroic': b64(dichroic),
            'logExposure': b64(LOG_EXPOSURE),
            'kg3': b64(kg3),
            'oklabCmax': {
                'nL': cmax_nL,
                'nH': cmax_nH,
                'l0': 0.02,
                'l1': 1.0,
                'max': cmax_max,
                'data': b64u16(cmax_q),
            },
        },
        'films': films,
        'papers': papers,
        'neutral': neutral,
    }

    payload = json.dumps(out, separators=(',', ':'), ensure_ascii=False)
    header = (
        '/* SPOOLO · 光谱胶片 / 相纸数据（由 tools/build-spektra-data.py 生成）\n'
        ' * 来源：spektrafilm — https://github.com/andreavolpato/spektrafilm\n'
        ' * Copyright (c) Andrea Volpato\n'
        ' * 代码 GPL-3.0-or-later；profile 数据 CC BY-SA 4.0。\n'
        ' * 本文件是上游 profile 的直接衍生编码（Modified by SPOOLO / SEEKERSUNG, 2026），\n'
        ' * 仅用于浏览器端色彩链；修改说明见 THIRD_PARTY.md，许可原文见\n'
        ' * third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt。\n'
        ' */\n'
    )
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write("(function(g){'use strict';var S=g.SPOOLO=g.SPOOLO||{};S.SPEKTRA_DATA=")
        f.write(payload)
        f.write(';})(window);\n')

    print('films', len(films), 'papers', len(papers))
    print('out', args.out, os.path.getsize(args.out) / 1024.0, 'KB')


if __name__ == '__main__':
    main()
