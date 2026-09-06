# 版本 B 检查清单

对照优化指令逐条核对（2026-09-06）。

| 项目 | 结果 |
|---|---|
| 内嵌 JSON 与 `v2/bias_map_data.json` 一致 | ✅ 深度相等 |
| 节点 / 边数量 | ✅ 101 / 35 |
| 与原数据的差异 | ✅ 仅 4 个节点的 `zh` 字段；`en`、`one_liner`、`source`、边、meta 均未改动 |
| 页面零外部请求 | ✅ 源码中无外部 URL；Playwright 记录到的非 file:// 请求数为 0 |
| 连线默认隐藏 | ✅ 初始可见边 0；悬停节点显示直连边（前景理论 5 条）；点击后保持，Esc / 关闭卡片后归零；"显示全部连线"开关显示 31 条 |
| 悬停站名显示去偏虚线 | ✅ 悬停 ② 显示 premortem→planning_fallacy、consider_opposite→confirmation_bias、debiasing_training→confirmation_bias、debiasing_training→anchoring |
| 中文名不截断 | ✅ 允许 2 行；1440 与 2560 下被截断的中文名数量为 0 |
| 区内按学派分列 | ✅ B、C、D、E 网格按 kahneman → thaler → social → critique → expertise 分组，组间留 18 单位间距；图例底部加注 |
| H·I 面板并入图例 | ✅ 左下图例两个可展开小节，8 个概念可点击打开卡片；右上角不再占位；噪声晕保留 |
| 1440×900 "节点"层级 | ✅ 初始缩放 0.693，主轴五站完整可见，B/C 区节点重叠 0，最小中文字号 9.36px |
| 2560×1440 "节点"层级 | ✅ 缩放 1.248，整图入屏 |
| "骨架"层级一屏放下 | ✅ 1440×900：缩放 0.49；390×844（手机）：缩放 0.237，整图入屏 |

说明：H、I 两区的 8 个概念现在位于图例面板而非画布，涉及它们的 4 条边（clinical_vs_statistical→decision_hygiene、decision_hygiene→noise_components、adversarial_collaboration→intuitive_expertise、adversarial_collaboration→income_wellbeing）无法在画布上画出，但仍完整保留在数据里，并在节点卡片的"相连节点"列表中显示，点击可跳到图例中的对应项。画布上可画的边为 31 条。
