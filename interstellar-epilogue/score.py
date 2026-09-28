"""Original score and sound design, synthesised from scratch.

Pipe organ (additive ranks) in a cathedral-sized reverb, a clock that ticks every 1.25 s,
NASA-style Quindar tones around radio lines, and noise-based rumble / wind / thrusters.

usage: python score.py  -> build/score.wav
"""
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

from timeline import DURATION, SUBS, TICK

SR = 48000
N = int(DURATION * SR)
rng = np.random.default_rng(1968)
HERE = os.path.dirname(os.path.abspath(__file__))


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}


def nm(name):
    """'A2' -> midi number."""
    return NOTE[name[:-1]] + 12 * (int(name[-1]) + 1)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def lp(x, hi, order=2):
    return sosfilt(butter(order, hi, btype="low", fs=SR, output="sos"), x)


def hp(x, lo, order=2):
    return sosfilt(butter(order, lo, btype="high", fs=SR, output="sos"), x)


class Bus:
    def __init__(self):
        self.L = np.zeros(N + SR * 8)
        self.R = np.zeros(N + SR * 8)

    def add(self, t0, sig, pan=0.0, gain=1.0):
        i = int(t0 * SR)
        if i < 0:
            sig = sig[-i:]
            i = 0
        n = min(len(sig), len(self.L) - i)
        if n <= 0:
            return
        gl = gain * np.cos((pan + 1) * np.pi / 4)
        gr = gain * np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + n] += sig[:n] * gl
        self.R[i:i + n] += sig[:n] * gr


def envelope(n, attack, release, hold_n):
    env = np.ones(n)
    a = max(int(attack * SR), 1)
    env[:a] = (1 - np.cos(np.linspace(0, np.pi, a))) / 2
    r0 = min(hold_n, n)
    rel = np.exp(-np.arange(n - r0) / (release * SR / 4.6))
    env[r0:] *= rel
    return env


RANKS_SOFT = ((1.0, 1.0), (2.0, 0.35))
RANKS_MID = ((0.5, 0.45), (1.0, 1.0), (2.0, 0.5), (4.0, 0.12))
RANKS_FULL = ((0.5, 0.8), (1.0, 1.0), (2.0, 0.7), (3.0, 0.3), (4.0, 0.35), (6.0, 0.12), (8.0, 0.1))


def organ(m, dur, ranks=RANKS_MID, attack=0.6, release=2.0, bright=0.0):
    f0 = midi(m)
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for mult, ra in ranks:
        f = f0 * mult * (1 + rng.normal(0, 0.0006))
        for h in range(1, 12):
            if f * h > 9000:
                break
            a = ra / h ** (1.9 - bright)
            s += a * np.sin(2 * np.pi * f * h * t + rng.random() * 6.28)
    # wind noise in the pipes
    s += bp(rng.normal(0, 1, n), min(f0 * 2, 6000), min(f0 * 6, 12000), 1) * 0.004
    return s * envelope(n, attack, release, int(dur * SR)) / 3.0


def pluck(m, dur=4.0):
    """Soft felt-piano-like tone."""
    f0 = midi(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for h in range(1, 9):
        fh = f0 * h * np.sqrt(1 + 0.0004 * h * h)
        s += np.sin(2 * np.pi * fh * t) * np.exp(-t * (0.9 + 0.8 * h)) / h ** 1.2
    att = np.minimum(t / 0.006, 1)
    return s * att * 0.5


def tick():
    n = int(0.06 * SR)
    x = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.004 * SR))
    x = bp(x, 1600, 4200, 2) * 3 + bp(x, 400, 900, 1)
    return x


def chord(bus, t0, dur, notes, gain, ranks=RANKS_MID, attack=0.8, release=2.5, bright=0.0, spread=0.5):
    for k, name in enumerate(notes):
        pan = spread * (2 * k / max(len(notes) - 1, 1) - 1)
        bus.add(t0, organ(nm(name), dur, ranks, attack, release, bright), pan, gain)


