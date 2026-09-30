/* 讲解模块：按节点编号从 packs/<pack_id>/notes/<id>.md 按需读取 Markdown 讲解，
   用锁定版本的 marked 解析，再按白名单过滤成安全的 HTML。
   文件不存在时静默（返回 null）；第一行标题的编号和文件名不一致时通过 onProblem 报到页面顶部的校验条。 */

const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@16.4.1/lib/marked.esm.js';

/* 只放行这些标签；其余标签去壳保留文字；DROP 里的连内容一起删掉 */
const ALLOW = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'A', 'BLOCKQUOTE', 'CODE', 'PRE', 'DETAILS', 'SUMMARY']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'NOSCRIPT', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'FRAME', 'FRAMESET']);

function safeHref(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw, location.href);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch (e) { return null; }
}

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const walk = (parent) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue; /* 文字原样保留 */
      const tag = child.tagName;
      if (DROP.has(tag)) { child.remove(); continue; }
      if (!ALLOW.has(tag)) { walk(child); child.replaceWith(...Array.from(child.childNodes)); continue; }
      const href = tag === 'A' ? child.getAttribute('href') : null;
      for (const a of Array.from(child.attributes)) child.removeAttribute(a.name); /* 包括 details 的 open：默认收起 */
      if (tag === 'A') {
        const ok = safeHref(href);
        if (ok) { child.setAttribute('href', ok); child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* 第一行必须是「# 编号 中文名」。返回 { id, name, body }；没有标题时 id 为 null */
export function splitHeading(md) {
  const text = String(md || '').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  let i = 0; while (i < lines.length && !lines[i].trim()) i++;
  const m = i < lines.length ? /^#\s+(\S+)\s*(.*)$/.exec(lines[i]) : null;
  if (!m) return { id: null, name: null, body: text };
  return { id: m[1], name: m[2].trim(), body: lines.slice(i + 1).join('\n') };
}

let markedPromise = null;
function loadMarked() {
  if (!markedPromise) markedPromise = import(MARKED_URL).then((m) => m.marked).catch((e) => { markedPromise = null; throw e; });
  return markedPromise;
}

export function initNotes({ packId, model, onProblem }) {
  const cache = new Map(); /* id → { html } | null（不存在） */
  const pending = new Map();
  const reported = new Set();
  const problem = (id, msg) => { const key = id + '|' + msg; if (reported.has(key)) return; reported.add(key); if (onProblem) onProblem({ where: `notes/${id}.md`, msg }); };

  async function fetchNote(id) {
    if (!model.byId.has(id) || !/^[A-Za-z0-9-]+$/.test(id)) return null;
    let res;
    try { res = await fetch(`packs/${encodeURIComponent(packId)}/notes/${encodeURIComponent(id)}.md`, { cache: 'no-cache' }); } catch (e) { return null; }
    if (!res.ok) return null; /* 404 等：没有讲解，静默 */
    let md;
    try { md = await res.text(); } catch (e) { return null; }
    const { id: headId, body } = splitHeading(md);
    if (!headId) problem(id, '第一行缺少「# 编号 中文名」标题');
    else if (headId !== id) problem(id, `第一行标题的编号是 ${headId}，和文件名 ${id} 不一致`);
    let marked;
    try { marked = await loadMarked(); } catch (e) { return { html: '<p class="p-md-fail">讲解需要联网加载 Markdown 解析器（cdn.jsdelivr.net），当前未能加载。</p>' }; }
    let html;
    try { html = marked.parse(body, { async: false, gfm: true, breaks: false }); } catch (e) { return { html: '<p class="p-md-fail">讲解文件解析失败。</p>' }; }
    return { html: sanitize(html) };
  }

  return {
    /* 已经读过的直接给（同步），没读过返回 undefined */
    peek(id) { return cache.has(id) ? cache.get(id) : undefined; },
    get(id) {
      if (cache.has(id)) return Promise.resolve(cache.get(id));
      if (pending.has(id)) return pending.get(id);
      const p = fetchNote(id).then((r) => { cache.set(id, r); pending.delete(id); return r; });
      pending.set(id, p);
      return p;
    },
  };
}
