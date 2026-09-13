# 偏见地图 · 交接简报

本文件是**给 AI 读的项目现状说明**，不是使用手册。读完这份，再按下面的地址取需要的文件。

## 0. 文件在哪里（可直接抓取的原始地址）

仓库 `michaelmiguel1285049725-hub/Claude-9.5` 为公开仓库，以下地址返回纯文本，无需登录：

| 文件 | 地址 | 什么时候需要读 |
|---|---|---|
| 知识图谱数据 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/v3/bias_map_data.json` | **讨论内容时必读**。101 节点 35 边 |
| 节点编号对照表 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/v3/NUMBERING.md` | 需要按编号（A-1、B-7）定位概念时 |
| 设计方案一 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/pipeline-map/PLAN.md` | 讨论布局或视觉时 |
| 网页全文（v3） | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/v3/index.html` | **只在要改代码时读**，约 4 万 token，很占空间 |
| 传达室代码 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/v3/worker.js` | 讨论 AI / Notion 后端时 |
| 部署指引 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/v3/SETUP.md` | 排查后端配置问题时 |
| 本文件 | `https://raw.githubusercontent.com/michaelmiguel1285049725-hub/Claude-9.5/HEAD/HANDOVER.md` | — |

`HEAD` 指向默认分支 `claude/new-session-sefln5`，内容随项目更新，不用改地址。
仓库网页版入口：`https://github.com/michaelmiguel1285049725-hub/Claude-9.5`

**按需取用，不要一次性全读。** 多数讨论只需要这份简报加数据文件；`index.html` 只有真要改代码时才值得读进来。

---

## 1. 这是什么

一张认知偏差的交互式知识地图。101 个概念按"**它在思考的哪一步把你带偏**"排在一条从左到右的流水线上，而不是按字母或学科分类。主轴回答的问题是："我此刻在哪一步出错？"

技术形态：**一个自包含的 HTML 文件**，数据内嵌其中，无构建步骤、无框架、无外部依赖（字体用系统中文字体）。托管在 GitHub Pages。

---

## 2. 现在有三个版本，都在线

| 版本 | 地址 | 说明 |
|---|---|---|
| 原版 | `…github.io/Claude-9.5/` | 最初实现，连线常驻显示 |
| v2 | `…github.io/Claude-9.5/v2/` | 连线按需显示、区内按学派分列、手机列表模式 |
| **v3（当前）** | `…github.io/Claude-9.5/v3/` | v2 + AI 讲解 + Notion 笔记 + 节点编号 + 访问口令 |

站点根：`https://michaelmiguel1285049725-hub.github.io/Claude-9.5/`
仓库：`michaelmiguel1285049725-hub/Claude-9.5`，分支 `claude/new-session-sefln5`

**v3 打开会先要口令**（口令由作者掌握，不在本文件里）。这是纯客户端遮挡，不是访问控制：页面与数据文件仍可被直接抓取。

---

## 3. 数据契约（最重要的一节）

文件：`bias_map_data.json`，**101 个节点、35 条边**。

```
node = { id, zh, en, zone, stage, school, one_liner, source, year, evidence }
edge = { from, to, type }
```

- `zone` A–J 共 10 个区，决定节点属于哪一类；`meta.zones` 里有中文名。
- `stage` 决定它在流水线上落在哪：`foundation`(地基) / `estimate`(站2) / `choose`(站3) / `remember`(站5) / `self_input`(轴上方·看自己) / `social_input`(轴上方·看他人) / `environment`(背景色带) / `noise`(散布晕) / `meta`(图例层) / `debias`(轴下方)。
- `school` 决定颜色，7 种：`kahneman` `thaler` `social` `critique` `expertise` `debias` `meta`。
- `evidence` 决定样式，3 种：`solid`(实心) / `contested`(虚线边框) / `refuted`(灰色删除线，**必须保留在图上**，作用是提醒"这块砖别用")。
- `edge.type` 13 种关系：explains / derives / component / targets / uses / reduces / limits / unconfounds / leads_to / adopted_by / context / produced / basis。

### 铁律
1. **不要增删节点或边**，也不要"补充看起来相关"的连线。原始数据是人工审过的。
2. **不要凭记忆补年份、期刊名、作者、具体数字**。`source` 字段里没有的就说不确定。
3. 节点编号（`A-1`、`B-7`）**不在数据文件里**，是页面加载时按数组原始顺序在每个 zone 内从 1 开始算出来的。对照表见 `NUMBERING.md`。
4. v3 的数据相对最初上传版，只改过 4 个节点的 `zh`（缩短显示名），`en` / `one_liner` / `source` / 边 / meta 全部未动：
   - `ecological_rationality` → 生态理性
   - `naturalistic_decision_making` → 自然主义决策（RPD）
   - `tfs_ch4_priming` → TFS 第 4 章：社会启动
   - `tfs_ch3_ego_depletion` → TFS 第 3 章：自我损耗

---

## 4. 布局规则（改画面前必须知道）

