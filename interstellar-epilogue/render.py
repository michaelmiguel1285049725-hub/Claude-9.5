"""《星际穿越 · 后来》 — renders the whole short, frame by frame.

usage:
    python render.py                      # full film -> build/picture.mp4
    python render.py --preview 10,40,80   # stills -> build/preview_*.png
"""
import argparse
import math
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blackhole  # noqa: E402
import space  # noqa: E402
import surface as sf  # noqa: E402
from lib import (CACHE, FPS, OUT_H, OUT_W, SCOPE_H, Film, Writer, add_glow, ease,  # noqa: E402
                 ease_io, look_at, make_sky, project, smoothstep)

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
os.makedirs(BUILD, exist_ok=True)

from timeline import DURATION, SUBS, TICK  # noqa: E402


class Assets:
    def __init__(self):
        t0 = time.time()
        self.sky = make_sky(12288, 11, 180000, 0.010, (0.9, 0.7, 0.55))
        self.sky2 = make_sky(12288, 23, 220000, 0.026, (1.0, 0.74, 0.48))
        print(f"skies ready {time.time() - t0:.1f}s", flush=True)
        self._surface = None
        self._garg = None

    # ---- surface base plates (rendered once) -------------------------------
    def surface(self):
        if self._surface is not None:
            return self._surface
        W, H = 2880, 1206
        h0 = sf.terrain_height(0, 0)
        cam = np.array([0.0, h0 + 1.6, 0.0])
        fw, rt, up = look_at(cam, cam + np.array([0.0, 0.004, 1.0]))
        hfov = 58.0
        a, e = math.radians(-15), math.radians(4.2)
        L1 = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)])
        ga, ge = math.radians(24), math.radians(6.2)
        Lg = np.array([math.sin(ga) * math.cos(ge), math.sin(ge), math.cos(ga) * math.cos(ge)])
        path = os.path.join(CACHE, "surface_gbuf.npz")
        if os.path.exists(path):
            g = dict(np.load(path))
        else:
            t0 = time.time()
            g = sf.gbuffer(W, H, cam, fw, rt, up, hfov, L1, Lg)
            np.savez(path, **g)
            print(f"surface gbuffer {time.time() - t0:.1f}s", flush=True)
        tanh = math.tan(math.radians(hfov) / 2)
        cam_info = dict(cam=cam, fw=fw, rt=rt, up=up, tanh=tanh, W=W, H=H)
        garg = self.gargantua_sprite()

        def proj(p):
            return project(p, cam, fw, rt, up, tanh, W, H)

        def ground(x, z):
            return np.array([x, sf.terrain_height(x, z), z])

        # Gargantua in the sky
        gdir = Lg
        gx, gy, _ = proj(cam + gdir * 1000)
        size_px = int(math.radians(11) / (2 * tanh) * W)
        spr = cv2.resize(garg, (size_px, size_px), interpolation=cv2.INTER_AREA) * np.float32([1.0, 0.8, 0.55])

        def put_garg(img, gain, extinction_mask):
            x0, y0 = int(gx - size_px / 2), int(gy - size_px / 2)
            xa, ya = max(x0, 0), max(y0, 0)
            xb, yb = min(x0 + size_px, W), min(y0 + size_px, H)
            sub = spr[ya - y0:yb - y0, xa - x0:xb - x0]
            yy = np.arange(ya, yb)[:, None, None]
            ext = np.exp(-0.02 / np.clip(g["dirs"][ya:yb, xa:xb, 1:2], 0.003, 1))
            img[ya:yb, xa:xb] += sub * gain * extinction_mask[ya:yb, xa:xb, None] * ext

        skymask = (g["depth"] <= 0).astype(np.float32)
        skymask = cv2.GaussianBlur(skymask, (0, 0), 0.7)

        dusk = sf.light_dusk(g, L1.astype(np.float32))
        put_garg(dusk, 0.35, skymask)
        stars = np.zeros_like(g["dirs"])
        sf.sample_dirs(self.sky2, g["dirs"], stars)
        hab = ground(16, 120)
        rng_lp = ground(-30, 135)
        lights = [(hab + np.array([-1.0, 2.5, -4.0]), (1.0, 0.62, 0.32), 500.0),
                  (rng_lp + np.array([0, 3.0, -6.0]), (0.8, 0.85, 1.0), 500.0),
                  (hab + np.array([-3.0, 8.0, -2.0]), (1.0, 0.3, 0.2), 40.0)]
        night = sf.light_night(g, Lg.astype(np.float32), lights, stars * 0.9)
        put_garg(night, 0.8, skymask)

        self._surface = dict(dusk=dusk, night=night, cam=cam_info, proj=proj, ground=ground,
                             L1=L1, hab=hab, ranger_pad=rng_lp)
        # static set dressing
        for key, amb, rim in (("dusk", (0.012, 0.010, 0.010), (1.6, 0.8, 0.4)),
                              ("night", (0.0015, 0.0015, 0.002), (0.10, 0.07, 0.05))):
            self._dress(self._surface[key], amb, rim, key)
        return self._surface

    def _billboard(self, base, uv):
        s = self._surface
        R = -s["cam"]["rt"].copy()
        R[1] = 0
        R = -R / np.linalg.norm(R)   # camera-right, horizontal
        out = []
        for u, v in uv:
            p = s["proj"](base + R * u + np.array([0.0, v, 0.0]))
            out.append((p[0], p[1]))
        return out

    def _scale(self, base):
        s = self._surface
        p = s["proj"](base)
        q = s["proj"](base + np.array([0.0, 1.0, 0.0]))
        return abs(p[1] - q[1])

    def _dress(self, img, amb, rim, key):
        s = self._surface
        hab = s["hab"]
        bb = lambda uv: self._billboard(hab, uv)
        px = self._scale(hab)
        rim_off = (max(1.5, px * 0.08), -max(1.0, px * 0.05))
        polys = [bb([(-5, 0.7), (5, 0.7), (5, 3.8), (-5, 3.8)]),
                 bb([(6.0, 0.0), (10.5, 0.0), (10.5, 0.8), (6.0, 0.8)]),
                 bb([(-13.5, 0.3), (-8.5, 0.3), (-8.0, 1.6), (-13.0, 1.6)]),
                 bb([(-7.5, 0.3), (-6.0, 0.3), (-5.6, 1.3), (-7.1, 1.3)]),
                 bb([(-2.0, 3.6), (1.0, 3.6), (1.0, 4.6), (-2.0, 4.6)])]
        e = []
        for (u, v, rx, ry) in ((-5, 2.25, 1.2, 1.55), (5, 2.25, 1.2, 1.55), (8.25, 0.8, 2.3, 2.1),
                               (-2.35, 9.1, 0.75, 0.45)):
            c = bb([(u, v)])[0]
            e.append((c[0], c[1], rx * px, ry * px))
        lines = [(bb([(-3, 3.8), (-3, 10.0)]), max(1.0, 0.14 * px)),
                 (bb([(-4, 0.0), (-4, 0.7)]), max(1.0, 0.2 * px)),
                 (bb([(4, 0.0), (4, 0.7)]), max(1.0, 0.2 * px))]
        sf.draw_shape(img, polys, amb, rim, rim_off, e, lines)
        # the cairn over Edmunds' grave
        cairn = s["ground"](-1.2, 39)
        cp = self._scale(cairn)
        bc = lambda uv: self._billboard(cairn, uv)
        e = []
        for (u, v, rx, ry) in ((0, 0.12, 0.55, 0.22), (0.05, 0.38, 0.38, 0.17), (-0.02, 0.6, 0.24, 0.13)):
            c = bc([(u, v)])[0]
            e.append((c[0], c[1], rx * cp, ry * cp))
        lines = [(bc([(0.55, 0.0), (0.55, 1.5)]), max(1.0, 0.05 * cp)),
                 (bc([(0.55, 1.5), (0.95, 1.42)]), max(1.0, 0.18 * cp))]
        sf.draw_shape(img, [], amb, rim, (max(1.2, cp * 0.06), -1.0), e, lines)
        # a strip of small lit windows along the module
        win = bb([(0.3, 2.35), (0.9, 2.35), (1.5, 2.35)])
        for (x, y) in win:
            add_glow(img, x, y, max(0.8, 0.12 * px), (1.0, 0.6, 0.28), 6.0 if key == "night" else 2.0)

    # ---- Gargantua as seen from the planet --------------------------------
    def gargantua_sprite(self):
        if self._garg is not None:
            return self._garg
        path = os.path.join(CACHE, "garg_sprite.npy")
        if os.path.exists(path):
            self._garg = np.load(path)
        else:
            D, e = 60.0, math.radians(9)
            cam = (D * math.cos(e) * math.sin(0.4), D * math.sin(e), D * math.cos(e) * math.cos(0.4))
            self._garg = blackhole.render(1000, 1000, cam, (0, 0, 0), math.radians(12), 34,
                                          self.sky2, 0.0, 3.0, r_out=17.0)
            np.save(path, self._garg)
        return self._garg


