"""Shared building blocks: noise, sky maps, film post-processing, subtitles, video IO."""
import math
import os
import subprocess

import cv2
import numpy as np
from numba import njit, prange
from PIL import Image, ImageDraw, ImageFont

OUT_W, OUT_H = 1920, 1080
SCOPE_H = 804                     # 2.39:1 inside a 16:9 frame
FPS = 24
FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
CACHE = os.environ.get("EPILOGUE_CACHE", "/tmp/epilogue_cache")
os.makedirs(CACHE, exist_ok=True)


# ----------------------------------------------------------------------------
# Noise
# ----------------------------------------------------------------------------
@njit(inline="always", fastmath=True, cache=True)
def _hash3(ix, iy, iz):
    h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF) / 16777215.0


@njit(inline="always", fastmath=True, cache=True)
def noise3(x, y, z):
    fx = math.floor(x)
    fy = math.floor(y)
    fz = math.floor(z)
    ix = np.int64(fx)
    iy = np.int64(fy)
    iz = np.int64(fz)
    tx = x - fx
    ty = y - fy
    tz = z - fz
    ux = tx * tx * (3.0 - 2.0 * tx)
    uy = ty * ty * (3.0 - 2.0 * ty)
    uz = tz * tz * (3.0 - 2.0 * tz)
    a = _hash3(ix, iy, iz)
    b = _hash3(ix + 1, iy, iz)
    c = _hash3(ix, iy + 1, iz)
    d = _hash3(ix + 1, iy + 1, iz)
    e = _hash3(ix, iy, iz + 1)
    f = _hash3(ix + 1, iy, iz + 1)
    g = _hash3(ix, iy + 1, iz + 1)
    h = _hash3(ix + 1, iy + 1, iz + 1)
    k0 = a + (b - a) * ux
    k1 = c + (d - c) * ux
    k2 = e + (f - e) * ux
    k3 = g + (h - g) * ux
    m0 = k0 + (k1 - k0) * uy
    m1 = k2 + (k3 - k2) * uy
    return m0 + (m1 - m0) * uz


@njit(fastmath=True, cache=True)
def fbm3(x, y, z, octaves):
    s = 0.0
    amp = 0.5
    norm = 0.0
    for _ in range(octaves):
        s += amp * noise3(x, y, z)
        norm += amp
        x = x * 2.03 + 17.1
        y = y * 2.03 + 3.7
        z = z * 2.03 + 9.2
        amp *= 0.5
    return s / norm


@njit(fastmath=True, cache=True)
def ridged3(x, y, z, octaves):
    s = 0.0
    amp = 0.5
    norm = 0.0
    prev = 1.0
    for _ in range(octaves):
        n = 1.0 - abs(noise3(x, y, z) * 2.0 - 1.0)
        n = n * n
        s += amp * n * prev
        prev = n
        norm += amp
        x = x * 2.1 + 5.3
        y = y * 2.1 + 1.1
        z = z * 2.1 + 7.7
        amp *= 0.5
    return s / norm


@njit(inline="always", fastmath=True, cache=True)
def smoothstep(a, b, x):
    t = (x - a) / (b - a)
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return t * t * (3.0 - 2.0 * t)


# ----------------------------------------------------------------------------
# Sky maps (equirectangular, linear HDR)
# ----------------------------------------------------------------------------
def star_color(temp):
    """Approximate blackbody tint for a star temperature (Kelvin), linear RGB."""
    t = temp / 100.0
    r = np.where(t <= 66, 255.0, 329.7 * (np.maximum(t - 60, 1e-3) ** -0.1332))
    g = np.where(t <= 66, 99.47 * np.log(np.maximum(t, 1)) - 161.1,
                 288.1 * (np.maximum(t - 60, 1e-3) ** -0.0755))
    b = np.where(t >= 66, 255.0,
                 np.where(t <= 19, 0.0, 138.5 * np.log(np.maximum(t - 10, 1)) - 305.0))
    c = np.clip(np.stack([r, g, b], -1) / 255.0, 0, 1) ** 2.2
    return c / np.maximum(c.max(-1, keepdims=True), 1e-6)


