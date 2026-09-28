# -*- coding: utf-8 -*-
"""离线合成旁白（sherpa-onnx + Kokoro v1.1 中文模型），输出每句 wav 与时长表。

用法: python3 tts_build.py <kokoro 模型目录> <输出目录> [speaker_id]
模型下载: https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2
"""
import hashlib
import json
import os
import sys

import numpy as np
import sherpa_onnx
import soundfile as sf

from script import SCENES


def make_tts(d):
    j = lambda f: os.path.join(d, f)
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=j("model.onnx"), voices=j("voices.bin"), tokens=j("tokens.txt"),
                data_dir=j("espeak-ng-data"), dict_dir=j("dict"),
                lexicon=j("lexicon-us-en.txt") + "," + j("lexicon-zh.txt")),
            num_threads=4),
        rule_fsts=",".join(j(f) for f in ("date-zh.fst", "phone-zh.fst", "number-zh.fst")),
        max_num_sentences=1)
    return sherpa_onnx.OfflineTts(cfg)


def trim(x, sr, thr=0.01):
    """去掉首尾静音，留 60ms 余量。"""
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    pad = int(0.06 * sr)
    return x[max(0, idx[0] - pad): idx[-1] + pad]


def main():
    model_dir, out_dir = sys.argv[1], sys.argv[2]
    sid = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    speed = 1.05
    os.makedirs(out_dir, exist_ok=True)
    tts = make_tts(model_dir)
    table = []
    for si, sc in enumerate(SCENES):
        for li, line in enumerate(sc["lines"]):
            h = hashlib.md5(f"{sid}|{speed}|{line}".encode()).hexdigest()[:12]
            path = os.path.join(out_dir, f"{si:02d}_{li:02d}_{h}.wav")
            if not os.path.exists(path):
                a = tts.generate(line, sid=sid, speed=speed)
                x = trim(np.array(a.samples, dtype=np.float32), a.sample_rate)
                sf.write(path, x, a.sample_rate)
            info = sf.info(path)
            table.append(dict(scene=si, line=li, path=path, dur=info.frames / info.samplerate,
                              sr=info.samplerate))
            print(f"{si}.{li} {table[-1]['dur']:.2f}s {line[:24]}", flush=True)
    with open(os.path.join(out_dir, "durations.json"), "w") as f:
        json.dump(table, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
