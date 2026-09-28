// 找路径：结果在画布上画成横向链条。节点从左到右一字排开，节点之间用带类型颜色、线型和箭头的线相连，
// 线上方写类型名；逆着箭头走的关系，箭头朝左。多条路径上下排列。
import { nodeBox, drawNode, styleEdgePath, CARD } from '../glyph.js';
import { relColor } from '../encoding.js';
import { clusterOf } from '../data.js';
import { formatPath } from '../pathfinder.js';
import { edgeTip, esc } from './shared.js';

const d3 = window.d3;
const TOP = 96, ROW_H = 118, SIDE = 32;

export function createPathView({ svg, root, model, tooltip, actions, getDigested }) {
  const g = svg.append('g').attr('class', 'pathv').attr('display', 'none');
  const bar = d3.select(root).append('div').attr('class', 'pathbar').attr('hidden', true).attr('role', 'group').attr('aria-label', '找路径');
  const msg = d3.select(root).append('div').attr('class', 'path-msg').attr('hidden', true);
  let size = { W: 800, H: 600 }, path = null, res = { paths: [] };
  let items = { nodes: [], edges: [] };

  const opt = model.nodes.map(n => `<option value="${esc(n.id)} ${esc(n.name)}"></option>`).join('');
  bar.html(`<span class="pb-title">找路径</span>
    <datalist id="pathNodes">${opt}</datalist>
    <label class="pb-end"><span>起点</span><input id="pathFrom" type="text" list="pathNodes" data-end="from" placeholder="编号或名称" autocomplete="off" spellcheck="false"></label>
    <button type="button" class="btn icon-btn" data-act="swap" title="交换起点和终点" aria-label="交换起点和终点">⇄</button>
    <label class="pb-end"><span>终点</span><input id="pathTo" type="text" list="pathNodes" data-end="to" placeholder="编号或名称" autocomplete="off" spellcheck="false"></label>
    <label class="switch" title="加权最短路：来源 1，加工 3，未验证再加 2"><input type="checkbox" id="pathPrefer" data-act="prefer"> 优先走文献路径</label>
    <button type="button" class="btn" data-act="copy">复制路径</button>
    <button type="button" class="btn" data-act="exit" title="退出找路径（Esc）">退出</button>`);

  const parse = v => {
    const raw = String(v || '').trim(); if (!raw) return null;
    const first = raw.split(/\s+/)[0].toUpperCase();
    if (model.nodeById.has(first)) return first;
    const hit = model.nodes.find(n => n.name === raw || n.name === raw.replace(/^\S+\s+/, ''));
    return hit ? hit.id : undefined;
  };
  bar.on('change', ev => {
    const t = ev.target;
    if (t.dataset.end) {
      const id = parse(t.value);
      if (id !== undefined) actions.setPathEnd(t.dataset.end, id);
      else t.setCustomValidity('找不到这个节点'), t.reportValidity();
    }
    if (t.dataset.act === 'prefer') actions.setPreferSource(t.checked);
  }).on('input', ev => { if (ev.target.dataset.end) ev.target.setCustomValidity(''); })
    .on('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'swap') actions.swapPath();
      if (b.dataset.act === 'exit') actions.exitPath();
      if (b.dataset.act === 'copy') {
        if (!res.paths.length) return;
        actions.copy(res.paths.map((p, i) => `路径 ${i + 1}：${formatPath(p, model.nodeById)}`).join('\n'), '路径已复制');
      }
    });

  function syncBar() {
    const label = id => (id ? `${id} ${model.nodeById.get(id)?.name ?? ''}` : '');
    const f = bar.select('#pathFrom').node(), t = bar.select('#pathTo').node();
    if (document.activeElement !== f) f.value = label(path.from);
    if (document.activeElement !== t) t.value = label(path.to);
    bar.select('#pathPrefer').property('checked', !!path.prefer);
    bar.select('[data-act="copy"]').property('disabled', !res.paths.length);
  }

  function render() {
    g.selectAll('*').remove();
    msg.attr('hidden', true).html('');
    items = { nodes: [], edges: [] };
    if (!path) return;
    syncBar();
    if (!path.from || !path.to) { showMsg('在上方输入起点和终点，或从节点详情里点"从这里出发找路径"。'); return; }
    if (path.from === path.to) { showMsg('起点和终点是同一个节点。'); return; }
    if (!res.paths.length) {
      const sg = res.suggest;
      showMsg(`<b>在当前筛选下，这两个节点之间没有关系链。</b><br>${sg?.single?.length ? `可以放宽：${sg.single.map(esc).join('、')}` : sg?.all ? `需要同时放宽：${sg.active.map(esc).join('、')}` : '即使取消全部筛选，它们之间也没有关系链。'}`, true);
      return;
    }
    const { W } = size;
    const digested = getDigested();
    res.paths.forEach((p, i) => {
      const n = p.nodes.length;
      const avail = W - SIDE * 2;
      const gap = n > 1 ? Math.max(64, Math.min(150, (avail - n * CARD.w) / (n - 1))) : 0;
      const chainW = n * CARD.w + (n - 1) * gap;
      const scale = chainW > avail ? avail / chainW : 1;
      const x0 = (W - chainW * scale) / 2, y0 = TOP + i * ROW_H;
      const row = g.append('g').attr('class', 'path-row').attr('transform', `translate(${x0},${y0}) scale(${scale})`);
      row.append('text').attr('class', 'path-label').attr('x', 0).attr('y', 0)
        .text(`路径 ${i + 1}（${p.steps.length} 步，其中 ${p.proc} 条加工、${p.untested} 条未验证）${i === 0 ? (path.prefer ? ' · 文献优先' : ' · 最短') : ''}`);
      const cy = 44;
      p.steps.forEach((st, k) => {
        const xa = k * (CARD.w + gap) + CARD.w + 2, xb = (k + 1) * (CARD.w + gap) - 2;
        const [x1, x2] = st.forward ? [xa, xb] : [xb, xa];
        const eg = row.append('g').attr('class', 'edge').attr('data-id', st.edge.id).datum(st.edge);
        eg.append('path').attr('class', 'edge-hit').attr('d', `M${x1},${cy} L${x2},${cy}`);
        styleEdgePath(eg.append('path').attr('d', `M${x1},${cy} L${x2},${cy}`), st.edge);
        if (st.edge.basis === '加工') eg.append('circle').attr('class', 'edge-proc').attr('r', 4).attr('cx', (xa + xb) / 2).attr('cy', cy).style('stroke', relColor(st.edge.type));
        eg.append('text').attr('class', 'path-type').attr('x', (xa + xb) / 2).attr('y', cy - 10).attr('text-anchor', 'middle')
          .style('fill', relColor(st.edge.type)).text(st.forward ? `${st.edge.type} →` : `← ${st.edge.type}`);
        items.edges.push(st.edge);
      });
      p.nodes.forEach((id, k) => {
        const nd = model.nodeById.get(id);
        const c = row.append('g').attr('class', 'node').attr('data-id', id).attr('tabindex', 0).attr('role', 'button')
          .attr('aria-label', `${id} ${nd.name}，打开关系透镜`).attr('transform', `translate(${k * (CARD.w + gap) + CARD.w / 2},${cy})`).datum(nd);
        drawNode(c, nd, nodeBox(nd), { clusterColor: clusterOf(model, nd).color, digested: digested.has(id) });
        c.classed('path-end', k === 0 || k === n - 1);
        items.nodes.push(nd);
      });
    });
  }
  function showMsg(html, warn = false) { msg.attr('hidden', null).classed('warn', warn).html(html); }

  g.on('pointerover', ev => {
    const e = ev.target.closest('g.edge'); if (e) { tooltip.show(edgeTip(model, d3.select(e).datum()), ev); return; }
    const n = ev.target.closest('g.node'); if (n) { const nd = d3.select(n).datum(); tooltip.show(`<div class="tt-head"><span class="tt-id">${esc(nd.id)}</span>${esc(nd.name)}</div>${nd.gist ? `<div class="tt-body">${esc(nd.gist)}</div>` : ''}<div class="tt-meta">点击进入关系透镜</div>`, ev); }
  }).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide())
    .on('click', ev => {
      const e = ev.target.closest('g.edge'); if (e) { ev.stopPropagation(); actions.selectEdge(d3.select(e).datum().id); return; }
      const n = ev.target.closest('g.node'); if (n) { ev.stopPropagation(); tooltip.hide(); actions.exitPath(); actions.openLens(d3.select(n).datum().id, { from: 'other' }); }
    })
    .on('keydown', ev => { const n = ev.target.closest('g.node'); if (n && ev.key === 'Enter') { actions.exitPath(); actions.openLens(d3.select(n).datum().id, { from: 'other' }); } });

  return {
    g,
    set(p, r) {
      path = p && p.active ? p : null;
      res = r || { paths: [] };
      g.attr('display', path ? null : 'none');
      bar.attr('hidden', path ? null : true);
      if (!path) msg.attr('hidden', true);
      render();
    },
    active: () => !!path,
    resize(s) { size = s; if (path) render(); },
    focusInput() { const f = bar.select(path?.from ? '#pathTo' : '#pathFrom').node(); if (f) f.focus(); },
    legend: () => items,
    summary: () => res.paths.map(p => ({ steps: p.steps.length, proc: p.proc, untested: p.untested, text: formatPath(p, model.nodeById) })),
  };
}
