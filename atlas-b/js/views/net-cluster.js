// 关系网第二层：研究线展开。当前研究线的节点排成整齐网格（按年份或按类型），
// 其他研究线缩成画布四周的小气泡；内部关系淡淡画出，悬停节点时才画它的跨研究线关系。
import { nodeBox, drawNode, CARD } from '../glyph.js';
import { KINDS } from '../encoding.js';
import { clusterOf } from '../data.js';
import { arcBetween, boxEdgePoint, joinEdges, edgeTip, nodeTip, esc, reduceMotion } from './shared.js';

const d3 = window.d3;
const GX = 24, GY = 28, SIDE = 96, TOP = 104, BOTTOM = 64, EDGE_R = 26, EDGE_M = 46;

export function createClusterView({ svg, model, tooltip, actions, getDigested, store }) {
  const g = svg.append('g').attr('class', 'cl').attr('display', 'none');
  const gWrap = g.append('g').attr('class', 'cl-wrap');
  const gRowLabel = gWrap.append('g').attr('class', 'cl-rowlabels');
  const gEdge = gWrap.append('g').attr('class', 'edges cl-intra');
  const gCross = g.append('g').attr('class', 'edges cl-cross');
  const gNode = gWrap.append('g').attr('class', 'nodes');
  const gBub = g.append('g').attr('class', 'cl-bubbles');

  let vis = null, cid = null, size = { W: 800, H: 600 };
  let sortBy = store.get('clusterSort', 'year') === 'kind' ? 'kind' : 'year';
  let showIntra = store.get('clusterIntra', true) !== false;
  let pos = new Map(), bubbles = [], members = [];
  const B = { w: CARD.w, h: CARD.h };   // 所有卡片同一尺寸

  // ---------- 布局 ----------
  function layoutGrid() {
    pos = new Map();
    const { W, H } = size;
    members = model.nodes.filter(n => n.cluster === cid && vis.nodes.has(n.id));
    const labelW = sortBy === 'kind' ? 72 : 0;
    const avail = W - SIDE * 2 - labelW;
    const cols = Math.max(1, Math.floor((avail + GX) / (CARD.w + GX)));
    let rows = [];
    if (sortBy === 'year') {
      const list = [...members].sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));
      for (let i = 0; i < list.length; i += cols) rows.push({ label: null, items: list.slice(i, i + cols) });
    } else {
      for (const k of KINDS) {
        const list = members.filter(n => n.kind === k).sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));
        for (let i = 0; i < list.length; i += cols) rows.push({ label: i === 0 ? k : null, items: list.slice(i, i + cols) });
      }
    }
    const usedCols = Math.min(cols, Math.max(1, ...rows.map(r => r.items.length)));
    const gridW = labelW + usedCols * CARD.w + (usedCols - 1) * GX;
    const gridH = rows.length * CARD.h + Math.max(0, rows.length - 1) * GY;
    const x0 = (W - gridW) / 2 + labelW, y0 = Math.max(TOP, TOP + (H - TOP - BOTTOM - gridH) / 2);
    rows.forEach((r, ri) => r.items.forEach((n, ci) => pos.set(n.id, { x: x0 + ci * (CARD.w + GX) + CARD.w / 2, y: y0 + ri * (CARD.h + GY) + CARD.h / 2 })));
    return rows.map((r, ri) => ({ label: r.label, x: x0 - 14, y: y0 + ri * (CARD.h + GY) + CARD.h / 2 }));
  }

  // 其他研究线放在它们相对当前研究线的方位上，贴着画布边缘
  function layoutBubbles() {
    const { W, H } = size;
    const cur = model.clusterById.get(cid);
    const others = model.clusters.filter(c => c.id !== cid && model.nodes.some(n => n.cluster === c.id && vis.nodes.has(n.id)));
    const x0 = EDGE_M, x1 = W - EDGE_M, y0 = TOP - 30, y1 = H - EDGE_M;
    const cx = W / 2, cy = (y0 + y1) / 2;
    const per = 2 * ((x1 - x0) + (y1 - y0));
    // 周长参数化：把边界上的点映射到 0..per，便于沿边界拉开
    const toS = (x, y) => {
      if (Math.abs(y - y0) < 0.5) return x - x0;
      if (Math.abs(x - x1) < 0.5) return (x1 - x0) + (y - y0);
      if (Math.abs(y - y1) < 0.5) return (x1 - x0) + (y1 - y0) + (x1 - x);
      return 2 * (x1 - x0) + (y1 - y0) + (y1 - y);
    };
    const fromS = s => {
      s = ((s % per) + per) % per;
      const a = x1 - x0, b = y1 - y0;
      if (s < a) return { x: x0 + s, y: y0 };
      if (s < a + b) return { x: x1, y: y0 + (s - a) };
      if (s < 2 * a + b) return { x: x1 - (s - a - b), y: y1 };
      return { x: x0, y: y1 - (s - 2 * a - b) };
    };
    const list = others.map(o => {
      let dx = (o.anchor[0] - cur.anchor[0]) * W, dy = (o.anchor[1] - cur.anchor[1]) * H;
      if (!dx && !dy) dy = 1;
      const t = Math.min(dx ? (dx > 0 ? (x1 - cx) / dx : (x0 - cx) / dx) : Infinity, dy ? (dy > 0 ? (y1 - cy) / dy : (y0 - cy) / dy) : Infinity);
      const p = { x: Math.max(x0, Math.min(x1, cx + dx * t)), y: Math.max(y0, Math.min(y1, cy + dy * t)) };
      return { c: o, s: toS(p.x, p.y) };
    }).sort((a, b) => a.s - b.s);
    // 相邻气泡至少相隔 96px
    for (let iter = 0; iter < 20; iter++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[(i + 1) % list.length];
        if (list.length < 2) break;
        let gap = b.s - a.s; if (i === list.length - 1) gap += per;
        if (gap < 96) { a.s -= (96 - gap) / 2; b.s += (96 - gap) / 2; }
      }
    }
    const links = new Map();
    for (const e of vis.visibleEdgeList) {
      const a = model.nodeById.get(e.from).cluster, b = model.nodeById.get(e.to).cluster;
      if (a === cid && b !== cid) links.set(b, (links.get(b) || 0) + 1);
      if (b === cid && a !== cid) links.set(a, (links.get(a) || 0) + 1);
    }
    bubbles = list.map(o => ({ c: o.c, ...fromS(o.s), count: links.get(o.c.id) || 0 }));
  }

  // ---------- 绘制 ----------
  function render() {
    if (!vis || !cid) return;
    const labels = layoutGrid();
    layoutBubbles();
    const digested = getDigested();
    gRowLabel.selectAll('text').data(labels.filter(l => l.label)).join('text').attr('class', 'cl-rowlabel')
      .attr('x', d => d.x).attr('y', d => d.y).attr('text-anchor', 'end').attr('dominant-baseline', 'central').text(d => d.label);
    gNode.selectAll('g.node').remove();
    gNode.selectAll('g.node').data(members, n => n.id).join('g').attr('class', 'node').attr('data-id', n => n.id)
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', n => `${n.id} ${n.name}，打开关系透镜`)
      .attr('transform', n => `translate(${pos.get(n.id).x},${pos.get(n.id).y})`)
      .each(function (n) { drawNode(d3.select(this), n, nodeBox(n), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) }); });
    drawIntra();
    const bg = gBub.selectAll('g.cl-bubble').data(bubbles, b => b.c.id).join(enter => {
      const x = enter.append('g').attr('class', 'cl-bubble').attr('tabindex', 0).attr('role', 'button');
      x.append('circle').attr('r', EDGE_R);
      x.append('text').attr('class', 'cl-b-name').attr('text-anchor', 'middle');
      x.append('text').attr('class', 'cl-b-count').attr('text-anchor', 'middle').attr('dominant-baseline', 'central');
      x.append('text').attr('class', 'cl-b-hover').attr('text-anchor', 'middle');
      return x;
    });
    bg.attr('transform', b => `translate(${b.x},${b.y})`).classed('main', b => !!b.c.main)
      .attr('aria-label', b => `${b.c.name}：与当前研究线有 ${b.count} 条关系，点击切换`);
    bg.select('.cl-b-count').text(b => b.count);
    bg.select('.cl-b-name').attr('y', b => (b.y > size.H / 2 ? -EDGE_R - 8 : EDGE_R + 16)).text(b => b.c.name);
    bg.select('.cl-b-hover').attr('y', b => (b.y > size.H / 2 ? -EDGE_R - 26 : EDGE_R + 34)).text('');
    gCross.selectAll('*').remove();
  }

  function drawIntra() {
    const edges = showIntra ? vis.visibleEdgeList.filter(e => pos.has(e.from) && pos.has(e.to)) : [];
    const geo = new Map(edges.map(e => [e.id, arcBetween(pos.get(e.from), B, pos.get(e.to), B, 0.3)]));
    joinEdges(gEdge, edges, geo);
  }

  // 悬停节点：它的内部关系变实，其余降到 10%；并画出它通往边缘小气泡的跨研究线关系
  function hoverNode(id) {
    svg.classed('cl-hover', !!id);
    gEdge.selectAll('g.edge').classed('hi', e => !!id && (e.from === id || e.to === id));
    gNode.selectAll('g.node').classed('hi', n => !!id && (n.id === id || vis.visibleEdgeList.some(e => (e.from === id && e.to === n.id) || (e.to === id && e.from === n.id))));
    gCross.selectAll('*').remove();
    gBub.selectAll('.cl-b-hover').text('');
    if (!id) return;
    const p = pos.get(id), b0 = B;
    const cross = vis.visibleEdgeList.filter(e => (e.from === id && !pos.has(e.to)) || (e.to === id && !pos.has(e.from)));
    const byBubble = d3.group(cross, e => model.nodeById.get(e.from === id ? e.to : e.from).cluster);
    const geo = new Map();
    for (const [other, list] of byBubble) {
      const b = bubbles.find(x => x.c.id === other); if (!b) continue;
      list.forEach((e, i) => {
        const off = (i - (list.length - 1) / 2) * 22;
        const len = Math.hypot(b.x - p.x, b.y - p.y) || 1;
        const nx = -(b.y - p.y) / len, ny = (b.x - p.x) / len;
        const mx = (p.x + b.x) / 2 + nx * off, my = (p.y + b.y) / 2 + ny * off;
        const pNode = boxEdgePoint(p, b0, mx, my, 2);
        const t = EDGE_R + 3, dl = Math.hypot(mx - b.x, my - b.y) || 1;
        const pBub = { x: b.x + (mx - b.x) / dl * t, y: b.y + (my - b.y) / dl * t };
        const [s, q] = e.from === id ? [pNode, pBub] : [pBub, pNode];
        geo.set(e.id, { d: `M${s.x},${s.y} Q${mx},${my} ${q.x},${q.y}`, mid: { x: 0.25 * s.x + 0.5 * mx + 0.25 * q.x, y: 0.25 * s.y + 0.5 * my + 0.25 * q.y } });
      });
      gBub.selectAll('g.cl-bubble').filter(x => x.c.id === other).select('.cl-b-hover').text(`${list.length} 条`);
    }
    joinEdges(gCross, cross.filter(e => geo.has(e.id)), geo);
  }

  // ---------- 交互 ----------
  gNode.on('pointerover', ev => {
    const el = ev.target.closest('g.node'); if (!el) return;
    const n = d3.select(el).datum();
    hoverNode(n.id);
    tooltip.show(nodeTip(n), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => { const el = ev.target.closest('g.node'); if (el && !el.contains(ev.relatedTarget)) { hoverNode(null); tooltip.hide(); } })
    .on('click', ev => { const el = ev.target.closest('g.node'); if (!el) return; ev.stopPropagation(); tooltip.hide(); actions.openLens(d3.select(el).datum().id, { from: 'cluster' }); })
    .on('keydown', ev => { const el = ev.target.closest('g.node'); if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); actions.openLens(d3.select(el).datum().id, { from: 'cluster' }); } });
  gEdge.on('pointerover', ev => {
    const el = ev.target.closest('g.edge'); if (!el) return;
    const e = d3.select(el).datum();
    svg.classed('cl-hover', true);
    gEdge.selectAll('g.edge').classed('hi', x => x.id === e.id);
    tooltip.show(edgeTip(model, e), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', () => { hoverNode(null); tooltip.hide(); })
    .on('click', ev => { const el = ev.target.closest('g.edge'); if (el) { ev.stopPropagation(); actions.selectEdge(d3.select(el).datum().id); } });
  gBub.on('click', ev => { const el = ev.target.closest('g.cl-bubble'); if (el) { ev.stopPropagation(); tooltip.hide(); actions.openCluster(d3.select(el).datum().c.id); } })
    .on('keydown', ev => { const el = ev.target.closest('g.cl-bubble'); if (el && ev.key === 'Enter') actions.openCluster(d3.select(el).datum().c.id); })
    .on('pointerover', ev => {
      const el = ev.target.closest('g.cl-bubble'); if (!el) return;
      const b = d3.select(el).datum();
      tooltip.show(`<div class="tt-head">${esc(b.c.name)}</div><div class="tt-meta">与「${esc(model.clusterById.get(cid).name)}」之间 ${b.count} 条关系 · 点击切换</div>`, ev);
    }).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide());

  // ---------- 工具栏：排序、内部关系 ----------
  function tools(el) {
    el.innerHTML = `<span class="seg small" role="group" aria-label="排列方式">
        <button type="button" data-sort="year" aria-pressed="${sortBy === 'year'}">按年份</button><button type="button" data-sort="kind" aria-pressed="${sortBy === 'kind'}">按节点类型</button></span>
      <button type="button" class="btn" data-intra aria-pressed="${showIntra}">显示内部关系</button>`;
    el.onclick = ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.sort) { sortBy = b.dataset.sort; store.set('clusterSort', sortBy); }
      if ('intra' in b.dataset) { showIntra = !showIntra; store.set('clusterIntra', showIntra); }
      tools(el); render(); actions.legendDirty();
    };
  }

  return {
    g,
    show(c, { from } = {}) {
      const changed = c !== cid;
      cid = c;
      g.attr('display', null);
      render();
      // 从概览进入：从气泡的位置放大展开
      if (changed && from && !reduceMotion()) {
        gWrap.attr('transform', `translate(${from.x},${from.y}) scale(0.15) translate(${-size.W / 2},${-size.H / 2})`).attr('opacity', 0)
          .transition().duration(250).ease(d3.easeCubicOut).attr('transform', null).attr('opacity', 1);
      }
    },
    hide() { g.attr('display', 'none'); },
    setVisibility(v) { vis = v; if (cid && g.attr('display') !== 'none') render(); },
    resize(s) { size = s; if (cid && g.attr('display') !== 'none') render(); },
    render,
    tools,
    legend() {
      const edges = [...gEdge.selectAll('g.edge').data(), ...gCross.selectAll('g.edge').data()];
      return { nodes: members, edges };
    },
  };
}
