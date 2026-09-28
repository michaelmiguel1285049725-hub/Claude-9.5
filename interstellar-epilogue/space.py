"""Saturn + wormhole, the wormhole transit, and Edmunds' planet from orbit."""
import math

import numpy as np
from numba import njit, prange

from lib import fbm3, noise3, ridged3, sample_sky, smoothstep


# ----------------------------------------------------------------------------
# Saturn system with a spherical wormhole
# ----------------------------------------------------------------------------
@njit(inline="always", fastmath=True, cache=True)
def _sphere_hit(ox, oy, oz, dx, dy, dz, cx, cy, cz, R):
    lx, ly, lz = cx - ox, cy - oy, cz - oz
    tc = lx * dx + ly * dy + lz * dz
    d2 = lx * lx + ly * ly + lz * lz - tc * tc
    if d2 > R * R:
        return -1.0
    th = math.sqrt(R * R - d2)
    t0 = tc - th
    if t0 > 1e-6:
        return t0
    t1 = tc + th
    if t1 > 1e-6:
        return t1
    return -1.0


@njit(inline="always", fastmath=True, cache=True)
def _ring_density(r):
    if r < 1.24 or r > 2.27:
        return 0.0
    fine = 0.75 + 0.25 * noise3(r * 380.0, 0.5, 0.5) + 0.12 * (noise3(r * 1400.0, 1.5, 0.5) - 0.5)
    if r < 1.53:        # C ring
        d = 0.10 + 0.06 * noise3(r * 90.0, 2.0, 1.0)
    elif r < 1.95:      # B ring
        d = 0.70 + 0.25 * noise3(r * 60.0, 3.0, 1.0)
    elif r < 2.03:      # Cassini division
        d = 0.04
    elif r < 2.21 or r > 2.216:
        d = 0.45 + 0.15 * noise3(r * 70.0, 4.0, 1.0)
    else:               # Encke gap
        d = 0.02
    d *= smoothstep(1.24, 1.27, r) * (1.0 - smoothstep(2.25, 2.27, r))
    return min(d * fine, 0.97)