def noise_bed(t0, t1, lo, hi, env_fn, seed=0, order=2):
    n = int((t1 - t0) * SR)
    x = np.random.default_rng(seed).normal(0, 1, n)
    x = bp(x, lo, hi, order)
    tt = np.linspace(0, 1, n)
    return x * env_fn(tt)


def main():
    music = Bus()      # organ, piano, clock -> big reverb
    sfx = Bus()        # rumble, wind, radio -> small room / dry

    # --- 0-7  pedal and first ticks ------------------------------------------
    chord(music, 0.4, 6.6, ["A1", "A2"], 0.55, RANKS_SOFT, attack=4.0, release=3.0)
    chord(music, 3.0, 4.0, ["E3"], 0.25, RANKS_SOFT, attack=2.5, release=3.0)

    # --- 7-24  Saturn: Am  F  C  G/B, with an ostinato -----------------------
    prog = [["A2", "E3", "A3", "C4", "E4"], ["F2", "C3", "A3", "C4", "F4"],
            ["C3", "G3", "C4", "E4", "G4"], ["B1", "G3", "B3", "D4", "G4"]]
    for i, ch in enumerate(prog):
        chord(music, 7.0 + i * 4.25, 4.6, ch, 0.36, RANKS_MID, attack=1.2, release=2.5)
    ost = [["E5", "A5"], ["F5", "A5"], ["E5", "G5"], ["D5", "G5"]]
    step = TICK / 4
    t = 11.25
    while t < 24.0:
        idx = min(int((t - 7.0) / 4.25), 3)
        k = int(round((t - 11.25) / step))
        note = ost[idx][k % 2]
        g = 0.13 * min(1, (t - 11.25) / 3)
        music.add(t, organ(nm(note), step * 0.9, RANKS_SOFT, 0.02, 0.35, bright=0.4), 0.3 * (1 if k % 2 else -1), g)
        t += step

    # --- 24-30.5  tension into the wormhole ----------------------------------
    chord(music, 24.0, 2.3, ["A2", "E3", "A3", "C4", "E4", "A4"], 0.42, RANKS_FULL, attack=0.4, release=0.5)
    chord(music, 26.2, 2.3, ["D2", "F3", "A3", "D4", "F4", "A4"], 0.48, RANKS_FULL, attack=0.3, release=0.5)
    chord(music, 28.4, 2.3, ["E2", "E3", "G#3", "B3", "E4", "G#4", "B4"], 0.58, RANKS_FULL, attack=0.3, release=0.5, bright=0.3)
    t = 24.0
    while t < 30.4:
        g = 0.12 + 0.12 * (t - 24.0) / 6.4
        idx = 0 if t < 26.2 else (1 if t < 28.4 else 2)
        pair = [["A5", "E5"], ["A5", "F5"], ["B5", "G#5"]][idx]
        k = int(round((t - 24.0) / (TICK / 4)))
        music.add(t, organ(nm(pair[k % 2]), TICK / 4 * 0.9, RANKS_SOFT, 0.01, 0.2, bright=0.5), 0.3 * (1 if k % 2 else -1), g)
        t += TICK / 4
    rumble = noise_bed(23.5, 30.5, 25, 180, lambda x: (x ** 2) * 1.0, 3, 2)
    rumble += np.sin(2 * np.pi * 33 * np.arange(len(rumble)) / SR) * np.linspace(0, 1, len(rumble)) ** 2 * 0.5
    sfx.add(23.5, rumble, 0, 0.9)
    sfx.add(24.6, noise_bed(24.6, 30.5, 900, 6000, lambda x: x ** 3 * 0.35, 4), 0, 0.5)

    # --- 31.5-52  Gargantua: silence, then the organ opens up ----------------
    chord(music, 33.0, 5.0, ["A0", "A1"], 0.55, RANKS_MID, attack=3.5, release=2.0)
    big = [(35.0, ["A1", "A2", "E3", "A3", "C4", "E4", "A4"], 0.34),
           (39.25, ["F1", "F2", "C3", "A3", "C4", "F4", "A4"], 0.40),
           (43.5, ["E1", "E2", "C3", "G3", "C4", "E4", "G4", "C5"], 0.46),
           (47.75, ["G1", "G2", "D3", "G3", "B3", "D4", "G4", "B4", "D5"], 0.50)]
    for (t0, ch, g) in big:
        chord(music, t0, 4.6, ch, g, RANKS_FULL, attack=1.5, release=3.5, bright=0.25, spread=0.8)
    chord(music, 52.0, 3.5, ["A1", "A2", "E3", "A3", "C4", "E4"], 0.30, RANKS_MID, attack=0.5, release=4.0)
    for k in range(int(36.0 / TICK), int(52.0 / TICK)):
        music.add(k * TICK, tick(), 0.1, 0.12)

    # --- 52-68  Edmunds' planet --------------------------------------------------
    calm = [(55.5, ["F2", "C3", "A3", "C4", "F4"]), (59.5, ["A2", "E3", "A3", "C4", "E4"]),
            (63.5, ["F2", "A3", "C4", "F4"]), (65.75, ["E2", "B3", "E4", "G#4"])]
    for (t0, ch) in calm:
        chord(music, t0, 4.2 if t0 < 63 else 2.4, ch, 0.24, RANKS_MID, attack=1.5, release=3.0)
    for k in range(int(52.0 / TICK) + 1, int(68.0 / TICK)):
        music.add(k * TICK, tick(), -0.1, 0.18)
    sfx.add(61.5, noise_bed(61.5, 68.3, 30, 400,
                            lambda x: np.sin(np.pi * np.clip(x * 1.1, 0, 1)) ** 2, 5, 2), 0, 0.7)

    # --- 68-91  the surface at dusk --------------------------------------------
    wind = noise_bed(67.5, 105.5, 150, 1400, lambda x: 0.25 + 0.2 * np.sin(x * 23) ** 2, 6, 1)
    sfx.add(67.5, wind * np.minimum(np.arange(len(wind)) / (1.5 * SR), 1), -0.3, 0.16)
    wind2 = noise_bed(67.5, 105.5, 300, 2600, lambda x: 0.2 + 0.2 * np.sin(x * 17 + 1) ** 2, 7, 1)
    sfx.add(67.5, wind2 * np.minimum(np.arange(len(wind2)) / (1.5 * SR), 1), 0.4, 0.10)
    pad = [(68.0, ["A2", "E3", "C4"]), (73.75, ["F2", "C3", "A3"]), (79.5, ["C3", "G3", "E4"]),
           (85.25, ["G2", "D3", "B3"])]
    for (t0, ch) in pad:
        chord(music, t0, 6.0, ch, 0.24, RANKS_SOFT, attack=2.0, release=3.0)
    motif = ["A4", "C5", "E5", "D5", "C5", "E5", "A4", "G4"]
    for k, n in enumerate(motif):
        music.add(69.0 + k * TICK, pluck(nm(n)), 0.2 * (k % 3 - 1), 0.22)
    engine = noise_bed(72.0, 86.5, 40, 900,
                       lambda x: np.clip((x - 0.05) * 1.4, 0, 1) ** 2 * (1 - np.clip((x - 0.88) * 8.3, 0, 1)), 8, 2)
    sfx.add(72.0, engine, -0.4, 1.1)
    hiss = noise_bed(79.0, 86.5, 1500, 7000,
                     lambda x: np.clip(x * 3, 0, 1) * (1 - np.clip((x - 0.8) * 5, 0, 1)), 9, 2)
    sfx.add(79.0, hiss, -0.3, 0.25)
    # engine cut-off and settling
    sfx.add(85.3, noise_bed(85.3, 87.5, 40, 300, lambda x: np.exp(-x * 5), 10) , -0.3, 0.6)
    # "welcome home"
    chord(music, 87.0, 4.3, ["F2", "C3", "A3", "C4", "F4"], 0.22, RANKS_MID, attack=1.8, release=3.0)
    for k, n in enumerate(["C5", "A4", "F4"]):
        music.add(87.3 + k * TICK, pluck(nm(n), 5.0), 0.0, 0.14)

    # --- 91-105  night, resolution to C major -----------------------------------
    chord(music, 91.0, 4.2, ["F2", "C3", "F3", "A3", "C4", "F4"], 0.26, RANKS_MID, attack=2.0, release=3.0)
    chord(music, 95.0, 3.8, ["G2", "D3", "G3", "B3", "D4", "G4"], 0.30, RANKS_MID, attack=1.5, release=3.0)
    chord(music, 98.6, 10.5, ["C2", "C3", "G3", "C4", "E4", "G4", "D5"], 0.32, RANKS_FULL, attack=2.5, release=6.0,
          bright=0.1, spread=0.8)
    for k, n in enumerate(["E5", "G5", "C6", "B5", "G5", "E5", "D5", "C5"]):
        music.add(92.0 + k * TICK, pluck(nm(n), 5.0), 0.25 * (k % 3 - 1), 0.10)
    for k in range(int(91.0 / TICK) + 1, int(105.0 / TICK)):
        music.add(k * TICK, tick(), 0.1, 0.07)
    music.add(109.0, tick(), 0.0, 0.14)

    # --- radio: Quindar tones and a hiss bed under transmissions -----------------
    for (a, b, who, line, radio) in SUBS:
        if not radio:
            continue
        for (t0, f) in ((a - 0.30, 2525.0), (b - 0.05, 2475.0)):
            n = int(0.25 * SR)
            tt = np.arange(n) / SR
            beep = np.sin(2 * np.pi * f * tt) * np.minimum(1, np.minimum(tt, 0.25 - tt) / 0.005)
            sfx.add(t0, beep, 0.0, 0.035)
        st = noise_bed(a - 0.05, b, 800, 5000, lambda x: 0.6 + 0.4 * np.sin(x * 40) ** 2, int(a * 10), 2)
        sfx.add(a - 0.05, st, 0.0, 0.012)

    # --- mix ----------------------------------------------------------------------
    tl = np.arange(int(5.5 * SR)) / SR
    irn = rng.normal(0, 1, (2, len(tl)))
    dark = np.stack([lp(irn[0], 2200), lp(irn[1], 2200)])
    ir = (dark * np.exp(-6.9 * tl / 5.2) + irn * np.exp(-6.9 * tl / 1.2) * 0.35)
    ir[:, :int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt((ir ** 2).sum(1, keepdims=True))
    wetL = fftconvolve(music.L, ir[0])[:len(music.L)]
    wetR = fftconvolve(music.R, ir[1])[:len(music.R)]
    small = ir[:, :int(1.0 * SR)] * np.exp(-6.9 * tl[:int(1.0 * SR)] / 0.5)
    sfxL = sfx.L + 0.3 * fftconvolve(sfx.L, small[0])[:len(sfx.L)]
    sfxR = sfx.R + 0.3 * fftconvolve(sfx.R, small[1])[:len(sfx.R)]
    L = music.L * 0.45 + wetL * 0.9 + sfxL
    R = music.R * 0.45 + wetR * 0.9 + sfxR
    L, R = L[:N], R[:N]
    # hard cut to silence as we exit the wormhole (30.5-31.6 s)
    gate = np.ones(N)
    a, b = int(30.5 * SR), int(31.6 * SR)
    fade = int(0.015 * SR)
    gate[a:b] = 0
    gate[a - fade:a] = np.linspace(1, 0, fade)
    gate[b:b + int(0.2 * SR)] = np.linspace(0, 1, int(0.2 * SR))
    L *= gate
    R *= gate
    # gentle fade in / out
    fi, fo = int(0.3 * SR), int(3.0 * SR)
    for ch in (L, R):
        ch[:fi] *= np.linspace(0, 1, fi)
        ch[-fo:] *= np.linspace(1, 0, fo) ** 2
    mix = np.stack([L, R], 1)
    mix = hp(mix.T, 22).T
    peak = np.abs(mix).max()
    mix = np.tanh(mix / peak * 1.4) / np.tanh(1.4) * 0.89
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    out = os.path.join(HERE, "build", "score.wav")
    wavfile.write(out, SR, (mix * 32767).astype(np.int16))
    print("wrote", out)


if __name__ == "__main__":
    main()
