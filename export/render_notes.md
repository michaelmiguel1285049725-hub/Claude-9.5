# atlas 节点文字的渲染方式与讲解语料接入建议

配套文件：`export/atlas_export.json`（同目录），全部数据来自 `atlas/packs/ai-bias/pack.json`，分类和等级的定义来自 `atlas/js/encoding.js`，字段取值范围来自 `atlas/js/validate.js`。

## 1. 节点详情面板里的文字从哪来

面板由 `atlas/js/panel.js` 生成，每一块对应的字段如下：

| 面板上的内容 | 读取的字段 |
|---|---|
| 大标题、灰色英文副标题 | `node.name`、`node.name_en` |
| 标签行：类型、研究线、年份、证据等级圆标、成熟度、「AI 相关」 | `node.kind`、`domain.clusters[].name`（按 `node.cluster` 查）、`node.year`、`node.evidence`、`node.crowding`、`node.ai_related` |
| 红色「! 重要警示」块 | `node.alerts`（数组，目前只有 1 个节点有） |
| 灰底的一句话 + 「来源 / 加工」小标签 | `node.gist`、`node.gist_basis` |
| 「? 据已有知识补充，本次未经检索核验」 | `node.unverified` 为 true 时显示固定文案（文案在 `encoding.js` 的 `UNVERIFIED_TEXT`） |
| 小字备注（如「小组场景；个人场景未检验」） | `node.note` |
| 代表文献 | `node.refs` |
| 关系列表（削弱 / 解释…，它指向谁 / 谁指向它） | `edges` 里 from 或 to 等于本节点的条目：对方节点的 `id`、`name`，加 `edge.status`、`edge.basis`；悬停显示 `edge.reason`；分组标题旁的含义来自 `encoding.js` 的 `REL[].desc` |
| 相关空缺 | `gaps` 里 `nodes` 包含本节点的条目：`id`、`title`、`status`、`key`（★） |

关系面板另外显示 `edge.reason`、`edge.ref`、类型含义、状态的判定规则（`encoding.js` 的 `STATUS[].rule`）。「复制给 Claude 的提问」按钮拼的文字在 `atlas/js/prompt.js`，用的也是上面这些字段。

## 2. 目前按什么方式渲染

**纯文本。** 所有字段在写进页面之前都经过 `esc()`（在 `atlas/js/tooltip.js`）做 HTML 转义，再用 `innerHTML` 插入。也就是说：

- 字段里写 `**加粗**`、`# 标题` 这类 Markdown，会原样显示成星号和井号，不会变成格式。
- 字段里写 `<details>`、`<b>` 这类 HTML 标签，会被转成 `&lt;details&gt;` 原样显示成文字，**不会折叠、不会生效**。
- 换行符也不会换行（`<p>` 内的普通空白会被折叠）。
- 页面上唯一一个原生 `<details>` 是顶部的校验提示条（`index.html` 里的 `#banner`），和节点内容无关。

所以现在的引擎不支持 Markdown，也不支持折叠标签。要接入较长的讲解，必须在引擎侧增加一个「Markdown → 安全 HTML」的步骤，不能靠往字段里写标签解决。

## 3. 讲解语料放哪、怎么接入（只是建议，未实现）

**建议：不动 `pack.json`，另起一个「旁挂」目录，按节点编号一文件一节点。**

```
atlas/packs/ai-bias/notes/
  C-08.md
  H-09.md
  …
```

理由：

1. **内容包保持只读。** 之前定的规则是内容包只报告不修改，讲解语料是另一个 AI 另写的另一类内容，分开放彼此不影响；重新导出 `pack.json` 时也不会把讲解冲掉。
2. **按编号对应最直观。** 文件名就是节点编号，哪个节点缺讲解一眼可见；`tools/validate.mjs` 顺手加一条检查：`notes/` 里的文件名必须是存在的节点编号，就能防错。
3. **按需加载，页面不变重。** 只有打开某个节点的面板时才 `fetch('packs/ai-bias/notes/C-08.md')`，没有这个文件就不显示这一段（404 静默）。GitHub Pages 直接能提供 `.md` 文件，不需要构建步骤，和现有架构一致。
4. **换内容包也成立。** `notes/` 跟着 `packs/<pack_id>/` 走，新领域直接照搬结构。

引擎侧要加的三件事（都在页面里，不需要任何 AI 调用）：

- 在节点面板里增加一个「讲解」区块，位置建议放在「代表文献」之前、备注之后；面板已经是浮层可滚动，长文不会撑坏布局。
- 引入一个固定版本的 Markdown 解析器，从 `cdn.jsdelivr.net` 加载并锁定版本（例如 `marked`），和现在的 D3 用同一种方式；解析后的 HTML **必须经过白名单过滤**（只放行标题、段落、列表、粗斜体、链接、引用、代码、`<details>`/`<summary>`），链接一律加 `rel="noopener"`。这样 `<details>` 折叠可以原生生效，而语料里万一混入脚本也不会执行。
- 给 `.md` 加一个约定的开头（例如第一行 `# C-08 唱反调 AI`），解析时校验编号和文件名一致，不一致就在页面顶部的校验条里提示。

不建议的两种做法：

- **把长文写进 `pack.json` 的新字段（如 `explain`）**：会把内容包和语料绑死，校验规则（一句话 ≤20 字等）也要跟着改，且 JSON 里写多行 Markdown 很容易出错。
- **一个大的 `notes.json` 把所有节点的讲解装在一起**：一个节点改一句就要重新提交整个文件，另一个 AI 分批交稿时也不方便合并。

给另一个 AI 写语料时的建议约定：每个文件一个节点；第一行 `# 编号 中文名`；正文用普通 Markdown；需要折叠的部分用 `<details><summary>标题</summary>…</details>`；不要用图片和内嵌 HTML 样式；引用文献时沿用 `refs` 里的写法。
