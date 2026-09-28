"""Edmunds' planet, ground level: a ray-marched heightfield rendered once into a G-buffer,
then relit (dusk / night) and dressed with silhouettes, lights, dust and the Ranger."""
import math

import cv2
import numpy as np
from numba import njit, prange
from PIL import Image, ImageDraw

from lib import fbm3, ridged3, sample_sky, smoothstep


@njit(fastmath=True, cache=True)
def height(x, z, oct_):
    d = math.sqrt(x * x + z * z)
    h = (fbm3(x * 0.0011, 0.0, z * 0.0011, 4) - 0.5) * 24.0
    h += (fbm3(x * 0.004, 7.3, z * 0.004, 3) - 0.5) * 7.0
    h += (fbm3(x * 0.035, 1.3, z * 0.035, oct_) - 0.5) * 1.6
    h += (fbm3(x * 0.0017, 11.0, z * 0.0017, 3) - 0.35) * 55.0 * smoothstep(350.0, 1600.0, d)
    if oct_ >= 4:
        r = fbm3(x * 0.22, 2.1, z * 0.22, 2)
        h += smoothstep(0.62, 0.86, r) * 0.9
        h += math.sin(x * 0.9 + z * 0.35 + 6.0 * fbm3(x * 0.05, 4.0, z * 0.05, 2)) * 0.03
    # a lone mesa on the left mid-ground
    mx, mz = x - 950.0, z - 1900.0
    md = math.sqrt(mx * mx + mz * mz) + (fbm3(x * 0.006, 9.0, z * 0.006, 3) - 0.5) * 220.0
    if md < 520.0:
        h += 150.0 * smoothstep(430.0, 330.0, md) + 20.0 * smoothstep(520.0, 380.0, md)
    far = smoothstep(2600.0, 7500.0, d)
    if far > 0.0:
        m = ridged3(x * 0.00048, 5.0, z * 0.00048, 3 + oct_)
        mh = m * m * 700.0 * far
        tt = mh / 90.0
        fl = math.floor(tt)
        fr = tt - fl
        mh = 0.5 * mh + 0.5 * (fl + smoothstep(0.6, 1.0, fr)) * 90.0
        h += mh
    return h


@njit(inline="always", fastmath=True, cache=True)
def _oct(t):
    if t < 60.0:
        return 6
    if t < 400.0:
        return 4
    return 2


