"""Gargantua: Schwarzschild null-geodesic ray tracer with a thin, turbulent accretion disk.

Units: Schwarzschild radius r_s = 1.  A photon's spatial path obeys
    x'' = -1.5 * h^2 * x / |x|^5,   h = |x cross v|
which reproduces the exact orbit equation u'' + u = 1.5 u^2 (u = 1/r).
"""
import math

import numpy as np
from numba import njit, prange

from lib import fbm3, noise3, sample_sky, smoothstep


@njit(inline="always", fastmath=True, cache=True)
def _acc(x, y, z, k):
    r2 = x * x + y * y + z * z
    f = k / (r2 * r2 * math.sqrt(r2))
    return -f * x, -f * y, -f * z


@njit(fastmath=True, cache=True)
def _disk(px, py, pz, t, r_in, r_out):
    """Emission (r, g, b) and opacity of the disk at a plane crossing."""
    r = math.sqrt(px * px + pz * pz)
    if r < r_in or r > r_out:
        return 0.0, 0.0, 0.0, 0.0
    x = r / r_in
    # Novikov-Thorne-like flux profile, peaked just outside the inner edge
    prof = x ** -3.0 * (1.0 - x ** -0.5)
    prof = prof / 0.0162  # normalise peak to ~1
    temp = min(prof, 1.4) ** 0.25
    phi = math.atan2(pz, px)
    om = 1.9 * r ** -1.5
    a = phi + om * t
    ca = math.cos(a)
    sa = math.sin(a)
    n1 = fbm3(r * 1.4, ca * 1.8, sa * 1.8, 5)
    n2 = fbm3(r * 4.5 + 3.0, ca * 4.0, sa * 4.0, 4)
    streak = 0.3 + 0.95 * n1 * (0.5 + 0.9 * n2)
    edge = smoothstep(r_in, r_in * 1.12, r) * (1.0 - smoothstep(r_out * 0.55, r_out, r))
    dens = min(1.0, streak * edge * 1.15)
    alpha = min(0.97, dens * (0.55 + 0.45 * smoothstep(0.1, 0.6, prof)))
    g = math.sqrt(max(1.0 - 1.0 / r, 0.0))       # gravitational redshift dimming
    inten = (prof ** 1.1) * streak * g * 5.0 + 0.10 * dens
    # colour: white-gold near the hole, amber-orange further out
    cr = 1.0
    cg = 0.42 + 0.48 * temp ** 2.2
    cb = 0.13 + 0.62 * temp ** 4.0
    return inten * cr, inten * cg, inten * cb, alpha


@njit(parallel=True, fastmath=True, cache=True)
def trace(W, H, cam, fw, rt, up, tanh, sky, sky_gain, t, r_in, r_out, out):
    aspect = H / W
    for j in prange(H):
        for i in range(W):
            sx = (2.0 * (i + 0.5) / W - 1.0) * tanh
            sy = (1.0 - 2.0 * (j + 0.5) / H) * tanh * aspect
            dx = fw[0] + sx * rt[0] + sy * up[0]
            dy = fw[1] + sx * rt[1] + sy * up[1]
            dz = fw[2] + sx * rt[2] + sy * up[2]
            n = math.sqrt(dx * dx + dy * dy + dz * dz)
            vx, vy, vz = dx / n, dy / n, dz / n
            x, y, z = cam[0], cam[1], cam[2]
            hx = y * vz - z * vy
            hy = z * vx - x * vz
            hz = x * vy - y * vx
            k = 1.5 * (hx * hx + hy * hy + hz * hz)
            cr = 0.0
            cg = 0.0
            cb = 0.0
            trans = 1.0
            escaped = False
            for _ in range(900):
                r = math.sqrt(x * x + y * y + z * z)
                if r < 1.0:
                    break
                if r > 80.0 and (x * vx + y * vy + z * vz) > 0:
                    escaped = True
                    break
                h = 0.012 + 0.035 * r * r
                if h > 1.2:
                    h = 1.2
                ax, ay, az = _acc(x, y, z, k)
                k1x, k1y, k1z = vx, vy, vz
                k1vx, k1vy, k1vz = ax, ay, az
                ax, ay, az = _acc(x + 0.5 * h * k1x, y + 0.5 * h * k1y, z + 0.5 * h * k1z, k)
                k2x, k2y, k2z = vx + 0.5 * h * k1vx, vy + 0.5 * h * k1vy, vz + 0.5 * h * k1vz
                k2vx, k2vy, k2vz = ax, ay, az
                ax, ay, az = _acc(x + 0.5 * h * k2x, y + 0.5 * h * k2y, z + 0.5 * h * k2z, k)
                k3x, k3y, k3z = vx + 0.5 * h * k2vx, vy + 0.5 * h * k2vy, vz + 0.5 * h * k2vz
                k3vx, k3vy, k3vz = ax, ay, az
                ax, ay, az = _acc(x + h * k3x, y + h * k3y, z + h * k3z, k)
                k4x, k4y, k4z = vx + h * k3vx, vy + h * k3vy, vz + h * k3vz
                k4vx, k4vy, k4vz = ax, ay, az
                nx = x + h / 6.0 * (k1x + 2 * k2x + 2 * k3x + k4x)
                ny = y + h / 6.0 * (k1y + 2 * k2y + 2 * k3y + k4y)
                nz = z + h / 6.0 * (k1z + 2 * k2z + 2 * k3z + k4z)
                vx += h / 6.0 * (k1vx + 2 * k2vx + 2 * k3vx + k4vx)
                vy += h / 6.0 * (k1vy + 2 * k2vy + 2 * k3vy + k4vy)
                vz += h / 6.0 * (k1vz + 2 * k2vz + 2 * k3vz + k4vz)
                if y * ny < 0.0:
                    f = y / (y - ny)
                    px = x + (nx - x) * f
                    pz = z + (nz - z) * f
                    er, eg, eb, al = _disk(px, 0.0, pz, t, r_in, r_out)
                    if al > 0.0:
                        cr += trans * al * er
                        cg += trans * al * eg
                        cb += trans * al * eb
                        trans *= 1.0 - al
                x, y, z = nx, ny, nz
                if trans < 0.01:
                    break
            if escaped and trans > 0.01 and sky_gain > 0.0:
                sr, sg, sb = sample_sky(sky, vx, vy, vz)
                cr += trans * sr * sky_gain
                cg += trans * sg * sky_gain
                cb += trans * sb * sky_gain
            out[j, i, 0] = cr
            out[j, i, 1] = cg
            out[j, i, 2] = cb


def render(W, H, cam, target, roll, hfov_deg, sky, sky_gain, t, r_in=3.0, r_out=16.0):
    from lib import look_at
    cam = np.asarray(cam, np.float64)
    fw, rt, up = look_at(cam, target, roll)
    out = np.zeros((H, W, 3), np.float32)
    trace(W, H, cam, fw, rt, up, math.tan(math.radians(hfov_deg) / 2), sky, sky_gain, t,
          r_in, r_out, out)
    return out