```
上层：D 区(看自己) / E 区(看他人) 两簇 ──箭头──▶ 指向 ② ③
背景：G 区画成整条轴的渐变色带，左浅(友善环境) 右深(恶劣环境)，8 个概念作为色带标注
主轴：① 看到世界 → ② 估计概率 → ③ 做选择 → ④ 行动 → ⑤ 事后记忆
        (①④ 只是流程标记，没有节点)   B 区     C 区              F 区
每站周围：H 区的"散布晕"表示噪声
回路：⑤ ──虚线──▶ ② 的反馈回路，在色带深色段画一个断口（表达"恶劣环境里反馈断了"）
下层：J 区去偏方法，用方块（区别于偏差用圆角矩形），虚线连到它作用的对象
地基：A 区总框架，横贯底部的长条
图例：I 区(证据可靠性) 和 H 区的概念作为可展开小节收在左下图例里
```

- 区内节点**按 school 分组纵向排列**（顺序 kahneman → thaler → social → critique → expertise），组间留空。位置不表示重要性。
- 所有节点等大，**不要用大小表达重要性**。
- 节点面上只放：编号 + 中文名 + 英文名 + 年份。`one_liner` 只在最近的缩放层级或卡片里出现。

### 一处重要取舍
H 区和 I 区的 8 个概念被移进了图例面板，不在画布上，因此涉及它们的 **4 条边画不出来，画布上可画的边是 31 条**。这 4 条边数据里完整保留，在节点卡片的"相连节点"列表里可见并可跳转。

---

## 5. 视觉与交互

**配色**：5 个学派色经过色觉障碍与对比度校验（全对组合通过），卡尼曼色最醒目。
`kahneman #e2684a` · `thaler #3c53cd` · `social #b56ae7` · `critique #3ca694` · `expertise #796006`(亮) / `#71640b`(暗) · `debias`/`meta` 中性灰。
深浅两套主题都做了，通过 CSS 变量切换，不要把颜色写死在某个主题的媒体查询里。

**交互**：三级缩放（骨架 → 节点名 → 一句话）；图层开关（显示全部连线 / 只看卡尼曼 / 按学派筛选 / 只看硬证据 / 显示编号）；点节点开卡片；悬停节点显示直连边；悬停站名高亮该站节点及针对它们的去偏方法。

**手机（<768px）**：不渲染地图，改渲染按区分组的列表页 + 搜索 + 全屏卡片；可切到地图模式，地图支持双指缩放、单指平移、双击放大。搜索能匹配编号（输 `b7` 或 `B-7` 都行）。

---

## 6. AI 讲解 + Notion 笔记（v3 新增）

```
浏览器 ──▶ Cloudflare Worker「传达室」(保管密钥) ──┬──▶ Anthropic API  (/chat)
                                                  └──▶ Notion 数据库  (/notes)
```

- 网页本身**不持有任何密钥**。传达室地址写死在页面里，访问口令每台设备在设置面板填一次，存 localStorage。
- 节点卡片有四个标签页：**概念 / 深入 / 问 AI / 笔记**，电脑侧边卡片和手机全屏卡片共用同一组件。
- "深入"读同源的 `corpus/<节点id>.md`，**这个目录目前是空的**，语料还没写。
- "问 AI"的提示词在页面顶层的 `PROMPTS` 对象里，上下文拼装顺序固定为：系统提示 → 节点数据 → 相连概念 → 语料 → 用户笔记 → 对话历史。
- 提示词要求 AI：**不来自上述材料的内容必须标注「[通用知识]」**；年份期刊数字一律不许凭记忆给。这是作者刻意设的规矩，改动时不要削弱它。
- 笔记有两种模式：**未配置传达室时存 localStorage**（零配置可用，设置面板可导出 Markdown），配置后写入 Notion。两者在卡片里合并显示，都会进 AI 的上下文。
- 笔记只写不改，编辑和整理在 Notion 里做。写失败会暂存本地，下次自动补发。
- 未配置传达室时全部优雅降级，地图与其他功能完全不受影响。

---

## 7. 还没做的事

- **语料**：`corpus/*.md` 一个都没写，这是下一步最有价值的工作。
- **整理模式**：读 Notion 里积累的笔记做归纳、找矛盾——等笔记有几十条再做才有意义。
- **提问模式**（AI 反过来考你）：明确不做。
- 桌面端没有搜索框，编号搜索只在手机列表模式里。
- 原版和 v2 没有口令，内容基本相同，等于 v3 的口令可以被绕过。

---

## 8. 和新窗口协作时的提醒

- 网页是**一个文件**，改动请基于最新的 `index.html` 全文，不要凭记忆重写。
- 每次大改**新开一个版本目录**（v2 → v3 → v4），旧版保持不动，方便回滚。这是已经形成的习惯。
- **绝不要把 Anthropic 密钥、Notion token、传达室口令粘进任何对话窗口。** 它们只存在于 Cloudflare 的环境变量里。`worker.js` 本身不含密钥，可以安全分享。
