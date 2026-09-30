/* 视角二：成熟度地图。横轴证据等级（N/A、C、B、A、空缺），纵轴拥挤度（饱和、活跃、稀疏）。
   整个网格适配一屏；若卡片字号会小于 12px，则改为按 12px 定缩放、纵向滚动，行列标题固定。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as tooltip from '../tooltip.js';
import { computeVisibility } from '../filters.js';
import { appendNodeGlyph, appendEdgeGlyph, setEdgePath, nodeTip, edgeTip, borderPoint } from '../glyph.js';
import { computeHighlight, applyClasses } from '../highlight.js';
import { prefersReduced, extraInset, panClearOfPanel } from '../zoomable.js';
const esc = tooltip.esc;

const COLS = [...enc.EVIDENCE_ORDER, '__gap'];
const ROWS = enc.CROWDING_ORDER;
const PAD = 14, GAP_X = 10, GAP_Y = 8, GROUP_GAP = 8, HEAD_H = 56, ROW_HEAD_W = 92, GAP_W = 210, GAP_CARD_H = 46;
const COL_SUB = { 'N/A': '规范理论或框架，不适用证据等级', C: '单项非预注册、预印本或综述', B: '单项预注册或设计较严的研究', A: '元分析或多实验室重复', __gap: '空缺问题，按状态分组' };
const MIN_FONT = 12, CARD_FONT = 13, CARD_W = 132; /* 成熟度里的卡片略窄，名称可换两行 */
const INSET = { top: 56, right: 40, bottom: 40, left: 40 };