@njit(fastmath=True, cache=True)
def _saturn_shade(ox, oy, oz, dx, dy, dz, sky, S, pole, L):
    """Colour along one straight ray through the Saturn system (no wormhole)."""
    tp = _sphere_hit(ox, oy, oz, dx, dy, dz, S[0], S[1], S[2], 1.0)
    # ring plane
    denom = dx * pole[0] + dy * pole[1] + dz * pole[2]
    tr = -1.0
    ra = 0.0
    rcr = rcg = rcb = 0.0
    if abs(denom) > 1e-9:
        tr = ((S[0] - ox) * pole[0] + (S[1] - oy) * pole[1] + (S[2] - oz) * pole[2]) / denom
        if tr > 0:
            qx, qy, qz = ox + tr * dx - S[0], oy + tr * dy - S[1], oz + tr * dz - S[2]
            rq = math.sqrt(qx * qx + qy * qy + qz * qz)
            ra = _ring_density(rq)
            if ra > 0:
                # planet shadow on the rings
                sh = _sphere_hit(qx + S[0], qy + S[1], qz + S[2], L[0], L[1], L[2],
                                 S[0], S[1], S[2], 1.0)
                lit = 0.03 if sh > 0 else 1.0
                sun = abs(L[0] * pole[0] + L[1] * pole[1] + L[2] * pole[2])
                b = (0.25 + 0.75 * sun) * lit * 1.0
                tint = 0.85 + 0.15 * noise3(rq * 40.0, 7.0, 0.0)
                rcr, rcg, rcb = b * 0.86 * tint, b * 0.76 * tint, b * 0.60 * tint
            else:
                tr = -1.0
    # planet
    pr = pg = pb = 0.0
    hit_p = tp > 0
    if hit_p:
        px, py, pz = ox + tp * dx, oy + tp * dy, oz + tp * dz
        nx, ny, nz = px - S[0], py - S[1], pz - S[2]
        lat = nx * pole[0] + ny * pole[1] + nz * pole[2]
        band = (0.5 + 0.18 * math.sin(lat * 23.0) + 0.12 * math.sin(lat * 57.0 + 1.3)
                + 0.08 * math.sin(lat * 131.0) + 0.1 * (noise3(nx * 3.0, lat * 40.0, nz * 3.0) - 0.5))
        polar = smoothstep(0.75, 0.95, abs(lat))
        ar = (0.70 + 0.30 * band) * (1 - polar) + 0.55 * polar
        ag = (0.56 + 0.26 * band) * (1 - polar) + 0.58 * polar
        ab = (0.36 + 0.18 * band) * (1 - polar) + 0.60 * polar
        ndl = nx * L[0] + ny * L[1] + nz * L[2]
        diff = smoothstep(-0.08, 0.35, ndl) * max(ndl, 0.0) ** 0.35
        # ring shadow on the planet
        dn = L[0] * pole[0] + L[1] * pole[1] + L[2] * pole[2]
        if abs(dn) > 1e-6:
            ts = -(nx * pole[0] + ny * pole[1] + nz * pole[2]) / dn
            if ts > 0:
                sx, sy, sz = nx + ts * L[0], ny + ts * L[1], nz + ts * L[2]
                diff *= 1.0 - 0.9 * _ring_density(math.sqrt(sx * sx + sy * sy + sz * sz))
        mu = -(nx * dx + ny * dy + nz * dz)
        limb = 0.55 + 0.45 * max(mu, 0.0) ** 0.5
        e = diff * limb * 1.1 + 0.006
        pr, pg, pb = ar * e, ag * e, ab * e
    # composite
    if hit_p:
        br, bg, bb = pr, pg, pb
    else:
        br, bg, bb = sample_sky(sky, dx, dy, dz)
    if tr > 0 and (not hit_p or tr < tp):
        return rcr * ra + br * (1 - ra), rcg * ra + bg * (1 - ra), rcb * ra + bb * (1 - ra)
    return br, bg, bb


@njit(parallel=True, fastmath=True, cache=True)
def saturn_kernel(W, H, cam, fw, rt, up, tanh, sky, sky2, S, pole, L, Wc, Rw, out):
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
            lx, ly, lz = Wc[0] - cam[0], Wc[1] - cam[1], Wc[2] - cam[2]
            tc = lx * dx + ly * dy + lz * dz
            px, py, pz = lx - tc * dx, ly - tc * dy, lz - tc * dz
            b = math.sqrt(px * px + py * py + pz * pz)
            if tc > 0 and b < Rw:
                # through the wormhole: the other galaxy, folded
                q = b / Rw
                ang = math.pi * (1.0 - q) ** 0.7 * 1.15
                ex, ey, ez = px / (b + 1e-12), py / (b + 1e-12), pz / (b + 1e-12)
                ca, sa = math.cos(ang), math.sin(ang)
                ndx, ndy, ndz = dx * ca + ex * sa, dy * ca + ey * sa, dz * ca + ez * sa
                r, g, bl = sample_sky(sky2, ndx, ndy, ndz)
                rim = math.exp(-((1.0 - q) / 0.012) ** 2) * 0.35
                g2 = 2.6 * (0.55 + 0.45 * q)
                out[j, i, 0] = r * g2 + rim * 0.9
                out[j, i, 1] = g * g2 + rim * 0.95
                out[j, i, 2] = bl * g2 + rim * 1.0
            else:
                if tc > 0:
                    alpha = 0.55 * (Rw / b) ** 1.3
                    ex, ey, ez = px / b, py / b, pz / b
                    ca, sa = math.cos(alpha), math.sin(alpha)
                    dx, dy, dz = dx * ca + ex * sa, dy * ca + ey * sa, dz * ca + ez * sa
                r, g, bl = _saturn_shade(cam[0], cam[1], cam[2], dx, dy, dz, sky, S, pole, L)
                out[j, i, 0] = r
                out[j, i, 1] = g
                out[j, i, 2] = bl