@njit(parallel=True, fastmath=True, cache=True)
def gbuffer_kernel(W, H, cam, fw, rt, up, tanh, L1, L2, depth, normal, albedo, pos, sh1, sh2, dirs):
    aspect = H / W
    for j in prange(H):
        for i in range(W):
            sx = (2.0 * (i + 0.5) / W - 1.0) * tanh
            sy = (1.0 - 2.0 * (j + 0.5) / H) * tanh * aspect
            dx = fw[0] + sx * rt[0] + sy * up[0]
            dy = fw[1] + sx * rt[1] + sy * up[1]
            dz = fw[2] + sx * rt[2] + sy * up[2]
            n = math.sqrt(dx * dx + dy * dy + dz * dz)
            dx, dy, dz = dx / n, dy / n, dz / n
            dirs[j, i, 0] = dx
            dirs[j, i, 1] = dy
            dirs[j, i, 2] = dz
            t = 0.5
            tp = t
            hit = False
            for _ in range(1400):
                px = cam[0] + dx * t
                py = cam[1] + dy * t
                pz = cam[2] + dz * t
                hh = height(px, pz, _oct(t))
                dh = py - hh
                if dh < 0.0015 * t:
                    hit = True
                    break
                tp = t
                st = 0.3 * dh
                if st < 0.005 * t:
                    st = 0.005 * t
                t += st
                if t > 60000.0 or py > 560.0:
                    break
            if not hit and dy < 0.02 and t < 60000.0:
                hit = True          # grazing ray ran out of steps: it is skimming the ground
                tp = t * 0.995
            if not hit:
                depth[j, i] = -1.0
                continue
            a = tp
            b = t
            for _ in range(8):
                m = 0.5 * (a + b)
                if cam[1] + dy * m - height(cam[0] + dx * m, cam[2] + dz * m, _oct(m)) < 0:
                    b = m
                else:
                    a = m
            t = 0.5 * (a + b)
            px = cam[0] + dx * t
            py = cam[1] + dy * t
            pz = cam[2] + dz * t
            o = _oct(t)
            e = max(0.03, 0.002 * t)
            hx = height(px + e, pz, o) - height(px - e, pz, o)
            hz = height(px, pz + e, o) - height(px, pz - e, o)
            nx, ny, nz = -hx / (2 * e), 1.0, -hz / (2 * e)
            nn = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / nn, ny / nn, nz / nn
            depth[j, i] = t
            normal[j, i, 0] = nx
            normal[j, i, 1] = ny
            normal[j, i, 2] = nz
            pos[j, i, 0] = px
            pos[j, i, 1] = py
            pos[j, i, 2] = pz
            # albedo: rusty sand on flats, grey-brown rock on slopes and ridges
            c1 = fbm3(px * 0.08, 0.0, pz * 0.08, 3)
            c2 = fbm3(px * 0.004, 3.0, pz * 0.004, 3)
            rock = smoothstep(0.93, 0.75, ny) + 0.5 * smoothstep(0.62, 0.8, c1)
            rock = min(rock, 1.0)
            sr, sg, sb = 0.46 + 0.1 * c2, 0.31 + 0.06 * c2, 0.21 + 0.03 * c2
            rr, rg, rb = 0.24 + 0.08 * c1, 0.20 + 0.06 * c1, 0.18 + 0.05 * c1
            albedo[j, i, 0] = sr * (1 - rock) + rr * rock
            albedo[j, i, 1] = sg * (1 - rock) + rg * rock
            albedo[j, i, 2] = sb * (1 - rock) + rb * rock
            # soft shadows toward both light directions
            for li in range(2):
                if li == 0:
                    lx, ly, lz = L1[0], L1[1], L1[2]
                else:
                    lx, ly, lz = L2[0], L2[1], L2[2]
                res = 1.0
                ts = 0.3 + 0.002 * t
                for _ in range(70):
                    qx = px + lx * ts
                    qy = py + ly * ts
                    qz = pz + lz * ts
                    dd = qy - height(qx, qz, 2)
                    if dd < 0.0:
                        res = 0.0
                        break
                    res = min(res, 12.0 * dd / ts)
                    ts += max(0.4 * dd, 0.02 * ts + 0.2)
                    if ts > 9000.0 or qy > 560.0:
                        break
                if li == 0:
                    sh1[j, i] = max(res, 0.0)
                else:
                    sh2[j, i] = max(res, 0.0)


def gbuffer(W, H, cam, fw, rt, up, hfov, L1, L2):
    depth = np.zeros((H, W), np.float32)
    normal = np.zeros((H, W, 3), np.float32)
    albedo = np.zeros((H, W, 3), np.float32)
    pos = np.zeros((H, W, 3), np.float32)
    sh1 = np.zeros((H, W), np.float32)
    sh2 = np.zeros((H, W), np.float32)
    dirs = np.zeros((H, W, 3), np.float32)
    gbuffer_kernel(W, H, np.asarray(cam, np.float64), fw, rt, up, math.tan(math.radians(hfov) / 2),
                   np.asarray(L1, np.float64), np.asarray(L2, np.float64),
                   depth, normal, albedo, pos, sh1, sh2, dirs)
    return dict(depth=depth, normal=normal, albedo=albedo, pos=pos, sh1=sh1, sh2=sh2, dirs=dirs)


