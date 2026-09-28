/* 右侧详情面板：节点 / 关系 / 路径 / 空缺列表。 */
import * as enc from './encoding.js';
import { get, set, subscribe } from './state.js';
import { esc } from './tooltip.js';
import * as pf from './pathfinder.js';
import { computeVisibility } from './filters.js';

export function initPanel({ el, model, actions }) {
  const nodeLabel = (id) => { const n = model.byId.get(id); return n ? `${n.id} ${n.name}` : id; };
  const basisTag = (b) => `<span class="bm-tag ${b === '加工' ? 'proc' : 'src'}">${b === '加工' ? '加工' : '来源'}</span>`;
  const evBadge = (g) => `<span class="ev-badge ev-${g === 'N/A' ? 'na' : g.toLowerCase()}" title="${esc(enc.EVIDENCE[g]?.desc || '')}">${esc(g)}</span>`;
  const gapPill = (st) => `<span class="gap-pill ${enc.GAP_STATUS[st]?.cls || ''}">${esc(st)}</span>`;
  const relSw = (t) => `<i class="sw line" style="--c:${enc.relColor(t)}"></i>`;

  function header(title, closeTo) {
    return `<div class="p-top"><span class="p-kind">${title}</span><button type="button" class="p-close" data-act="close" aria-label="关闭">×</button></div>`;
  }

  /* ---------- 节点 ---------- */
  function renderNode(s) {
    const n = model.byId.get(s.node); if (!n) { el.innerHTML = `<p class="empty">节点 ${esc(s.node)} 不存在。</p>`; return; }
    const c = model.clusterById.get(n._cluster);
    const vis = computeVisibility(model, s.filters);
    const out = model.out.get(n.id) || [], inc = model.inc.get(n.id) || [];
    const groups = enc.REL_ORDER.map((t) => ({ t, out: out.filter((e) => e.type === t), inc: inc.filter((e) => e.type === t) })).filter((g) => g.out.length || g.inc.length);
    const item = (e, dir) => {
      const other = dir === 'out' ? e.to : e.from; const o = model.byId.get(other);
      const hidden = !vis.edgeVis.has(e.id);
      return `<li><button type="button" class="rel-item${hidden ? ' hidden-edge' : ''}${s.edge === e.id ? ' cur' : ''}" data-act="edge" data-id="${esc(e.id)}" title="${esc(e.reason)}${hidden ? '（当前被筛选隐藏）' : ''}">
        <span class="r-dir">${dir === 'out' ? '→' : '←'}</span><span class="r-id">${esc(o.id)}</span><span class="r-name">${esc(o.name)}</span>
        <span class="r-meta">${esc(e.status)}</span>${basisTag(e.basis)}${e.unverified ? '<span class="r-unv" title="' + esc(enc.UNVERIFIED_TEXT) + '">?</span>' : ''}
      </button></li>`;
    };
    const gaps = model.gapsOfNode.get(n.id) || [];
    el.innerHTML = header('节点') + `
      <div class="p-head">
        <div class="p-idrow"><span class="p-id">${esc(n.id)}</span><button type="button" class="icon-btn tiny" data-act="copy-id" title="复制编号">复制编号</button></div>
        <h2>${esc(n.name)}</h2>
        <p class="p-en">${esc(n.name_en)}</p>
      </div>
      <div class="p-tags">
        <span class="tag">${esc(n.kind)}</span>
        <span class="tag"><span class="dot" style="--c:${c?._color}"></span>${esc(c?.name || n._cluster)}</span>
        <span class="tag mono">${n.year}</span>
        ${evBadge(n.evidence)}
        <span class="tag" title="${esc(enc.CROWDING[n.crowding]?.desc || '')}">${esc(n.crowding)}</span>
        ${n.ai_related ? '<span class="tag ai">AI 相关</span>' : ''}
      </div>
      ${Array.isArray(n.alerts) && n.alerts.length ? `<div class="p-alert"><b>! 重要警示</b>${n.alerts.map((a) => `<div>${esc(a)}</div>`).join('')}</div>` : ''}
      <p class="p-gist">${esc(n.gist)} ${basisTag(n.gist_basis)}</p>
      ${n.unverified ? `<p class="p-unv">? ${esc(enc.UNVERIFIED_TEXT)}</p>` : ''}
      ${n.note ? `<p class="p-note">${esc(n.note)}</p>` : ''}
      <div class="p-actions">
        <label class="p-toggle"><input type="checkbox" data-act="depth" ${s.depth >= 2 ? 'checked' : ''}> 显示两跳</label>
        <button type="button" class="icon-btn small" data-act="path-from">从这里出发找路径</button>
        <button type="button" class="icon-btn small" data-act="zoom">缩放过去</button>
      </div>
      <section class="p-sec"><h3>代表文献</h3>${n.refs?.length ? `<ul class="p-refs">${n.refs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="empty">无</p>'}</section>
      <section class="p-sec"><h3>关系 <span class="p-count">${out.length + inc.length}</span></h3>
        ${groups.length ? groups.map((g) => `<div class="rel-group" style="--c:${enc.relColor(g.t)}"><div class="rel-title">${relSw(g.t)}${esc(g.t)}<span class="rel-desc">${esc(enc.relByZh[g.t].desc)}</span></div>
          <div class="rel-cols">
            <div class="rel-col"><div class="rel-colhead">它指向谁</div>${g.out.length ? `<ul>${g.out.map((e) => item(e, 'out')).join('')}</ul>` : '<p class="empty">—</p>'}</div>
            <div class="rel-col"><div class="rel-colhead">谁指向它</div>${g.inc.length ? `<ul>${g.inc.map((e) => item(e, 'inc')).join('')}</ul>` : '<p class="empty">—</p>'}</div>
          </div></div>`).join('') : '<p class="empty">没有关系线。</p>'}
      </section>
      <section class="p-sec"><h3>相关空缺 <span class="p-count">${gaps.length}</span></h3>
        ${gaps.length ? `<ul class="gap-list compact">${gaps.map((g) => gapItem(g, s)).join('')}</ul>` : '<p class="empty">无</p>'}
      </section>`;
  }

  /* ---------- 关系 ---------- */
  function renderEdge(s) {
    const e = model.edgeById.get(s.edge); if (!e) { el.innerHTML = `<p class="empty">关系 ${esc(s.edge)} 不存在。</p>`; return; }
    const a = model.byId.get(e.from), b = model.byId.get(e.to);
    const r = enc.relByZh[e.type];
    const gap = e.gap ? model.gapById.get(e.gap) : null;
    el.innerHTML = header('关系') + `
      ${s.node ? `<button type="button" class="p-back" data-act="node" data-id="${esc(s.node)}">← 返回 ${esc(nodeLabel(s.node))}</button>` : ''}
      <div class="p-head"><div class="p-idrow"><span class="p-id">${esc(e.id)}</span></div></div>
      <div class="e-chain">
        <button type="button" class="e-node" data-act="node" data-id="${esc(a.id)}"><span class="r-id">${esc(a.id)}</span>${esc(a.name)}</button>
        <div class="e-rel" style="--c:${enc.relColor(e.type)}">${relSw(e.type)}<b>${esc(e.type)}</b></div>
        <button type="button" class="e-node" data-act="node" data-id="${esc(b.id)}"><span class="r-id">${esc(b.id)}</span>${esc(b.name)}</button>
      </div>
      <p class="p-gist">${esc(e.reason)} ${basisTag(e.basis)}</p>
      <dl class="p-dl">
        <dt>含义</dt><dd>${esc(r?.desc || '')}</dd>
        <dt>状态</dt><dd><b>${esc(e.status)}</b> · ${esc(enc.STATUS[e.status]?.rule || '')}</dd>
        <dt>依据</dt><dd>${e.basis === '加工' ? 'Claude 加工（推断或连接）' : '文献来源'}</dd>
        <dt>文献 / 说明</dt><dd>${esc(e.ref || '—')}</dd>
        ${gap ? `<dt>所属空缺</dt><dd><button type="button" class="link" data-act="gap" data-id="${esc(gap.id)}">${esc(gap.id)} ${esc(gap.title)}</button></dd>` : ''}
        ${e.unverified ? `<dt>未核验</dt><dd class="p-unv">? ${esc(enc.UNVERIFIED_TEXT)}</dd>` : ''}
      </dl>
      <div class="p-actions"><button type="button" class="icon-btn small" data-act="zoom">缩放过去</button></div>`;
  }

  /* ---------- 路径 ---------- */
  function chainHTML(p) {
    const parts = [`<span class="c-node">${esc(nodeLabel(p.nodes[0]))}</span>`];
    p.steps.forEach((st, i) => {
      const t = st.edge.type;
      parts.push(`<span class="c-rel" style="--c:${enc.relColor(t)}">${st.reverse ? `←${esc(t)}—` : `—${esc(t)}→`}</span>`);
      parts.push(`<span class="c-node">${esc(nodeLabel(p.nodes[i + 1]))}</span>`);
    });
    return parts.join(' ');
  }
  function pathKey(p) { return p.edges.join('>'); }
  function renderPath(s) {
    const q = s.pathQuery || { from: null, to: null, sourceFirst: false };
    const vis = computeVisibility(model, s.filters);
    const opts = model.nodes.map((n) => `<option value="${esc(n.id)}">${esc(n.id)} ${esc(n.name)}</option>`).join('');
    let results = '';
    if (q.from && q.to && model.byId.has(q.from) && model.byId.has(q.to)) {
      const main = q.sourceFirst ? pf.weightedShortest(model, vis.edgeVis, q.from, q.to) : pf.shortest(model, vis.edgeVis, q.from, q.to);
      if (!main) {
        const bl = pf.blockers(model, s.filters, q.from, q.to);
        results = `<div class="p-warn">在当前筛选下，${esc(nodeLabel(q.from))} 和 ${esc(nodeLabel(q.to))} 不连通。${bl.connectedAtAll ? `<br>可以放宽：${bl.hints.length ? bl.hints.map(esc).join('、') : '（某些被隐藏的节点或线）'}` : '<br>即使不做任何筛选，两者之间也没有关系链。'}</div>`;
      } else {
        const alts = pf.alternatives(model, vis.edgeVis, q.from, q.to, main, 5, 3);
        const cur = s.path ? pathKey(s.path) : null;
        const card = (p, label) => { const st = pf.pathStats(p); return `<button type="button" class="path-card${cur === pathKey(p) ? ' cur' : ''}" data-act="path" data-key="${esc(pathKey(p))}"><div class="path-label">${label}</div><div class="path-chain">${chainHTML(p)}</div><div class="path-stats">共 ${st.len} 步，其中 ${st.proc} 条是 Claude 加工，${st.unv} 条未验证</div></button>`; };
        results = card(main, q.sourceFirst ? '文献优先的最短路径' : '最短路径') + (alts.length ? `<h3 class="p-sub">备选路径（长度 ≤ 5）</h3>` + alts.map((p, i) => card(p, `备选 ${i + 1}`)).join('') : '<p class="empty">没有其他长度 ≤ 5 的路径。</p>');
        cacheResults([main, ...alts]);
      }
    }
    el.innerHTML = header('找路径') + `
      <p class="p-help">依次点击画布上的两个节点，或在下面输入编号。路径只走当前筛选下可见的线。</p>
      <div class="path-form">
        <label>起点 <input list="nodeOptions" data-field="from" value="${esc(q.from || '')}" placeholder="如 R-04"></label>
        <label>终点 <input list="nodeOptions" data-field="to" value="${esc(q.to || '')}" placeholder="如 C-04"></label>
        <datalist id="nodeOptions">${opts}</datalist>
        <div class="path-btns">
          <button type="button" class="icon-btn small" data-act="swap">交换</button>
          <button type="button" class="icon-btn small" data-act="clear-path">清除</button>
          <label class="p-toggle"><input type="checkbox" data-act="source-first" ${q.sourceFirst ? 'checked' : ''}> 优先走文献路径</label>
        </div>
      </div>
      <div class="path-results">${results}</div>`;
  }
  let lastResults = [];
  function cacheResults(list) { lastResults = list; }

  /* ---------- 空缺 ---------- */
  function gapItem(g, s) {
    const edges = model.edgesByGap.get(g.id) || [];
    return `<li><button type="button" class="gap-item${s.gap === g.id ? ' cur' : ''}" data-act="gap" data-id="${esc(g.id)}">
      <div class="gap-row"><span class="r-id">${esc(g.id)}</span>${g.key ? '<span class="gap-star" title="重点问题">★</span>' : ''}<span class="gap-title">${esc(g.title)}</span>${gapPill(g.status)}</div>
      <div class="gap-sum">${esc(g.summary)}</div>
      <div class="gap-meta">${(g.nodes || []).length} 个节点 · ${edges.length} 条线</div>
    </button></li>`;
  }
  function renderGaps(s) {
    const order = ['几乎空白', '有初步工作', '已基本解决'];
    const sorted = [...model.gaps].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.key - a.key));
    el.innerHTML = header('空缺问题') + `<p class="p-help">点击一个空缺，画布高亮它的节点和相关的线。★ 是你标记的重点问题。</p><ul class="gap-list">${sorted.map((g) => gapItem(g, s)).join('')}</ul>`;
  }

  function render() {
    const s = get();
    switch (s.panel) {
      case 'node': renderNode(s); break;
      case 'edge': renderEdge(s); break;
      case 'path': renderPath(s); break;
      case 'gaps': renderGaps(s); break;
      default: el.innerHTML = `<p class="empty">点击节点或关系查看详情。<br>悬停看连线，滚轮缩放，<kbd>Esc</kbd> 取消选择。</p>`;
    }
    el.parentElement.scrollTop = 0;
  }

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    const s = get();
    if (act === 'close') actions.clear();
    else if (act === 'node') actions.selectNode(id, { zoom: true });
    else if (act === 'edge') actions.selectEdge(id, { zoom: true });
    else if (act === 'gap') actions.selectGap(id);
    else if (act === 'copy-id') actions.copy(s.node);
    else if (act === 'zoom') actions.back();
    else if (act === 'path-from') actions.pathFrom(s.node);
    else if (act === 'swap') { const q = s.pathQuery || {}; set({ pathQuery: { ...q, from: q.to || null, to: q.from || null }, path: null }); }
    else if (act === 'clear-path') set({ pathQuery: { from: null, to: null, sourceFirst: !!(s.pathQuery && s.pathQuery.sourceFirst) }, path: null });
    else if (act === 'path') { const p = lastResults.find((x) => pathKey(x) === b.dataset.key); if (p) actions.showPath(p); }
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target; const s = get();
    if (t.dataset.act === 'depth') set({ depth: t.checked ? 2 : 1 });
    else if (t.dataset.act === 'source-first') set({ pathQuery: { ...(s.pathQuery || {}), sourceFirst: t.checked }, path: null });
    else if (t.dataset.field) {
      const v = t.value.trim().toUpperCase();
      const id = model.byId.has(v) ? v : (model.nodes.find((n) => n.id.toUpperCase() === v || n.name === t.value.trim())?.id || null);
      set({ pathQuery: { ...(s.pathQuery || {}), [t.dataset.field]: id }, path: null });
    }
  });

  subscribe((s, patch) => {
    if (['panel', 'node', 'edge', 'gap', 'path', 'pathQuery', 'depth', 'filters'].some((k) => k in patch)) render();
  });
  render();
  return { render };
}