def render_saturn(W, H, cam, target, roll, hfov, sky, sky2, S, pole, L, Wc, Rw):
    from lib import look_at
    cam = np.asarray(cam, np.float64)
    fw, rt, up = look_at(cam, target, roll)
    out = np.zeros((H, W, 3), np.float32)
    saturn_kernel(W, H, cam, fw, rt, up, math.tan(math.radians(hfov) / 2), sky, sky2,
                  np.asarray(S, np.float64), np.asarray(pole, np.float64) / np.linalg.norm(pole),
                  np.asarray(L, np.float64) / np.linalg.norm(L), np.asarray(Wc, np.float64), Rw, out)
    return out


# ----------------------------------------------------------------------------
# Wormhole transit
# ----------------------------------------------------------------------------
@njit(parallel=True, fastmath=True, cache=True)
def tunnel_kernel(W, H, t, cx, cy, twist, sky2, out):
    for j in prange(H):
        for i in range(W):
            x = (i - cx) / H
            y = (j - cy) / H
            r = math.sqrt(x * x + y * y) + 1e-4
            a = math.atan2(y, x) + twist / (r + 0.3)
            z = 0.22 / r + t * 3.2
            ca, sa = math.cos(a), math.sin(a)
            n1 = fbm3(ca * 11.0, sa * 11.0, z * 0.25, 4)
            n2 = fbm3(ca * 31.0 + 3.0, sa * 31.0, z * 0.6, 3)
            streak = smoothstep(0.55, 0.85, n1) ** 2 * (0.3 + n2) + 0.25 * smoothstep(0.6, 0.8, n2) ** 3
            glow = 0.02 / (r * r + 0.004)
            walls = smoothstep(0.02, 0.35, r)
            v = streak * walls * 1.6
            # glimpses of the far galaxy, bent round the throat
            s = 1.0 / (1.0 + 6.0 * r)
            sr, sg, sb = sample_sky(sky2, ca * (1 - s), s * 2.0 - 1.0 + 0.3 * sa, sa * (1 - s) + 0.2)
            out[j, i, 0] = v * (0.95 + 0.4 * n2) + glow * 1.0 + sr * 1.5
            out[j, i, 1] = v * (0.78 + 0.2 * n2) + glow * 0.95 + sg * 1.5
            out[j, i, 2] = v * 0.62 + glow * 0.9 + sb * 1.5


