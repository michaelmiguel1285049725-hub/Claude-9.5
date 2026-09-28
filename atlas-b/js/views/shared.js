// 三个视角共用的交互零件：高亮规则、悬停提示、关系线绘制、可缩放画布。
// 同一套规则保证"在一个视角里学会的读图方式，换到另一个视角照样成立"。
import { styleEdgePath } from '../glyph.js';
import { relColor } from '../encoding.js';

const d3 = window.d3;
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 提示内容 ----------
export const nodeTip = n => `<div class="tt-head"><span class="tt-id">${esc(n.id)}</span>${esc(n.name)}</div>${n.gist ? `<div class="tt-body">${esc(n.gist)}</div>` : ''}`;
export function edgeTip(model, e) {
  const a = model.nodeById.get(e.from), b = model.nodeById.get(e.to);
  return `<div class="tt-head">${esc(a.name)} <span class="tt-rel" style="color:${relColor(e.type)}">—${esc(e.type)}→</span> ${esc(b.name)}</div>
    <div class="tt-body">${esc(e.reason || '')}</div>
    <div class="tt-meta">${esc(e.status)} · ${e.basis === '加工' ? 'Claude 加工' : '来源'}${e.unverified ? ' · 未经检索核验' : ''}</div>`;
}

// ---------- 高亮规则 ----------
// 优先级：空缺 > 选中的关系 > 聚焦的节点 > 悬停。mode=focus 时其余降到 10%，hover 时降到 25%。
function neighbors(visEdges, id, depth) {
  const nodes = new Set([id]), edges = new Set();
  for (const e of visEdges) {
    if (e.from === id) { nodes.add(e.to); edges.add(e.id); }
    else if (e.to === id) { nodes.add(e.from); edges.add(e.id); }
  }
  const nodes2 = new Set(), edges2 = new Set();
  if (depth >= 2) {
    for (const e of visEdges) {
      if (edges.has(e.id) || !(nodes.has(e.from) || nodes.has(e.to))) continue;
      edges2.add(e.id);
      if (!nodes.has(e.from)) nodes2.add(e.from);
      if (!nodes.has(e.to)) nodes2.add(e.to);
    }
  }
  return { nodes, edges, nodes2, edges2 };
}

export function computeHighlight(model, vis, view, hover = {}) {
  const empty = () => ({ nodes2: new Set(), edges2: new Set() });
  if (view.gap && model.gapById.has(view.gap)) {
    const g = model.gapById.get(view.gap);
    const edges = new Set(model.edges.filter(e => e.gap === g.id).map(e => e.id));
    const nodes = new Set(Array.isArray(g.nodes) ? g.nodes : []);
    for (const e of model.edges) if (edges.has(e.id)) { nodes.add(e.from); nodes.add(e.to); }
    return { mode: 'focus', nodes, edges, gap: g.id, ...empty() };
  }
  if (view.sel?.kind === 'edge' && model.edgeById.has(view.sel.id)) {
    const e = model.edgeById.get(view.sel.id);
    return { mode: 'focus', nodes: new Set([e.from, e.to]), edges: new Set([e.id]), selEdge: e.id, ...empty() };
  }
  if (view.sel?.kind === 'node' && model.nodeById.has(view.sel.id)) {
    return { mode: 'focus', ...neighbors(vis.visibleEdgeList, view.sel.id, view.depth), selNode: view.sel.id };
  }
  if (hover.node) return { mode: 'hover', ...neighbors(vis.visibleEdgeList, hover.node, 1) };
  if (hover.edge && model.edgeById.has(hover.edge)) {
    const e = model.edgeById.get(hover.edge);
    return { mode: 'hover', nodes: new Set([e.from, e.to]), edges: new Set([e.id]), ...empty() };
  }
  return null;
}

// 把高亮结果套到一个视角的节点和线上
export function applyHighlight(svg, nodeSel, edgeSel, h, view) {
  svg.classed('mode-focus', h?.mode === 'focus').classed('mode-hover', h?.mode === 'hover');
  nodeSel
    .classed('hi', n => !!h && h.nodes.has(n.id))
    .classed('hi2', n => !!h && h.nodes2.has(n.id))
    .classed('sel', n => h?.selNode === n.id);
  if (edgeSel) edgeSel
    .classed('hi', e => !!h && h.edges.has(e.id))
    .classed('hi2', e => !!h && h.edges2.has(e.id))
    .classed('sel', e => h?.selEdge === e.id);
}

// ---------- 关系线 ----------
// geo: Map(edgeId → { d, mid })。线的颜色、线型、箭头、加工空心圆与关系网完全相同。
export function joinEdges(g, edges, geo) {
  const eg = g.selectAll('g.edge').data(edges, e => e.id).join(enter => {
    const x = enter.append('g').attr('class', 'edge');
    x.append('path').attr('class', 'edge-hit');
    x.append('path').attr('class', 'edge-line');
    x.append('circle').attr('class', 'edge-proc').attr('r', 4);
    x.each(function (e) { styleEdgePath(d3.select(this).select('.edge-line'), e); });
    return x;
  });
  eg.attr('data-id', e => e.id);
  eg.select('.edge-hit').attr('d', e => geo.get(e.id).d);
  eg.select('.edge-line').attr('d', e => geo.get(e.id).d);
  eg.select('.edge-proc')
    .attr('cx', e => geo.get(e.id).mid.x).attr('cy', e => geo.get(e.id).mid.y)
    .style('stroke', e => relColor(e.type))
    .attr('display', e => (e.basis === '加工' ? null : 'none'));
  return eg;
}

