// 右侧详情面板：节点、关系、找路径、空缺列表。只有一句话级别的文字，其余靠视觉编码。
import { REL_TYPES, REL, STATUS, BASIS, EVIDENCE, CROWDING, relColor } from './encoding.js';
import { clusterOf } from './data.js';
import { formatPath } from './pathfinder.js';
import { relSampleSvg } from './glyph.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createPanel(el, { model, actions, getDigested, getNotion }) {
  const nodeName = id => model.nodeById.get(id)?.name ?? id;
  const dot = c => `<span class="dot" style="background:${c}"></span>`;
  const basisTag = b => `<span class="btag ${b === '加工' ? 'proc' : 'src'}" title="${esc(BASIS[b]?.long || '')}">${esc(b || '?')}</span>`;
  const evBadge = ev => `<span class="evb ev-${EVIDENCE[ev]?.key || 'na'}" title="${esc(EVIDENCE[ev]?.meaning || '')}">${esc(ev)}</span>`;
  const crowd = c => {
    const lv = CROWDING[c]?.level || 0;
    return `<span class="crowd-tag" title="${esc(CROWDING[c]?.meaning || '')}">${[0, 1, 2].map(i => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}${esc(c)}</span>`;
  };
  const relSample = (type, status = '确立') => relSampleSvg(type, status);
  const nodeBtn = id => `<button type="button" class="nlink" data-node="${esc(id)}"><span class="mono">${esc(id)}</span>${esc(nodeName(id))}</button>`;
  const gapStatusCls = s => (s === '几乎空白' ? 'blank' : s === '有初步工作' ? 'early' : 'solved');

  // ---------- 节点 ----------
  function nodeHtml(n, st, vis) {
    const c = clusterOf(model, n);
    const rel = model.edgesByNode.get(n.id) || [];
    const groups = REL_TYPES.map(t => ({
      t, out: rel.filter(e => e.type === t && e.from === n.id), inn: rel.filter(e => e.type === t && e.to === n.id),
    })).filter(g => g.out.length || g.inn.length);
    const relItem = (e, other) => `<li><button type="button" class="rel-item${vis.edges.has(e.id) ? '' : ' muted'}" data-edge="${esc(e.id)}" title="${vis.edges.has(e.id) ? '' : '当前筛选下隐藏'}">
        <span class="mono">${esc(other)}</span><span class="nm">${esc(nodeName(other))}</span>
        <span class="marks">${e.status !== '确立' ? `<i class="st ${e.status === '初步' ? 'dash' : 'dot'}" title="${esc(e.status)}"></i>` : ''}${e.basis === '加工' ? '<i class="proc" title="Claude 加工"></i>' : ''}</span></button></li>`;
    const gaps = model.gaps.filter(g => Array.isArray(g.nodes) && g.nodes.includes(n.id));
    const done = getDigested().has(n.id);
    const notion = getNotion(n.id);
    const inLens = st.view === 'network' && st.net.level === 'lens' && st.net.trail[st.net.pos] === n.id;
    const lensBtn = inLens ? '' : '<button type="button" class="btn primary" data-act="open-lens">在关系透镜中打开</button>';
    return `
      <div class="p-toolbar">
        <label class="switch"><input type="checkbox" data-act="depth" ${st.depth === 2 ? 'checked' : ''}> 显示两跳</label>
        ${vis.nodes.has(n.id) ? '' : '<span class="warn-chip">当前筛选下隐藏</span>'}
      </div>
      <div class="p-id"><span class="big-id">${esc(n.id)}</span><button type="button" class="mini" data-act="copy-id" title="复制编号">复制编号</button></div>
      <h2>${esc(n.name)}</h2>
      ${n.name_en ? `<p class="en">${esc(n.name_en)}</p>` : ''}
      <div class="tags">
        <span class="tag">${esc(n.kind)}</span>
        <span class="tag" title="${esc(c.desc || '')}">${dot(c.color)}${esc(c.name)}</span>
        <span class="tag mono">${esc(n.year)}</span>
        ${evBadge(n.evidence)}
        ${crowd(n.crowding)}
        ${n.ai_related ? '<span class="tag ai">AI 相关</span>' : ''}
      </div>
      ${Array.isArray(n.alerts) && n.alerts.length ? `<div class="alert-box">${n.alerts.map(a => `<p>! ${esc(a)}</p>`).join('')}</div>` : ''}
      ${n.gist ? `<p class="liner" style="--c:${c.color}">${esc(n.gist)} ${basisTag(n.gist_basis)}</p>` : ''}
      ${n.unverified ? '<p class="unv">? 据已有知识补充，本次未经检索核验</p>' : ''}
      ${n.note ? `<p class="note">${esc(n.note)}</p>` : ''}
      ${Array.isArray(n.refs) && n.refs.length ? `<section><h3>代表文献</h3><ul class="refs">${n.refs.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}
      <section><h3>关系 · ${rel.length}</h3>
        ${groups.length ? groups.map(g => `<div class="rel-group">
          <div class="rg-head">${relSample(g.t)}<b style="color:${relColor(g.t)}">${esc(g.t)}</b><span class="rg-mean">${esc(REL[g.t].meaning)}</span></div>
          <div class="rg-cols">
            <div><div class="rg-sub">它指向谁 →</div>${g.out.length ? `<ul>${g.out.map(e => relItem(e, e.to)).join('')}</ul>` : '<p class="none">—</p>'}</div>
            <div><div class="rg-sub">← 谁指向它</div>${g.inn.length ? `<ul>${g.inn.map(e => relItem(e, e.from)).join('')}</ul>` : '<p class="none">—</p>'}</div>
          </div></div>`).join('') : '<p class="none">没有与它相连的关系</p>'}
      </section>
      ${gaps.length ? `<section><h3>相关空缺 · ${gaps.length}</h3><ul class="gap-mini">${gaps.map(g => `<li><button type="button" data-gap="${esc(g.id)}"><span class="mono">${esc(g.id)}</span>${g.key ? '<span class="star" title="重点问题">★</span>' : ''}${esc(g.title)}<span class="gs ${gapStatusCls(g.status)}">${esc(g.status)}</span></button></li>`).join('')}</ul></section>` : ''}
      <div class="actions">
        ${lensBtn}
        <button type="button" class="btn" data-act="copy-prompt" title="复制一段提问，粘贴到和 Claude 的对话里请它讲解">复制给 Claude 的提问</button>
        <button type="button" class="btn${done ? ' on' : ''}" data-act="digest" aria-pressed="${done}">${done ? '✓ 已消化' : '标记已消化'}</button>
        <button type="button" class="btn" data-act="path-from">从这里出发找路径</button>
      </div>
      <div class="notion">
        ${notion && !st.notionEdit
          ? `<a class="btn" href="${esc(notion)}" target="_blank" rel="noopener noreferrer">在 Notion 打开</a><button type="button" class="mini" data-act="notion-edit">修改链接</button>`
          : `<label for="notionInput">Notion 链接</label><div class="notion-row"><input id="notionInput" type="url" placeholder="粘贴这个节点的 Notion 页面链接" value="${esc(notion || '')}" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-act="notion-save">保存</button></div>
             <p class="notion-err" hidden></p>`}
      </div>`;
  }

  // ---------- 关系 ----------
  function edgeHtml(e, vis) {
    const g = e.gap ? model.gapById.get(e.gap) : null;
    return `
      <div class="p-id"><span class="big-id">${esc(e.id)}</span>${vis.edges.has(e.id) ? '' : '<span class="warn-chip">当前筛选下隐藏</span>'}</div>
      <div class="edge-ends">${nodeBtn(e.from)}<span class="arrow" style="color:${relColor(e.type)}">—${esc(e.type)}→</span>${nodeBtn(e.to)}</div>
      ${e.reason ? `<p class="liner" style="--c:${relColor(e.type)}">${esc(e.reason)}</p>` : ''}
      <dl class="kv">
        <dt>类型</dt><dd>${relSample(e.type)}<b style="color:${relColor(e.type)}">${esc(e.type)}</b> · ${esc(REL[e.type]?.meaning || '')}</dd>
        <dt>状态</dt><dd>${relSample('继承', e.status)}<b>${esc(e.status)}</b> · ${esc(STATUS[e.status]?.rule || '')}</dd>
        <dt>依据</dt><dd>${basisTag(e.basis)} ${esc(e.basis === '加工' ? 'Claude 的推断或连接' : '文献结论')}</dd>
        ${e.ref ? `<dt>文献</dt><dd>${esc(e.ref)}</dd>` : ''}
        ${g ? `<dt>空缺</dt><dd><button type="button" class="nlink" data-gap="${esc(g.id)}"><span class="mono">${esc(g.id)}</span>${esc(g.title)}</button></dd>` : ''}
      </dl>
      ${e.unverified ? '<p class="unv">? 据已有知识补充，本次未经检索核验</p>' : ''}`;
  }

  // ---------- 空缺 ----------
  function gapsHtml(st) {
    const order = ['几乎空白', '有初步工作', '已基本解决'];
    const list = [...model.gaps].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const selId = st.sel?.kind === 'gap' ? st.sel.id : null;
    return `<h2 class="p-title">空缺问题 · ${model.gaps.length}</h2>
      <ul class="gap-list">${list.map(g => {
        const open = g.id === selId;
        const edges = model.edges.filter(e => e.gap === g.id);
        return `<li class="${open ? 'open' : ''}"><button type="button" class="gap-card" data-gap="${esc(g.id)}" aria-expanded="${open}">
          <span class="gc-head"><span class="mono">${esc(g.id)}</span>${g.key ? '<span class="star" title="重点问题">★</span>' : ''}<span class="gs ${gapStatusCls(g.status)}">${esc(g.status)}</span></span>
          <span class="gc-title">${esc(g.title)}</span>
          <span class="gc-sum">${esc(g.summary || '')}</span></button>
          ${open ? `<div class="gc-more">
            <div class="rg-sub">相关节点</div><div class="chips">${(g.nodes || []).map(nodeBtn).join('')}</div>
            ${edges.length ? `<div class="rg-sub">相关关系</div><ul>${edges.map(e => `<li><button type="button" class="rel-item" data-edge="${esc(e.id)}"><span class="mono">${esc(e.from)}</span><span class="arrow" style="color:${relColor(e.type)}">—${esc(e.type)}→</span><span class="mono">${esc(e.to)}</span></button></li>`).join('')}</ul>` : ''}
          </div>` : ''}</li>`;
      }).join('')}</ul>`;
  }

  // ---------- 找路径 ----------
  function chainHtml(p) {
    let s = `<span class="pn">${esc(p.nodes[0])} ${esc(nodeName(p.nodes[0]))}</span>`;
    p.steps.forEach((stp, i) => {
      const t = stp.edge.type;
      const proc = stp.edge.basis === '加工' ? '<i class="proc" title="Claude 加工"></i>' : '';
      s += `<span class="pa" style="color:${relColor(t)}">${stp.forward ? `—${esc(t)}→` : `←${esc(t)}—`}${proc}</span><span class="pn">${esc(p.nodes[i + 1])} ${esc(nodeName(p.nodes[i + 1]))}</span>`;
    });
    return s;
  }
  function pathHtml(st, res) {
    const opt = model.nodes.map(n => `<option value="${esc(n.id)} ${esc(n.name)}"></option>`).join('');
    const val = id => (id ? `${id} ${nodeName(id)}` : '');
    let body = '';
    if (!st.path.from || !st.path.to) body = `<p class="hint">${st.path.from ? '再点一个节点作为终点' : '在画布上依次点击两个节点，或在上面输入编号 / 名称'}</p>`;
    else if (st.path.from === st.path.to) body = '<p class="hint">起点和终点是同一个节点</p>';
    else if (!res.paths.length) {
      const sg = res.suggest;
      body = `<div class="no-path"><b>在当前筛选下，这两个节点不连通。</b>
        ${sg?.single?.length ? `<p>可以放宽：${sg.single.map(esc).join('、')}</p>` : sg?.all ? `<p>需要同时放宽：${sg.active.map(esc).join('、')}</p>` : '<p>即使取消全部筛选，它们之间也没有关系链。</p>'}</div>`;
    } else {
      body = `<ol class="path-list">${res.paths.map((p, i) => `<li><button type="button" class="path-card${i === st.path.chosen ? ' on' : ''}" data-path="${i}" title="${esc(formatPath(p, model.nodeById))}">
        <span class="pc-label">${i === 0 ? (st.path.prefer ? '文献优先' : '最短路径') : `备选 ${i}`}</span>
        <span class="chain">${chainHtml(p)}</span>
        <span class="pc-meta">共 ${p.steps.length} 步，其中 ${p.proc} 条是 Claude 加工，${p.untested} 条未验证</span></button></li>`).join('')}</ol>`;
    }
    return `<h2 class="p-title">找路径</h2>
      <datalist id="nodeOptions">${opt}</datalist>
      <div class="path-inputs">
        <label><span>起点</span><input type="text" list="nodeOptions" data-end="from" value="${esc(val(st.path.from))}" placeholder="点画布或输入" autocomplete="off"></label>
        <button type="button" class="mini" data-act="swap" title="交换起点和终点">⇅</button>
        <label><span>终点</span><input type="text" list="nodeOptions" data-end="to" value="${esc(val(st.path.to))}" placeholder="点画布或输入" autocomplete="off"></label>
      </div>
      <label class="switch"><input type="checkbox" data-act="prefer" ${st.path.prefer ? 'checked' : ''}> 优先走文献路径 <span class="muted-s">（来源 1，加工 3，未验证 +2）</span></label>
      ${body}
      <div class="actions"><button type="button" class="btn" data-act="exit-path">退出找路径</button></div>`;
  }

  // ---------- 渲染与事件 ----------
  const body = el.querySelector('.p-body');
  let mode = null;

  function render(st, vis, extra = {}) {
    let html = '';
    if (st.path.active) { mode = 'path'; html = pathHtml(st, extra.pathRes || { paths: [] }); }
    else if (st.panel === 'gaps' || (st.panel === 'detail' && st.sel?.kind === 'gap')) { mode = 'gaps'; html = gapsHtml(st); }
    else if (st.panel === 'detail' && st.sel?.kind === 'node' && model.nodeById.has(st.sel.id)) { mode = 'node'; html = nodeHtml(model.nodeById.get(st.sel.id), st, vis); }
    else if (st.panel === 'detail' && st.sel?.kind === 'edge' && model.edgeById.has(st.sel.id)) { mode = 'edge'; html = edgeHtml(model.edgeById.get(st.sel.id), vis); }
    else mode = null;
    el.classList.toggle('open', !!mode);
    el.setAttribute('aria-hidden', String(!mode));
    el.dataset.mode = mode || '';
    const scroll = body.scrollTop;
    body.innerHTML = html;
    if (extra.keepScroll) body.scrollTop = scroll;
  }

  el.addEventListener('click', ev => {
    const t = ev.target.closest('button, [data-act]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.node) return actions.selectNode(t.dataset.node, { zoom: true, detail: true });
    if (t.dataset.edge) return actions.selectEdge(t.dataset.edge, { zoom: true });
    if (t.dataset.gap) return actions.selectGap(t.dataset.gap);
    if (t.dataset.path) return actions.choosePath(+t.dataset.path);
    switch (t.dataset.act) {
      case 'close': return actions.closePanel();
      case 'copy-id': return actions.copy(model.nodeById.get(actions.state().sel.id).id, '编号已复制');
      case 'path-from': return actions.startPath(actions.state().sel.id);
      case 'open-lens': return actions.openLens(actions.state().sel.id, { from: 'other' });
      case 'copy-prompt': return actions.copyPrompt(actions.state().sel.id);
      case 'digest': return actions.toggleDigested(actions.state().sel.id);
      case 'notion-edit': return actions.editNotion(true);
      case 'notion-save': {
        const input = el.querySelector('#notionInput'), err = el.querySelector('.notion-err');
        const v = input.value.trim();
        if (v && !/^https?:\/\/\S+$/i.test(v)) { err.hidden = false; err.textContent = '链接要以 http:// 或 https:// 开头'; return; }
        return actions.setNotion(actions.state().sel.id, v);
      }
      case 'exit-path': return actions.exitPath();
      case 'swap': return actions.swapPath();
    }
  });
  el.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.act === 'depth') actions.setDepth(t.checked ? 2 : 1);
    if (t.dataset.act === 'prefer') actions.setPreferSource(t.checked);
    if (t.dataset.end) {
      const id = t.value.trim().split(/\s+/)[0].toUpperCase();
      if (model.nodeById.has(id)) actions.setPathEnd(t.dataset.end, id);
      else if (!t.value.trim()) actions.setPathEnd(t.dataset.end, null);
    }
  });

  return { render, mode: () => mode };
}