@njit(parallel=True, fastmath=True, cache=True)
def sample_dirs(sky, dirs, out):
    H, W, _ = dirs.shape
    for j in prange(H):
        for i in range(W):
            r, g, b = sample_sky(sky, dirs[j, i, 0], dirs[j, i, 1], dirs[j, i, 2])
            out[j, i, 0] = r
            out[j, i, 1] = g
            out[j, i, 2] = b


def terrain_height(x, z):
    return float(height(float(x), float(z), 6))


# ----------------------------------------------------------------------------
# Lighting passes
# ----------------------------------------------------------------------------
def _sky_dusk(d, L, disk=True):
    el = np.clip(d[..., 1], -0.2, 1)
    cosang = np.clip(d @ L, -1, 1)
    ang = np.arccos(cosang)
    az_sun = np.clip((d[..., [0, 2]] @ (L[[0, 2]] / np.linalg.norm(L[[0, 2]]))), -1, 1)
    horizon_warm = np.float32([1.25, 0.55, 0.24]) * (0.35 + 0.65 * ((az_sun + 1) / 2) ** 3)[..., None]
    horizon_cool = np.float32([0.40, 0.34, 0.36])
    hz = horizon_cool + horizon_warm
    zen = np.float32([0.035, 0.05, 0.10])
    f = np.exp(-np.maximum(el, 0) / 0.09)[..., None]
    col = zen * (1 - f) + hz * f
    col *= 0.5
    col += (np.exp(-ang / 0.09) * 2.2 + np.exp(-ang / 0.35) * 0.35)[..., None] * np.float32([1.0, 0.62, 0.32])
    if disk:
        col += (np.exp(-(ang / 0.0055) ** 2) * 220)[..., None] * np.float32([1.0, 0.82, 0.62])
    return col.astype(np.float32)


def _sky_night(d, Lg):
    el = np.clip(d[..., 1], -0.2, 1)
    f = np.exp(-np.maximum(el, 0) / 0.12)[..., None]
    col = np.float32([0.0035, 0.0045, 0.009]) * (1 - f) + np.float32([0.012, 0.012, 0.016]) * f
    return col.astype(np.float32)


def light_dusk(g, L, sky_hdr=None):
    d = g["dirs"]
    sky = _sky_dusk(d, L)
    img = sky.copy()
    m = g["depth"] > 0
    n = g["normal"][m]
    al = g["albedo"][m]
    ndl = np.clip(n @ L, 0, None) * g["sh1"][m]
    sun = np.float32([1.0, 0.58, 0.32]) * 2.4
    amb = (np.float32([0.16, 0.17, 0.22]) * (0.45 + 0.55 * n[:, 1:2])
           + np.float32([0.25, 0.14, 0.08]) * 0.35 * np.clip(-(n @ L), 0, None)[:, None] * 0.0)
    back = np.float32([0.5, 0.26, 0.12]) * 0.18 * (1 - np.clip(n[:, 1:2], 0, 1))
    col = al * (ndl[:, None] * sun + amb * 0.55 + back)
    t = g["depth"][m][:, None]
    fogc = _sky_dusk(np.stack([d[m][:, 0], np.full(len(t), 0.03), d[m][:, 2]], -1)
                     / np.linalg.norm(np.stack([d[m][:, 0], np.full(len(t), 0.03), d[m][:, 2]], -1), axis=1, keepdims=True), L, False)
    fog = 1 - np.exp(-t / 7000.0)
    col = col * (1 - fog) + fogc * fog * 0.45
    img[m] = col
    return img.astype(np.float32)