@njit(parallel=True, fastmath=True, cache=True)
def _nebula(tex, gx, gy, gz, seed, strength, tint):
    H, W, _ = tex.shape
    for j in prange(H):
        lat = math.pi * (0.5 - (j + 0.5) / H)
        cl = math.cos(lat)
        sl = math.sin(lat)
        for i in range(W):
            lon = 2.0 * math.pi * ((i + 0.5) / W) - math.pi
            dx = cl * math.sin(lon)
            dy = sl
            dz = cl * math.cos(lon)
            glat = dx * gx + dy * gy + dz * gz
            band = math.exp(-(glat / 0.22) ** 2)
            n = fbm3(dx * 3.0 + seed, dy * 3.0, dz * 3.0, 6)
            n2 = fbm3(dx * 9.0, dy * 9.0 + seed, dz * 9.0, 5)
            dust = smoothstep(0.42, 0.72, fbm3(dx * 5.0 - seed, dy * 5.0, dz * 5.0, 6))
            v = band * (0.35 + n) * (0.6 + 0.8 * n2) * (1.0 - 0.85 * dust)
            v += 0.08 * math.exp(-(glat / 0.6) ** 2) * n
            v *= strength
            w = n2
            tex[j, i, 0] += v * (tint[0] * (1 - w) + 0.55 * w)
            tex[j, i, 1] += v * (tint[1] * (1 - w) + 0.60 * w)
            tex[j, i, 2] += v * (tint[2] * (1 - w) + 0.85 * w)


