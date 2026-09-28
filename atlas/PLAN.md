# atlas · 领域学习地图引擎 · 实施计划（阶段 0）

状态：**五个阶段已全部完成**（2026-09-28）。使用说明见 `README.md`；本文保留为开发记录。

---

## 1. 读 v3 的结论：复用什么

v3 是单文件（`v3/index.html`，约 4 万 token），风格克制：浅灰画布、白卡片、系统中文字体、细描边、少阴影。atlas 用同一套视觉语言，拆成多文件。

### 1.1 直接搬到 `css/tokens.css` 的设计变量
- 画布与面板：`--ground #e9ebee` / `--surface #f7f8f9` / `--panel #fff` / `--panel-2 #f1f2f4`
- 文字：`--ink #1c1f24` / `--ink-2 #4c525c` / `--muted #7a808a`；描边 `--line #cfd3d9` / `--line-2 #e2e5e9`
- 阴影 `--shadow: 0 8px 28px rgba(28,31,36,.14)`（只用在浮层，画布上不用）
- 字体 `--sans`（PingFang SC 等系统字体）、`--mono`（SF Mono / Menlo）
- **来源 / 加工标签**：`--tag-src-*`（绿）、`--tag-proc-*`（琥珀），连同 `.bm-tag.src / .proc` 的样式一起搬过来，用于 `gist_basis` 和 edge `basis`
- 深色模式机制：`@media (prefers-color-scheme: dark)` + `:root[data-theme]` 覆盖。v3 只有 CSS 钩子没有按钮，atlas 补一个手动切换按钮（系统 / 浅 / 深）。

### 1.2 复用的组件样式
| v3 里的 | atlas 里用在 |
|---|---|
| `header` / `.brand h1 .ver` / `.controls .ctl .eyebrow` / `.seg` 分段按钮 | 顶栏：标题、版本小标签、视角切换（关系网 / 成熟度 / 时间线） |
| `.icon-btn`、`.tag` 药丸标签、`.tag .dot` | 筛选栏开关、面板里的类型 / 研究线 / 证据标签 |
| `#card`（右侧卡片：圆角 12、细边、阴影、关闭按钮、`.kicker`、`dl`、`.conn` 关系列表按钮） | 右侧详情面板（改成固定栏，可收起，而不是浮层） |
| `#legend`（`<details>` 折叠、`▾/▸`、分节 `h4`、`.ln` 线样） | 左下角图例 |
| `#hint` 底部快捷键提示、`#bm-toast` 提示条 | 同 |
| `.node.dim` / `.faded` 的降不透明度写法、`:focus-visible`、`prefers-reduced-motion` 规则、自定义滚动条 | 同 |

### 1.3 复用的交互习惯
- 悬停节点 → 显示它的连线、其余变淡；点节点 → `.active` + 开卡片；Esc 清除；`+ / -` 缩放。
- 三级缩放用 `svg[data-level]` 切 CSS 显隐（v3 阈值 0.5 / 1.35，atlas 按规范改成 0.6 / 1.4）。
- "只看硬证据"的思路 → atlas 的"只看有文献来源的线"。
- 编号处处显示（节点面、卡片标题、列表）。

### 1.4 不复用
口令闸门、Cloudflare 传达室、AI 对话、Notion 写入、手机列表模式、语料标签页。atlas 只做可视化。

---

## 2. 文件结构

按任务书第 4 节，微调如下（新增文件加粗）：

