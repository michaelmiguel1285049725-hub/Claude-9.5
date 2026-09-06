# v3 部署指引（零基础版）

铁律：Anthropic 密钥、Notion token、你自己编的口令，这三样不要发给任何人（包括 Claude）。唯一要发出去的是 Cloudflare Worker 的网址。

准备一个记事本（手机备忘录也行），下面会让你记 5 样东西。

---

## 阶段 A · Anthropic Console（约 10 分钟）

目的：拿到一把 API 密钥，AI 讲解功能靠它付费调用模型。

1. 浏览器打开 https://console.anthropic.com ，用邮箱注册。它和 claude.ai 的会员是两个系统，会员额度不能用在这里，需要单独充值。
2. 登录后找 **Billing**（或 Plans & billing）→ 添加付款方式 → 充值。先充 5 美元就够试很久。
3. 建议顺手设一个上限：**Settings → Limits**（或 Billing 里的 Spend limit），把每月上限设成比如 20 美元，超了自动停。
4. 左侧找 **API Keys** → **Create Key** → 名字随便起（比如 bias-map）→ 创建。
5. 弹出的密钥（以 `sk-ant-` 开头）**只显示这一次**，立刻复制到记事本，标上：`① ANTHROPIC_API_KEY`。
6. 不用管模型名，页面里已经写好了 `claude-sonnet-5`。

---

## 阶段 B · Notion（约 15 分钟）

目的：建一个表格当笔记本，并给它开一个"后门"让传达室能写进去。

**B1 建表**
1. 打开 Notion，新建一个页面，标题写"偏见地图笔记"。
2. 在页面正文里输入 `/表格` 或 `/database`，选 **表格 - 整页**（Table - Full page）。这样会得到一个独立的数据库页面。
3. 表格默认有一列标题（叫 Name 或 名称）。**这一列不用改名**。
4. 点表头最右边的 **+** 号，依次新增 5 列，名字要一字不差，类型见括号：
   - `概念ID`（类型：文本 / Text）
   - `概念名`（类型：文本 / Text）
   - `所属区`（类型：选择 / Select）
   - `学派`（类型：选择 / Select）
   - `类型`（类型：选择 / Select）
   - `创建时间`（类型：创建时间 / Created time）
   选择类型的列不用预先加选项，程序写入时会自动创建。

**B2 建集成（"后门"）**
1. 打开 https://www.notion.so/profile/integrations （或：Notion 左上角 设置 → 连接 → 开发或管理集成）。
2. 点 **New integration**（新建集成）。
3. 名称填 `偏见地图`；类型选 **Internal**（内部）；关联的工作区选你自己的。
4. 在权限（Capabilities）里勾上：**Read content、Update content、Insert content**。
5. 保存。页面会显示一个 **Internal Integration Secret**（以 `ntn_` 或 `secret_` 开头），点 Show → Copy，记到记事本：`② NOTION_TOKEN`。

**B3 把集成接到表上（最容易漏的一步）**
1. 回到"偏见地图笔记"这个数据库页面。
2. 点右上角 **···** → 找 **连接**（Connections）→ **添加连接** → 选 `偏见地图` → 确认。
3. 做完后 ··· 菜单里应该能看到"偏见地图"已连接。没做这步，笔记会保存失败。

**B4 抄表的 ID**
1. 还在这个数据库页面，看浏览器地址栏，形如：
   `https://www.notion.so/你的名字/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d?v=……`
2. 中间那串 **32 位字母数字**（问号前面的部分）就是数据库 ID，记到记事本：`③ NOTION_DB_ID`。
3. 如果你是在手机上，用 分享 → 复制链接，粘到记事本里再截取。
4. 注意：要抄的是**数据库本身**的链接，不是它外面那个父页面的。刚才用"表格 - 整页"建的就是数据库本身。

---

## 阶段 C · Cloudflare（约 15 分钟）

目的：搭一个"传达室"，密钥都锁在它那里，网页只跟它说话。