# ----------------------------------------------------------------------------
# Shots
# ----------------------------------------------------------------------------
def shot_title(t, A, film):
    frame = np.zeros((OUT_H, OUT_W, 3), np.uint8)
    a = smoothstep(1.2, 2.6, t) * (1 - smoothstep(5.2, 6.4, t))
    film.text(frame, ["土星轨道 · 库珀空间站"], 520, size=44, alpha=a, tracking=6)
    film.text(frame, ["SATURN ORBIT  ·  COOPER STATION"], 588, size=20, alpha=a * 0.7,
              color=(190, 184, 172), tracking=8)
    return frame, dict(grain_only=True)


SAT = dict(S=(-4.6, 0.35, -13.5), pole=(0.35, 1.0, 0.28), L=(0.95, 0.22, -0.45),
           Wc=(1.05, -0.12, -3.4), Rw=0.3)


def shot_saturn(t, A, film):
    u = (t - 7.0) / 17.0
    cam = np.array([0.12 * u, 0.04 * u, -0.45 * u])
    target = np.array([-0.25 + 0.1 * u, 0.05, -5.0])
    roll = math.radians(4 - 1.5 * u)
    img = space.render_saturn(OUT_W, SCOPE_H, cam, target, roll, 48, A.sky * 0.35, A.sky2,
                              SAT["S"], SAT["pole"], SAT["L"], SAT["Wc"], SAT["Rw"])
    fw, rt, up = look_at(cam, target, roll)
    tanh = math.tan(math.radians(48) / 2)
    # the Ranger: engine glow crossing toward the wormhole
    k = ease_io((t - 8.0) / 14.8)
    start = np.array([-0.55, -0.42, -0.7])
    wc = np.array(SAT["Wc"])
    p = start + (wc - start) * k + np.array([0, 0.12, 0]) * math.sin(math.pi * k)
    pr = project(p, cam, fw, rt, up, tanh, OUT_W, SCOPE_H)
    wr = project(wc, cam, fw, rt, up, tanh, OUT_W, SCOPE_H)
    if pr and wr and t > 8.0:
        rad_w = SAT["Rw"] / wr[2] / tanh * OUT_W / 2
        dist = math.hypot(pr[0] - wr[0], pr[1] - wr[1])
        vis = smoothstep(rad_w * 0.55, rad_w * 1.05, dist)
        size = max(1.2, 0.8 / pr[2] * 3)
        add_glow(img, pr[0], pr[1], size, (0.75, 0.85, 1.0), 9.0 * vis)
        add_glow(img, pr[0], pr[1], size * 5, (0.6, 0.7, 1.0), 0.25 * vis)
    fade = smoothstep(7.0, 8.2, t)
    return img, dict(exposure=0.95, fade=fade, streak=0.08)


