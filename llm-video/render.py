# -*- coding: utf-8 -*-
"""把旁白时间轴渲染成 1080p 动画视频（pycairo 画帧 → ffmpeg 编码）。

用法: python3 render.py <音频目录(含 durations.json)> <输出 mp4> [--preview 场景号:秒]
"""
import json
import math
import os
import random
import subprocess
import sys
from multiprocessing import Pool

import cairo
import numpy as np
import soundfile as sf

from script import SCENES, SUBTITLE_OVERRIDES

W, H, FPS = 1920, 1080, 30
FONT = "WenQuanYi Zen Hei"
MONO = "DejaVu Sans Mono"

BG0, BG1 = "#0a0f1e", "#131b35"
FG, MUTED, DIM = "#e8ecf6", "#8a93ad", "#3a4466"
BLUE, ORANGE, GREEN, PINK, PURPLE, CYAN = "#6ea8fe", "#ffb454", "#5fd3a5", "#f06a8c", "#b18cff", "#4fd1e8"
PALETTE = [BLUE, ORANGE, GREEN, PINK, PURPLE, CYAN]

HEAD, GAP, TAIL = 0.5, 0.45, 0.8   # 场景开头留白、句间停顿、场景结尾留白（秒）


# ───────────────────────── 基础绘图工具 ─────────────────────────

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def ease(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def rgb(h):
    return int(h[1:3], 16) / 255, int(h[3:5], 16) / 255, int(h[5:7], 16) / 255


def mix(h1, h2, t):
    a, b = rgb(h1), rgb(h2)
    return "#%02x%02x%02x" % tuple(int(255 * lerp(a[i], b[i], t)) for i in range(3))


def col(cr, h, a=1.0):
    r, g, b = rgb(h)
    cr.set_source_rgba(r, g, b, clamp(a))


def font(cr, size, mono=False, bold=False):
    cr.select_font_face(MONO if mono else FONT, cairo.FONT_SLANT_NORMAL,
                        cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    cr.set_font_size(size)


def tw(cr, s, size, mono=False, bold=False):
    font(cr, size, mono, bold)
    return cr.text_extents(s).x_advance


def text(cr, s, x, y, size, color=FG, a=1.0, align="c", mono=False, bold=False):
    """在 (x, y) 处画文字，y 为垂直中线。align: l/c/r。返回宽度。"""
    if a <= 0.001 or not s:
        return 0
    font(cr, size, mono, bold)
    w = cr.text_extents(s).x_advance
    fa, fd = cr.font_extents()[:2]
    x0 = x - w / 2 if align == "c" else x - w if align == "r" else x
    cr.move_to(x0, y + (fa - fd) / 2)
    col(cr, color, a)
    cr.show_text(s)
    return w


def rrect(cr, x, y, w, h, r=12):
    r = min(r, w / 2, h / 2)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 1.5 * math.pi)
    cr.close_path()


def box(cr, x, y, w, h, fill=None, stroke=None, a=1.0, r=12, lw=2, fa=0.18):
    if a <= 0.001:
        return
    rrect(cr, x, y, w, h, r)
    if fill:
        col(cr, fill, a * fa)
        cr.fill_preserve() if stroke else cr.fill()
    if stroke:
        col(cr, stroke, a)
        cr.set_line_width(lw)
        cr.stroke()


def chip(cr, s, cx, cy, size=40, color=BLUE, a=1.0, padx=18, pady=12, mono=False, fa=0.2, txt=FG):
    w = tw(cr, s, size, mono) + 2 * padx
    h = size + 2 * pady
    box(cr, cx - w / 2, cy - h / 2, w, h, fill=color, stroke=color, a=a, r=10, fa=fa)
    text(cr, s, cx, cy, size, txt, a, mono=mono)
    return w, h


def line(cr, x1, y1, x2, y2, color=MUTED, a=1.0, lw=2, dash=None):
    if a <= 0.001:
        return
    col(cr, color, a)
    cr.set_line_width(lw)
    if dash:
        cr.set_dash(dash)
    cr.move_to(x1, y1)
    cr.line_to(x2, y2)
    cr.stroke()
    cr.set_dash([])


def arrow(cr, x1, y1, x2, y2, color=MUTED, a=1.0, lw=3, head=14, prog=1.0, dash=None):
    if a <= 0.001 or prog <= 0.001:
        return
    x2, y2 = lerp(x1, x2, prog), lerp(y1, y2, prog)
    ang = math.atan2(y2 - y1, x2 - x1)
    bx, by = x2 - head * 0.8 * math.cos(ang), y2 - head * 0.8 * math.sin(ang)
    line(cr, x1, y1, bx, by, color, a, lw, dash)
    col(cr, color, a)
    cr.move_to(x2, y2)
    cr.line_to(x2 - head * math.cos(ang - 0.45), y2 - head * math.sin(ang - 0.45))
    cr.line_to(x2 - head * math.cos(ang + 0.45), y2 - head * math.sin(ang + 0.45))
    cr.close_path()
    cr.fill()


def bez(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return pts


def polyline(cr, pts, color, a=1.0, lw=2, prog=1.0, head=0, dash=None):
    if a <= 0.001 or prog <= 0.001 or len(pts) < 2:
        return
    k = max(2, int(round(len(pts) * clamp(prog))))
    pts = pts[:k]
    col(cr, color, a)
    cr.set_line_width(lw)
    if dash:
        cr.set_dash(dash)
    cr.move_to(*pts[0])
    for p in pts[1:]:
        cr.line_to(*p)
    cr.stroke()
    cr.set_dash([])
    if head:
        (xa, ya), (xb, yb) = pts[-2], pts[-1]
        ang = math.atan2(yb - ya, xb - xa)
        col(cr, color, a)
        cr.move_to(xb, yb)
        cr.line_to(xb - head * math.cos(ang - 0.45), yb - head * math.sin(ang - 0.45))
        cr.line_to(xb - head * math.cos(ang + 0.45), yb - head * math.sin(ang + 0.45))
        cr.close_path()
        cr.fill()


def arc_between(x1, x2, y, h, up=True):
    s = -1 if up else 1
    return bez((x1, y), (x1, y + s * h), (x2, y + s * h), (x2, y))


def circle(cr, x, y, r, color, a=1.0, fill=True, lw=2):
    if a <= 0.001:
        return
    col(cr, color, a)
    cr.new_path()
    cr.arc(x, y, r, 0, 2 * math.pi)
    if fill:
        cr.fill()
    else:
        cr.set_line_width(lw)
        cr.stroke()


def glow(cr, x, y, r, color, a=1.0):
    if a <= 0.001:
        return
    g = cairo.RadialGradient(x, y, 0, x, y, r)
    c = rgb(color)
    g.add_color_stop_rgba(0, *c, 0.45 * a)
    g.add_color_stop_rgba(1, *c, 0)
    cr.set_source(g)
    cr.new_path()
    cr.arc(x, y, r, 0, 2 * math.pi)
    cr.fill()


def vec_cells(cr, x, y, vals, cw=38, ch=38, a=1.0, prog=1.0, vertical=False, nums=False):
    """一串数字画成色块：蓝=负、橙=正。"""
    n = len(vals)
    for i, v in enumerate(vals):
        pa = a * ease(prog * n - i)
        if pa <= 0:
            continue
        c = mix("#1b2442", ORANGE if v > 0 else BLUE, min(1, abs(v)))
        cx, cy = (x, y + i * ch) if vertical else (x + i * cw, y)
        rrect(cr, cx, cy, cw - 4, ch - 4, 5)
        col(cr, c, pa)
        cr.fill()
        if nums:
            text(cr, f"{v:+.2f}", cx + (cw - 4) / 2, cy - 18, 17, MUTED, pa, mono=True)


def wrap(cr, s, size, maxw):
    font(cr, size)
    out, cur = [], ""
    for ch in s:
        if cr.text_extents(cur + ch).x_advance > maxw and cur:
            if ch in "，。；：！？、”）":  # 标点不放行首
                cur += ch
                out.append(cur)
                cur = ""
                continue
            out.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out


# ───────────────────────── 场景时间上下文 ─────────────────────────

class Ctx:
    def __init__(self, cr, t, beats, durs, dur):
        self.cr, self.t, self.beats, self.durs, self.dur = cr, t, beats, durs, dur

    def B(self, i):
        return self.beats[i] if i < len(self.beats) else self.dur + 99

    def raw(self, i, delay=0.0):
        return self.t - self.B(i) - delay

    def p(self, i, d=0.6, delay=0.0):
        return ease(self.raw(i, delay) / d)

    def u(self, i):
        """当前句内进度 0..1（按该句音频时长）。"""
        return clamp(self.raw(i) / self.durs[i]) if i < len(self.durs) else 0

    def view(self, i, j=None, d=0.5):
        """从第 i 句淡入、到第 j 句淡出的可见度。"""
        a = self.p(i, d) if i > 0 else ease(self.t / 0.4)
        if j is not None and j < len(self.beats):
            a = min(a, 1 - self.p(j, d * 0.8))
        return a


# ───────────────────────── 各场景 ─────────────────────────

rnd = random.Random(7)
FLOAT_TOKENS = [(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(-12, 12), rnd.uniform(-8, 8),
                 rnd.choice(["token", "的", "Attention", "0.42", "向量", "softmax", "我", "▁the", "猫", "Q·K",
                             "预测", "层", "概率", "[3721]", "注意力", "Transformer", "e^x"]),
                 rnd.uniform(20, 44)) for _ in range(46)]


def scene_intro(c):
    cr, t = c.cr, c.t
    for x, y, vx, vy, s, sz in FLOAT_TOKENS:
        text(cr, s, (x + vx * t) % W, (y + vy * t) % H, sz, MUTED, 0.13 * c.view(0))
    glow(cr, 960, 400, 520, PURPLE, 0.5 * c.view(0))
    a0 = c.p(0, 1.0)
    text(cr, "大语言模型的底层原理", 960, 360 - 20 * (1 - a0), 104, FG, a0, bold=True)
    text(cr, "Large Language Model，从零讲清楚", 960, 470, 40, MUTED, c.p(0, 1.0, 0.5))
    a1 = c.p(1, 0.7)
    if a1 > 0:
        glow(cr, 960, 600, 260, ORANGE, a1 * 0.6)
        w = tw(cr, "LLM 的本质  =  预测下一个词", 56, bold=True) + 80
        box(cr, 960 - w / 2, 555, w, 92, fill=ORANGE, stroke=ORANGE, a=a1, r=46, fa=0.18, lw=3)
        text(cr, "LLM 的本质  =  预测下一个词", 960, 601, 56, ORANGE, a1, bold=True)
    steps = ["分词", "嵌入", "注意力", "Transformer", "输出与采样", "训练", "对齐"]
    ws = [tw(cr, s, 32) + 44 for s in steps]
    total = sum(ws) + 50 * (len(steps) - 1)
    x = 960 - total / 2
    for k, (s, w) in enumerate(zip(steps, ws)):
        a = c.p(2, 0.5, 0.9 * k)
        box(cr, x, 740, w, 64, fill=PALETTE[k % 6], stroke=PALETTE[k % 6], a=a, r=32, fa=0.15)
        text(cr, s, x + w / 2, 772, 32, FG, a)
        if k < len(steps) - 1:
            arrow(cr, x + w + 8, 772, x + w + 42, 772, MUTED, c.p(2, 0.5, 0.9 * k + 0.4), lw=2, head=10)
        x += w + 50


PRED_BASE = "今天天气真好，我们一起去公园"
PRED_DISTS = [
    [("散步", .42), ("玩", .25), ("野餐", .12), ("跑步", .08), ("看花", .06), ("其他", .07)],
    [("，", .55), ("吧", .20), ("。", .15), ("了", .05), ("玩", .02), ("其他", .03)],
    [("顺便", .31), ("然后", .24), ("再", .20), ("还", .10), ("一起", .08), ("其他", .07)],
    [("看看", .46), ("去", .20), ("买", .12), ("晒", .09), ("拍", .06), ("其他", .07)],
    [("花", .38), ("湖", .22), ("风景", .18), ("鸭子", .10), ("大家", .05), ("其他", .07)],
]


def scene_predict(c):
    cr, t = c.cr, c.t
    SX, SY, SZ = 300, 230, 52
    # 接龙：第 4 句开始，每 1.4 秒生成一个词
    T4 = c.B(4)
    step, appended, flying = 0, [], None
    for k in range(len(PRED_DISTS)):
        s_k = T4 + 1.4 * k
        pick = s_k + (0 if k == 0 else 0.55)
        if t >= s_k:
            step = k
        if t >= pick + 0.55:
            appended.append(PRED_DISTS[k][0][0])
        elif t >= pick:
            flying = (k, (t - pick) / 0.55)
    # 句子
    a0 = c.view(0)
    box(cr, 240, 170, 1440, 120, fill=BLUE, stroke=DIM, a=a0, r=18, fa=0.06)
    n = int(len(PRED_BASE) * clamp(c.raw(0, 0.3) / 2.2))
    s = PRED_BASE[:n] + "".join(appended)
    font(cr, SZ)
    wb = cr.text_extents(PRED_BASE[:n]).x_advance
    text(cr, PRED_BASE[:n], SX, SY, SZ, FG, a0, align="l")
    text(cr, "".join(appended), SX + wb, SY, SZ, ORANGE, a0, align="l")
    end_x = SX + tw(cr, s, SZ)
    if n == len(PRED_BASE) and (int(t * 2.2) % 2 == 0):
        line(cr, end_x + 12, SY + 30, end_x + 60, SY + 30, ORANGE, a0, lw=4)
    # 脑中的候选
    a1 = c.view(1, 2)
    for k, w in enumerate(["散步？", "玩？", "野餐？"]):
        ak = a1 * c.p(1, 0.5, 0.35 + 0.35 * k)
        chip(cr, w, 830 + k * 230, 390 + 18 * math.sin(t * 2 + k), 40, PALETTE[k + 1], ak)
    # 模型盒子
    a2 = c.p(2)
    arrow(cr, 960, 295, 960, 372, MUTED, a2, prog=c.p(2, 0.5))
    g = cairo.LinearGradient(760, 380, 1160, 460)
    g.add_color_stop_rgba(0, *rgb(PURPLE), 0.9 * a2)
    g.add_color_stop_rgba(1, *rgb(BLUE), 0.9 * a2)
    rrect(cr, 760, 378, 400, 88, 20)
    cr.set_source(g)
    cr.fill()
    text(cr, "语言模型", 960, 422, 44, "#ffffff", a2, bold=True)
    arrow(cr, 960, 470, 960, 530, MUTED, a2, prog=c.p(2, 0.5, 0.4))
    text(cr, "下一个词的概率分布", 960 + 30, 500, 26, MUTED, a2, align="l")
    # 概率条
    dist = PRED_DISTS[step]
    for i, (w, pr) in enumerate(dist):
        y = 565 + i * 50
        if step == 0:
            g_ = c.p(3, 0.8, 0.12 * i) if c.t < T4 else 1
            ar = c.p(2, 0.5, 0.6)
        else:
            g_ = ease((t - (T4 + 1.4 * step)) / 0.45 - 0.1 * i)
            ar = 1
        hi = (i == 0 and flying is not None and flying[0] == step) or (i == 0 and step in [x for x in range(len(appended))] and t >= T4)
        dim = 0.35 if (t >= T4 and i > 0) else 1
        text(cr, w, 830, y, 34, ORANGE if hi else FG, ar * dim, align="r")
        bw = 640 * pr / 0.55 * g_
        rrect(cr, 850, y - 16, max(bw, 1), 32, 6)
        col(cr, ORANGE if hi else BLUE, ar * (0.9 if hi else 0.55) * dim)
        cr.fill()
        text(cr, f"{int(round(pr * 100 * g_))}%", 865 + bw, y, 28, MUTED, ar * g_ * dim, align="l", mono=True)
    # 飞行的词
    if flying:
        k, f = flying
        f = ease(f)
        w = PRED_DISTS[k][0][0]
        fx = lerp(830 - tw(cr, w, 34), SX + tw(cr, PRED_BASE + "".join(appended), SZ), f)
        fy = lerp(565, SY, f)
        text(cr, w, fx, fy, lerp(34, SZ, f), ORANGE, 1, align="l")
    # 回环箭头
    al = c.p(4, 0.6, 1.0)
    pts = bez((1560, 640), (1790, 640), (1790, 230), (1700, 230))
    polyline(cr, pts, ORANGE, al * 0.8, lw=3, prog=c.p(4, 0.8, 1.0), head=14)
    text(cr, "接到末尾", 1690, 430, 28, ORANGE, al, align="r")
    text(cr, "再来一次", 1690, 468, 28, ORANGE, al, align="r")


TOK_A = ["我", "喜欢", "学习", "人工", "智能", "。"]
ID_A = [2769, 23411, 11053, 17340, 26402, 1811]
TOK_B = ["Chat", "G", "PT", "␣is", "␣un", "believ", "able", "!"]
ID_B = [30820, 38, 11571, 318, 555, 6667, 540, 0]


def token_row(c, toks, ids, cx, y, size, split, idp, base_a):
    cr = c.cr
    gap = 22 * split
    ws = [tw(cr, s, size) for s in toks]
    pad = 14 * split
    total = sum(ws) + gap * (len(toks) - 1) + 2 * pad * len(toks)
    x = cx - total / 2
    centers = []
    for k, (s, w) in enumerate(zip(toks, ws)):
        cw = w + 2 * pad
        colr = PALETTE[k % 6]
        box(cr, x, y - size / 2 - 14, cw, size + 28, fill=colr, stroke=colr, a=base_a * split, r=10, fa=0.2)
        text(cr, s, x + cw / 2, y, size, FG, base_a)
        ia = base_a * ease(idp * len(toks) - k)
        text(cr, str(ids[k]), x + cw / 2, y + size / 2 + 42, 26, colr, ia, mono=True)
        centers.append(x + cw / 2)
        x += cw + gap
    return centers


def scene_token(c):
    cr = c.cr
    a0 = c.view(0)
    split = c.p(1, 0.9)
    idp = c.p(2, 1.2)
    text(cr, "原始文本" if split < 0.5 else "切分成 token", 160, 190, 30, MUTED, a0, align="l")
    token_row(c, TOK_A, ID_A, 760, 330, 56, split, idp, a0)
    token_row(c, TOK_B, ID_B, 760, 540, 56, split, idp, a0)
    text(cr, "（␣ 表示空格；编号仅为示意）", 760, 660, 22, MUTED, c.p(2, 0.6, 1.0))
    # 词表面板
    ap = c.p(2, 0.6)
    if ap > 0:
        box(cr, 1440, 190, 360, 520, fill=PURPLE, stroke=PURPLE, a=ap, r=16, fa=0.08)
        text(cr, "词表 Vocabulary", 1620, 230, 30, PURPLE, ap, bold=True)
        rows = [("0", "!"), ("318", "␣is"), ("…", "…"), ("2769", "我"), ("11053", "学习"),
                ("23411", "喜欢"), ("…", "…"), ("30820", "Chat"), ("…", "…"), ("100255", "…")]
        for k, (i_, w) in enumerate(rows):
            ra = ap * ease(c.raw(2) * 3 - k * 0.3)
            y = 285 + k * 40
            text(cr, i_, 1560, y, 24, MUTED, ra, align="r", mono=True)
            text(cr, w, 1600, y, 26, FG, ra, align="l")
        text(cr, "共约 10 万个条目", 1620, 685, 24, PURPLE, ap)
    # 整数序列
    a3 = c.p(3, 0.6)
    ids = ID_A
    s = "[ " + ", ".join(str(i) for i in ids) + " ]"
    n = int(len(s) * c.p(3, 1.4))
    box(cr, 260, 740, 1000, 90, fill=GREEN, stroke=GREEN, a=a3, r=16, fa=0.1)
    text(cr, s[:n], 290, 785, 38, GREEN, a3, align="l", mono=True)
    text(cr, "← 模型真正看到的输入", 1290, 785, 30, MUTED, c.p(3, 0.5, 1.2), align="l")


EMB_PTS = {
    "猫": (470, 280, PINK), "狗": (570, 320, PINK), "兔子": (495, 390, PINK),
    "苹果": (1290, 360, GREEN), "香蕉": (1400, 420, GREEN), "葡萄": (1300, 470, GREEN),
    "男人": (700, 760, BLUE), "女人": (960, 760, BLUE), "国王": (700, 560, PURPLE), "女王": (960, 560, PURPLE),
}


def scene_embed(c):
    cr, t = c.cr, c.t
    # 视图 1：编号无意义 + 向量
    v1 = c.view(0, 2)
    if v1 > 0:
        chip(cr, "#3721  →  猫", 660, 270, 44, BLUE, v1 * c.p(0, 0.6, 0.3), mono=False)
        chip(cr, "#3722  →  税收", 1260, 270, 44, ORANGE, v1 * c.p(0, 0.6, 0.8))
        text(cr, "编号相邻  ≠  意思相近", 960, 370, 36, PINK, v1 * c.p(0, 0.6, 1.6))
        a1 = v1 * c.p(1)
        chip(cr, "猫", 300, 580, 56, PINK, a1)
        arrow(cr, 370, 580, 500, 580, MUTED, a1, prog=c.p(1, 0.6, 0.3))
        vals = [0.12, -0.83, 0.45, 0.91, -0.27, 0.06, -0.64, 0.33, 0.78, -0.15, -0.52, 0.21, 0.07]
        vec_cells(cr, 530, 560, vals, cw=76, ch=46, a=a1, prog=c.p(1, 1.6, 0.5), nums=True)
        text(cr, "…… 共几千维", 1530, 670, 30, MUTED, v1 * c.p(1, 0.6, 2.0), align="r")
        text(cr, "词嵌入：每个 token 对应一个向量", 960, 760, 36, FG, v1 * c.p(1, 0.6, 2.4))
    # 视图 2：语义空间
    v2 = c.view(2, 4)
    if v2 > 0:
        for gx in range(360, 1600, 80):
            line(cr, gx, 170, gx, 850, DIM, v2 * 0.35, lw=1)
        for gy in range(170, 860, 80):
            line(cr, 360, gy, 1560, gy, DIM, v2 * 0.35, lw=1)
        for (cx, cy, rx, ry, colr, lab) in [(510, 330, 150, 110, PINK, "动物"), (1330, 415, 160, 110, GREEN, "水果")]:
            ha = v2 * c.p(2, 0.8, 2.5)
            cr.new_path()
            cr.save()
            cr.translate(cx, cy)
            cr.scale(rx, ry)
            cr.arc(0, 0, 1, 0, 2 * math.pi)
            cr.restore()
            col(cr, colr, ha * 0.12)
            cr.fill()
            text(cr, lab, cx, cy - ry - 22, 28, colr, ha)
        for k, (w, (x, y, colr)) in enumerate(EMB_PTS.items()):
            pa = v2 * c.p(2, 0.5, 0.15 * k)
            circle(cr, x, y, 9, colr, pa)
            left = w in ("国王", "男人")
            text(cr, w, x - 18 if left else x + 18, y - 4, 34, FG, pa, align="r" if left else "l")
        # 国王 - 男人 + 女人 ≈ 女王
        a3 = v2 * c.p(3)
        mx, my = EMB_PTS["男人"][:2]
        wx, wy = EMB_PTS["女人"][:2]
        kx, ky = EMB_PTS["国王"][:2]
        qx, qy = EMB_PTS["女王"][:2]
        arrow(cr, mx, my - 12, kx, ky + 14, PURPLE, a3, lw=4, prog=c.p(3, 0.7, 0.2))
        text(cr, "“王室”方向", mx - 110, (my + ky) / 2, 26, PURPLE, a3, align="r")
        arrow(cr, mx + 14, my, wx - 14, wy, PINK, a3, lw=4, prog=c.p(3, 0.7, 1.4))
        text(cr, "“性别”方向", (mx + wx) / 2, my + 40, 26, PINK, a3)
        a4 = v2 * c.p(3, 0.8, 3.0)
        arrow(cr, kx + 14, ky, qx - 14, qy, PINK, a4, lw=4, prog=c.p(3, 0.7, 3.0), dash=[10, 8])
        glow(cr, qx, qy, 70, ORANGE, a4 * (0.7 + 0.3 * math.sin(t * 4)))
        box(cr, 1080, 640, 480, 150, fill=ORANGE, stroke=ORANGE, a=a4, r=16, fa=0.1)
        text(cr, "国王 － 男人 ＋ 女人", 1320, 690, 38, FG, a4)
        text(cr, "≈  女王", 1320, 745, 42, ORANGE, a4, bold=True)
    # 视图 3：位置编码
    v3 = c.view(4)
    if v3 > 0:
        for r_, (ws, lab) in enumerate([(["狗", "咬", "人"], "狗 咬 人"), (["人", "咬", "狗"], "人 咬 狗")]):
            y = 320 + r_ * 260
            for k, w in enumerate(ws):
                x = 560 + k * 220
                a = v3 * c.p(4, 0.5, 0.2 * k + r_ * 0.6)
                chip(cr, w, x, y, 60, PINK if w == "狗" else BLUE if w == "人" else PURPLE, a)
                pa = v3 * c.p(4, 0.5, 2.5 + 0.25 * k)
                text(cr, "+", x, y + 64, 30, MUTED, pa)
                chip(cr, f"位置{k + 1}", x, y + 108, 26, GREEN, pa, padx=12, pady=6)
        ta = v3 * c.p(4, 0.6, 4.2)
        box(cr, 1260, 360, 460, 250, fill=GREEN, stroke=GREEN, a=ta, r=16, fa=0.08)
        text(cr, "输入向量", 1490, 420, 34, FG, ta)
        text(cr, "= 词向量 + 位置向量", 1490, 480, 34, GREEN, ta)
        text(cr, "同样的字，不同的顺序", 1490, 545, 28, MUTED, ta)


ATT_TOKS = ["小猫", "没有", "吃", "鱼", "，", "因为", "它", "太", "饱", "了"]
ATT_W = [.62, .03, .06, .12, .01, .04, .05, .02, .04, .01]
IT = 6


def att_xs(cr, toks, cx, size, gap):
    ws = [tw(cr, s, size) + 36 for s in toks]
    total = sum(ws) + gap * (len(toks) - 1)
    x, xs = cx - total / 2, []
    for w in ws:
        xs.append(x + w / 2)
        x += w + gap
    return xs, ws


def scene_attention(c):
    cr, t = c.cr, c.t
    a0 = c.view(0, 1)
    text(cr, "Attention", 960, 420, 120, PURPLE, a0, bold=True)
    text(cr, "注意力机制", 960, 540, 56, FG, a0)
    Y = 370
    xs, ws = att_xs(cr, ATT_TOKS, 960, 48, 26)
    ar = c.p(1)
    allmode = c.p(6, 0.8)
    for k, s in enumerate(ATT_TOKS):
        a = ar * c.p(1, 0.4, 0.08 * k)
        colr = ORANGE if k == IT else PINK if k == 0 and c.t > c.B(5) else BLUE
        box(cr, xs[k] - ws[k] / 2, Y - 38, ws[k], 76, fill=colr, stroke=colr, a=a, r=10, fa=0.2)
        text(cr, s, xs[k], Y, 48, FG, a)
    qa = ar * c.p(1, 0.6, 1.8) * (1 - c.p(3, 0.4))
    text(cr, "？", xs[IT], Y - 80 + 6 * math.sin(t * 5), 54, ORANGE, qa, bold=True)
    # 从“它”出发的弧线
    wmode = c.p(4, 1.0)
    for k in range(len(ATT_TOKS)):
        if k == IT:
            continue
        pts = arc_between(xs[IT], xs[k], Y - 42, 30 + abs(k - IT) * 18)
        base = c.p(2, 0.8, 0.12 * abs(k - IT))
        wgt = ATT_W[k]
        lw = lerp(2, 2 + 16 * wgt, wmode)
        al = lerp(0.35, 0.25 + 0.75 * wgt / 0.62, wmode) * (1 - 0.8 * allmode)
        colr = ORANGE if (k == 0 and wmode > 0.5) else MUTED
        polyline(cr, pts, colr, al * ar, lw=lw, prog=base)
    # Q K V
    a3 = c.p(3) * (1 - 0.8 * allmode)
    text(cr, "Q 查询：我在找什么", 330, 150, 28, ORANGE, a3)
    text(cr, "K 键：我有什么特征", 960, 150, 28, BLUE, a3)
    text(cr, "V 值：我能提供什么信息", 1590, 150, 28, GREEN, a3)
    for k in range(len(ATT_TOKS)):
        ka = a3 * c.p(3, 0.4, 1.4 + 0.08 * k)
        chip(cr, "K", xs[k] - 22, 450, 22, BLUE, ka, padx=9, pady=4, mono=True)
        chip(cr, "V", xs[k] + 22, 450, 22, GREEN, ka, padx=9, pady=4, mono=True)
    chip(cr, "Q", xs[IT], Y - 62, 22, ORANGE, a3 * c.p(3, 0.4, 0.8), padx=9, pady=4, mono=True)
    # 权重柱
    a4 = c.p(4) * (1 - 0.8 * allmode)
    base_y = 720
    text(cr, "Q·K 匹配", 70, 570, 28, MUTED, a4, align="l")
    text(cr, "→ softmax", 70, 610, 28, MUTED, a4, align="l")
    text(cr, "→ 权重", 70, 650, 28, MUTED, a4, align="l")
    for k in range(len(ATT_TOKS)):
        g = c.p(4, 0.8, 1.2 + 0.07 * k)
        h = 210 * ATT_W[k] / 0.62 * g
        colr = ORANGE if k == 0 else BLUE
        rrect(cr, xs[k] - 24, base_y - h, 48, max(h, 1), 6)
        col(cr, colr, a4 * 0.85)
        cr.fill()
        text(cr, f"{ATT_W[k]:.2f}", xs[k], base_y - h - 20, 22, colr if k == 0 else MUTED, a4 * g, mono=True)
    line(cr, xs[0] - 50, base_y, xs[-1] + 50, base_y, DIM, a4, lw=2)
    text(cr, "合计 = 1.00", xs[-1] + 40, base_y + 30, 22, MUTED, a4 * c.p(4, 0.5, 2.2), align="r")
    # 加权求和得到新的“它”
    a5 = c.p(5) * (1 - 0.8 * allmode)
    ox, oy = xs[IT], 835
    for k in range(len(ATT_TOKS)):
        f = ease((c.raw(5) - 0.3 - 0.06 * k) / 1.2)
        if f <= 0 or f >= 1:
            continue
        px, py = lerp(xs[k] + 22, ox, f), lerp(460, oy, f) - 60 * math.sin(math.pi * f)
        circle(cr, px, py, 4 + 16 * ATT_W[k], GREEN if k else PINK, a5)
    fill_c = mix(GREEN, PINK, 0.7)
    box(cr, ox - 70, oy - 36, 140, 72, fill=fill_c, stroke=fill_c, a=a5 * c.p(5, 0.5, 1.2), r=12, fa=0.3)
    text(cr, "它′", ox, oy, 42, FG, a5 * c.p(5, 0.5, 1.2), bold=True)
    text(cr, "= 0.62×小猫 + 0.12×鱼 + 0.06×吃 + …", ox + 100, oy, 30, FG, a5 * c.p(5, 0.5, 1.8), align="l")
    text(cr, "融合了上下文的新表示", ox - 100, oy, 28, MUTED, a5 * c.p(5, 0.5, 2.4), align="r")
    # 所有词两两互相注意
    if allmode > 0:
        rr = random.Random(3)
        for i in range(len(ATT_TOKS)):
            for j in range(len(ATT_TOKS)):
                if i >= j:
                    continue
                pts = arc_between(xs[i], xs[j], Y + 42, 30 + (j - i) * 22, up=False)
                ph = (t * 0.8 + rr.random()) % 1
                polyline(cr, pts, PALETTE[(i + j) % 6], allmode * (0.25 + 0.35 * ph), lw=2,
                         prog=c.p(6, 1.2, 0.05 * (i + j)))


def mini_heads(c, a):
    cr, t = c.cr, c.t
    heads = [
        ("头 1 · 指代", ORANGE, [(6, 0, 1.0), (6, 3, 0.25)]),
        ("头 2 · 语法", GREEN, [(2, 0, 0.8), (2, 3, 0.8), (8, 6, 0.7), (1, 2, 0.5)]),
        ("头 3 · 邻近", CYAN, [(i, i + 1, 0.6) for i in range(9)]),
    ]
    for h, (lab, colr, links) in enumerate(heads):
        ha = a * c.p(0, 0.6, 0.5 + 1.2 * h)
        y = 300 + h * 215
        box(cr, 160, y - 120, 1600, 190, fill=colr, stroke=colr, a=ha * 0.6, r=16, fa=0.05, lw=1.5)
        text(cr, lab, 200, y - 85, 30, colr, ha, align="l", bold=True)
        xs, ws = att_xs(cr, ATT_TOKS, 1030, 34, 22)
        for k, s in enumerate(ATT_TOKS):
            box(cr, xs[k] - ws[k] / 2 + 6, y + 10, ws[k] - 12, 52, fill=BLUE, stroke=None, a=ha, r=8, fa=0.2)
            text(cr, s, xs[k], y + 36, 34, FG, ha)
        for i, j, w in links:
            pts = arc_between(xs[i], xs[j], y + 4, 18 + abs(i - j) * 12)
            polyline(cr, pts, colr, ha * (0.35 + 0.65 * w), lw=2 + 6 * w, prog=c.p(0, 0.8, 0.9 + 1.2 * h))


def scene_transformer(c):
    cr, t = c.cr, c.t
    v1 = c.view(0, 1)
    if v1 > 0:
        mini_heads(c, v1)
    # 前馈网络
    v2 = c.view(1, 2)
    if v2 > 0:
        layers = [6, 12, 6]
        lx = [720, 960, 1200]
        pos = [[(lx[l], 540 + (i - (n - 1) / 2) * (560 / max(n, 7))) for i in range(n)] for l, n in enumerate(layers)]
        for l in range(2):
            for i, p in enumerate(pos[l]):
                for j, q in enumerate(pos[l + 1]):
                    line(cr, p[0], p[1], q[0], q[1], MUTED, v2 * 0.18 * c.p(1, 0.8, 0.3 * l), lw=1)
        for l, ps in enumerate(pos):
            for i, (x, y) in enumerate(ps):
                pulse = 0.5 + 0.5 * math.sin(t * 5 - l * 1.3 + i * 0.7)
                circle(cr, x, y, 13, [BLUE, PURPLE, GREEN][l], v2 * c.p(1, 0.5, 0.2 * l) * (0.5 + 0.5 * pulse))
        text(cr, "前馈网络 FFN", 960, 190, 44, FG, v2, bold=True)
        text(cr, "每个位置各自加工", 960, 245, 28, MUTED, v2)
        vec_cells(cr, 500, 380, [0.3, -0.6, 0.8, -0.2, 0.5, 0.1, -0.7], cw=40, ch=46, a=v2, vertical=True)
        text(cr, "输入", 520, 350, 26, MUTED, v2)
        vec_cells(cr, 1380, 380, [-0.4, 0.9, 0.2, -0.8, 0.6, -0.1, 0.4], cw=40, ch=46, a=v2, vertical=True)
        text(cr, "输出", 1400, 350, 26, MUTED, v2)
        ka = v2 * c.p(1, 0.6, 5.0)
        box(cr, 1480, 700, 380, 140, fill=ORANGE, stroke=ORANGE, a=ka, r=16, fa=0.1)
        text(cr, "“巴黎是法国的首都”", 1670, 748, 30, ORANGE, ka)
        text(cr, "这类知识大多存在这里", 1670, 796, 26, MUTED, ka)
    # Transformer 块
    v3 = c.view(2, 3)
    if v3 > 0:
        cx = 960
        blocks = [(800, "输入向量", DIM), (680, "多头注意力", PURPLE), (580, "相加 & 归一化", MUTED),
                  (480, "前馈网络", BLUE), (380, "相加 & 归一化", MUTED), (260, "输出向量", DIM)]
        box(cr, 700, 330, 520, 400, fill=PURPLE, stroke=PURPLE, a=v3 * c.p(2, 0.6, 2.5), r=20, fa=0.06, lw=2)
        text(cr, "Transformer 块", 700, 310, 30, PURPLE, v3 * c.p(2, 0.6, 2.5), align="l", bold=True)
        text(cr, "× N 层", 1240, 530, 44, ORANGE, v3 * c.p(2, 0.6, 3.5), align="l", bold=True)
        for k, (y, lab, colr) in enumerate(blocks):
            a = v3 * c.p(2, 0.5, 0.25 * k)
            w = 380 if k not in (0, 5) else 300
            box(cr, cx - w / 2, y - 30, w, 60, fill=colr, stroke=colr, a=a, r=12, fa=0.3)
            text(cr, lab, cx, y, 32, FG, a)
            if k < len(blocks) - 1:
                ny = blocks[k + 1][0]
                arrow(cr, cx, y - 32, cx, ny + 32, MUTED, a, lw=2, head=10)
        # 残差连接
        ra = v3 * c.p(2, 0.6, 1.8)
        for (y0, y1) in [(800, 580), (580, 380)]:
            pts = [(cx - 200, y0 - 10), (cx - 300, y0 - 10), (cx - 300, y1), (cx - 195, y1)]
            polyline(cr, pts, GREEN, ra, lw=3, head=12, prog=1)
        text(cr, "残差连接", cx - 320, 690, 26, GREEN, ra, align="r")
        text(cr, "（信息可以直接“抄近路”）", cx - 320, 725, 22, MUTED, ra, align="r")
    # 多层堆叠
    v4 = c.view(3)
    if v4 > 0:
        n = 9
        labels = {0: "字词、局部搭配", 3: "语法结构", 6: "语义、指代", 8: "推理、任务"}
        for k in range(n):
            y = 800 - k * 68
            a = v4 * c.p(3, 0.4, 0.15 * k)
            colr = mix(BLUE, PURPLE, k / (n - 1))
            cr.move_to(700, y)
            cr.line_to(1160, y)
            cr.line_to(1220, y - 40)
            cr.line_to(760, y - 40)
            cr.close_path()
            col(cr, colr, a * 0.35)
            cr.fill_preserve()
            col(cr, colr, a)
            cr.set_line_width(2)
            cr.stroke()
            lab_l = "第 1 层" if k == 0 else "第 96 层" if k == n - 1 else "···" if k == 4 else ""
            text(cr, lab_l, 670, y - 20, 26, MUTED, a, align="r")
            if k in labels:
                la = v4 * c.p(3, 0.5, 2.5 + 1.1 * list(labels).index(k))
                line(cr, 1225, y - 20, 1300, y - 20, colr, la, lw=2)
                text(cr, labels[k], 1315, y - 20, 32, FG, la, align="l")
        f = (t - c.B(3)) * 0.35 % 1
        glow(cr, 960, 780 - f * 560, 60, ORANGE, v4)
        arrow(cr, 560, 800, 560, 260, ORANGE, v4 * 0.7, lw=3)
        text(cr, "越来越抽象", 530, 530, 28, ORANGE, v4, align="r")


LOGITS = np.array([5.2, 4.7, 4.0, 3.6, 3.3, 3.4] + list(np.random.RandomState(4).normal(0, 1.2, 46)))
LOGIT_LABELS = {0: "散步", 1: "玩", 2: "野餐", 3: "跑步", 4: "看花"}
_FIXED = {0: 10, 1: 19, 2: 28, 3: 37, 4: 45}   # 有标签的词在柱状图上的位置，彼此拉开
_rest = [i for i in range(len(LOGITS)) if i not in _FIXED.values()]
np.random.RandomState(9).shuffle(_rest)
ORDER = [_FIXED[k] if k in _FIXED else _rest.pop() for k in range(len(LOGITS))]


def softmax(x, T=1.0):
    z = np.exp((x - x.max()) / T)
    return z / z.sum()


def scene_sample(c):
    cr, t = c.cr, c.t
    v = c.view(0, 3)
    if v > 0:
        a0 = v * c.p(0)
        vec_cells(cr, 150, 250, [0.4, -0.7, 0.2, 0.9, -0.3, 0.6, -0.5, 0.1, 0.8], cw=44, ch=48, a=a0,
                  vertical=True, prog=c.p(0, 1.0))
        text(cr, "最后位置", 172, 200, 26, MUTED, a0)
        arrow(cr, 220, 460, 300, 460, MUTED, a0, prog=c.p(0, 0.5, 0.8))
        box(cr, 310, 400, 200, 120, fill=PURPLE, stroke=PURPLE, a=a0 * c.p(0, 0.5, 1.0), r=14, fa=0.25)
        text(cr, "× 输出矩阵", 410, 445, 28, FG, a0 * c.p(0, 0.5, 1.0))
        text(cr, "映射到词表", 410, 482, 22, MUTED, a0 * c.p(0, 0.5, 1.0))
        arrow(cr, 520, 460, 600, 460, MUTED, a0, prog=c.p(0, 0.5, 1.4))
        # 温度
        T = 1.0
        if c.t >= c.B(2):
            u = c.u(2)
            keys = [(0, 1.0), (0.12, 1.0), (0.24, 0.3), (0.5, 0.3), (0.62, 2.2), (0.9, 2.2), (1.0, 1.0)]
            for (u0, T0), (u1, T1) in zip(keys, keys[1:]):
                if u0 <= u <= u1:
                    T = lerp(T0, T1, ease((u - u0) / (u1 - u0)))
                    break
        P = softmax(LOGITS, T)
        m = c.p(1, 1.2)  # logits → 概率
        base_y = 560
        x0, bw = 640, 22
        for idx, k in enumerate(sorted(range(len(LOGITS)), key=lambda i: ORDER[i])):
            x = x0 + idx * 23.5
            ga = a0 * c.p(0, 0.3, 1.6 + 0.02 * idx)
            hl = LOGITS[k] * 32
            hp = P[k] / 0.5 * 330
            h = lerp(hl, hp, m)
            colr = ORANGE if k in LOGIT_LABELS else BLUE
            y0, y1 = (base_y - h, base_y) if h >= 0 else (base_y, base_y - h)
            rrect(cr, x, y0, bw, max(y1 - y0, 1), 4)
            col(cr, colr, ga * (0.9 if k in LOGIT_LABELS else 0.5))
            cr.fill()
            if k in LOGIT_LABELS:
                text(cr, LOGIT_LABELS[k], x + bw / 2, base_y + 34 + (34 if h < 0 else 0), 24, ORANGE, ga)
                if m > 0.5 and k < 3:
                    text(cr, f"{P[k]:.2f}", x + bw / 2, y0 - 16, 18, MUTED, ga * (m - 0.5) * 2, mono=True)
        line(cr, x0 - 10, base_y, x0 + 52 * 23.5, base_y, DIM, a0, lw=2)
        text(cr, "logits：每个 token 的原始分数（可正可负）", 1250, 200, 30, FG, a0 * (1 - m), align="c")
        text(cr, "softmax → 概率，全部加起来 = 1", 1250, 200, 30, GREEN, a0 * m, align="c")
        text(cr, "（只画出词表的一小部分）", 1250, 245, 22, MUTED, a0)
        # 温度滑块
        sa = v * c.p(2)
        if sa > 0:
            sx0, sx1, sy = 780, 1600, 760
            line(cr, sx0, sy, sx1, sy, DIM, sa, lw=6)
            tx = lerp(sx0, sx1, (T - 0.2) / 2.2)
            circle(cr, tx, sy, 16, ORANGE, sa)
            text(cr, f"温度 T = {T:.1f}", tx, sy - 44, 30, ORANGE, sa, mono=False)
            text(cr, "保守、确定", sx0, sy + 44, 26, MUTED, sa, align="l")
            text(cr, "发散、有创意", sx1, sy + 44, 26, MUTED, sa, align="r")
    # 自回归循环
    v4 = c.view(3)
    if v4 > 0:
        base = ["今天", "天气", "真", "好"]
        gen = ["，", "我们", "去", "公园", "吧"]
        T3 = c.B(3)
        nshow = int(clamp((t - T3 - 1.0) / 1.3, 0, len(gen)))
        toks = base + gen[:nshow]
        xs, ws = att_xs(cr, toks, 960, 44, 16)
        for k, s in enumerate(toks):
            colr = ORANGE if k >= len(base) else BLUE
            box(cr, xs[k] - ws[k] / 2, 250 - 34, ws[k], 68, fill=colr, stroke=colr, a=v4, r=10, fa=0.2)
            text(cr, s, xs[k], 250, 44, FG, v4)
        text(cr, "输入", 160, 250, 28, MUTED, v4, align="l")
        arrow(cr, 960, 300, 960, 400, MUTED, v4)
        g = cairo.LinearGradient(760, 400, 1160, 500)
        g.add_color_stop_rgba(0, *rgb(PURPLE), 0.9 * v4)
        g.add_color_stop_rgba(1, *rgb(BLUE), 0.9 * v4)
        rrect(cr, 760, 405, 400, 100, 20)
        cr.set_source(g)
        cr.fill()
        text(cr, "LLM", 960, 455, 48, "#ffffff", v4, bold=True)
        arrow(cr, 960, 510, 960, 600, MUTED, v4)
        if nshow < len(gen):
            ph = ((t - T3 - 1.0) % 1.3) / 1.3 if t > T3 + 1.0 else 0
            nxt = gen[nshow]
            oa = v4 * ease(ph * 3)
            y = 650 if ph < 0.6 else lerp(650, 250, ease((ph - 0.6) / 0.4))
            x = 960 if ph < 0.6 else lerp(960, xs[-1] + ws[-1] / 2 + 60, ease((ph - 0.6) / 0.4))
            chip(cr, nxt, x, y, 44, ORANGE, oa)
        pts = [(1060, 650), (1800, 650), (1800, 250), (xs[-1] + ws[-1] / 2 + 110, 250)]
        polyline(cr, pts, ORANGE, v4 * 0.6, lw=3, head=14, dash=[10, 8])
        text(cr, "接回输入，再预测下一个", 1780, 450, 28, ORANGE, v4, align="r")
        text(cr, "自回归生成 Autoregressive", 960, 760, 40, FG, v4 * c.p(3, 0.6, 3.0), bold=True)


def scene_train(c):
    cr, t = c.cr, c.t
    # 旋钮
    v0 = c.view(0, 1)
    if v0 > 0:
        rr = random.Random(5)
        for i in range(26):
            for j in range(10):
                x, y = 250 + i * 55, 230 + j * 55
                a = v0 * c.p(0, 0.3, 0.02 * (i + j))
                ang = rr.uniform(0, 6.28) + t * rr.uniform(-1, 1) * (1 if c.t > c.B(0) + 3 else 0)
                circle(cr, x, y, 18, BLUE, a * 0.5, fill=False, lw=2)
                line(cr, x, y, x + 14 * math.cos(ang), y + 14 * math.sin(ang), ORANGE, a, lw=3)
        text(cr, "数千亿个参数 ≈ 数千亿个可以调节的旋钮", 960, 820, 40, FG, v0 * c.p(0, 0.6, 1.0))
    # 数据
    v1 = c.view(1, 2)
    if v1 > 0:
        srcs = [("网页", "</>", BLUE), ("书籍", "▤", ORANGE), ("百科", "W", GREEN), ("代码", "{ }", PINK)]
        for k, (lab, ic, colr) in enumerate(srcs):
            a = v1 * c.p(1, 0.5, 0.6 + 0.5 * k)
            x = 330 + k * 250
            box(cr, x - 95, 230, 190, 220, fill=colr, stroke=colr, a=a, r=16, fa=0.12)
            text(cr, ic, x, 310, 60, colr, a, mono=True, bold=True)
            for q in range(3):
                line(cr, x - 60, 375 + q * 18, x + 60 - q * 25, 375 + q * 18, colr, a * 0.5, lw=4)
            text(cr, lab, x, 480, 32, FG, a)
        # token 流
        rr = random.Random(11)
        for q in range(60):
            ph = (t * 0.4 + rr.random()) % 1
            sx = 330 + rr.randrange(4) * 250
            x, y = lerp(sx, 1420, ph), lerp(520, 640, ph) + 30 * math.sin(ph * 6 + q)
            circle(cr, x, y, 5, PALETTE[q % 6], v1 * c.p(1, 0.6, 2.5) * math.sin(math.pi * ph))
        g = cairo.LinearGradient(1320, 560, 1640, 720)
        g.add_color_stop_rgba(0, *rgb(PURPLE), 0.9 * v1)
        g.add_color_stop_rgba(1, *rgb(BLUE), 0.9 * v1)
        rrect(cr, 1420, 580, 280, 120, 20)
        cr.set_source(g)
        cr.fill()
        text(cr, "模型", 1560, 640, 44, "#ffffff", v1, bold=True)
        cnt = 15e12 * ease(c.raw(1, 2.5) / 5)
        text(cr, f"{cnt / 1e12:5.1f} 万亿 token", 760, 720, 56, ORANGE, v1 * c.p(1, 0.6, 2.5), bold=True)
    # 训练循环
    v2 = c.view(2, 3)
    if v2 > 0:
        cx, cy, RX, RY = 960, 510, 460, 250
        nodes = [("① 预测下一个词", "模型：“玩”", BLUE), ("② 对照正确答案", "原文：“散步”", GREEN),
                 ("③ 计算损失", "错得有多离谱", PINK), ("④ 反向传播 + 梯度下降", "每个参数微调一点", ORANGE)]
        angs = [-90, 0, 90, 180]
        ring_a = v2 * c.p(2, 0.6, 0.2)
        cr.new_path()
        cr.save()
        cr.translate(cx, cy)
        cr.scale(RX, RY)
        cr.arc(0, 0, 1, 0, 2 * math.pi)
        cr.restore()
        col(cr, DIM, ring_a)
        cr.set_line_width(3)
        cr.stroke()
        ang = t * 1.6
        circle(cr, cx + RX * math.cos(ang), cy + RY * math.sin(ang), 12, ORANGE, v2 * c.p(2, 0.6, 5.5))
        for k, ((l1, l2, colr), ang) in enumerate(zip(nodes, angs)):
            a = v2 * c.p(2, 0.5, 0.2 + 1.3 * k)
            x, y = cx + RX * math.cos(math.radians(ang)), cy + RY * math.sin(math.radians(ang))
            w = max(tw(cr, l1, 32), tw(cr, l2, 26)) + 50
            box(cr, x - w / 2, y - 55, w, 110, fill=BG0, stroke=None, a=a, r=16, fa=1.0)
            box(cr, x - w / 2, y - 55, w, 110, fill=colr, stroke=colr, a=a, r=16, fa=0.15)
            text(cr, l1, x, y - 18, 32, FG, a)
            text(cr, l2, x, y + 24, 26, colr, a)
        ring_a = v2 * c.p(2, 0.6, 5.5)
        text(cr, "循环往复", cx, cy - 20, 40, FG, ring_a, bold=True)
        text(cr, "× 无数次", cx, cy + 30, 30, ORANGE, ring_a)
    # 损失曲线
    v3 = c.view(3, 4)
    if v3 > 0:
        X0, X1, Y0, Y1 = 330, 1560, 190, 790
        arrow(cr, X0, Y1, X1 + 20, Y1, MUTED, v3, lw=2, head=12)
        arrow(cr, X0, Y1, X0, Y0 - 20, MUTED, v3, lw=2, head=12)
        text(cr, "训练步数", X1, Y1 + 36, 26, MUTED, v3, align="r")
        text(cr, "损失", X0 - 20, Y0, 26, MUTED, v3, align="r")
        rr = np.random.RandomState(2)
        xs = np.linspace(0, 1, 200)
        ys = 0.12 + 0.85 * np.exp(-5 * xs) + rr.normal(0, 0.012, 200) * (1 - xs * 0.5)
        pts = [(lerp(X0, X1, x), lerp(Y1, Y0, y)) for x, y in zip(xs, ys)]
        prog = c.p(3, 5.0, 0.3)
        polyline(cr, pts, ORANGE, v3, lw=4, prog=prog)
        marks = [(0.04, "拼写、常用字词"), (0.16, "语法"), (0.36, "事实知识"), (0.62, "逻辑"), (0.9, "一定的推理能力")]
        for k, (mx, lab) in enumerate(marks):
            if prog < mx:
                continue
            i = int(mx * 199)
            px, py = pts[i]
            la = v3 * ease((prog - mx) * 8)
            circle(cr, px, py, 8, GREEN, la)
            text(cr, lab, px + 16, py - 34, 30, GREEN, la, align="l")
    # 规模定律
    v4 = c.view(4)
    if v4 > 0:
        X0, X1, Y0, Y1 = 330, 1560, 190, 790
        arrow(cr, X0, Y1, X1 + 20, Y1, MUTED, v4, lw=2, head=12)
        arrow(cr, X0, Y1, X0, Y0 - 20, MUTED, v4, lw=2, head=12)
        text(cr, "算力（对数刻度）", X1, Y1 + 36, 26, MUTED, v4, align="r")
        text(cr, "损失（对数）", X0 - 20, Y0 - 10, 26, MUTED, v4, align="r")
        # 每条曲线 = 前沿直线上的切点 + 向左上翘起的部分 + 右侧逐渐饱和的平台
        front = lambda x: 0.86 - 0.62 * x
        models = [("1 亿参数", 0.22, BLUE), ("100 亿参数", 0.5, PURPLE), ("1 万亿参数", 0.8, PINK)]
        for k, (lab, xk, colr) in enumerate(models):
            xs = np.linspace(max(0.02, xk - 0.2), min(1.0, xk + 0.3), 90)
            yk = front(xk)
            tau = 0.12
            ys = np.where(xs <= xk, front(xs) + 4 * (xk - xs) ** 2,
                          yk - 0.62 * tau * (1 - np.exp(-(xs - xk) / tau)))
            pts = [(lerp(X0, X1, x), lerp(Y1, Y0, y)) for x, y in zip(xs, ys)]
            a = v4 * c.p(4, 0.5, 0.8 * k)
            polyline(cr, pts, colr, a, lw=4, prog=c.p(4, 1.2, 0.8 * k))
            text(cr, lab, pts[0][0] + 10, pts[0][1] - 26, 26, colr, a * c.p(4, 0.5, 0.8 * k + 0.6), align="l")
        ea = v4 * c.p(4, 0.8, 3.0)
        polyline(cr, [(lerp(X0, X1, 0.02), lerp(Y1, Y0, front(0.02))), (lerp(X0, X1, 1.0), lerp(Y1, Y0, front(1.0)))],
                 ORANGE, ea, lw=3, dash=[12, 10], prog=c.p(4, 1.0, 3.0))
        text(cr, "规模定律：沿着一条平滑下降的直线", 1500, 250, 34, ORANGE, ea, align="r", bold=True)
        text(cr, "更大的模型 + 更多数据 + 更多算力 → 更低的损失", 1500, 300, 26, MUTED, ea, align="r")


def bubble(cr, s, x, y, maxw, colr, a, align="l", size=32, n=None):
    lines = wrap(cr, s, size, maxw - 50)
    if n is not None:
        out, left = [], n
        for ln in lines:
            out.append(ln[:max(0, left)])
            left -= len(ln)
        lines = out
    w = max([tw(cr, ln, size) for ln in wrap(cr, s, size, maxw - 50)] + [40]) + 50
    h = len(lines) * (size + 14) + 36
    bx = x if align == "l" else x - w
    box(cr, bx, y, w, h, fill=colr, stroke=colr, a=a, r=18, fa=0.18)
    for k, ln in enumerate(lines):
        text(cr, ln, bx + 25, y + 18 + (size + 14) * k + size / 2 + 4, size, FG, a, align="l")
    return h


def scene_align(c):
    cr, t = c.cr, c.t
    stages = [("预训练", "Base Model", MUTED), ("监督微调", "SFT", GREEN), ("人类反馈强化学习", "RLHF", ORANGE)]
    cur = 0 if c.t < c.B(1) else 1 if c.t < c.B(2) else 2
    xs = [420, 960, 1500]
    for k, (a_, b_, colr) in enumerate(stages):
        a = c.view(0) * (1 if k <= cur else 0.3)
        on = k == cur
        box(cr, xs[k] - 210, 150, 420, 100, fill=colr, stroke=colr, a=a, r=18, fa=0.25 if on else 0.08,
            lw=3 if on else 1.5)
        text(cr, a_, xs[k], 185, 34, FG, a, bold=on)
        text(cr, b_, xs[k], 225, 24, colr, a, mono=True)
        if k < 2:
            arrow(cr, xs[k] + 220, 200, xs[k + 1] - 220, 200, MUTED, c.view(0), lw=2, head=10)
    # 续写器
    v0 = c.view(0, 1)
    if v0 > 0:
        text(cr, "用户", 330, 350, 26, MUTED, v0, align="r")
        bubble(cr, "法国的首都是哪里？", 360, 320, 800, BLUE, v0)
        text(cr, "模型", 330, 480, 26, MUTED, v0 * c.p(0, 0.5, 1.5), align="r")
        s = "德国的首都是哪里？意大利的首都是哪里？西班牙的首都是哪里？……"
        n = int(len(s) * clamp(c.raw(0, 1.8) / 4.0))
        bubble(cr, s, 360, 450, 1200, MUTED, v0 * c.p(0, 0.5, 1.5), n=n)
        text(cr, "只会“接着写”，不会“回答”", 960, 700, 40, PINK, v0 * c.p(0, 0.6, 5.5), bold=True)
    # SFT
    v1 = c.view(1, 2)
    if v1 > 0:
        a = v1 * c.p(1, 0.6, 0.5)
        box(cr, 200, 310, 700, 330, fill=GREEN, stroke=GREEN, a=a, r=18, fa=0.06)
        text(cr, "人工撰写的示范问答（数万条）", 550, 350, 28, GREEN, a)
        text(cr, "问：法国的首都是哪里？", 240, 420, 32, FG, a, align="l")
        text(cr, "答：法国的首都是巴黎。", 240, 475, 32, GREEN, a, align="l")
        text(cr, "问：帮我写一首关于秋天的诗", 240, 545, 32, FG, a * 0.6, align="l")
        text(cr, "答：……", 240, 595, 32, GREEN, a * 0.6, align="l")
        arrow(cr, 920, 475, 1030, 475, MUTED, v1 * c.p(1, 0.5, 2.0))
        b = v1 * c.p(1, 0.5, 2.6)
        text(cr, "用户", 1060, 350, 26, MUTED, b, align="l")
        bubble(cr, "法国的首都是哪里？", 1060, 375, 700, BLUE, b)
        text(cr, "模型", 1060, 510, 26, MUTED, b * c.p(1, 0.5, 3.2), align="l")
        bubble(cr, "法国的首都是巴黎。", 1060, 535, 700, GREEN, b * c.p(1, 0.5, 3.2))
    # RLHF
    v2 = c.view(2)
    if v2 > 0:
        a = v2 * c.p(2, 0.6, 0.3)
        bubble(cr, "A：法国的首都是巴黎，也是法国最大的城市。", 160, 320, 820, BLUE, a, size=30)
        bubble(cr, "B：应该是里昂吧。", 160, 460, 820, BLUE, a, size=30)
        ra = v2 * c.p(2, 0.5, 2.5)
        chip(cr, "√ 更好", 1070, 356, 30, GREEN, ra)
        chip(cr, "× 更差", 1070, 492, 30, PINK, ra)
        text(cr, "人类标注员排序", 1070, 290, 26, MUTED, ra)
        arrow(cr, 1180, 424, 1290, 424, MUTED, v2 * c.p(2, 0.5, 3.5))
        box(cr, 1300, 370, 240, 110, fill=PURPLE, stroke=PURPLE, a=v2 * c.p(2, 0.5, 3.8), r=16, fa=0.25)
        text(cr, "奖励模型", 1420, 425, 34, FG, v2 * c.p(2, 0.5, 3.8))
        arrow(cr, 1550, 424, 1640, 424, MUTED, v2 * c.p(2, 0.5, 4.6))
        box(cr, 1650, 370, 200, 110, fill=ORANGE, stroke=ORANGE, a=v2 * c.p(2, 0.5, 4.9), r=16, fa=0.25)
        text(cr, "更新模型", 1750, 425, 34, FG, v2 * c.p(2, 0.5, 4.9))
        pts = bez((1750, 485), (1750, 640), (1200, 660), (1000, 560))
        polyline(cr, pts, ORANGE, v2 * 0.6 * c.p(2, 0.5, 5.4), lw=3, dash=[10, 8], head=12, prog=c.p(2, 1, 5.4))
        for k, (lab, colr) in enumerate([("更有帮助", GREEN), ("更诚实", BLUE), ("更安全", ORANGE)]):
            chip(cr, lab, 660 + k * 300, 760, 38, colr, v2 * c.p(2, 0.5, 7.0 + 0.6 * k))


def warn_icon(cr, x, y, s, colr, a):
    cr.move_to(x, y - s)
    cr.line_to(x + s * 1.1, y + s * 0.8)
    cr.line_to(x - s * 1.1, y + s * 0.8)
    cr.close_path()
    col(cr, colr, a)
    cr.fill()
    text(cr, "!", x, y + s * 0.15, s * 1.1, BG0, a, bold=True)


def scene_summary(c):
    cr, t = c.cr, c.t
    v = c.view(0, 2)
    steps = [("文本", MUTED), ("Token", BLUE), ("向量", CYAN), ("Transformer × N", PURPLE),
             ("概率分布", GREEN), ("下一个词", ORANGE)]
    ws = [tw(cr, s, 34) + 50 for s, _ in steps]
    total = sum(ws) + 60 * (len(steps) - 1)
    x = 960 - total / 2
    cen = []
    d0 = c.durs[0] if c.durs else 10
    for k, ((s, colr), w) in enumerate(zip(steps, ws)):
        a = v * c.p(0, 0.5, d0 * 0.8 * k / len(steps))
        box(cr, x, 330, w, 90, fill=colr, stroke=colr, a=a, r=16, fa=0.2)
        text(cr, s, x + w / 2, 375, 34, FG, a)
        if k == 3:
            text(cr, "注意力 + 前馈网络", x + w / 2, 455, 24, PURPLE, a)
        if k < len(steps) - 1:
            arrow(cr, x + w + 8, 375, x + w + 52, 375, MUTED, a, lw=2, head=10)
        cen.append(x + w / 2)
        x += w + 60
    la = v * c.p(0, 0.8, d0 * 0.85)
    pts = [(cen[-1], 422), (cen[-1], 520), (cen[0], 520), (cen[0], 425)]
    polyline(cr, pts, ORANGE, la * 0.8, lw=3, head=14, dash=[10, 8], prog=la)
    text(cr, "一个接一个，循环生成", 960, 550, 28, ORANGE, la)
    wa = v * c.p(1, 0.6, 1.0)
    if wa > 0:
        box(cr, 460, 640, 1000, 170, fill=ORANGE, stroke=ORANGE, a=wa, r=20, fa=0.1)
        warn_icon(cr, 560, 725, 38, ORANGE, wa)
        text(cr, "“看起来合理”  ≠  “真实”", 1010, 700, 44, FG, wa, bold=True)
        text(cr, "这就是“幻觉”的来源：流畅地编造", 1010, 765, 30, ORANGE, wa)
    fa = c.p(2, 1.0)
    if fa > 0:
        glow(cr, 960, 470, 520, PURPLE, fa * 0.7)
        text(cr, "预测下一个词", 960, 430, 110, FG, fa, bold=True)
        text(cr, "Next-Token Prediction", 960, 540, 40, MUTED, fa, mono=True)
        text(cr, "感谢观看", 960, 690, 52, ORANGE, c.p(2, 0.8, 3.5))


DRAW = dict(intro=scene_intro, predict=scene_predict, token=scene_token, embed=scene_embed,
            attention=scene_attention, transformer=scene_transformer, sample=scene_sample,
            train=scene_train, align=scene_align, summary=scene_summary)


# ───────────────────────── 时间轴与合成 ─────────────────────────

def build_timeline(audio_dir):
    table = json.load(open(os.path.join(audio_dir, "durations.json")))
    scenes, t0 = [], 0.0
    for si, sc in enumerate(SCENES):
        rows = [r for r in table if r["scene"] == si]
        beats, durs, cur = [], [], HEAD
        for r in rows:
            beats.append(cur)
            durs.append(r["dur"])
            cur += r["dur"] + GAP
        dur = cur - GAP + TAIL
        scenes.append(dict(idx=si, key=sc["key"], title=sc["title"], lines=sc["lines"], start=t0, dur=dur,
                           beats=beats, durs=durs, audio=[r["path"] for r in rows]))
        t0 += dur
    return scenes, t0


def build_audio(scenes, total, out):
    sr = sf.info(scenes[0]["audio"][0]).samplerate
    buf = np.zeros(int((total + 0.5) * sr), dtype=np.float32)
    for sc in scenes:
        for b, p in zip(sc["beats"], sc["audio"]):
            x, _ = sf.read(p, dtype="float32")
            i = int((sc["start"] + b) * sr)
            buf[i:i + len(x)] += x[: len(buf) - i]
    peak = np.abs(buf).max()
    if peak > 0:
        buf = buf / peak * 0.89
    sf.write(out, buf, sr)


def draw_frame(cr, sc, t, total, gt):
    g = cairo.LinearGradient(0, 0, W, H)
    g.add_color_stop_rgb(0, *rgb(BG0))
    g.add_color_stop_rgb(1, *rgb(BG1))
    cr.set_source(g)
    cr.paint()
    ctx = Ctx(cr, t, sc["beats"], sc["durs"], sc["dur"])
    DRAW[sc["key"]](ctx)
    # 场景切换淡入淡出
    fade = max(1 - ease(t / 0.35), ease((t - (sc["dur"] - 0.3)) / 0.3))
    if fade > 0:
        col(cr, BG0, fade)
        cr.paint()
    # 顶部标题
    if sc["title"]:
        text(cr, sc["title"], 60, 60, 30, MUTED, 1, align="l")
        line(cr, 60, 90, 60 + tw(cr, sc["title"], 30), 90, PURPLE, 0.8, lw=3)
    # 字幕
    cur = None
    for i, b in enumerate(sc["beats"]):
        if b - 0.1 <= t < b + sc["durs"][i] + GAP * 0.8:
            cur = i
    if cur is not None:
        s = SUBTITLE_OVERRIDES.get(sc["lines"][cur], sc["lines"][cur])
        lines = wrap(cr, s, 36, 1640)
        hh = len(lines) * 50 + 30
        y0 = 1042 - hh
        rrect(cr, 960 - 870, y0, 1740, hh, 14)
        col(cr, "#05080f", 0.62)
        cr.fill()
        for k, ln in enumerate(lines):
            text(cr, ln, 960, y0 + 15 + 25 + 50 * k, 36, "#ffffff", 1)
    # 进度条
    col(cr, DIM, 0.6)
    cr.rectangle(0, H - 6, W, 6)
    cr.fill()
    col(cr, PURPLE, 0.9)
    cr.rectangle(0, H - 6, W * gt / total, 6)
    cr.fill()


FFMPEG = None


def ffmpeg_bin():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def render_scene(args):
    sc, total, out = args
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    cr = cairo.Context(surf)
    n = int(round(sc["dur"] * FPS))
    p = subprocess.Popen([ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra",
                          "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium",
                          "-crf", "22", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    start_f = int(round(sc["start"] * FPS))
    for f in range(n):
        t = f / FPS
        draw_frame(cr, sc, t, total, (start_f + f) / FPS)
        surf.flush()
        p.stdin.write(surf.get_data())
    p.stdin.close()
    p.wait()
    return out


def main():
    audio_dir, out = sys.argv[1], sys.argv[2]
    scenes, total = build_timeline(audio_dir)
    # 用整帧数重新对齐场景起点，保证画面与声音不漂移
    t = 0.0
    for sc in scenes:
        sc["dur"] = round(sc["dur"] * FPS) / FPS
        sc["start"] = t
        t += sc["dur"]
    total = t
    if len(sys.argv) > 3 and sys.argv[3] == "--preview":
        for spec in sys.argv[4:]:
            si, ts = spec.split(":")
            sc = scenes[int(si)]
            surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
            cr = cairo.Context(surf)
            tt = float(ts)
            if tt < 0:  # 负数表示“第 k 句开始后 1.5 秒”
                tt = sc["beats"][int(-tt) - 1] + 1.5
            draw_frame(cr, sc, tt, total, sc["start"] + tt)
            surf.write_to_png(f"{out}_s{si}_{ts}.png")
        return
    work = out + ".parts"
    os.makedirs(work, exist_ok=True)
    wav = os.path.join(work, "narration.wav")
    build_audio(scenes, total, wav)
    jobs = [(sc, total, os.path.join(work, f"scene{sc['idx']:02d}.mp4")) for sc in scenes]
    jobs.sort(key=lambda j: -j[0]["dur"])
    with Pool(min(4, os.cpu_count() or 1)) as pool:
        for o in pool.imap_unordered(render_scene, jobs):
            print("rendered", o, flush=True)
    lst = os.path.join(work, "list.txt")
    with open(lst, "w") as f:
        for sc in scenes:
            f.write(f"file 'scene{sc['idx']:02d}.mp4'\n")
    subprocess.check_call([ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                           "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
                           "-movflags", "+faststart", out])
    print(f"done: {out}  ({total:.1f}s)")


if __name__ == "__main__":
    main()