// 从矩形中心朝 (tx,ty) 方向，求与矩形边（外扩 pad）的交点
export function boxEdgePoint(c, b, tx, ty, pad = 2) {
  const dx = tx - c.x, dy = ty - c.y;
  if (!dx && !dy) return { x: c.x, y: c.y };
  const sx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// 两个矩形之间的弧线：往行进方向左侧弯，A→B 和 B→A 自然分到两边
export function arcBetween(S, sb, T, tb, bend = 0.22) {
  const len = Math.hypot(T.x - S.x, T.y - S.y) || 1;
  const px = -(T.y - S.y) / len, py = (T.x - S.x) / len;
  const off = Math.min(160, len * bend);
  const mx = (S.x + T.x) / 2 + px * off, my = (S.y + T.y) / 2 + py * off;
  const p0 = boxEdgePoint(S, sb, mx, my), p1 = boxEdgePoint(T, tb, mx, my);
  return {
    d: `M${p0.x},${p0.y} Q${mx},${my} ${p1.x},${p1.y}`,
    mid: { x: 0.25 * p0.x + 0.5 * mx + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * my + 0.25 * p1.y },
  };
}

// 节点和线的悬停、点击事件（三个视角一致）
export function bindInteractions({ gNode, gEdge, model, tooltip, actions, onHover }) {
  let hn = null, he = null;
  gNode.on('pointerover', ev => {
    const el = ev.target.closest('g.node'); if (!el) return;
    const n = d3.select(el).datum();
    if (hn !== n.id) { hn = n.id; he = null; onHover({ node: hn }); }
    tooltip.show(nodeTip(n), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => {
      const el = ev.target.closest('g.node');
      if (el && !el.contains(ev.relatedTarget)) { hn = null; onHover({}); tooltip.hide(); }
    })
    .on('click', ev => {
      const el = ev.target.closest('g.node'); if (!el) return;
      ev.stopPropagation();
      actions.clickNode(d3.select(el).datum().id);
    })
    .on('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const el = ev.target.closest('g.node'); if (!el) return;
      ev.preventDefault();
      actions.clickNode(d3.select(el).datum().id);
    });
  if (gEdge) gEdge.on('pointerover', ev => {
    const el = ev.target.closest('g.edge'); if (!el) return;
    const e = d3.select(el).datum();
    if (he !== e.id) { he = e.id; hn = null; onHover({ edge: he }); }
    tooltip.show(edgeTip(model, e), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => {
      const el = ev.target.closest('g.edge');
      if (el && !el.contains(ev.relatedTarget)) { he = null; onHover({}); tooltip.hide(); }
    })
    .on('click', ev => {
      const el = ev.target.closest('g.edge'); if (!el) return;
      ev.stopPropagation();
      actions.selectEdge(d3.select(el).datum().id);
    });
}

// ---------- 可缩放画布（成熟度、时间线用） ----------
export function createZoomCanvas(root, cls, { onZoom } = {}) {
  const svg = d3.select(root).append('svg').attr('class', `canvas ${cls}`).attr('data-level', 'mid').attr('role', 'application');
  const viewport = svg.append('g').attr('class', 'viewport');
  let bounds = { x0: 0, y0: 0, x1: 100, y1: 100 };
  let fitK = 1;
  const zoom = d3.zoom().on('zoom', ev => { viewport.attr('transform', ev.transform); onZoom && onZoom(ev.transform); });
  svg.call(zoom).on('dblclick.zoom', null);
  const size = () => ({ W: svg.node().clientWidth || 800, H: svg.node().clientHeight || 600 });
  const go = (t, animate) => (animate && !reduceMotion() ? svg.transition().duration(260) : svg).call(zoom.transform, t);
  function fitBox(b, pad) {
    const { W, H } = size();
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    return { k, t: (kk = k) => d3.zoomIdentity.translate(W / 2 - kk * (b.x0 + bw / 2), H / 2 - kk * (b.y0 + bh / 2)).scale(kk) };
  }
  const api = {
    svg, viewport,
    setBounds(b) { bounds = b; fitK = fitBox(bounds, 24).k; zoom.scaleExtent([fitK * 0.3, Math.max(fitK * 5, 2.5)]); },
    fitAll(animate = true) { const f = fitBox(bounds, 24); fitK = f.k; go(f.t(), animate); },
    // 缩放到一组矩形；不小于"适配全部"，最多放大到 1.6
    zoomToBox(b, animate = true) {
      const f = fitBox(b, 70);
      go(f.t(Math.max(fitK, Math.min(f.k, 1.6))), animate);
    },
    // 矩形不在视口里时才移动
    ensureVisible(b) {
      const t = d3.zoomTransform(svg.node()); const { W, H } = size();
      const [x0, y0] = t.apply([b.x0, b.y0]), [x1, y1] = t.apply([b.x1, b.y1]);
      if (x0 < 10 || y0 < 10 || x1 > W - 10 || y1 > H - 10) {
        const k = t.k, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        go(d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k), true);
      }
    },
    transform: () => d3.zoomTransform(svg.node()),
  };
  return api;
}
