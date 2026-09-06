// worker.js — 偏见地图的"传达室"（Cloudflare Worker，Notion 版）
// 两个职责：
//   1) 保管 Anthropic 密钥，转发 /chat
//   2) 保管 Notion token，把笔记写进你的 Notion 数据库、读出来给网页和 AI
//
// 环境变量（Cloudflare → Worker → Settings → Variables，全部设为 Secret）：
//   ANTHROPIC_API_KEY  Console 里生成的密钥
//   APP_TOKEN          你自设的一串口令；网页设置里填一次，防止陌生人白嫖代理
//   NOTION_TOKEN       Notion 内部集成的 token（以 ntn_ 或 secret_ 开头）
//   NOTION_DB_ID       "偏见地图笔记"数据库的 ID（数据库链接里 32 位那串）
//   ALLOWED_ORIGIN     你的站点，如 "https://yourname.github.io"
//   MODEL              可选，默认见下；充值前到 Console 模型列表确认名字
//   EFFORT             可选。不设 = 不带参数（模型默认自适应思考）；设为 "low" 可省思考 token。
//                      建议先不设跑通，再设 "low" 验证一次。
//
// Notion 数据库需要这些列（名字必须完全一致，类型见括号）：
//   概念ID(Text) · 概念名(Text) · 所属区(Select) · 学派(Select) · 类型(Select)
//   标题列：按类型自动识别（数据库里唯一的 Title 列，叫 Name / 名称 / 标题 都行）。
//   "创建时间"用 Notion 自带的 Created time 列即可，代理不写它。

const DEFAULT_MODEL = "claude-sonnet-5";
const NOTION_VERSION = "2022-06-28"; // 固定版本，避免新版接口变动影响；如需升级请同时检查 query 接口
const NOTION_TEXT_LIMIT = 2000;       // Notion 单段 rich_text 上限
const CHAT_INPUT_CHAR_LIMIT = 120000; // /chat 请求体（system + messages）字符上限，防止异常大的请求烧钱
let titlePropCache = null;            // Notion 数据库 Title 列名缓存（按类型识别）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (request.headers.get("x-app-token") !== env.APP_TOKEN) {
      return json({ error: "unauthorized" }, 401, cors);
    }

    try {
      if (url.pathname === "/ping") return json({ ok: true, model: env.MODEL || DEFAULT_MODEL, effort: env.EFFORT || null }, 200, cors);
      if (url.pathname === "/chat" && request.method === "POST") return chat(request, env, cors);
      if (url.pathname === "/notes" && request.method === "POST") return createNote(request, env, cors);
      if (url.pathname.startsWith("/notes/") && request.method === "GET") return listNotes(env, cors, url);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

/* ---------------- /chat：转发到 Anthropic ---------------- */
// 请求体：{ system: string, messages: [{role, content}], max_tokens?: number }
// 提示词在网页端组装，代理只转发；这样你改提示词不用重新部署。
async function chat(request, env, cors) {
  const body = await request.json();
  const size = String(body.system || "").length + JSON.stringify(body.messages || []).length;
  if (size > CHAT_INPUT_CHAR_LIMIT) return json({ error: `request too large (${size} chars > ${CHAT_INPUT_CHAR_LIMIT})` }, 413, cors);
  const payload = {
    model: env.MODEL || DEFAULT_MODEL,
    max_tokens: Math.min(body.max_tokens || 1500, 4000),
    system: body.system || "",
    messages: body.messages || [],
  };
  if (env.EFFORT) payload.output_config = { effort: env.EFFORT }; // 可关：删掉 EFFORT 变量即恢复默认
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) return json({ error: data }, r.status, cors);
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return json({ text, usage: data.usage }, 200, cors);
}