# ----------------------------------------------------------------------------
# Edmunds' planet from orbit
# ----------------------------------------------------------------------------
@njit(parallel=True, fastmath=True, cache=True)
def planet_kernel(W, H, cam, fw, rt, up, tanh, sky, L, rot, sun_int, out, mask):
    aspect = H / W
    Hs = 0.018
    cr_, sr_ = math.cos(rot), math.sin(rot)
    for j in prange(H):
        for i in range(W):
            sx = (2.0 * (i + 0.5) / W - 1.0) * tanh
            sy = (1.0 - 2.0 * (j + 0.5) / H) * tanh * aspect
            dx = fw[0] + sx * rt[0] + sy * up[0]
            dy = fw[1] + sx * rt[1] + sy * up[1]
            dz = fw[2] + sx * rt[2] + sy * up[2]
            n = math.sqrt(dx * dx + dy * dy + dz * dz)
            dx, dy, dz = dx / n, dy / n, dz / n
            ox, oy, oz = cam[0], cam[1], cam[2]
            tc = -(ox * dx + oy * dy + oz * dz)
            qx, qy, qz = ox + tc * dx, oy + tc * dy, oz + tc * dz
            b = math.sqrt(qx * qx + qy * qy + qz * qz)
            cosang = dx * L[0] + dy * L[1] + dz * L[2]
            phase = 1.0 + 5.0 * max(cosang, 0.0) ** 12 + 0.6 * max(cosang, 0.0) ** 2
            r = g = bl = 0.0
            m = 0.0
            if tc > 0 and b < 1.0:
                th = math.sqrt(1.0 - b * b)
                t0 = tc - th
                px, py, pz = ox + t0 * dx, oy + t0 * dy, oz + t0 * dz
                # rotate surface texture about y
                ux = px * cr_ + pz * sr_
                uz = -px * sr_ + pz * cr_
                c1 = fbm3(ux * 2.2, py * 2.2, uz * 2.2, 6)
                c2 = fbm3(ux * 9.0 + 4.0, py * 9.0, uz * 9.0, 5)
                c3 = ridged3(ux * 4.0, py * 4.0 + 2.0, uz * 4.0, 5)
                ar = 0.42 + 0.25 * c1 - 0.18 * c3 + 0.1 * c2
                ag = 0.30 + 0.17 * c1 - 0.14 * c3 + 0.08 * c2
                ab = 0.22 + 0.10 * c1 - 0.08 * c3 + 0.06 * c2
                ice = smoothstep(0.82, 0.9, abs(py) + 0.1 * c2)
                ar = ar * (1 - ice) + 0.8 * ice
                ag = ag * (1 - ice) + 0.8 * ice
                ab = ab * (1 - ice) + 0.82 * ice
                ndl = px * L[0] + py * L[1] + pz * L[2]
                diff = smoothstep(-0.05, 0.25, ndl) * (0.3 + 0.7 * max(ndl, 0.0))
                mu = -(px * dx + py * dy + pz * dz)
                haze = (1.0 - max(mu, 0.0)) ** 3
                term = math.exp(-(ndl / 0.12) ** 2)
                e = diff * 2.2
                r = ar * e + haze * diff * 0.5 + term * haze * 0.35 * smoothstep(-0.2, 0.1, ndl)
                g = ag * e + haze * diff * 0.65 + term * haze * 0.14 * smoothstep(-0.2, 0.1, ndl)
                bl = ab * e + haze * diff * 0.95 + term * haze * 0.06 * smoothstep(-0.2, 0.1, ndl)
                m = 1.0
            else:
                sr, sg, sb = sample_sky(sky, dx, dy, dz)
                r, g, bl = sr, sg, sb
                if tc > 0:
                    alt = b - 1.0
                    dens = math.exp(-alt / Hs)
                    nq = (qx * L[0] + qy * L[1] + qz * L[2]) / b
                    lit = smoothstep(-0.28, 0.25, nq)
                    red = math.exp(-(nq / 0.18) ** 2)
                    a = dens * lit * phase * 0.8
                    r += a * (0.45 * (1 - red) + 1.3 * red)
                    g += a * (0.65 * (1 - red) + 0.55 * red)
                    bl += a * (1.10 * (1 - red) + 0.25 * red)
                # the star itself
                ang = math.acos(min(1.0, max(-1.0, cosang)))
                sun = math.exp(-(ang / 0.0045) ** 2) * 900.0 + math.exp(-ang / 0.03) * 3.0
                r += sun * sun_int
                g += sun * sun_int * 0.92
                bl += sun * sun_int * 0.8
            out[j, i, 0] = r
            out[j, i, 1] = g
            out[j, i, 2] = bl
            mask[j, i] = m


def render_planet(W, H, cam, target, roll, hfov, sky, L, rot, sun_int=1.0):
    from lib import look_at
    cam = np.asarray(cam, np.float64)
    fw, rt, up = look_at(cam, target, roll)
    out = np.zeros((H, W, 3), np.float32)
    mask = np.zeros((H, W), np.float32)
    L = np.asarray(L, np.float64)
    planet_kernel(W, H, cam, fw, rt, up, math.tan(math.radians(hfov) / 2), sky,
                  L / np.linalg.norm(L), rot, sun_int, out, mask)
    return out, mask, (cam, fw, rt, up)