def light_night(g, Lg, lights, stars):
    d = g["dirs"]
    img = _sky_night(d, Lg)
    sky_m = g["depth"] <= 0
    ext = np.exp(-0.035 / np.clip(d[..., 1], 0.004, 1))[..., None]
    img = img + stars * ext * sky_m[..., None]
    m = g["depth"] > 0
    n = g["normal"][m]
    al = g["albedo"][m]
    p = g["pos"][m]
    ndl = np.clip(n @ Lg, 0, None) * g["sh2"][m]
    col = al * (ndl[:, None] * np.float32([1.0, 0.72, 0.48]) * 0.09
                + np.float32([0.012, 0.015, 0.024]) * (0.5 + 0.5 * n[:, 1:2]))
    for (lp, lc, li) in lights:
        v = np.float32(lp) - p
        dist2 = (v * v).sum(1)
        v /= np.sqrt(dist2)[:, None]
        col += al * (np.clip((n * v).sum(1), 0, None) * li / (dist2 + 4.0))[:, None] * np.float32(lc)
    t = g["depth"][m][:, None]
    fog = 1 - np.exp(-t / 7000.0)
    col = col * (1 - fog) + np.float32([0.012, 0.012, 0.016]) * fog
    img[m] = col
    return img.astype(np.float32)


# ----------------------------------------------------------------------------
# Silhouettes
# ----------------------------------------------------------------------------
def draw_shape(img, polys, fill, rim=None, rim_off=(2.0, -1.0), ellipses=(), lines=(), ss=4):
    """Rasterise polygons (pixel coords, float) into img (linear HDR) as a solid silhouette
    with an optional rim light on the side facing the light (rim_off in pixels)."""
    pts = [p for poly in polys for p in poly] + [(e[0] - e[2], e[1] - e[3]) for e in ellipses] + \
          [(e[0] + e[2], e[1] + e[3]) for e in ellipses] + [p for ln in lines for p in ln[0]]
    if not pts:
        return
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = 8
    x0, y0 = int(math.floor(min(xs))) - pad, int(math.floor(min(ys))) - pad
    x1, y1 = int(math.ceil(max(xs))) + pad, int(math.ceil(max(ys))) + pad
    H, W, _ = img.shape
    if x1 < 0 or y1 < 0 or x0 >= W or y0 >= H:
        return
    w, h = x1 - x0, y1 - y0
    im = Image.new("L", (w * ss, h * ss), 0)
    dr = ImageDraw.Draw(im)
    for poly in polys:
        dr.polygon([((x - x0) * ss, (y - y0) * ss) for x, y in poly], fill=255)
    for (cx, cy, rx, ry) in ellipses:
        dr.ellipse([(cx - rx - x0) * ss, (cy - ry - y0) * ss, (cx + rx - x0) * ss, (cy + ry - y0) * ss], fill=255)
    for (seg, width) in lines:
        dr.line([((x - x0) * ss, (y - y0) * ss) for x, y in seg], fill=255, width=max(1, int(width * ss)))
    a = np.asarray(im.resize((w, h), Image.BOX), np.float32) / 255.0
    cx0, cy0 = max(x0, 0), max(y0, 0)
    cx1, cy1 = min(x1, W), min(y1, H)
    a = a[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    reg = img[cy0:cy1, cx0:cx1]
    reg *= (1 - a)[..., None]
    reg += a[..., None] * np.float32(fill)
    if rim is not None:
        M = np.float32([[1, 0, -rim_off[0]], [0, 1, -rim_off[1]]])
        sh = cv2.warpAffine(a, M, (a.shape[1], a.shape[0]))
        r = np.clip(a - sh, 0, 1)
        reg += r[..., None] * np.float32(rim)


def puff_sprites(n, size, seed):
    rng = np.random.default_rng(seed)
    out = []
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    rr = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2) / (size / 2)
    for k in range(n):
        noise = np.zeros((size, size), np.float32)
        amp = 1.0
        for o in range(5):
            s = 4 * 2 ** o
            g = rng.random((s, s)).astype(np.float32)
            noise += cv2.resize(g, (size, size), interpolation=cv2.INTER_CUBIC) * amp
            amp *= 0.5
        noise /= 1.94
        a = np.clip((noise - 0.3) * 1.8, 0, 1) * np.clip(1 - rr, 0, 1) ** 1.5
        out.append(a)
    return out