**C1 建 Worker**
1. 打开 https://dash.cloudflare.com 注册（免费档就够）。
2. 左侧 **Workers & Pages** → **Create**（创建）→ 选 **Create Worker**（或 Start with Hello World）。
3. 名字改成 `bias-map-proxy`（随意，但记住它）→ **Deploy**。
4. 部署完点 **Edit code**（编辑代码）。把编辑器里原有内容**全部删掉**，然后把仓库里 `v3/worker.js` 的全文粘进去。
   文件在这里：https://github.com/michaelmiguel1285049725-hub/Claude-9.5/blob/claude/new-session-sefln5/v3/worker.js ，点右上角 **Raw**，全选复制。
5. 右上角 **Deploy**（部署）。

**C2 填密钥**
1. 回到这个 Worker 的页面 → **Settings**（设置）→ **Variables and Secrets**（变量与密钥）→ **Add**（添加）。
2. 每一条：类型选 **Secret**，填名字和值，保存。一共 5 条，名字必须一字不差：

   | 名字 | 值 |
   |---|---|
   | `ANTHROPIC_API_KEY` | 记事本里的 ① |
   | `NOTION_TOKEN` | 记事本里的 ② |
   | `NOTION_DB_ID` | 记事本里的 ③ |
   | `APP_TOKEN` | 你自己现编一串，20 位左右字母数字，比如 `pk7Qm2xL9vB4nR8sT3wY`。记到记事本：`④ APP_TOKEN`，之后网页里要填 |
   | `ALLOWED_ORIGIN` | 一字不差地填：`https://michaelmiguel1285049725-hub.github.io` （没有路径，结尾没有斜杠）|

3. `MODEL` 和 `EFFORT` 这两个**先不要加**。
4. 加完变量后，页面上如果出现 **Deploy** 提示，再点一次部署，变量才生效。

**C3 抄 Worker 网址并自检**
1. Worker 页面顶部或 Overview 里有它的网址，形如 `https://bias-map-proxy.某某某.workers.dev`。记到记事本：`⑤ Worker 网址`。
2. 自检：在浏览器打开 `⑤/ping`（例如 `https://bias-map-proxy.某某某.workers.dev/ping`）。
   看到 `{"error":"unauthorized"}` 就是**正常的**，说明传达室在岗，只是你没带口令。
   看到别的错误或打不开，把页面上的文字告诉 Claude。

---

## 阶段 D · 接线（2 分钟）

1. 把 **⑤ Worker 网址** 发给 Claude。Claude 会把它写进页面并推送。
2. 等一两分钟，打开 https://michaelmiguel1285049725-hub.github.io/Claude-9.5/v3/ 。
3. 点右上角 **⚙**（手机在顶栏）。地址一栏已经填好；在"口令"一栏粘 **④ APP_TOKEN** → 点 **测试连接**。
   显示 `ok · 模型 claude-sonnet-5` 就通了 → 点 **保存**。
4. 手机上重复第 3 步一次（口令是按设备存的）。

---

## 阶段 E · 验收

1. 点开"锚定"→ **问 AI** → 输入"锚定和参照点依赖有什么区别"→ 回答里应有「[通用知识]」标注，下方显示 token 数。
2. **笔记** 标签写一句 → **保存到 Notion** → 打开 Notion 的表，应出现一条，"所属区"是 `B 估计世界`，"类型"是 `概念笔记`。
3. 再问 AI 一个问题，它的回答应该能引用你刚写的那句。
4. 点 **⚙** 看"本月已用 token"有没有在涨。
5. 都通过后，回到 Cloudflare 的 Variables 里加一条 `EFFORT` = `low`，Deploy，再问一次 AI，测试连接处会显示 `effort low`。

## 常见问题

- **测试连接显示"失败：Failed to fetch"**：多半是 `ALLOWED_ORIGIN` 填错了（多了斜杠或路径），或者变量加完没重新 Deploy。
- **测试连接 HTTP 401**：口令和 Cloudflare 里的 `APP_TOKEN` 不一致，检查有没有多余空格。
- **笔记保存失败、错误里有 Notion 字样**：先查 B3（集成有没有接到表上），再查列名有没有错字。
- **问 AI 报错含 credit / billing**：Console 余额不足。
