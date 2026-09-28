/* 视角一：关系网。
   阶段 1：稳定布局（种子力导向 / layout.json / 用户固定）、簇背景、关系线、节点、缩放平移。
   阶段 2：语义缩放（簇视图）、悬停、聚焦、筛选可见性、路径 / 空缺高亮、拖动固定、缩放到目标。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as tooltip from '../tooltip.js';
import * as progress from '../progress.js';
import { computeVisibility } from '../filters.js';
import { appendNodeGlyph, appendEdgeGlyph, setEdgePath, nodeTip as glyphNodeTip, edgeTip as glyphEdgeTip, borderPoint } from '../glyph.js';
import { computeHighlight, applyClasses } from '../highlight.js';
import { extraInset } from '../zoomable.js';

/* 全览网格布局：每个研究线一个区域，区域内按年份排列；列数按节点数：≤3 → 1 列，4–8 → 2 列，≥9 → 3 列 */
const GX = 12, GY = 10, PAD = 16, TITLE_H = 30, REGION_GAP = 48;
const esc = tooltip.esc;
function colsFor(n) { return n <= 3 ? 1 : n <= 8 ? 2 : 3; }

function prefersReduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

export function createNetwork({ svgEl, stageEl, model, onNodeClick }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('#world');
  const gHulls = world.append('g').attr('class', 'hulls');
  const gEdges = world.append('g').attr('class', 'edges');
  const gNodes = world.append('g').attr('class', 'nodes');
  const gBubbles = world.append('g').attr('class', 'bubbles');

  /* ---- 布局数据（不改内容包对象，另建一层） ---- */
  const sn = model.nodes.map((n) => ({ id: n.id, ref: n, w: enc.NODE_W, h: enc.NODE_H, x: 0, y: 0 }));
  const snById = new Map(sn.map((d) => [d.id, d]));
  const se = model.edges.map((e) => ({ id: e.id, ref: e, source: snById.get(e.from), target: snById.get(e.to) }));
  const seById = new Map(se.map((d) => [d.id, d]));
  const pairGroups = new Map();
  for (const e of se) {
    const key = [e.source.id, e.target.id].sort().join('|');
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(e);
  }
  /* 区域：{ c, nodes, cols, rows, x, y, w, h } */
  let regions = [];
  function computeLayout() {
    const bucket = (v) => (v < 0.34 ? 0 : v < 0.67 ? 1 : 2);
    regions = model.clusters.map((c) => {
      const nodes = sn.filter((d) => d.ref._cluster === c.id).sort((p, q) => p.ref.year - q.ref.year || p.id.localeCompare(q.id));
      const cols = colsFor(nodes.length), rows = Math.max(1, Math.ceil(nodes.length / cols));
      const a = c.anchor || [0.5, 0.5];
      return { c, nodes, cols, rows, gx: bucket(a[0]), gy: a[1], w: PAD * 2 + cols * enc.NODE_W + (cols - 1) * GX, h: TITLE_H + PAD + rows * enc.NODE_H + (rows - 1) * GY + PAD };
    }).filter((r) => r.nodes.length);
    /* 三列，每列按 anchor.y 从上到下堆叠 */
    const columns = [0, 1, 2].map((i) => regions.filter((r) => r.gx === i).sort((p, q) => p.gy - q.gy));
    const colW = columns.map((col) => Math.max(0, ...col.map((r) => r.w)));
    const colH = columns.map((col) => col.reduce((h, r) => h + r.h, 0) + Math.max(0, col.length - 1) * REGION_GAP);
    const totalH = Math.max(...colH);
    let x = 0;
    columns.forEach((col, i) => {
      if (!col.length) return;
      let y = (totalH - colH[i]) / 2;
      for (const r of col) {
        r.x = x + (colW[i] - r.w) / 2; r.y = y;
        r.nodes.forEach((d, k) => {
          const ci = k % r.cols, ri = Math.floor(k / r.cols);
          d.x = Math.round(r.x + PAD + ci * (enc.NODE_W + GX) + enc.NODE_W / 2);
          d.y = Math.round(r.y + TITLE_H + PAD + ri * (enc.NODE_H + GY) + enc.NODE_H / 2);
        });
        y += r.h + REGION_GAP;
      }
      x += colW[i] + REGION_GAP;
    });
  }
  computeLayout();

  /* ---- 几何 ---- */
  function edgeGeom(e) {
    const a = e.source, b = e.target;
    const group = pairGroups.get([a.id, b.id].sort().join('|'));
    const k = group.length, i = group.indexOf(e);
    const sign = a.id < b.id ? 1 : -1;
    const off = k === 1 ? 0 : (i - (k - 1) / 2) * 34 * sign;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const cx = (a.x + b.x) / 2 + nx * off * 2, cy = (a.y + b.y) / 2 + ny * off * 2;
    const gap = e.ref.type === '对应' ? 5 : 3;
    const p0 = off ? borderPoint(a, cx, cy, gap) : borderPoint(a, b.x, b.y, gap);
    const p1 = off ? borderPoint(b, cx, cy, gap) : borderPoint(b, a.x, a.y, gap);
    const d = off ? `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}` : `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`;
    const mid = off ? [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]] : [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    return { d, mid };
  }
  /* ---- 研究线区域 ---- */
  function drawHulls() {
    const sel = gHulls.selectAll('g.hull').data(regions, (d) => d.c.id);
    const ent = sel.enter().append('g').attr('class', 'hull').attr('data-cluster', (d) => d.c.id).style('--c', (d) => d.c._color);
    ent.append('rect').attr('class', 'hull-area').attr('rx', 14);
    ent.append('text').attr('class', 'hull-label').classed('main', (d) => !!d.c.main);
    ent.append('g').attr('class', 'gap-badge');
    ent.on('dblclick', (ev, d) => { ev.stopPropagation(); zoomToCluster(d.c.id); });
    ent.append('title').text((d) => `${d.c.name}${d.c.desc ? '：' + d.c.desc : ''}`);
    positionHulls();
  }
  function positionHulls() {
    gHulls.selectAll('g.hull').each(function (d) {
      const vis = d.nodes.filter((n) => visible.nodeVis.has(n.id));
      const g = d3.select(this).classed('empty', !vis.length);
      g.select('rect').attr('x', d.x).attr('y', d.y).attr('width', d.w).attr('height', d.h);
      const t = g.select('text').attr('x', d.x + 12).attr('y', d.y + 20);
      t.selectAll('tspan').remove(); t.text(d.c.name);
      t.append('tspan').attr('class', 'hull-count').attr('dx', 6).text(vis.length);
      const pr = progress.clusterProgress(model, d.c.id);
      if (pr.done) t.append('tspan').attr('class', 'hull-prog').attr('dx', 8).text(`✓ ${pr.done}/${pr.total}`);
      /* 相关空缺数：琥珀色小徽章 */
      const gapIds = new Set(); for (const n of d.nodes) for (const gp of model.gapsOfNode.get(n.id) || []) gapIds.add(gp.id);
      const gb = g.select('g.gap-badge'); gb.selectAll('*').remove();
      if (gapIds.size) {
        const tw = t.node().getComputedTextLength ? t.node().getComputedTextLength() : 80;
        const bx = d.x + 12 + tw + 14;
        gb.attr('transform', `translate(${bx},${d.y + 15})`);
        gb.append('circle').attr('r', 8);
        gb.append('text').attr('y', 3.5).text(gapIds.size);
        gb.append('title').text(`这条研究线涉及 ${gapIds.size} 个空缺问题：${[...gapIds].join('、')}`);
      }
    });
  }

  function drawEdges() {
    const sel = gEdges.selectAll('g.edge').data(se, (d) => d.id);
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    ent.on('mouseenter', (ev, d) => { set({ hoverEdge: d.id }); tooltip.show(edgeTip(d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverEdge: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); selectEdge(d.id); });
    positionEdges();
  }
  function positionEdges() {
    gEdges.selectAll('g.edge').each(function (d) { const g = edgeGeom(d); setEdgePath(d3.select(this), g.d, g.mid); });
  }

  function drawNodes() {
    const sel = gNodes.selectAll('g.node').data(sn, (d) => d.id);
    const ent = appendNodeGlyph(sel.enter().append('g'), model);
    /* 交互 */
    ent.on('mouseenter', (ev, d) => { set({ hoverNode: d.id }); tooltip.show(nodeTip(d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverNode: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); if (onNodeClick && onNodeClick(d.id)) return; toggleSelect(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (onNodeClick && onNodeClick(d.id)) return; toggleSelect(d.id); } });
    positionNodes();
  }
  function positionNodes() { gNodes.selectAll('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`); }
  function positionAll() { positionNodes(); positionEdges(); positionHulls(); if (svgEl.getAttribute('data-level') === '1') drawBubbles(); }

  /* ---- 簇视图（远距离） ---- */
  function clusterStats() {
    const stats = [];
    for (const c of model.clusters) {
      const nodes = sn.filter((d) => d.ref._cluster === c.id && visible.nodeVis.has(d.id));
      if (!nodes.length) continue;
      stats.push({ c, nodes, x: d3.mean(nodes, (d) => d.x), y: d3.mean(nodes, (d) => d.y), r: 28 + 11 * Math.sqrt(nodes.length), progress: progress.clusterProgress(model, c.id) });
    }
    const byId = new Map(stats.map((s) => [s.c.id, s]));
    const links = new Map();
    for (const e of se) {
      if (!visible.edgeVis.has(e.id)) continue;
      const a = e.source.ref._cluster, b = e.target.ref._cluster;
      if (a === b || !byId.has(a) || !byId.has(b)) continue;
      const key = [a, b].sort().join('|');
      if (!links.has(key)) links.set(key, { a: byId.get([a, b].sort()[0]), b: byId.get([a, b].sort()[1]), count: 0, byType: {} });
      const l = links.get(key); l.count++; l.byType[e.ref.type] = (l.byType[e.ref.type] || 0) + 1;
    }
    return { stats, links: [...links.values()] };
  }
  /* 簇视图里的气泡按屏幕像素恒定大小：世界坐标乘以 kFit / 当前 k */
  function bubbleScale() { return Math.max(1, kFit / (transform.k || kFit)); }
  function drawBubbles() {
    if (svgEl.getAttribute('data-level') !== '1' && gBubbles.selectAll('g.bubble').size()) return; /* 非簇视图不重算 */
    const { stats, links } = clusterStats();
    const f = bubbleScale();
    const ls = gBubbles.selectAll('g.clink').data(links, (d) => d.a.c.id + '|' + d.b.c.id);
    const le = ls.enter().append('g').attr('class', 'clink');
    le.append('path').attr('class', 'l'); le.append('path').attr('class', 'hit');
    le.on('mouseenter', (ev, d) => tooltip.show(`<b>${esc(d.a.c.name)} ↔ ${esc(d.b.c.name)}</b><div class="tip-sub">${d.count} 条关系</div>` + enc.REL_ORDER.filter((t) => d.byType[t]).map((t) => `<div class="tip-row"><i class="sw" style="--c:${enc.relColor(t)}"></i>${t} ${d.byType[t]}</div>`).join(''), ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    ls.exit().remove();
    const la = le.merge(ls);
    la.select('path.l').attr('d', (d) => `M${d.a.x},${d.a.y} L${d.b.x},${d.b.y}`).attr('stroke-width', (d) => (1.5 + d.count * 1.1) * f);
    la.select('path.hit').attr('d', (d) => `M${d.a.x},${d.a.y} L${d.b.x},${d.b.y}`).attr('stroke-width', 16 * f);

    const bs = gBubbles.selectAll('g.bubble').data(stats, (d) => d.c.id);
    const be = bs.enter().append('g').attr('class', 'bubble').style('--c', (d) => d.c._color);
    be.append('circle');
    be.append('text').attr('class', 'b-name').classed('main', (d) => !!d.c.main);
    be.append('text').attr('class', 'b-count');
    be.append('text').attr('class', 'b-prog');
    be.on('dblclick', (ev, d) => { ev.stopPropagation(); zoomToCluster(d.c.id); })
      .on('click', (ev, d) => { ev.stopPropagation(); zoomToCluster(d.c.id); })
      .on('mouseenter', (ev, d) => tooltip.show(`<b>${esc(d.c.name)}</b><div class="tip-sub">${esc(d.c.desc || '')}</div><div class="tip-sub">点击缩放到这条研究线</div>`, ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    bs.exit().remove();
    const ba = be.merge(bs).attr('transform', (d) => `translate(${d.x},${d.y}) scale(${f})`);
    ba.select('circle').attr('r', (d) => d.r).attr('stroke-width', 2);
    ba.select('.b-name').attr('y', -6).text((d) => d.c.name);
    ba.select('.b-count').attr('y', 14).text((d) => `${d.nodes.length} 个节点`);
    ba.select('.b-prog').attr('y', 30).text((d) => `已消化 ${d.progress.done} / ${d.progress.total}`);
  }

  const nodeTip = (n) => glyphNodeTip(model, n);
  const edgeTip = (e) => glyphEdgeTip(model, e);

  /* ---- 可见性与高亮 ---- */
  let visible = computeVisibility(model, get().filters);
  function refreshVisibility() { visible = computeVisibility(model, get().filters); positionHulls(); applyState(); }

  function applyState() {
    const s = get();
    const hl = computeHighlight(model, s, visible);
    applyClasses({ nodeEls: gNodes.node().children, edgeEls: gEdges.node().children, hl, visible, s });
    svgEl.dataset.mode = hl.mode;
    if (svgEl.getAttribute('data-level') === '1') drawBubbles();
  }

  /* ---- 选择 ---- */
  function toggleSelect(id) {
    const s = get();
    if (s.node === id && !s.edge && !s.path && !s.gap) set({ node: null, edge: null, panel: 'closed' });
    else set({ node: id, edge: null, path: null, gap: null, panel: 'node' });
  }
  function selectEdge(id) { set({ edge: id, path: null, gap: null, panel: 'edge' }); }
  function clearSelection() {
    const s = get();
    const panel = s.panel === 'path' ? 'path' : s.panel === 'gaps' ? 'gaps' : 'closed';
    set({ node: null, edge: null, path: null, gap: null, panel });
  }
  svg.on('click', (ev) => { if (ev.target === svgEl || ev.target.closest('.hulls')) clearSelection(); });

  /* ---- 缩放 / 平移 + 语义级别（相对于"适配全部"的倍率） ---- */
  let kFit = 1;
  let transform = d3.zoomIdentity;
  const zoom = d3.zoom().scaleExtent([0.12, 6]).on('zoom', (ev) => {
    transform = ev.transform;
    world.attr('transform', transform);
    updateLevel(transform.k);
    if (svgEl.getAttribute('data-level') === '1') drawBubbles();
  });
  svg.call(zoom).on('dblclick.zoom', null);
  function updateLevel(k) {
    const rel = k / kFit;
    const lvl = rel < 0.6 ? 1 : rel < 1.4 ? 2 : 3;
    if (svgEl.getAttribute('data-level') !== String(lvl)) { svgEl.setAttribute('data-level', String(lvl)); set({ level: lvl }); if (lvl === 1) drawBubbles(); }
    const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = `${Math.round(rel * 100)}%`;
  }
  function bounds(list) {
    if (!list) { const x0 = d3.min(regions, (r) => r.x), y0 = d3.min(regions, (r) => r.y), x1 = d3.max(regions, (r) => r.x + r.w), y1 = d3.max(regions, (r) => r.y + r.h); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
    const x0 = d3.min(list, (d) => d.x - d.w / 2) - 24, x1 = d3.max(list, (d) => d.x + d.w / 2) + 24;
    const y0 = d3.min(list, (d) => d.y - d.h / 2) - 24, y1 = d3.max(list, (d) => d.y + d.h / 2) + 24;
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  const FIT_INSET = { top: 40, right: 40, bottom: 40, left: 40 };
  function fitBounds(b, animate, maxK) {
    const r = stageEl.getBoundingClientRect();
    const aw = r.width - FIT_INSET.left - FIT_INSET.right - extraInset.right, ah = r.height - FIT_INSET.top - FIT_INSET.bottom;
    let k = Math.min(aw / b.w, ah / b.h);
    if (maxK) k = Math.min(k, maxK);
    const t = d3.zoomIdentity.translate(FIT_INSET.left + (aw - b.w * k) / 2 - b.x0 * k, FIT_INSET.top + (ah - b.h * k) / 2 - b.y0 * k).scale(k);
    (animate && !prefersReduced() ? svg.transition().duration(300) : svg).call(zoom.transform, t);
    return k;
  }
  function fitAll(animate = true) {
    const r = stageEl.getBoundingClientRect();
    const b = bounds();
    kFit = Math.min((r.width - FIT_INSET.left - FIT_INSET.right - extraInset.right) / b.w, (r.height - FIT_INSET.top - FIT_INSET.bottom) / b.h);
    fitBounds(b, animate);
  }
  function fitNodes(ids, animate = true, maxRel = 2.2) {
    const list = ids.map((id) => snById.get(id)).filter(Boolean);
    if (!list.length) return;
    fitBounds(bounds(list), animate, kFit * maxRel);
  }
  function zoomBy(f) { (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }
  function zoomToNode(id, relK = 1.8) {
    const d = snById.get(id); if (!d) return;
    const r = stageEl.getBoundingClientRect();
    const k = kFit * Math.max(relK, transform.k / kFit);
    const t = d3.zoomIdentity.translate(r.width / 2 - d.x * k, r.height / 2 - d.y * k).scale(k);
    (prefersReduced() ? svg : svg.transition().duration(300)).call(zoom.transform, t);
  }
  function zoomToCluster(cid) { const r = regions.find((x) => x.c.id === cid); if (r) fitBounds({ x0: r.x - 12, y0: r.y - 12, x1: r.x + r.w + 12, y1: r.y + r.h + 12, w: r.w + 24, h: r.h + 24 }, true, kFit * 2.4); }
  function centerAt(wx, wy) {
    const r = stageEl.getBoundingClientRect();
    const k = transform.k;
    (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - wx * k, r.height / 2 - wy * k).scale(k));
  }
  function backToSelection() {
    const s = get();
    if (s.path) fitNodes(s.path.nodes);
    else if (s.gap && model.gapById.has(s.gap)) fitNodes(gapNodeIds(s.gap));
    else if (s.edge && model.edgeById.has(s.edge)) { const e = model.edgeById.get(s.edge); fitNodes([e.from, e.to]); }
    else if (s.node) zoomToNode(s.node);
  }
  function gapNodeIds(gid) {
    const g = model.gapById.get(gid); const ids = new Set(g.nodes || []);
    for (const e of model.edgesByGap.get(gid) || []) { ids.add(e.from); ids.add(e.to); }
    return [...ids];
  }

  drawHulls(); drawEdges(); drawNodes();
  applyState();
  fitAll(false);

  subscribe((s, patch) => {
    if ('filters' in patch || 'progressTick' in patch) { refreshVisibility(); return; }
    if (['node', 'edge', 'gap', 'path', 'hoverNode', 'hoverEdge', 'depth'].some((k) => k in patch)) applyState();
  });

  return {
    fitAll, fitNodes, zoomBy, zoomToNode, zoomToCluster, centerAt, backToSelection, refreshVisibility, applyState,
    gapNodeIds,
    nodes: sn, edges: se, regions: () => regions,
    getTransform: () => transform,
    visibility: () => visible,
  };
}