export function createMaturity({ svgEl, stageEl, model, actions, toolsEl }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('g.world');
  const gGrid = world.append('g').attr('class', 'grid');
  const gGroups = world.append('g').attr('class', 'groups');
  const gEdges = world.append('g').attr('class', 'edges');
  const gNodes = world.append('g').attr('class', 'nodes');
  const gGaps = world.append('g').attr('class', 'gapcards');
  /* 行列标题画在 world 之外，滚动时可固定 */
  const gRowHead = svg.append('g').attr('class', 'heads rowheads');
  const gColHead = svg.append('g').attr('class', 'heads colheads');
  const gCorner = svg.append('rect').attr('class', 'head-corner');

  const sn = model.nodes.map((n) => ({ id: n.id, ref: n, w: CARD_W, h: enc.NODE_H, x: 0, y: 0 }));
  const snById = new Map(sn.map((d) => [d.id, d]));
  const sg = model.gaps.map((g) => ({ id: g.id, ref: g, w: GAP_W - PAD * 2, h: GAP_CARD_H, x: 0, y: 0 }));
  let visible = computeVisibility(model, get().filters);
  let colorGroups = false;
  let active = false;
  let layout = null;
  let scrollMode = false;

  /* ---- 布局 ---- */
  function computeLayout() {
    const cellNodes = new Map();
    for (const c of COLS) for (const r of ROWS) cellNodes.set(c + '|' + r, []);
    for (const d of sn) {
      if (!visible.nodeVis.has(d.id)) continue;
      const key = d.ref.evidence + '|' + d.ref.crowding;
      if (cellNodes.has(key)) cellNodes.get(key).push(d);
    }
    const clusterIndex = new Map(model.clusters.map((c, i) => [c.id, i]));
    const cells = new Map();
    const colCols = new Map();
    for (const c of enc.EVIDENCE_ORDER) {
      let maxCount = 0;
      for (const r of ROWS) maxCount = Math.max(maxCount, cellNodes.get(c + '|' + r).length);
      colCols.set(c, maxCount > 2 ? 2 : 1);
    }
    for (const c of enc.EVIDENCE_ORDER) for (const r of ROWS) {
      const list = cellNodes.get(c + '|' + r).sort((a, b) => (clusterIndex.get(a.ref._cluster) - clusterIndex.get(b.ref._cluster)) || (a.ref.year - b.ref.year) || a.id.localeCompare(b.id));
      const groups = [];
      for (const d of list) { const last = groups[groups.length - 1]; if (last && last.cluster === d.ref._cluster) last.nodes.push(d); else groups.push({ cluster: d.ref._cluster, nodes: [d] }); }
      const nc = colCols.get(c);
      let h = PAD;
      for (const g of groups) { g.rows = Math.ceil(g.nodes.length / nc); g.y0 = h; h += g.rows * (enc.NODE_H + GAP_Y) - GAP_Y + GROUP_GAP; g.y1 = h - GROUP_GAP; }
      h = groups.length ? h - GROUP_GAP + PAD : PAD * 2 + enc.NODE_H;
      cells.set(c + '|' + r, { groups, h, count: list.length, nc });
    }
    const colW = new Map();
    for (const c of enc.EVIDENCE_ORDER) colW.set(c, PAD * 2 + colCols.get(c) * (CARD_W + GAP_X) - GAP_X);
    const rowH = new Map();
    for (const r of ROWS) rowH.set(r, Math.max(...enc.EVIDENCE_ORDER.map((c) => cells.get(c + '|' + r).h), 110));
    const colX = new Map(); let x = ROW_HEAD_W;
    for (const c of enc.EVIDENCE_ORDER) { colX.set(c, x); x += colW.get(c); if (c === 'N/A') x += 18; }
    const gapX = x + 12; colX.set('__gap', gapX); colW.set('__gap', GAP_W);
    const rowY = new Map(); let y = HEAD_H;
    for (const r of ROWS) { rowY.set(r, y); y += rowH.get(r); }
    let totalH = y;
    for (const c of enc.EVIDENCE_ORDER) for (const r of ROWS) {
      const cell = cells.get(c + '|' + r);
      const x0 = colX.get(c), y0 = rowY.get(r);
      for (const g of cell.groups) g.nodes.forEach((d, i) => {
        const col = i % cell.nc, row = Math.floor(i / cell.nc);
        d.x = x0 + PAD + col * (CARD_W + GAP_X) + CARD_W / 2;
        d.y = y0 + g.y0 + row * (enc.NODE_H + GAP_Y) + enc.NODE_H / 2;
        g.x0 = x0 + PAD - 6; g.x1 = x0 + PAD + cell.nc * (CARD_W + GAP_X) - GAP_X + 6; g.yy0 = y0 + g.y0 - 5; g.yy1 = y0 + g.y1 + 5;
      });
    }
    const order = ['几乎空白', '有初步工作', '已基本解决'];
    const sorted = [...sg].sort((a, b) => order.indexOf(a.ref.status) - order.indexOf(b.ref.status) || (b.ref.key - a.ref.key) || a.id.localeCompare(b.id));
    const gapGroups = [];
    let gy = HEAD_H + PAD + 14;
    for (const st of order) {
      const list = sorted.filter((g) => g.ref.status === st);
      if (!list.length) continue;
      gapGroups.push({ status: st, y: gy - 12, n: list.length });
      for (const g of list) { g.x = gapX + PAD + g.w / 2; g.y = gy + g.h / 2; gy += g.h + GAP_Y; }
      gy += 26;
    }
    totalH = Math.max(totalH, gy);
    layout = { cells, colW, colX, rowH, rowY, totalH, totalW: gapX + GAP_W, gapGroups, gapX };
  }

  /* ---- 绘制 ---- */
  function drawGrid() {
    const L = layout;
    gGrid.selectAll('*').remove(); gRowHead.selectAll('*').remove(); gColHead.selectAll('*').remove(); gGroups.selectAll('*').remove();
    ROWS.forEach((r, ri) => {
      for (const c of COLS) {
        const isGap = c === '__gap';
        if (isGap && ri > 0) continue;
        const x = L.colX.get(c), w = L.colW.get(c), y = L.rowY.get(r), h = isGap ? L.totalH - HEAD_H : L.rowH.get(r);
        gGrid.append('rect').attr('class', 'cell' + (ri % 2 ? ' alt' : '') + (isGap ? ' gapcell' : '')).attr('x', x).attr('y', y).attr('width', w).attr('height', h);
        if (!isGap) { const cell = L.cells.get(c + '|' + r); gGrid.append('text').attr('class', 'cell-count').attr('x', x + w - 8).attr('y', y + 16).text(cell.count); }
      }
    });
    const sx = L.colX.get('N/A') + L.colW.get('N/A') + 9;
    gGrid.append('line').attr('class', 'divider').attr('x1', sx).attr('x2', sx).attr('y1', HEAD_H - 8).attr('y2', L.totalH);
    /* 列头（固定层）*/
    gColHead.append('rect').attr('class', 'head-bg').attr('x', 0).attr('y', 0).attr('width', L.totalW).attr('height', HEAD_H - 2);
    for (const c of COLS) {
      const x = L.colX.get(c), w = L.colW.get(c);
      const g = gColHead.append('g').attr('class', 'colhead').attr('transform', `translate(${x + w / 2},0)`);
      g.append('rect').attr('class', 'head-hit').attr('x', -w / 2).attr('y', 0).attr('width', w).attr('height', HEAD_H);
      g.append('text').attr('class', 'head-title').attr('y', 24).text(c === '__gap' ? '空缺' : (c === 'N/A' ? 'N/A' : `证据 ${c}`));
      g.append('text').attr('class', 'head-sub').attr('y', 42).text(COL_SUB[c]);
      g.on('mouseenter', (ev) => tooltip.show(`<b>${esc(c === '__gap' ? '空缺' : c)}</b><div class="tip-sub">${esc(c === '__gap' ? COL_SUB[c] : enc.EVIDENCE[c].desc)}</div>`, ev.clientX, ev.clientY)).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    }
    gColHead.append('text').attr('class', 'axis-name').attr('x', ROW_HEAD_W).attr('y', 11).text('证据等级 →');
    /* 行头（固定层）*/
    gRowHead.append('rect').attr('class', 'head-bg').attr('x', 0).attr('y', HEAD_H).attr('width', ROW_HEAD_W - 4).attr('height', L.totalH - HEAD_H);
    for (const r of ROWS) {
      const y = L.rowY.get(r), h = L.rowH.get(r);
      const g = gRowHead.append('g').attr('class', 'rowhead').attr('transform', `translate(0,${y})`);
      g.append('rect').attr('class', 'head-hit').attr('x', 0).attr('y', 0).attr('width', ROW_HEAD_W - 6).attr('height', h);
      g.append('text').attr('class', 'head-title').attr('x', 12).attr('y', 26).text(r);
      g.append('text').attr('class', 'head-sub').attr('x', 12).attr('y', 44).text(`${'●'.repeat(enc.CROWDING[r].n)}${'○'.repeat(3 - enc.CROWDING[r].n)}`);
      g.on('mouseenter', (ev) => tooltip.show(`<b>拥挤度 ${esc(r)}</b><div class="tip-sub">${esc(enc.CROWDING[r].desc)}</div>`, ev.clientX, ev.clientY)).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    }
    gRowHead.append('text').attr('class', 'axis-name').attr('x', 12).attr('y', HEAD_H + 14).text('拥挤度 ↓');
    for (const gg of L.gapGroups) gGrid.append('text').attr('class', 'gap-group').attr('x', L.gapX + PAD).attr('y', gg.y).text(`${gg.status} · ${gg.n}`).style('fill', enc.GAP_STATUS[gg.status]?.color || 'var(--muted)');
    for (const c of enc.EVIDENCE_ORDER) for (const r of ROWS) for (const g of L.cells.get(c + '|' + r).groups) {
      const cl = model.clusterById.get(g.cluster);
      gGroups.append('rect').attr('class', 'group-tint').attr('x', g.x0).attr('y', g.yy0).attr('width', g.x1 - g.x0).attr('height', g.yy1 - g.yy0).attr('rx', 8).style('fill', cl?._color || 'var(--muted)').append('title').text(cl?.name || g.cluster);
    }
    gGroups.classed('on', colorGroups);
  }

  function drawNodes() {
    const sel = gNodes.selectAll('g.node').data(sn, (d) => d.id);
    const ent = appendNodeGlyph(sel.enter().append('g'), model);
    ent.on('mouseenter', (ev, d) => { set({ hoverNode: d.id }); tooltip.show(nodeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverNode: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.nodeClick(d.id, { detail: ev.detail }); })
      .on('dblclick', (ev, d) => { ev.stopPropagation(); ev.preventDefault(); tooltip.hide(); actions.nodeDblClick(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); actions.nodeClick(d.id); } });
    ent.merge(sel).attr('transform', (d) => `translate(${d.x},${d.y})`);
  }
  function drawGapCards() {
    const sel = gGaps.selectAll('g.gapcard').data(sg, (d) => d.id);
    const ent = sel.enter().append('g').attr('class', 'gapcard').attr('data-id', (d) => d.id).attr('tabindex', 0).attr('role', 'button');
    ent.append('rect').attr('x', (d) => -d.w / 2).attr('y', (d) => -d.h / 2).attr('width', (d) => d.w).attr('height', (d) => d.h).attr('rx', 8).style('--c', (d) => enc.GAP_STATUS[d.ref.status]?.color || 'var(--muted)');
    ent.append('text').attr('class', 'g-id').attr('x', (d) => -d.w / 2 + 10).attr('y', -6).text((d) => d.id + (d.ref.key ? ' ★' : ''));
    ent.append('text').attr('class', 'g-title').attr('x', (d) => -d.w / 2 + 10).attr('y', 13).text((d) => d.ref.title);
    ent.append('title').text((d) => `${d.id} ${d.ref.title}\n${d.ref.summary}`);
    ent.on('click', (ev, d) => { ev.stopPropagation(); actions.selectGap(d.id, { zoom: false }); })
      .on('mouseenter', (ev, d) => tooltip.show(`<div class="tip-head"><span class="tip-id">${esc(d.id)}</span><b>${esc(d.ref.title)}</b></div><div class="tip-sub">${esc(d.ref.summary)}</div><div class="tip-meta">${esc(d.ref.status)}${d.ref.key ? ' · ★ 重点' : ''} · ${(d.ref.nodes || []).length} 个节点</div>`, ev.clientX, ev.clientY))
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    ent.merge(sel).attr('transform', (d) => `translate(${d.x},${d.y})`);
    gGaps.selectAll('text.g-title').each(function (d) { const t = d3.select(this); let txt = d.ref.title; t.text(txt); const max = d.w - 20; while (this.getComputedTextLength() > max && txt.length > 2) { txt = txt.slice(0, -1); t.text(txt + '…'); } });
  }

  function drawEdges(hl) {
    const ids = new Set([...hl.eHi, ...hl.eHi2].filter((id) => visible.edgeVis.has(id)));
    const data = [...ids].map((id) => ({ id, ref: model.edgeById.get(id) })).filter((d) => visible.nodeVis.has(d.ref.from) && visible.nodeVis.has(d.ref.to));
    const sel = gEdges.selectAll('g.edge').data(data, (d) => d.id);
    sel.exit().remove();
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    ent.on('mouseenter', (ev, d) => { set({ hoverEdge: d.id }); tooltip.show(edgeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverEdge: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.edgeClick(d.id); });
    ent.merge(sel).each(function (d) {
      const a = snById.get(d.ref.from), b = snById.get(d.ref.to);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const off = Math.min(90, L * 0.18) * (dx >= 0 ? -1 : 1);
      const cx = (a.x + b.x) / 2 + (-dy / L) * off, cy = (a.y + b.y) / 2 + (dx / L) * off;
      const gap = d.ref.type === '对应' ? 5 : 3;
      const p0 = borderPoint(a, cx, cy, gap), p1 = borderPoint(b, cx, cy, gap);
      setEdgePath(d3.select(this), `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}`, [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]]);
    });
  }

  function applyState() {
    if (!active) return;
    const s = get();
    const hl = computeHighlight(model, s, visible);
    drawEdges(hl);
    applyClasses({ nodeEls: gNodes.node().children, edgeEls: gEdges.node().children, hl, visible, s });
    gGaps.selectAll('g.gapcard').each(function (d) { this.classList.toggle('active', d.id === s.gap); this.classList.toggle('faint', hl.mode !== 'none' && hl.mode !== 'gap' && !(s.node && (d.ref.nodes || []).includes(s.node))); });
    svgEl.dataset.mode = hl.mode;
  }
  function relayout() { computeLayout(); drawGrid(); drawNodes(); drawGapCards(); }

  /* ---- 缩放：整屏适配或纵向滚动 ---- */
  let transform = d3.zoomIdentity, kFit = 1;
  const zoom = d3.zoom().scaleExtent([0.2, 6]).filter((ev) => !(scrollMode && ev.type === 'wheel')).on('zoom', (ev) => { transform = ev.transform; world.attr('transform', transform); placeHeads(); const z = stageEl.querySelector('[data-zoom-readout]'); if (z && active) z.textContent = `${Math.round((transform.k / kFit) * 100)}%`; });
  svg.call(zoom).on('dblclick.zoom', null);
  svgEl.addEventListener('wheel', (ev) => { if (!active || !scrollMode) return; ev.preventDefault(); const dx = ev.shiftKey ? ev.deltaY : ev.deltaX; const dy = ev.shiftKey ? 0 : ev.deltaY; svg.call(zoom.translateBy, -dx / transform.k, -dy / transform.k); }, { passive: false });
  function placeHeads() {
    const t = transform;
    /* 列头贴顶、行头贴左（sticky），其余跟着内容走 */
    const hy = scrollMode ? Math.max(t.y, INSET.top) : t.y;
    const hx = scrollMode ? Math.max(t.x, 12) : t.x;
    gColHead.attr('transform', `translate(${t.x},${hy}) scale(${t.k})`);
    gRowHead.attr('transform', `translate(${hx},${t.y}) scale(${t.k})`);
    gCorner.attr('x', hx).attr('y', hy).attr('width', (ROW_HEAD_W - 4) * t.k).attr('height', (HEAD_H - 2) * t.k).attr('display', scrollMode ? null : 'none');
  }
  function fitAll(animate = true) {
    const r = stageEl.getBoundingClientRect();
    const aw = r.width - INSET.left - INSET.right - extraInset.right, ah = r.height - INSET.top - INSET.bottom;
    const bw = layout.totalW + 20, bh = layout.totalH + 20;
    let k = Math.min(aw / bw, ah / bh);
    scrollMode = false;
    /* 字号会低于 12px：改为按 12px 定缩放，网格内滚动（先上下，宽度放不下时也可左右），行列标题固定 */
    if (k * CARD_FONT < MIN_FONT) { k = MIN_FONT / CARD_FONT; scrollMode = true; }
    kFit = k;
    const left = scrollMode ? 12 : INSET.left;
    const tx = scrollMode ? left + 10 * k : INSET.left + Math.max(0, (aw - bw * k) / 2) + 10 * k;
    const ty = scrollMode ? INSET.top + 10 * k : INSET.top + (ah - bh * k) / 2 + 10 * k;
    zoom.scaleExtent(scrollMode ? [k, k] : [0.2, 6]);
    if (scrollMode) zoom.translateExtent([[-10 - left / k, -10 - INSET.top / k], [Math.max(layout.totalW + 10 + 12 / k, (r.width - left) / k - 10), Math.max(layout.totalH + 10 + INSET.bottom / k, (r.height - INSET.top) / k - 10)]]);
    else zoom.translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]);
    const t = d3.zoomIdentity.translate(tx, ty).scale(k);
    (animate && !prefersReduced() ? svg.transition().duration(300) : svg).call(zoom.transform, t);
    const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = '100%';
  }
  function fitNodes(ids, animate = true) {
    const list = ids.map((id) => snById.get(id)).filter((d) => d && visible.nodeVis.has(d.id)); if (!list.length) return;
    const r = stageEl.getBoundingClientRect();
    const cx = d3.mean(list, (d) => d.x), cy = d3.mean(list, (d) => d.y);
    centerOn(cx, cy, scrollMode ? kFit : Math.min(kFit * 2.2, Math.max(kFit, Math.min((r.width - 80) / (d3.max(list, (d) => d.x + d.w / 2) - d3.min(list, (d) => d.x - d.w / 2) + 80), (r.height - 100) / (d3.max(list, (d) => d.y + d.h / 2) - d3.min(list, (d) => d.y - d.h / 2) + 80)))), animate);
  }
  function centerOn(x, y, k, animate = true) {
    const r = stageEl.getBoundingClientRect();
    (animate && !prefersReduced() ? svg.transition().duration(300) : svg).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - x * k, r.height / 2 - y * k).scale(k));
  }
  function ensureVisible(id) { const d = snById.get(id); if (d) panClearOfPanel({ svg, zoom, transform, stageEl, node: d }); }
  function zoomToNode(id) { const d = snById.get(id); if (d) centerOn(d.x, d.y, scrollMode ? kFit : Math.max(kFit * 1.6, transform.k)); }
  function zoomBy(f) { if (scrollMode) return; (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }

  function renderTools() {
    toolsEl.innerHTML = '';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = '按研究线着色格子背景'; b.setAttribute('aria-pressed', String(colorGroups));
    b.addEventListener('click', () => { colorGroups = !colorGroups; b.setAttribute('aria-pressed', String(colorGroups)); gGroups.classed('on', colorGroups); });
    toolsEl.appendChild(b);
    const tip = document.createElement('span'); tip.className = 'vt-hint'; tip.textContent = scrollMode ? '滚轮上下滚动网格 · 点节点看跨格关系' : '点节点看它与其他格子的关系弧线';
    toolsEl.appendChild(tip);
  }

  svg.on('click', (ev) => { if (ev.target === svgEl || ev.target.closest('.grid') || ev.target.closest('.heads')) actions.clearCanvas(); });
  subscribe((s, patch) => {
    if (!active) return;
    if ('filters' in patch || 'progressTick' in patch) { visible = computeVisibility(model, s.filters); relayout(); applyState(); return; }
    if (['node', 'edge', 'gap', 'path', 'hoverNode', 'hoverEdge', 'depth'].some((k) => k in patch)) applyState();
  });

  return {
    show() { active = true; svgEl.removeAttribute('hidden'); visible = computeVisibility(model, get().filters); relayout(); applyState(); fitAll(false); renderTools(); },
    hide() { active = false; svgEl.setAttribute('hidden', ''); },
    fitAll, fitNodes, zoomToNode, zoomBy, applyState, ensureVisible,
    isScrollMode: () => scrollMode,
    backToSelection() { const s = get(); if (s.path) fitNodes(s.path.nodes); else if (s.gap) fitNodes(gapNodeIds(s.gap)); else if (s.edge) { const e = model.edgeById.get(s.edge); if (e) fitNodes([e.from, e.to]); } else if (s.node) zoomToNode(s.node); },
  };
  function gapNodeIds(gid) { const g = model.gapById.get(gid); if (!g) return []; const ids = new Set(g.nodes || []); for (const e of model.edgesByGap.get(gid) || []) { ids.add(e.from); ids.add(e.to); } return [...ids]; }
}