```
atlas/
  index.html                  入口；读 ?pack=，默认 ai-bias；只含骨架和 <defs>（8 组箭头 marker）
  css/tokens.css              设计变量（浅 / 深）+ 8 种关系色 + 簇色板
  css/app.css                 布局、组件、三个视角的 SVG 样式
  js/main.js                  启动：读 pack → 校验 → 建索引 → 恢复 hash/localStorage → 挂载视角
  js/state.js                 单一状态对象 + subscribe()；写 URL hash；后退键恢复
  js/data.js                  fetch pack.json / layout.json，建 byId、邻接表、簇→节点索引
  js/validate.js              8 条校验规则，纯函数，浏览器与 Node 共用
  js/encoding.js              视觉编码表：关系→颜色/线型/箭头、状态→dasharray、形状→路径生成器、簇色板
  js/views/network.js         视角一（含语义缩放、簇气泡、簇凸包背景、拖动固定）
  js/views/maturity.js        视角二
  js/views/timeline.js        视角三（含故事线模式）
  js/panel.js                 右侧面板：节点 / 关系 / 路径 / 空缺 四种内容
  js/filters.js               筛选栏 + 可见性计算（一处算，三视角共用）
  js/pathfinder.js            BFS 最短路、简单路径枚举、加权 Dijkstra
  js/progress.js              已消化、簇进度、只看未消化
  js/storage.js               localStorage 封装（全部 try/catch，键前缀 atlas.<pack_id>.）
  **js/search.js**            顶部搜索框 + 下拉候选（从 network.js 里拆出来，三视角共用）
  **js/minimap.js**           小地图（只在关系网用，但独立成文件便于关掉）
  **js/tooltip.js**           悬停提示（三视角共用一个 DOM）
  **js/theme.js**             浅 / 深 / 跟随系统 切换
  packs/ai-bias/pack.json     内容包（已原样保存）
  packs/ai-bias/layout.json   （可选）"导出布局"生成后由你决定是否提交
  tools/validate.mjs          node tools/validate.mjs packs/ai-bias
  README.md                   阶段 5 写
```

D3 只从 `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` 加载，不引入其他库。

### 2.1 几个跨阶段的技术决定
- **坐标系**：关系网世界坐标固定为 1600 × 1000，簇 `anchor` 的 0–1 相对值乘上去。`layout.json` 和 localStorage 里存的都是世界坐标，与窗口大小无关。
- **布局稳定**：`d3.randomLcg(42)` 作种子，模拟在内存里跑 300 tick 再一次性绘制；有 `layout.json` 时跳过模拟直接用；localStorage 里用户拖过的节点坐标优先级最高。
- **初始视图**："适配全部"时缩放 k 落在 1.0 左右（名称级），而不是簇气泡级；簇气泡只在你主动缩小到 k < 0.6 时出现。
- **可见性只算一次**：`filters.js` 输出 `visibleNodes / visibleEdges` 两个 Set，三个视角和找路径都读这两个 Set，保证"在哪个视角看到的都一样"。
- **状态与 URL**：`#view=network&node=C-04&depth=2&edge=E-07&gap=G-03&path=R-04,C-04`，用 `history.pushState`，后退可用；筛选偏好不进 URL，进 localStorage。
- **簇颜色**：引擎自带一组 8 色低饱和色板，按内容包里 `clusters` 的顺序分配；内容包若给了可选字段 `color` 则优先用它。引擎里不出现任何簇名或簇编号。

---

## 3. 分阶段计划