def shot_tunnel(t, A, film):
    if t < 25.2:
        # final approach: the sphere swallows the frame
        k = ease((t - 24.0) / 1.2)
        wc = np.array(SAT["Wc"])
        cam = wc + np.array([-0.05, 0.02, 1.0 - 0.62 * k])
        img = space.render_saturn(OUT_W, SCOPE_H, cam, wc, math.radians(3 + 6 * k), 48, A.sky * 0.35,
                                  A.sky2, SAT["S"], SAT["pole"], SAT["L"], SAT["Wc"], SAT["Rw"])
        if t > 24.8:
            tun = np.zeros_like(img)
            space.tunnel_kernel(OUT_W, SCOPE_H, t - 24.8, OUT_W / 2, SCOPE_H / 2, 0.15, A.sky2, tun)
            m = smoothstep(24.8, 25.2, t)
            img = img * (1 - m) + tun * m * 0.6
        return img, dict(exposure=0.95)
    tt = t - 24.8
    rng = np.random.default_rng(int(t * FPS))
    shake = 6 + 14 * smoothstep(26, 29.5, t)
    cx = OUT_W / 2 + math.sin(t * 13.1) * shake * 0.6 + rng.normal(0, shake * 0.3)
    cy = SCOPE_H / 2 + math.cos(t * 11.3) * shake * 0.4 + rng.normal(0, shake * 0.3)
    img = np.zeros((SCOPE_H, OUT_W, 3), np.float32)
    space.tunnel_kernel(OUT_W, SCOPE_H, tt * (1 + 0.5 * tt), cx, cy, 0.15 + 0.1 * math.sin(t), A.sky2, img)
    ex = 0.6 + 0.6 * smoothstep(27, 30.2, t)
    white = smoothstep(29.8, 30.4, t)
    img = img * (1 - white) + white * 40.0
    return img, dict(exposure=ex, streak=0.12)


