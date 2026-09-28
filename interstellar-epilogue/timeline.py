"""Shared timing: running length, subtitles, and the clock that ticks through the film."""

DURATION = 113.0

# (start, end, speaker, line, over_radio)
SUBS = [
    (8.0, 11.4, "墨菲", "……去吧，爸爸。她还在等你。", False),
    (13.0, 15.9, "库珀", "TARS，离虫洞还有多远？", True),
    (16.4, 19.6, "TARS", "九十秒。要我讲个笑话打发时间吗？", True),
    (20.1, 22.9, "库珀", "幽默度，调到零。", True),
    (37.0, 39.8, "TARS", "卡冈图雅。保持安全距离。", True),
    (41.5, 44.4, "库珀", "上一次，我们靠得太近了。", True),
    (46.0, 49.6, "TARS", "上一次，你替所有人赢回了时间。", True),
    (54.4, 57.3, "TARS", "埃德蒙兹星球。检测到地面信标。", True),
    (58.3, 61.4, "TARS", "信标还在发送，库珀。有人活着。", True),
    (72.2, 75.4, "布兰德", "……这里是布兰德。有人收到吗？", True),
    (76.6, 79.4, "库珀", "收到，布兰德。我是库珀。", True),
    (80.4, 82.8, "库珀", "我来了。", True),
    (87.0, 90.2, "布兰德", "欢迎回家。", True),
]

TICK = 1.25   # the Miller's-planet clock, reused as the film's heartbeat
