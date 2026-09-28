/* 视角一：关系网。三个层级：全览（区域网格 + 汇总连线）、研究线聚焦、关系透镜（lens.js）；另有"简化为研究线"气泡视图。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as tooltip from '../tooltip.js';
import * as progress from '../progress.js';
import { computeVisibility } from '../filters.js';
import { appendNodeGlyph, appendEdgeGlyph, setEdgePath, nodeTip as glyphNodeTip, edgeTip as glyphEdgeTip, borderPoint } from '../glyph.js';
import { computeHighlight } from '../highlight.js';
import { extraInset, prefersReduced } from '../zoomable.js';
import { createLens } from './lens.js';

/* 全览网格布局：每个研究线一个区域，区域内按年份排列；列数按节点数：≤3 → 1 列，4–8 → 2 列，≥9 → 3 列 */
const GX = 12, GY = 10, PAD = 16, TITLE_H = 30, REGION_GAP = 48;
const esc = tooltip.esc;
function colsFor(n) { return n <= 3 ? 1 : n <= 8 ? 2 : 3; }

/* 矩形边缘上朝向 (tx,ty) 的点 */
function rectBorder(r, tx, ty, gap = 0) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return borderPoint({ x: cx, y: cy, w: r.w, h: r.h }, tx, ty, gap);
}

