# 大语言模型的底层原理 · 讲解视频

`llm_explained.mp4`：约 6 分钟，1080p，中文配音 + 中文字幕。

## 内容结构

| 章节 | 主题 | 画面 |
|---|---|---|
| 开场 | LLM 的本质 = 预测下一个词 | 标题、章节路线图 |
| 01 | 核心任务 | “今天天气真好，我们一起去公园___” → 概率条 → 逐词接龙 |
| 02 | 分词 Tokenization | 中英文句子切成 token → 编号 → 词表 → 整数序列 |
| 03 | 词嵌入 Embedding | 编号无意义 → 向量色块 → 语义空间（国王 − 男人 + 女人 ≈ 女王）→ 位置编码 |
| 04 | 注意力机制 | “小猫没有吃鱼，因为它太饱了”：Q/K/V、softmax 权重、加权融合 |
| 05 | Transformer 结构 | 多头注意力、前馈网络、残差 + 归一化、多层堆叠 |
| 06 | 输出与采样 | logits → softmax → 温度滑块 → 自回归循环 |
| 07 | 训练 | 参数旋钮、海量语料、损失 → 反向传播循环、损失曲线、规模定律 |
| 08 | 对齐 | 预训练续写器 → 监督微调 SFT → 人类反馈强化学习 RLHF |
| 09 | 总结 | 全流程回顾、“幻觉”的来源 |

旁白全文见 `script.py`。

## 重新生成

全部离线完成，无需任何在线 API。

```bash
pip install sherpa-onnx soundfile numpy pycairo imageio-ffmpeg

# 1. 下载离线中文语音模型（Kokoro v1.1-zh，约 360 MB）
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2
tar xjf kokoro-multi-lang-v1_1.tar.bz2

# 2. 合成旁白（每句一个 wav + durations.json）
python3 tts_build.py kokoro-multi-lang-v1_1 audio 60     # 60 = 男声，可换其他 speaker id

# 3. 渲染视频（pycairo 逐帧绘制，按场景并行编码，再与旁白合成）
python3 render.py audio llm_explained.mp4

# 只看某几帧：场景号:秒数
python3 render.py audio preview --preview 4:20 6:30
```

- 改旁白：编辑 `script.py`，动画会自动按新的句子时长对齐（每一句是一个“节拍”）。
- 改画面：`render.py` 里每个场景一个 `scene_*` 函数，`c.p(i, d, delay)` 表示“第 i 句开始 delay 秒后，用 d 秒淡入”。
- 字体使用系统里的文泉驿正黑（WenQuanYi Zen Hei）和 DejaVu Sans Mono。
