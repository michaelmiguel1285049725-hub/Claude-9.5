# v3 · AI 讲解 + Notion 笔记

在 v2（版本 B，含手机适配）基础上加了四件事：设置面板、卡片四标签页（概念 / 深入 / 问 AI / 笔记）、随手记、未配置时的优雅降级。数据文件与 v2 完全一致。

- 公开地址：`https://michaelmiguel1285049725-hub.github.io/Claude-9.5/v3/`
- 传达室代码：`worker.js`（粘进 Cloudflare Worker）
- 语料目录：`corpus/<节点id>.md`（可空）

## 部署顺序

1. **Anthropic Console**：注册、充值、生成 API Key。建议顺手设一个每月花费上限。
2. **Notion**：建数据库，列名与类型必须是：`概念ID`(Text) · `概念名`(Text) · `所属区`(Select) · `学派`(Select) · `类型`(Select)，外加自带的 Created time。**标题列名字随意**（Name / 名称 / 标题 都行，worker 按类型识别）。建 Internal 集成，并在数据库页面的 Connections 里添加它。
3. **Cloudflare Worker**：粘贴 `worker.js`，Secrets 填 `ANTHROPIC_API_KEY`、`APP_TOKEN`、`NOTION_TOKEN`、`NOTION_DB_ID`、`ALLOWED_ORIGIN`（填 `https://michaelmiguel1285049725-hub.github.io`，不带路径和尾斜杠）。`MODEL`、`EFFORT` 可选，**先都不设**跑通，再把 `EFFORT` 设为 `low` 验证一次。
4. **把 Worker 地址写进页面**：`index.html` 顶部 `const APP_CONFIG = { workerUrl: "" }`，填成 `https://xxx.workers.dev`。之后每台设备只需在设置面板填一次口令。

## 前端要点

- 提示词在顶层 `PROMPTS` 对象里；`PROMPTS.limits` 控制相连概念数、笔记条数、对话轮数、字符阈值、`max_tokens`。
- 对话历史按节点存 localStorage（`bm.chat.<id>`），发送前截断：最多 20 轮，且总字符 ≤ 16000。
- 本月已用 token 按 `bm.usage.YYYY-MM` 累计，在设置面板显示，可清零。
- 未发送成功的笔记存 `bm.pendingNotes`，页面加载或保存设置后自动重试一次。
- Markdown 渲染为内置最小实现，先转义再渲染；AI 回答和 Notion 内容都按不可信文本处理。
- 只在 GitHub Pages 地址上可用 AI 与笔记（受 Worker 的 CORS 限制）；地图与其他功能在任何地址都正常。