def make_sky(W, seed, n_stars, nebula_strength, tint):
    path = os.path.join(CACHE, f"sky_{W}_{seed}.npy")
    if os.path.exists(path):
        return np.load(path)
    H = W // 2
    rng = np.random.default_rng(seed)
    tex = np.zeros((H, W, 3), np.float32)
    v = rng.normal(size=(n_stars, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    # concentrate a share of stars toward the galactic plane
    g = np.array([0.25, 0.9, 0.35])
    g /= np.linalg.norm(g)
    mag = rng.exponential(1.2, n_stars)
    flux = 0.9 * 10 ** (-0.4 * mag * 2.2)
    flux[rng.random(n_stars) < 0.004] *= 12
    temp = rng.choice([3200, 4200, 5200, 5800, 6500, 8000, 11000, 15000], n_stars,
                      p=[.18, .2, .17, .14, .12, .09, .06, .04])
    col = star_color(temp)
    lat = np.arcsin(np.clip(v[:, 1], -1, 1))
    lon = np.arctan2(v[:, 0], v[:, 2])
    x = (lon + np.pi) / (2 * np.pi) * W - 0.5
    y = (0.5 - lat / np.pi) * H - 0.5
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                      (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        np.add.at(tex, ((y0 + dy).clip(0, H - 1), (x0 + dx) % W),
                  (col * (flux * w)[:, None]).astype(np.float32))
    # round stars on the sphere: widen horizontally toward the poles
    rows_lat = np.pi * (0.5 - (np.arange(H) + 0.5) / H)
    sig0 = 0.75
    out = np.empty_like(tex)
    for j in range(H):
        s = min(sig0 / max(math.cos(rows_lat[j]), 0.02), 60)
        pad = int(s * 4) + 2
        row = np.concatenate([tex[j, -pad:], tex[j], tex[j, :pad]])[None]
        out[j] = cv2.GaussianBlur(row, (0, 0), sigmaX=s, sigmaY=0.01)[0, pad:pad + W]
    tex = cv2.GaussianBlur(out, (0, 0), sigmaX=0.01, sigmaY=sig0)
    tex *= 2 * math.pi * sig0 * sig0
    _nebula(tex, g[0], g[1], g[2], float(seed % 97), nebula_strength,
            np.array(tint, np.float64))
    np.save(path, tex)
    return tex


@njit(fastmath=True, cache=True)
def sample_sky(sky, dx, dy, dz):
    H = sky.shape[0]
    W = sky.shape[1]
    if dy > 1.0:
        dy = 1.0
    elif dy < -1.0:
        dy = -1.0
    lat = math.asin(dy)
    lon = math.atan2(dx, dz)
    x = (lon + math.pi) / (2.0 * math.pi) * W - 0.5
    y = (0.5 - lat / math.pi) * H - 0.5
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = x - x0
    fy = y - y0
    ix = np.int64(x0) % W
    ix1 = (ix + 1) % W
    iy = np.int64(y0)
    if iy < 0:
        iy = 0
    iy1 = iy + 1
    if iy1 > H - 1:
        iy1 = H - 1
    if iy > H - 1:
        iy = H - 1
    r = ((sky[iy, ix, 0] * (1 - fx) + sky[iy, ix1, 0] * fx) * (1 - fy)
         + (sky[iy1, ix, 0] * (1 - fx) + sky[iy1, ix1, 0] * fx) * fy)
    g = ((sky[iy, ix, 1] * (1 - fx) + sky[iy, ix1, 1] * fx) * (1 - fy)
         + (sky[iy1, ix, 1] * (1 - fx) + sky[iy1, ix1, 1] * fx) * fy)
    b = ((sky[iy, ix, 2] * (1 - fx) + sky[iy, ix1, 2] * fx) * (1 - fy)
         + (sky[iy1, ix, 2] * (1 - fx) + sky[iy1, ix1, 2] * fx) * fy)
    return r, g, b


# ----------------------------------------------------------------------------
# Camera helpers
# ----------------------------------------------------------------------------
def look_at(pos, target, roll=0.0, world_up=(0.0, 1.0, 0.0)):
    pos = np.asarray(pos, np.float64)
    fw = np.asarray(target, np.float64) - pos
    fw /= np.linalg.norm(fw)
    rt = np.cross(fw, np.asarray(world_up, np.float64))
    rt /= np.linalg.norm(rt)
    up = np.cross(rt, fw)
    c, s = math.cos(roll), math.sin(roll)
    rt, up = rt * c + up * s, -rt * s + up * c
    return fw, rt, up


def project(p, pos, fw, rt, up, tanh, W, H):
    """World point -> pixel coords (x, y), depth.  tanh = tan(hfov/2)."""
    v = np.asarray(p, np.float64) - pos
    z = v @ fw
    if z <= 1e-6:
        return None
    x = (v @ rt) / z / tanh
    y = (v @ up) / z / tanh * (W / H)
    return (x + 1) * 0.5 * W, (1 - y) * 0.5 * H, z


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def ease_io(t):
    t = min(max(t, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * t)


def add_glow(img, x, y, radius, color, intensity):
    """Additive gaussian point light into a linear HDR image."""
    H, W, _ = img.shape
    r = int(radius * 4) + 2
    x0, x1 = int(max(x - r, 0)), int(min(x + r + 1, W))
    y0, y1 = int(max(y - r, 0)), int(min(y + r + 1, H))
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    g = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * radius * radius)) * intensity
    img[y0:y1, x0:x1] += g[..., None] * np.asarray(color, np.float32)


# ----------------------------------------------------------------------------
# Film finishing
# ----------------------------------------------------------------------------
def _aces(x):
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


class Film:
    def __init__(self, seed=7):
        self.rng = np.random.default_rng(seed)
        self.font_cache = {}
        self.text_cache = {}

    def font(self, size):
        if size not in self.font_cache:
            self.font_cache[size] = ImageFont.truetype(FONT_PATH, size)
        return self.font_cache[size]

    def finish(self, img, exposure=1.0, scope=True, bloom=0.10, streak=0.05,
               warmth=0.0, grain=1.0, fade=1.0, sat=0.92):
        """img: linear HDR float32 (h, 1920, 3).  Returns uint8 1080p frame."""
        h, w, _ = img.shape
        img = img * (exposure * (1.0 + self.rng.normal(0, 0.004)))
        small = cv2.resize(img, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
        hi = np.maximum(small - 0.8, 0)
        b = (cv2.GaussianBlur(hi, (0, 0), 2) * 0.45 + cv2.GaussianBlur(hi, (0, 0), 7) * 0.35
             + cv2.GaussianBlur(small, (0, 0), 22) * 0.015 + cv2.GaussianBlur(hi, (0, 0), 30) * 0.2)
        halation = cv2.GaussianBlur(np.maximum(small - 1.5, 0), (0, 0), 3) * np.float32([0.5, 0.12, 0.03])
        st = cv2.GaussianBlur(np.maximum(small - 2.5, 0), (0, 0), sigmaX=90, sigmaY=0.8)
        st = st.mean(-1, keepdims=True) * np.float32([0.45, 0.7, 1.0])
        glow = cv2.resize(b * bloom * 4 + halation * 0.6 + st * streak * 6, (w, h),
                          interpolation=cv2.INTER_LINEAR)
        img = img + glow
        # grade in scene-linear: a touch of warmth in highlights, cool lift in shadows
        lum = img @ np.float32([0.2126, 0.7152, 0.0722])
        img = lum[..., None] + (img - lum[..., None]) * sat
        img = img * np.float32([1.0 + 0.06 * warmth, 1.0 + 0.01 * warmth, 1.0 - 0.07 * warmth])
        img = _aces(img)
        img = np.power(img, 1 / 2.2, dtype=np.float32)
        img = img * 0.97 + np.float32([0.012, 0.014, 0.018]) * (1 - img)
        # vignette
        yy = (np.arange(h, dtype=np.float32) - h / 2) / (h / 2)
        xx = (np.arange(w, dtype=np.float32) - w / 2) / (w / 2)
        vig = 1 - 0.22 * (xx[None, :] ** 2 * 0.6 + yy[:, None] ** 2 * 0.4) ** 1.2
        img *= vig[..., None]
        # grain: clumpy, strongest in midtones
        if grain > 0:
            g = self.rng.normal(0, 1, (h // 2, w // 2)).astype(np.float32)
            g = cv2.resize(g, (w, h), interpolation=cv2.INTER_LINEAR)
            g2 = self.rng.normal(0, 1, (h, w)).astype(np.float32) * 0.5
            l = img.mean(-1)
            amp = (0.014 + 0.022 * l * (1 - l) * 4) * grain
            img += ((g + g2) * amp)[..., None] * np.float32([1.0, 0.95, 1.05])
        img *= fade
        # sub-pixel gate weave
        dx, dy = self.rng.normal(0, 0.18), self.rng.normal(0, 0.18)
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        img = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
        frame = np.zeros((OUT_H, OUT_W, 3), np.float32)
        top = (OUT_H - h) // 2
        frame[top:top + h] = img
        return np.clip(frame * 255 + 0.5, 0, 255).astype(np.uint8)

    # -- text ---------------------------------------------------------------
    def _render_text(self, lines, size, color, spacing, tracking=0):
        key = (tuple(lines), size, color, spacing, tracking)
        if key in self.text_cache:
            return self.text_cache[key]
        font = self.font(size)
        pad = 24
        widths = []
        for ln in lines:
            if tracking:
                wsum = sum(font.getlength(ch) + tracking for ch in ln) - tracking
            else:
                wsum = font.getlength(ln)
            widths.append(int(wsum))
        W = max(widths) + pad * 2
        H = int(len(lines) * size * spacing) + pad * 2
        im = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(im)
        y = pad
        for ln, wd in zip(lines, widths):
            x = (W - wd) // 2
            if tracking:
                for ch in ln:
                    d.text((x, y), ch, font=font, fill=255)
                    x += font.getlength(ch) + tracking
            else:
                d.text((x, y), ln, font=font, fill=255)
            y += int(size * spacing)
        a = np.asarray(im, np.float32) / 255.0
        shadow = cv2.GaussianBlur(a, (0, 0), 3)
        res = (a, shadow, np.float32(color) / 255.0)
        self.text_cache[key] = res
        return res

    def text(self, frame, lines, cy, size=40, alpha=1.0, color=(236, 232, 222),
             spacing=1.5, tracking=0, cx=None):
        if alpha <= 0:
            return frame
        a, shadow, col = self._render_text(tuple(lines), size, color, spacing, tracking)
        h, w = a.shape
        cx = OUT_W // 2 if cx is None else cx
        x0, y0 = int(cx - w / 2), int(cy - h / 2)
        f = frame[y0:y0 + h, x0:x0 + w].astype(np.float32) / 255.0
        f *= (1 - shadow * 0.75 * alpha)[..., None]
        f = f * (1 - a[..., None] * alpha) + col * (a[..., None] * alpha)
        frame[y0:y0 + h, x0:x0 + w] = np.clip(f * 255 + 0.5, 0, 255).astype(np.uint8)
        return frame


# ----------------------------------------------------------------------------
# Video output
# ----------------------------------------------------------------------------
class Writer:
    def __init__(self, path, fps=FPS):
        from imageio_ffmpeg import get_ffmpeg_exe
        self.ffmpeg = get_ffmpeg_exe()
        self.p = subprocess.Popen(
            [self.ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
             "-s", f"{OUT_W}x{OUT_H}", "-r", str(fps), "-i", "-",
             "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "grain",
             "-pix_fmt", "yuv420p", path],
            stdin=subprocess.PIPE)

    def write(self, frame):
        self.p.stdin.write(frame.tobytes())

    def close(self):
        self.p.stdin.close()
        self.p.wait()