def ranger_polys(cx, cy, px_per_m, flip=False, gear=0.0):
    pts = [(-8, 1.25), (-4.5, 2.05), (1, 2.45), (5.5, 2.5), (7.0, 3.3), (7.9, 3.3), (8.0, 2.2),
           (8.0, 1.05), (4, 0.75), (-4, 0.75), (-7, 1.0)]
    s = -1 if flip else 1
    poly = [(cx + s * u * px_per_m, cy - (v - 2.0) * px_per_m) for u, v in pts]
    lines = []
    if gear > 0:
        for u in (-4.5, 4.5):
            lines.append(([(cx + s * u * px_per_m, cy - (0.6 - 2.0) * px_per_m),
                           (cx + s * (u + 0.4) * px_per_m, cy - (0.6 - gear * 1.4 - 2.0) * px_per_m)],
                          max(1.0, 0.25 * px_per_m)))
    return [poly], lines


def shot_gargantua(t, A, film):
    u = (t - 31.5) / 20.5
    D = 34 - 6 * ease_io(u)
    e = math.radians(5.2 - 2.4 * u)
    az = 0.18 + 0.3 * u
    cam = (D * math.cos(e) * math.sin(az), D * math.sin(e), D * math.cos(e) * math.cos(az))
    roll = math.radians(-7 + 3 * u)
    W, H = 1440, 810
    img = blackhole.render(W, H, cam, (0, 0.6, 0), roll, 56, A.sky2, 0.45, t * 1.2)
    img = cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_CUBIC)
    # the Ranger, a tiny silhouette against the disk
    k = (t - 38.0) / 12.5
    if 0 <= k <= 1:
        x = OUT_W * (1.06 - 1.12 * k)
        y = OUT_H * (0.60 - 0.05 * k)
        ppm = 4.2
        polys, lines = ranger_polys(x, y, ppm, flip=False)
        sf.draw_shape(img, polys, (0.002, 0.002, 0.002), None)
        blink = 1.0 if (t % 1.0) < 0.12 else 0.0
        add_glow(img, x - 8 * ppm, y - 0.5 * ppm, 1.5, (1.0, 0.25, 0.2), 3.0)
        add_glow(img, x + 8 * ppm, y - 1.2 * ppm, 1.5, (1.0, 1.0, 1.0), 25.0 * blink)
        add_glow(img, x + 8.3 * ppm, y, 3.0, (0.6, 0.75, 1.0), 4.0)
    fade = smoothstep(31.5, 34.5, t)
    return img, dict(exposure=0.13, fade=fade, bloom=0.14, streak=0.03, scope=False)


PL = dict(L=np.array([0.36, 0.17, -1.0]), beacon=np.array([0.10, 0.86, 0.50]))