export function createNetwork({ svgEl, stageEl, model, actions }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('#world');
  const gHulls = world.append('g').attr('class', 'hulls');
  const gSummary = world.append('g').attr('class', 'summary');
  const gEdges = world.append('g').attr('class', 'edges');
  const gStubs = world.append('g').attr('class', 'stubs');
  const gNodes = world.append('g').attr('class', 'nodes');
  const gBubbles = world.append('g').attr('class', 'bubbles');

  const sn = model.nodes.map((n) => ({ id: n.id, ref: n, w: enc.NODE_W, h: enc.NODE_H, x: 0, y: 0 }));
  const snById = new Map(sn.map((d) => [d.id, d]));
  const se = model.edges.map((e) => ({ id: e.id, ref: e, source: snById.get(e.from), target: snById.get(e.to) }));
  const pairGroups = new Map();
  for (const e of se) {
    const key = [e.source.id, e.target.id].sort().join('|');
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(e);
  }
  let visible = computeVisibility(model, get().filters);
  let simple = false;

  /* ---- 区域布局 ---- */
  let regions = [];
  const regionById = new Map();
  function computeLayout() {
    const bucket = (v) => (v < 0.34 ? 0 : v < 0.67 ? 1 : 2);
    regions = model.clusters.map((c) => {
      const nodes = sn.filter((d) => d.ref._cluster === c.id).sort((p, q) => p.ref.year - q.ref.year || p.id.localeCompare(q.id));
      const cols = colsFor(nodes.length), rows = Math.max(1, Math.ceil(nodes.length / cols));
      const a = c.anchor || [0.5, 0.5];
      return { c, nodes, cols, rows, gx: bucket(a[0]), gy: a[1], anchor: a, w: PAD * 2 + cols * enc.NODE_W + (cols - 1) * GX, h: TITLE_H + PAD + rows * enc.NODE_H + (rows - 1) * GY + PAD };
    }).filter((r) => r.nodes.length);
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
    regionById.clear(); for (const r of regions) regionById.set(r.c.id, r);
  }
  computeLayout();
  const worldBox = () => { const x0 = d3.min(regions, (r) => r.x), y0 = d3.min(regions, (r) => r.y), x1 = d3.max(regions, (r) => r.x + r.w), y1 = d3.max(regions, (r) => r.y + r.h); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };

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
    ent.style('cursor', 'pointer')
      .on('click', (ev, d) => { ev.stopPropagation(); actions.goCluster(d.c.id); })
      .on('mouseenter', (ev, d) => tooltip.show(`<b>${esc(d.c.name)}</b><div class="tip-sub">${esc(d.c.desc || '')}</div><div class="tip-meta">${d.nodes.length} 个节点 · 点击聚焦这条研究线</div>`, ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
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
      const gapIds = new Set(); for (const n of d.nodes) for (const gp of model.gapsOfNode.get(n.id) || []) gapIds.add(gp.id);
      const gb = g.select('g.gap-badge'); gb.selectAll('*').remove();
      if (gapIds.size) {
        const tw = t.node().getComputedTextLength ? t.node().getComputedTextLength() : 80;
        gb.attr('transform', `translate(${d.x + 12 + tw + 14},${d.y + 15})`);
        gb.append('circle').attr('r', 8);
        gb.append('text').attr('y', 3.5).text(gapIds.size);
        gb.append('title').text(`这条研究线涉及 ${gapIds.size} 个空缺问题：${[...gapIds].join('、')}`);
      }
    });
  }

  /* ---- 汇总连线（研究线之间） ---- */
  function summaryLinks() {
    const links = new Map();
    for (const e of se) {
      if (!visible.edgeVis.has(e.id)) continue;
      const a = e.source.ref._cluster, b = e.target.ref._cluster;
      if (a === b) continue;
      const [p, q] = [a, b].sort();
      const key = p + '|' + q;
      if (!links.has(key)) links.set(key, { a: p, b: q, count: 0, byType: {}, src: 0, proc: 0 });
      const l = links.get(key); l.count++; l.byType[e.ref.type] = (l.byType[e.ref.type] || 0) + 1; if (e.ref.basis === '来源') l.src++; else l.proc++;
    }
    return [...links.values()];
  }
  function linkTip(d, na, nb) {
    return `<b>${esc(na)} — ${esc(nb)}</b><div class="tip-sub">${d.count} 条关系 · 来源 ${d.src} 条、加工 ${d.proc} 条</div>` + enc.REL_ORDER.filter((t) => d.byType[t]).map((t) => `<div class="tip-row"><i class="sw" style="--c:${enc.relColor(t)}"></i>${t} ${d.byType[t]}</div>`).join('');
  }
  function drawSummary() {
    const data = summaryLinks().filter((l) => regionById.has(l.a) && regionById.has(l.b));
    const sel = gSummary.selectAll('g.clink').data(data, (d) => d.a + '|' + d.b);
    sel.exit().remove();
    const ent = sel.enter().append('g').attr('class', 'clink');
    ent.append('path').attr('class', 'l'); ent.append('path').attr('class', 'hit');
    ent.append('circle').attr('class', 'badge'); ent.append('text').attr('class', 'badge-t');
    ent.on('mouseenter', (ev, d) => tooltip.show(linkTip(d, regionById.get(d.a).c.name, regionById.get(d.b).c.name), ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    const all = ent.merge(sel);
    all.each(function (d) {
      const ra = regionById.get(d.a), rb = regionById.get(d.b);
      const ca = [ra.x + ra.w / 2, ra.y + ra.h / 2], cb = [rb.x + rb.w / 2, rb.y + rb.h / 2];
      const p0 = rectBorder(ra, cb[0], cb[1], 2), p1 = rectBorder(rb, ca[0], ca[1], 2);
      const g = d3.select(this);
      g.select('path.l').attr('d', `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`).attr('stroke-width', 1 + d.count * 0.8);
      g.select('path.hit').attr('d', `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`);
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      g.select('circle.badge').attr('cx', mx).attr('cy', my).attr('r', 10);
      g.select('text.badge-t').attr('x', mx).attr('y', my + 4).text(d.count);
    });
  }

  /* ---- 关系线与节点 ---- */
  function drawEdges() {
    const sel = gEdges.selectAll('g.edge').data(se, (d) => d.id);
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    ent.on('mouseenter', (ev, d) => { set({ hoverEdge: d.id }); tooltip.show(glyphEdgeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverEdge: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.selectEdge(d.id, { zoom: false }); });
    gEdges.selectAll('g.edge').each(function (d) { const g = edgeGeom(d); setEdgePath(d3.select(this), g.d, g.mid); });
  }
  function drawNodes() {
    const sel = gNodes.selectAll('g.node').data(sn, (d) => d.id);
    const ent = appendNodeGlyph(sel.enter().append('g'), model);
    ent.on('mouseenter', (ev, d) => { set({ hoverNode: d.id }); tooltip.show(glyphNodeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverNode: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.nodeClick(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); actions.nodeClick(d.id); } });
    gNodes.selectAll('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
  }

  /* 研究线聚焦里，悬停节点的跨研究线关系：画到对应研究线区域的边缘 */
  function drawStubs(nodeId) {
    gStubs.selectAll('*').remove();
    if (!nodeId) return;
    const d = snById.get(nodeId); if (!d) return;
    const labeled = new Set();
    for (const e of model.edgesOf.get(nodeId) || []) {
      if (!visible.edgeVis.has(e.id)) continue;
      const otherId = e.from === nodeId ? e.to : e.from;
      const other = model.byId.get(otherId);
      if (other._cluster === d.ref._cluster) continue;
      const r = regionById.get(other._cluster); if (!r) continue;
      const rc = [r.x + r.w / 2, r.y + r.h / 2];
      const pEdge = rectBorder(r, d.x, d.y, 4);
      const pNode = borderPoint(d, pEdge[0], pEdge[1], 3);
      const outgoing = e.from === nodeId;
      const p0 = outgoing ? pNode : pEdge, p1 = outgoing ? pEdge : pNode;
      const g = appendEdgeGlyph(gStubs.append('g').datum({ id: e.id, ref: e })).classed('stub', true);
      setEdgePath(g, `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
      g.on('mouseenter', (ev) => tooltip.show(glyphEdgeTip(model, e), ev.clientX, ev.clientY)).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide())
        .on('click', (ev) => { ev.stopPropagation(); actions.selectEdge(e.id, { zoom: false }); });
      /* 边缘处的目标研究线名（每条研究线只标一次） */
      if (!labeled.has(r.c.id)) { labeled.add(r.c.id); gStubs.append('text').attr('class', 'stub-label').attr('x', pEdge[0]).attr('y', pEdge[1] - 8).text(r.c.name); }
    }
  }

  /* ---- 简化视图：研究线气泡 ---- */
  function bubbleData() {
    const box = worldBox();
    const stats = regions.map((r) => {
      const nodes = r.nodes.filter((d) => visible.nodeVis.has(d.id));
      const rad = Math.max(36, Math.min(72, 22 + 12 * Math.sqrt(nodes.length)));
      return { c: r.c, n: nodes.length, r: rad, x: box.x0 + r.anchor[0] * box.w, y: box.y0 + r.anchor[1] * box.h, progress: progress.clusterProgress(model, r.c.id) };
    }).filter((b) => b.n);
    const byId = new Map(stats.map((b) => [b.c.id, b]));
    const links = summaryLinks().filter((l) => byId.has(l.a) && byId.has(l.b)).map((l) => ({ ...l, A: byId.get(l.a), B: byId.get(l.b) }));
    return { stats, links, byId };
  }
  /* 直线会穿过第三个气泡时改成弧线绕开 */
  function bubbleLinkPath(l, stats) {
    const A = l.A, B = l.B;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const p0 = [A.x + ux * (A.r + 2), A.y + uy * (A.r + 2)], p1 = [B.x - ux * (B.r + 2), B.y - uy * (B.r + 2)];
    let blocker = null;
    for (const s of stats) {
      if (s === A || s === B) continue;
      const t = ((s.x - A.x) * dx + (s.y - A.y) * dy) / (L * L);
      if (t <= 0 || t >= 1) continue;
      const px = A.x + t * dx, py = A.y + t * dy;
      if (Math.hypot(s.x - px, s.y - py) < s.r + 10) { blocker = s; break; }
    }
    if (!blocker) return { d: `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`, mid: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] };
    const nx = -uy, ny = ux;
    const side = ((blocker.x - A.x) * nx + (blocker.y - A.y) * ny) > 0 ? -1 : 1;
    const bow = blocker.r + 40;
    const cx = (A.x + B.x) / 2 + nx * bow * 2 * side, cy = (A.y + B.y) / 2 + ny * bow * 2 * side;
    return { d: `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}`, mid: [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]] };
  }
  function drawBubbles() {
    const { stats, links } = bubbleData();
    const ls = gBubbles.selectAll('g.clink').data(links, (d) => d.a + '|' + d.b);
    ls.exit().remove();
    const le = ls.enter().append('g').attr('class', 'clink');
    le.append('path').attr('class', 'l'); le.append('path').attr('class', 'hit'); le.append('circle').attr('class', 'badge'); le.append('text').attr('class', 'badge-t');
    le.on('mouseenter', (ev, d) => tooltip.show(linkTip(d, d.A.c.name, d.B.c.name), ev.clientX, ev.clientY)).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    le.merge(ls).each(function (d) {
      const p = bubbleLinkPath(d, stats);
      const g = d3.select(this);
      g.select('path.l').attr('d', p.d).attr('stroke-width', 1 + d.count * 0.8);
      g.select('path.hit').attr('d', p.d);
      g.select('circle.badge').attr('cx', p.mid[0]).attr('cy', p.mid[1]).attr('r', 10);
      g.select('text.badge-t').attr('x', p.mid[0]).attr('y', p.mid[1] + 4).text(d.count);
    });
    const bs = gBubbles.selectAll('g.bubble').data(stats, (d) => d.c.id);
    bs.exit().remove();
    const be = bs.enter().append('g').attr('class', 'bubble').style('--c', (d) => d.c._color);
    be.append('circle').attr('class', 'b-fill');
    be.append('circle').attr('class', 'b-ring-bg');
    be.append('circle').attr('class', 'b-ring');
    be.append('text').attr('class', 'b-name');
    be.append('text').attr('class', 'b-count');
    be.style('cursor', 'pointer')
      .on('click', (ev, d) => { ev.stopPropagation(); actions.setSimple(false); actions.goCluster(d.c.id); })
      .on('mouseenter', (ev, d) => tooltip.show(`<b>${esc(d.c.name)}</b><div class="tip-sub">${esc(d.c.desc || '')}</div><div class="tip-meta">${d.n} 个节点 · 已消化 ${d.progress.done}/${d.progress.total} · 点击聚焦</div>`, ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    const ba = be.merge(bs).attr('transform', (d) => `translate(${d.x},${d.y})`);
    ba.select('.b-fill').attr('r', (d) => d.r);
    ba.select('.b-ring-bg').attr('r', (d) => d.r + 5);
    ba.select('.b-ring').attr('r', (d) => d.r + 5).attr('stroke-dasharray', (d) => { const C = 2 * Math.PI * (d.r + 5); const f = d.progress.total ? d.progress.done / d.progress.total : 0; return `${(C * f).toFixed(1)} ${C.toFixed(1)}`; });
    ba.select('.b-name').attr('y', -4).classed('main', (d) => !!d.c.main).text((d) => d.c.name);
    ba.select('.b-count').attr('y', 14).text((d) => `${d.n} 个节点`);
  }

  /* ---- 状态套用 ---- */
  const nodeTip = (n) => glyphNodeTip(model, n);
  function refreshVisibility() { visible = computeVisibility(model, get().filters); positionHulls(); drawSummary(); applyState(); if (lens.isActive()) lens.refresh(); }

  function applyState() {
    const s = get();
    const mode = s.mode;
    const inLens = mode === 'lens';
    svgEl.dataset.mode = mode;
    svgEl.classList.toggle('simple', simple && mode === 'overview');
    world.attr('display', inLens ? 'none' : null);
    if (inLens) { lens.show(s.node); svg.on('.zoom', null); stageEl.classList.add('lens-mode'); return; }
    if (!zoomBound) { svg.call(zoom); svg.on('dblclick.zoom', null); zoomBound = true; } else svg.call(zoom);
    lens.hide(); stageEl.classList.remove('lens-mode');
    if (simple && mode === 'overview') { drawBubbles(); gStubs.selectAll('*').remove(); return; }
    const hl = computeHighlight(model, { ...s, node: null }, visible); /* 全览 / 聚焦不用节点聚焦高亮 */
    const focus = mode === 'cluster' ? s.focusCluster : null;
    const hover = s.hoverNode && model.byId.has(s.hoverNode) ? s.hoverNode : null;
    const hoverEdges = hover ? new Set((model.edgesOf.get(hover) || []).map((e) => e.id)) : null;
    const hoverNbrs = hover ? new Set([hover, ...(model.edgesOf.get(hover) || []).map((e) => (e.from === hover ? e.to : e.from))]) : null;
    const selection = hl.mode === 'path' || hl.mode === 'gap' || hl.mode === 'edge';
    /* 节点 */
    for (const el of gNodes.node().children) {
      const id = el.dataset.id; const n = model.byId.get(id);
      el.classList.toggle('hidden', !visible.nodeVis.has(id));
      let dim = '';
      if (focus) dim = n._cluster !== focus ? 'dim25' : '';
      else if (selection) dim = hl.nHi.has(id) ? '' : 'faint';
      else if (hover) dim = hoverNbrs.has(id) ? '' : 'dim35';
      el.classList.toggle('dim25', dim === 'dim25'); el.classList.toggle('dim35', dim === 'dim35'); el.classList.toggle('faint', dim === 'faint');
      el.classList.toggle('hi', !!hover && hoverNbrs.has(id) && id !== hover);
      el.classList.toggle('active', !!hover && id === hover);
      el.classList.toggle('digested', progress.has(id));
    }
    /* 关系线：全览默认不画，只画悬停节点的；聚焦画研究线内部的；抽屉开关可画全部 */
    for (const el of gEdges.node().children) {
      const id = el.dataset.id; const e = model.edgeById.get(id);
      const vis = visible.edgeVis.has(id);
      let show = false, cls = '';
      if (!vis) show = false;
      else if (selection) { show = hl.eHi.has(id) || hl.eHi2.has(id); cls = hl.eHi.has(id) ? 'hi' : 'hi2'; }
      else if (focus) {
        const internal = model.byId.get(e.from)._cluster === focus && model.byId.get(e.to)._cluster === focus;
        show = internal;
        if (hover) cls = hoverEdges.has(id) ? 'hi' : 'faint15';
      } else {
        show = s.filters.showAllEdges || (hover && hoverEdges.has(id));
        if (hover) cls = hoverEdges.has(id) ? 'hi' : 'dim35';
      }
      el.classList.toggle('hidden', !show);
      el.classList.toggle('hi', cls === 'hi' || id === s.hoverEdge);
      el.classList.toggle('hi2', cls === 'hi2'); el.classList.toggle('faint15', cls === 'faint15'); el.classList.toggle('dim35', cls === 'dim35');
      el.classList.toggle('active', id === s.edge);
    }
    /* 区域与汇总连线 */
    gHulls.selectAll('g.hull').each(function (d) { this.classList.toggle('dim25', !!focus && d.c.id !== focus); this.classList.toggle('focused', d.c.id === focus); });
    gSummary.attr('display', focus || s.filters.showAllEdges ? 'none' : null);
    gSummary.selectAll('g.clink').each(function (d) { this.classList.toggle('dim35', !!hover && !(model.byId.get(hover)._cluster === d.a || model.byId.get(hover)._cluster === d.b)); });
    drawStubs(focus && hover && model.byId.get(hover)._cluster === focus ? hover : null);
  }

  /* ---- 缩放 / 平移 ---- */
  let kFit = 1, transform = d3.zoomIdentity, zoomBound = false;
  const zoom = d3.zoom().scaleExtent([0.15, 6]).on('zoom', (ev) => {
    transform = ev.transform; world.attr('transform', transform);
    const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = `${Math.round((transform.k / kFit) * 100)}%`;
  });
  const FIT_INSET = { top: 40, right: 40, bottom: 40, left: 40 };
  function fitBounds(b, animate, maxK, duration = 300) {
    const r = stageEl.getBoundingClientRect();
    const aw = r.width - FIT_INSET.left - FIT_INSET.right - extraInset.right, ah = r.height - FIT_INSET.top - FIT_INSET.bottom;
    let k = Math.min(aw / b.w, ah / b.h);
    if (maxK) k = Math.min(k, maxK);
    const t = d3.zoomIdentity.translate(FIT_INSET.left + (aw - b.w * k) / 2 - b.x0 * k, FIT_INSET.top + (ah - b.h * k) / 2 - b.y0 * k).scale(k);
    (animate && !prefersReduced() ? svg.transition().duration(duration) : svg).call(zoom.transform, t);
    return k;
  }
  function contentBox() {
    if (simple && get().mode === 'overview') { const { stats } = bubbleData(); const x0 = d3.min(stats, (b) => b.x - b.r - 8), x1 = d3.max(stats, (b) => b.x + b.r + 8), y0 = d3.min(stats, (b) => b.y - b.r - 8), y1 = d3.max(stats, (b) => b.y + b.r + 8); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
    return worldBox();
  }
  function fitAll(animate = true) {
    const b = contentBox();
    const r = stageEl.getBoundingClientRect();
    kFit = Math.min((r.width - FIT_INSET.left - FIT_INSET.right - extraInset.right) / b.w, (r.height - FIT_INSET.top - FIT_INSET.bottom) / b.h);
    fitBounds(b, animate);
  }
  function fitNodes(ids, animate = true, maxRel = 2.2) {
    const list = ids.map((id) => snById.get(id)).filter(Boolean); if (!list.length) return;
    const x0 = d3.min(list, (d) => d.x - d.w / 2) - 24, x1 = d3.max(list, (d) => d.x + d.w / 2) + 24, y0 = d3.min(list, (d) => d.y - d.h / 2) - 24, y1 = d3.max(list, (d) => d.y + d.h / 2) + 24;
    fitBounds({ x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }, animate, kFit * maxRel);
  }
  function zoomBy(f) { if (get().mode === 'lens') return; (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }
  function zoomToNode(id, relK = 1.8) {
    const d = snById.get(id); if (!d) return;
    const r = stageEl.getBoundingClientRect();
    const k = kFit * Math.max(relK, transform.k / kFit);
    (prefersReduced() ? svg : svg.transition().duration(300)).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - d.x * k, r.height / 2 - d.y * k).scale(k));
  }
  function zoomToCluster(cid) { const r = regionById.get(cid); if (r) fitBounds({ x0: r.x - 16, y0: r.y - 16, x1: r.x + r.w + 16, y1: r.y + r.h + 16, w: r.w + 32, h: r.h + 32 }, true, kFit * 1.6, 250); }
  function backToSelection() {
    const s = get();
    if (s.mode === 'lens') return;
    if (s.path) fitNodes(s.path.nodes);
    else if (s.gap && model.gapById.has(s.gap)) fitNodes(gapNodeIds(s.gap));
    else if (s.edge && model.edgeById.has(s.edge)) { const e = model.edgeById.get(s.edge); fitNodes([e.from, e.to]); }
    else if (s.mode === 'cluster' && s.focusCluster) zoomToCluster(s.focusCluster);
    else if (s.node) zoomToNode(s.node);
  }
  function gapNodeIds(gid) {
    const g = model.gapById.get(gid); if (!g) return []; const ids = new Set(g.nodes || []);
    for (const e of model.edgesByGap.get(gid) || []) { ids.add(e.from); ids.add(e.to); }
    return [...ids];
  }

  /* ---- 透镜 ---- */
  const lens = createLens({ svgEl, stageEl, model, actions, visibleFn: () => visible });
  svg.on('click', (ev) => { if (ev.target === svgEl) actions.canvasBlankClick(); });

  drawHulls(); drawSummary(); drawEdges(); drawNodes();
  applyState();
  fitAll(false);

  subscribe((s, patch) => {
    if ('filters' in patch || 'progressTick' in patch) { refreshVisibility(); return; }
    if ('mode' in patch || 'focusCluster' in patch) { applyState(); if (s.mode === 'cluster') zoomToCluster(s.focusCluster); else if (s.mode === 'overview') fitAll(true); return; }
    if ('node' in patch && s.mode === 'lens') { lens.show(s.node); return; }
    if ('edge' in patch && s.mode === 'lens') { lens.applyHover(); return; }
    if (['node', 'edge', 'gap', 'path', 'hoverNode', 'hoverEdge'].some((k) => k in patch)) applyState();
  });

  return {
    fitAll, fitNodes, zoomBy, zoomToNode, zoomToCluster, backToSelection, refreshVisibility, applyState, gapNodeIds,
    setSimple(v) { simple = !!v; applyState(); if (get().mode === 'overview') fitAll(true); },
    isSimple: () => simple,
    nodes: sn, edges: se, regions: () => regions,
    getTransform: () => transform,
    visibility: () => visible,
    lens,
  };
}