| 阶段 | 做什么 | 产出文件 |
|---|---|---|
| **1 数据层与关系网基础** | 校验（浏览器 + 命令行）、红色提示条、索引；关系网静态渲染：44 节点 / 47 线 / 6 簇背景；8 色 8 marker、3 线型、加工空心圆、5 种节点形状、A/B/C/N/A 徽章、`?` `!` 角标；稳定布局；图例 | index.html, tokens.css, app.css, main.js, data.js, validate.js, encoding.js, state.js(最小), network.js(静态), tools/validate.mjs |
| **2 关系网交互** | d3.zoom + 三级语义缩放 + 簇气泡 + 汇总线；悬停高亮与提示（线可点区 12px）；点击聚焦 / 两跳 / Esc；筛选栏全部开关 + 摘要条；找路径三种算法；空缺模式；搜索；拖动固定、重置 / 导出布局；小地图；"适配全部" / "回到选中" | filters.js, pathfinder.js, search.js, minimap.js, tooltip.js, panel.js(节点 / 关系 / 路径 / 空缺) |
| **3 成熟度 + 时间线** | 成熟度网格（4+1 列 × 3 行、列头行头说明、空缺列、按研究线着色开关、跨格弧线）；时间线（分段压缩轴 + 断轴标记、泳道、错位堆叠、对话型关系默认显示、故事线逐步展开、年份刻度悬停） | maturity.js, timeline.js |
| **4 联动、面板、学习闭环** | 视角切换保留选中并滚到可见；URL hash 完整恢复 + 后退；面板全部字段与四个按钮（复制提问、Notion 链接、已消化、从这里找路径）；簇进度、只看未消化 | panel.js 补全, progress.js, storage.js |
| **5 打磨与部署** | 深色模式、键盘（1/2/3、/、Esc、+/-）、reduced motion；100 节点 / 200 线压力测试（临时假数据，测完删）；部署；README | README.md, theme.js |

每阶段结束：报告完成项、验收清单逐条打勾、浏览器检查步骤、`node tools/validate.mjs packs/ai-bias` 输出。

---

## 4. 内容包校验结果（阶段 0 预跑，Python 按第 5.5 节 8 条规则）

全部通过：44 节点、47 关系、10 空缺、6 簇；id 无重复；端点、gap、cluster 引用全部存在；枚举合法；gist 最长 19 字、reason 最长 21 字；年份 1955–2026；同一对节点无重复类型；加工线都有 ref；无孤立节点；无双向对。

只报告、不改动的观察：
1. **E-33、E-35 是「未验证」但没有 `gap`**。"只看空缺"模式按规范显示所有未验证线，这两条会出现但不属于任何空缺问题。
2. **G-05 没有任何线指向它**，只关联节点 O-01。点它时画布只会高亮 O-01。
3. 内容包里目前没有双向关系对、也没有同一对节点的多条线；第 8.1 节的对称弧线仍会实现，但当前数据看不到效果。

---

## 5. 需要你决定的地方

1. **部署分支**。`.github/workflows/pages.yml` 只在推送到 `claude/new-session-sefln5` 或 `main` 时部署。我的工作分支是 `claude/awesome-ride-294xb8`，推上去不会自动上线。到阶段 5 有两种办法：(a) 你把工作分支合并到 `claude/new-session-sefln5`；(b) 我在 workflow 的分支列表里加上工作分支（改的是 `.github/`，不碰 `v3/`）。**我倾向 (a)**，等阶段 5 再定也行。
2. **两个"未验证"容易混**。关系的 `status: 未验证`（无直接实证，理论推测）和节点 / 关系的 `unverified: true`（据已有知识补充，未经检索核验）是两回事。界面上我打算把后者叫"**未核验**"（`?` 角标，悬停显示规范里那句话），前者保留"未验证"。如果你希望另起名字请告诉我。
3. **关系上的 `unverified`**。规范只给节点定义了 `?` 角标。关系上的我打算只在悬停提示和关系详情里显示"未核验"标签，不在线上加图形（避免和加工空心圆挤在一起）。
4. **初始视图**是名称级（能看到 44 个节点）而不是簇气泡级。见 2.1。
5. **`?pack=`** 只接受 `[a-z0-9-]`，路径固定为 `packs/<id>/pack.json`。
6. **成熟度地图的跨格弧线**只在选中节点时画它的一跳关系，不画全图（全画会糊成一片）。
7. **时间线故事线**的"一步"= 一个年份（同年多个节点同一步出现）。
8. **面板里关系列表的一行写法**：指向的 `→ 解释 → H-07 锚定效应（初步 · 来源）`，被指向的 `← 解释 ← R-05 资源理性分析（初步 · 来源）`；"复制给 Claude 的提问"里也用这个格式。