def shot_planet(t, A, film):
    u = (t - 52.0) / 16.0
    y = 0.28 + 0.26 * ease_io(min(u * 1.4, 1))
    cam = np.array([0.08 * u, y, 2.45 - 0.2 * u])
    target = np.array([0.02, 0.92, 0.0])
    roll = math.radians(-3 + 2 * u)
    rot = 0.3 + 0.02 * u
    img, mask, (c, fw, rt, up) = space.render_planet(OUT_W, SCOPE_H, cam, target, roll, 50,
                                                     A.sky * 0.55, PL["L"], rot, 1.0)
    tanh = math.tan(math.radians(25))
    b = PL["beacon"] / np.linalg.norm(PL["beacon"])
    # rotate beacon with the surface
    cr, sr = math.cos(rot - 0.3), math.sin(rot - 0.3)
    b = np.array([b[0] * cr - b[2] * sr, b[1], b[0] * sr + b[2] * cr])
    pb = project(b * 1.001, cam, fw, rt, up, tanh, OUT_W, SCOPE_H)
    if pb:
        on = 1.0 if ((t % TICK) < 0.22) else 0.08
        add_glow(img, pb[0], pb[1], 1.3, (1.0, 0.35, 0.2), 6.0 * on)
    # atmospheric entry: a plasma streak falling toward the beacon
    if 61.5 < t < 68.0 and pb:
        def pos(tt):
            k = ease((tt - 61.5) / 6.5)
            x = 360 + (pb[0] - 360) * k
            y = 60 + (pb[1] - 60) * k - 60 * math.sin(math.pi * k)
            return (x, y), k
        for i in range(24, -1, -1):
            tt = t - i * 0.04
            if tt < 61.5:
                continue
            q, k = pos(tt)
            heat = smoothstep(0.15, 0.45, k) * (1 - smoothstep(0.75, 0.97, k))
            w = (1 - i / 25) ** 1.5
            add_glow(img, q[0], q[1], 1.0 + 2.2 * heat * w, (1.0, 0.6, 0.3), (2.0 + 28 * heat) * w)
    return img, dict(exposure=0.8, fade=smoothstep(52.0, 53.0, t), streak=0.02)


def _puffs():
    if not hasattr(_puffs, "s"):
        _puffs.s = sf.puff_sprites(6, 128, 5)
    return _puffs.s