/* ---------------- /notes：写入 Notion ---------------- */
// POST /notes  请求体：
// { node_id, node_zh, zone, school, type: "概念笔记"|"自由笔记", title?, content }
async function createNote(request, env, cors) {
  const b = await request.json();
  const content = String(b.content || "").trim();
  if (!content) return json({ error: "empty content" }, 400, cors);

  const title = b.title || (content.split("\n")[0].slice(0, 60));
  const isFree = b.type === "自由笔记" || !b.node_id;

  const titleProp = await titlePropName(env);
  const properties = {
    [titleProp]: { title: [{ text: { content: title } }] },
    "概念ID": { rich_text: [{ text: { content: isFree ? "journal" : String(b.node_id) } }] },
    "概念名": { rich_text: [{ text: { content: isFree ? "自由笔记" : String(b.node_zh || "") } }] },
    "类型": { select: { name: isFree ? "自由笔记" : "概念笔记" } },
  };
  if (!isFree && b.zone) properties["所属区"] = { select: { name: String(b.zone) } };
  if (!isFree && b.school) properties["学派"] = { select: { name: String(b.school) } };

  // 正文：按 2000 字分段，每段一个 paragraph 块；空行分段落
  const children = [];
  for (const para of content.split(/\n{2,}/)) {
    for (const piece of chunk(para, NOTION_TEXT_LIMIT)) {
      children.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: piece } }] } });
    }
  }

  const r = await notion(env, "pages", {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: env.NOTION_DB_ID }, properties, children: children.slice(0, 100) }),
  });
  const out = await r.json();
  if (!r.ok) return json({ error: out }, r.status, cors);
  return json({ ok: true, page_id: out.id, url: out.url }, 200, cors);
}

/* ---------------- /notes/<node_id>：读出该概念的笔记 ---------------- */
// GET /notes/<node_id>?limit=10&full=1
// 默认返回最近 10 条的标题、时间、Notion 链接；full=1 时附带正文（多几次请求，AI 上下文用）
async function listNotes(env, cors, url) {
  const nodeId = url.pathname.split("/")[2] || "journal";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 50);
  const full = url.searchParams.get("full") === "1";

  const r = await notion(env, `databases/${env.NOTION_DB_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: "概念ID", rich_text: { equals: nodeId } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: limit,
    }),
  });
  const data = await r.json();
  if (!r.ok) return json({ error: data }, r.status, cors);

  const titleProp = await titlePropName(env);
  const notes = [];
  for (const p of data.results || []) {
    const item = {
      id: p.id,
      url: p.url,
      created: p.created_time,
      title: plain(p.properties?.[titleProp]?.title),
    };
    if (full) item.content = await pageText(env, p.id);
    notes.push(item);
  }
  return json({ node_id: nodeId, notes }, 200, cors);
}

async function pageText(env, pageId) {
  const r = await notion(env, `blocks/${pageId}/children?page_size=100`);
  if (!r.ok) return "";
  const d = await r.json();
  return (d.results || [])
    .map(bk => plain(bk[bk.type]?.rich_text))
    .filter(Boolean)
    .join("\n\n");
}

/* ---------------- helpers ---------------- */
// 按类型找 Title 列：每个 Notion 数据库有且只有一列 type === "title"，名字随意
async function titlePropName(env) {
  if (titlePropCache) return titlePropCache;
  const r = await notion(env, `databases/${env.NOTION_DB_ID}`);
  const d = await r.json();
  if (!r.ok) throw new Error("notion database lookup failed: " + JSON.stringify(d));
  const hit = Object.entries(d.properties || {}).find(([, p]) => p && p.type === "title");
  titlePropCache = hit ? hit[0] : "Name";
  return titlePropCache;
}
function notion(env, path, init = {}) {
  return fetch(`https://api.notion.com/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.NOTION_TOKEN}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}
function plain(richText) {
  return (richText || []).map(t => t.plain_text || t.text?.content || "").join("");
}
function chunk(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
}
function corsHeaders(env, request) {
  const origin = request.headers.get("origin") || "";
  const allow = origin === env.ALLOWED_ORIGIN || origin.startsWith("http://localhost") ? origin : env.ALLOWED_ORIGIN;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-app-token",
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });
}