def _crop(base, zoom, cx, cy):
    """Crop/zoom a supersampled plate down to 1920 x 804. Returns image and mapping."""
    H, W, _ = base.shape
    cw, ch = W / zoom, W / zoom * SCOPE_H / OUT_W
    x0 = min(max(cx - cw / 2, 0), W - cw)
    y0 = min(max(cy - ch / 2, 0), H - ch)
    s = OUT_W / cw
    M = np.float32([[s, 0, -x0 * s], [0, s, -y0 * s]])
    img = cv2.warpAffine(base, M, (OUT_W, SCOPE_H), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    return img, (lambda p: ((p[0] - x0) * s, (p[1] - y0) * s)), s


def figure(img, base, px_per_m, fill, rim, arm=0.0, helmet=False, height=1.72, side=1.0):
    """A standing astronaut silhouette at pixel base (feet), px_per_m scale."""
    k = px_per_m * height / 1.72
    x, y = base
    P = lambda u, v: (x + u * k, y - v * k)
    polys = [
        # legs, slightly apart, with boots
        [P(-0.17, 0.9), P(-0.015, 0.9), P(-0.04, 0.06), P(-0.05, 0.0), P(-0.21, 0.0), P(-0.18, 0.06)],
        [P(0.015, 0.9), P(0.17, 0.9), P(0.18, 0.06), P(0.21, 0.0), P(0.05, 0.0), P(0.04, 0.06)],
        # suit torso: broad shoulders, narrower waist
        [P(-0.18, 0.86), P(0.18, 0.86), P(0.2, 1.12), P(0.25, 1.38), P(0.16, 1.47),
         P(-0.16, 1.47), P(-0.25, 1.38), P(-0.2, 1.12)],
        [P(-0.055, 1.44), P(0.055, 1.44), P(0.055, 1.53), P(-0.055, 1.53)],
        # left arm hanging
        [P(-0.25, 1.39), P(-0.17, 1.36), P(-0.2, 0.84), P(-0.28, 0.84)],
    ]
    hr = 0.15 if helmet else 0.1
    ell = [(x, y - (1.62 if helmet else 1.63) * k, hr * k, (hr + 0.02) * k)]
    th = math.radians(6 + arm)
    lines = [([P(0.21, 1.38), P(0.21 + 0.56 * math.sin(th), 1.38 - 0.56 * math.cos(th))],
              max(1.0, 0.085 * k))]
    sf.draw_shape(img, polys, fill, rim, (side * max(1.0, 0.022 * k), -0.5), ell, lines)


def shot_dusk(t, A, film):
    s = A.surface()
    u = (t - 68.0) / 23.0
    zoom = 1.02 + 0.07 * ease_io(u)
    img, m, sc = _crop(s["dusk"], zoom, 1440 + 40 * u, 640)
    proj = lambda p: m(s["proj"](p)[:2])
    ppm = lambda p: sc * abs(s["proj"](p)[1] - s["proj"](p + np.array([0, 1.0, 0]))[1])
    fill, rim = (0.012, 0.010, 0.010), (1.6, 0.8, 0.4)
    # beacon on the mast
    hab = s["hab"]
    R = np.array([-1.0, 0, 0])
    top = proj(hab + R * -3 + np.array([0, 10.1, 0]))
    on = 1.0 if ((t % TICK) < 0.22) else 0.0
    add_glow(img, top[0], top[1], 1.6, (1.0, 0.25, 0.15), 12.0 * on + 0.3)
    # Brand
    bpos = s["ground"](-3.4, 38)
    arm = 0.0
    if t > 84.6:
        arm = 150 * smoothstep(84.6, 85.4, t) * (0.85 + 0.15 * math.sin((t - 84.6) * 7))
        arm *= 1 - smoothstep(88.5, 89.5, t)
    figure(img, proj(bpos), ppm(bpos), fill, (0.9, 0.45, 0.22), arm=arm)
    # the Ranger comes down
    pad = s["ranger_pad"]
    if t > 71.5:
        P0 = pad + np.array([-150.0, 190.0, 640.0])
        Ph = pad + np.array([0.0, 14.0, 0.0])
        if t < 80.0:
            k = 1 - (1 - (t - 71.5) / 8.5) ** 2.2
            p = P0 + (Ph - P0) * k
        else:
            k = ease_io((t - 80.0) / 4.6)
            p = Ph + (pad + np.array([0, 0.3, 0]) - Ph) * k
        c = proj(p + np.array([0, 2.0, 0]))
        sc_m = ppm(p)
        gear = smoothstep(79, 82, t)
        polys, lines = ranger_polys(c[0], c[1], sc_m, flip=False, gear=gear)
        sf.draw_shape(img, polys, fill, rim, (max(1.0, 0.1 * sc_m), -max(1.0, 0.08 * sc_m)), (), lines)
        thr = 1 - smoothstep(84.8, 86.0, t)
        for uu in (-3.5, 4.0):
            add_glow(img, c[0] + uu * sc_m, c[1] + 1.6 * sc_m, 0.9 * sc_m + 1, (0.75, 0.85, 1.0), 6.0 * thr)
            add_glow(img, c[0] + uu * sc_m, c[1] + 2.4 * sc_m, 2.2 * sc_m + 2, (0.9, 0.7, 0.5), 0.5 * thr)
        blink = 1.0 if (t % 1.1) < 0.1 else 0.0
        add_glow(img, c[0] - 8 * sc_m, c[1] + 0.8 * sc_m, 1.2 + 0.15 * sc_m, (1.0, 0.2, 0.15), 5.0)
        add_glow(img, c[0] + 8 * sc_m, c[1] - 1.8 * sc_m, 1.2 + 0.15 * sc_m, (1.0, 1.0, 1.0), 30.0 * blink)
        add_glow(img, c[0] - 7.6 * sc_m, c[1] + 0.2 * sc_m, 1.5 + 0.3 * sc_m, (1.0, 0.95, 0.85), 4.0)
        # dust thrown up by the thrusters
        if t > 80.0:
            rng = np.random.default_rng(3)
            spr = _puffs()
            g = proj(pad)
            gp = ppm(pad)
            for i in range(26):
                birth = 80.0 + rng.random() * 5.5
                age = t - birth
                if age < 0 or age > 6.5:
                    continue
                ang = rng.uniform(-1, 1)
                dist = (4 + 26 * (1 - math.exp(-age * 0.7))) * ang
                rise = 1.5 + 5.0 * (1 - math.exp(-age * 0.5)) * rng.random()
                size = (4 + 7 * (1 - math.exp(-age * 0.6))) * gp
                a = 0.5 * smoothstep(0, 0.6, age) * (1 - smoothstep(3.0, 6.5, age))
                sp = spr[i % len(spr)]
                sz = int(max(4, size))
                a_img = cv2.resize(sp, (sz, sz)) * a
                x0 = int(g[0] + dist * gp - sz / 2)
                y0 = int(g[1] - rise * gp - sz / 2)
                x1, y1 = max(x0, 0), max(y0, 0)
                x2, y2 = min(x0 + sz, OUT_W), min(y0 + sz, SCOPE_H)
                if x2 <= x1 or y2 <= y1:
                    continue
                aa = a_img[y1 - y0:y2 - y0, x1 - x0:x2 - x0, None]
                reg = img[y1:y2, x1:x2]
                reg[:] = reg * (1 - aa) + aa * np.float32([0.95, 0.55, 0.30]) * 0.55
    fade = smoothstep(68.0, 69.2, t)
    return img, dict(exposure=0.72, fade=fade, warmth=0.5, streak=0.03)


def shot_night(t, A, film):
    s = A.surface()
    u = (t - 91.0) / 14.0
    zoom = 1.12 + 0.05 * u
    img, m, sc = _crop(s["night"], zoom, 1180 - 30 * u, 560)
    proj = lambda p: m(s["proj"](p)[:2])
    ppm = lambda p: sc * abs(s["proj"](p)[1] - s["proj"](p + np.array([0, 1.0, 0]))[1])
    fill, rim = (0.0015, 0.0015, 0.002), (0.25, 0.14, 0.07)
    hab = s["hab"]
    R = np.array([-1.0, 0, 0])
    top = proj(hab + R * -3 + np.array([0, 10.1, 0]))
    on = 1.0 if ((t % TICK) < 0.22) else 0.0
    add_glow(img, top[0], top[1], 1.8, (1.0, 0.25, 0.15), 14.0 * on + 0.3)
    # the Ranger at rest
    pad = s["ranger_pad"]
    c = proj(pad + np.array([0, 2.3, 0]))
    sc_m = ppm(pad)
    polys, lines = ranger_polys(c[0], c[1], sc_m, gear=1.0)
    sf.draw_shape(img, polys, fill, (0.05, 0.05, 0.06), (1.0, -1.0), (), lines)
    add_glow(img, c[0] - 7.6 * sc_m, c[1] + 0.2 * sc_m, 2 + 0.3 * sc_m, (1.0, 0.95, 0.85), 3.0)
    # two figures under Gargantua, silhouetted by a lantern set down behind them
    lp = s["ground"](8.8, 26.5)
    lx, ly = proj(lp + np.array([0, 0.25, 0]))
    lsc = ppm(lp)
    flick = 1.0 + 0.04 * math.sin(t * 17.0) + 0.03 * math.sin(t * 29.0)
    add_glow(img, lx, ly - 0.3 * lsc, 1.6 * lsc, (1.0, 0.55, 0.25), 0.045 * flick)
    add_glow(img, lx, ly, 0.08 * lsc + 1, (1.0, 0.8, 0.5), 3.0 * flick)
    for (x, z, hgt, helm) in ((9.4, 24.0, 1.72, False), (8.3, 24.3, 1.86, True)):
        p = s["ground"](x, z)
        k = ppm(p)
        fx, fy = proj(p)
        figure(img, (fx, fy), k, (0.008, 0.0055, 0.0035), (0.06, 0.045, 0.032), helmet=helm, height=hgt, side=-1.0)
    fade = smoothstep(91.0, 92.5, t) * (1 - smoothstep(103.8, 105.0, t))
    return img, dict(exposure=1.25, fade=fade, warmth=0.3, streak=0.0, grain=0.9)


def shot_end(t, A, film):
    frame = np.zeros((OUT_H, OUT_W, 3), np.uint8)
    a = smoothstep(105.8, 107.3, t) * (1 - smoothstep(111.2, 112.6, t))
    film.text(frame, ["星 际 穿 越"], 500, size=64, alpha=a, tracking=10)
    film.text(frame, ["后  来"], 590, size=30, alpha=a * 0.85, color=(200, 192, 178), tracking=12)
    film.text(frame, ["INTERSTELLAR · AFTERWARD   同人延展短片"], 690, size=18, alpha=a * 0.5,
              color=(170, 164, 154), tracking=4)
    return frame, dict(grain_only=True)


SHOTS = [
    (0.0, 7.0, shot_title),
    (7.0, 24.0, shot_saturn),
    (24.0, 30.5, shot_tunnel),
    (30.5, 31.5, None),
    (31.5, 52.0, shot_gargantua),
    (52.0, 68.0, shot_planet),
    (68.0, 91.0, shot_dusk),
    (91.0, 105.0, shot_night),
    (105.0, DURATION, shot_end),
]


def subtitle(film, frame, t):
    for (a, b, who, line, radio) in SUBS:
        if a - 0.2 <= t <= b + 0.2:
            al = smoothstep(a - 0.2, a + 0.1, t) * (1 - smoothstep(b - 0.1, b + 0.2, t))
            full = f"{who}：{line}"
            film.text(frame, [full], OUT_H - 78, size=34, alpha=al * 0.95)
    return frame


def epigraph(film, frame, t):
    a = smoothstep(93.2, 94.8, t) * (1 - smoothstep(101.5, 103.2, t))
    b = smoothstep(95.2, 96.8, t) * (1 - smoothstep(101.5, 103.2, t))
    film.text(frame, ["人类生于地球，"], 330, size=42, alpha=a, tracking=4)
    film.text(frame, ["但从未注定死在这里。"], 398, size=42, alpha=b, tracking=4)
    return frame


def render_frame(t, A, film):
    for (a, b, fn) in SHOTS:
        if a <= t < b:
            break
    if fn is None:
        return np.zeros((OUT_H, OUT_W, 3), np.uint8)
    img, opts = fn(t, A, film)
    if opts.pop("grain_only", False):
        g = film.rng.normal(0, 3.0, (OUT_H // 2, OUT_W // 2)).astype(np.float32)
        g = cv2.resize(g, (OUT_W, OUT_H))
        return np.clip(img.astype(np.float32) + 6 + g[..., None], 0, 255).astype(np.uint8)
    scope = opts.pop("scope", True)
    frame = film.finish(img, scope=scope, grain=opts.pop("grain", 0.8), **opts)
    frame = subtitle(film, frame, t)
    if 91.0 <= t < 105.0:
        frame = epigraph(film, frame, t)
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default="")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=DURATION)
    ap.add_argument("--out", default=os.path.join(BUILD, "picture.mp4"))
    args = ap.parse_args()
    A = Assets()
    film = Film()
    if args.preview:
        for ts in args.preview.split(","):
            t = float(ts)
            t0 = time.time()
            f = render_frame(t, A, film)
            cv2.imwrite(os.path.join(BUILD, f"preview_{t:06.2f}.png"), f[..., ::-1])
            print(f"t={t:.2f}s  {time.time() - t0:.2f}s", flush=True)
        return
    w = Writer(args.out)
    n0, n1 = int(round(args.start * FPS)), int(round(args.end * FPS))
    t_start = time.time()
    for n in range(n0, n1):
        t = n / FPS
        w.write(render_frame(t, A, film))
        if n % 48 == 0:
            el = time.time() - t_start
            print(f"frame {n}/{n1}  t={t:.1f}s  elapsed {el / 60:.1f} min", flush=True)
    w.close()
    print("done", args.out)


if __name__ == "__main__":
    main()
