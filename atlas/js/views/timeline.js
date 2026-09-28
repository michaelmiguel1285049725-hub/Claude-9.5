/* 视角三：时间线。横轴年份（按 timeline_breaks 分段压缩），纵向按研究线分泳道，关系画成弧线，支持故事线逐步展开。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as tooltip from '../tooltip.js';
import { computeVisibility } from '../filters.js';
import { appendNodeGlyph, appendEdgeGlyph, setEdgePath, nodeTip, edgeTip } from '../glyph.js';
import { computeHighlight, applyClasses } from '../highlight.js';
import { makeZoomable, boundsOf, prefersReduced } from '../zoomable.js';
const esc = tooltip.esc;

const AXIS_W = 1700, LANE_LABEL_W = 150, AXIS_H = 44, LANE_PAD = 26, ROW_GAP = 10, NODE_GAP_X = 12;
const DIALOG_TYPES = ['继承', '支持', '挑战', '修正'];

export function createTimeline({ svgEl, stageEl, model, actions, toolsEl }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('g.world');
  const gLanes = world.append('g').attr('class', 'lanes');
  const gAxis = world.append('g').attr('class', 'axis');
  const gEdges = world.append('g').attr('class', 'edges');
  const gNodes = world.append('g').attr('class', 'nodes');
  const gStory = world.append('g').attr('class', 'story');

  const sn = model.nodes.map((n) => ({ id: n.id, ref: n, w: enc.NODE_W, h: enc.NODE_H, x: 0, y: 0 }));
  const snById = new Map(sn.map((d) => [d.id, d]));
  const se = model.edges.map((e) => ({ id: e.id, ref: e, source: snById.get(e.from), target: snById.get(e.to) }));
  let visible = computeVisibility(model, get().filters);
  let active = false;
  const typesOn = new Set(DIALOG_TYPES);
  const story = { active: false, step: 0, years: [] };
  let layout = null;

  /* ---- 分段压缩的年份比例尺 ---- */
  function buildScale() {
    let breaks = Array.isArray(model.domain.timeline_breaks) ? model.domain.timeline_breaks.filter((b) => Number.isFinite(b?.from) && Number.isFinite(b?.to) && b.from < b.to && b.share > 0) : [];
    const years = sn.map((d) => d.ref.year);
    const minY = Math.min(...years), maxY = Math.max(...years);
    if (!breaks.length) breaks = [{ from: Math.floor((minY - 2) / 5) * 5, to: Math.ceil((maxY + 2) / 5) * 5, share: 1 }];
    /* 数据超出分段范围时，首尾段自动扩展 */
    if (minY < breaks[0].from) breaks[0] = { ...breaks[0], from: minY };
    if (maxY > breaks[breaks.length - 1].to) breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], to: maxY + 1 };
    const total = breaks.reduce((a, b) => a + b.share, 0);
    let x = LANE_LABEL_W;
    const segs = breaks.map((b) => { const w = (b.share / total) * AXIS_W; const s = { from: b.from, to: b.to, x0: x, x1: x + w }; x += w; return s; });
    const x0 = (year) => {
      const s = segs.find((g) => year >= g.from && year <= g.to) || (year < segs[0].from ? segs[0] : segs[segs.length - 1]);
      const t = Math.max(0, Math.min(1, (year - s.from) / (s.to - s.from)));
      return s.x0 + t * (s.x1 - s.x0);
    };
    return { segs, x: x0, x1: LANE_LABEL_W + AXIS_W };
  }

  function ticksFor(seg) {
    const span = seg.to - seg.from, px = seg.x1 - seg.x0;
    const step = [1, 2, 5, 10, 20, 25, 50].find((st) => (span / st) * 1 <= px / 60) || 50;
    const out = [];
    for (let y = Math.ceil(seg.from / step) * step; y <= seg.to; y += step) out.push(y);
    if (!out.includes(seg.from)) out.unshift(seg.from);
    return out;
  }

  /* ---- 布局 ---- */
  function computeLayout() {
    const scale = buildScale();
    const lanes = [];
    let y = AXIS_H;
    for (const c of model.clusters) {
      const nodes = sn.filter((d) => d.ref._cluster === c.id && visible.nodeVis.has(d.id)).sort((a, b) => a.ref.year - b.ref.year || a.id.localeCompare(b.id));
      const rows = [];
      for (const d of nodes) {
        d.x = scale.x(d.ref.year);
        let r = 0;
        while (rows[r] != null && rows[r] + NODE_GAP_X > d.x - d.w / 2) r++;
        rows[r] = d.x + d.w / 2; d._row = r;
      }
      const nRows = Math.max(1, rows.length);
      const h = LANE_PAD * 2 + nRows * (enc.NODE_H + ROW_GAP) - ROW_GAP;
      for (const d of nodes) d.y = y + LANE_PAD + d._row * (enc.NODE_H + ROW_GAP) + enc.NODE_H / 2;
      lanes.push({ c, y0: y, y1: y + h, nodes });
      y += h;
    }
    layout = { scale, lanes, totalH: y, totalW: scale.x1 + 20 };
    /* 故事线年份 */
    story.years = [...new Set(sn.filter((d) => visible.nodeVis.has(d.id)).map((d) => d.ref.year))].sort((a, b) => a - b);
    if (story.step > story.years.length - 1) story.step = Math.max(0, story.years.length - 1);
  }

  /* ---- 绘制 ---- */
  function drawLanes() {
    const L = layout;
    gLanes.selectAll('*').remove(); gAxis.selectAll('*').remove();
    L.lanes.forEach((ln, i) => {
      const g = gLanes.append('g').attr('class', 'lane' + (i % 2 ? ' alt' : '')).attr('data-cluster', ln.c.id);
      g.append('rect').attr('x', 0).attr('y', ln.y0).attr('width', L.totalW).attr('height', ln.y1 - ln.y0);
      g.append('rect').attr('class', 'lane-mark').attr('x', 0).attr('y', ln.y0).attr('width', 4).attr('height', ln.y1 - ln.y0).style('fill', ln.c._color);
      const t = g.append('text').attr('class', 'lane-label' + (ln.c.main ? ' main' : '')).attr('x', 14).attr('y', ln.y0 + 24).text(ln.c.name);
      t.append('tspan').attr('class', 'lane-count').attr('dx', 6).text(ln.nodes.length);
      g.append('text').attr('class', 'lane-desc').attr('x', 14).attr('y', ln.y0 + 42).text(ln.c.desc || '');
      g.append('title').text(`${ln.c.name}${ln.c.desc ? '：' + ln.c.desc : ''}`);
    });
    /* 轴 */
    const ay = AXIS_H - 12;
    gAxis.append('line').attr('class', 'axis-line').attr('x1', LANE_LABEL_W).attr('x2', L.scale.x1).attr('y1', ay).attr('y2', ay);
    gAxis.append('text').attr('class', 'axis-name').attr('x', 14).attr('y', ay + 4).text('年份 →');
    L.scale.segs.forEach((seg, i) => {
      for (const yr of ticksFor(seg)) {
        const x = L.scale.x(yr);
        const g = gAxis.append('g').attr('class', 'tick').attr('transform', `translate(${x},${ay})`);
        g.append('line').attr('y1', 0).attr('y2', 6);
        g.append('line').attr('class', 'gridline').attr('y1', 12).attr('y2', L.totalH - AXIS_H + 12);
        g.append('text').attr('y', -6).text(yr);
        g.append('rect').attr('class', 'tick-hit').attr('x', -16).attr('y', -22).attr('width', 32).attr('height', 30);
        g.on('mouseenter', (ev) => {
          const list = sn.filter((d) => d.ref.year === yr && visible.nodeVis.has(d.id));
          tooltip.show(`<b>${yr} 年</b>` + (list.length ? list.map((d) => `<div class="tip-row"><span class="tip-id">${esc(d.id)}</span> ${esc(d.ref.name)}</div>`).join('') : '<div class="tip-sub">这一年没有节点</div>'), ev.clientX, ev.clientY);
        }).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
      }
      /* 分段处的锯齿断轴标记 */
      if (i > 0) {
        const x = seg.x0;
        const g = gAxis.append('g').attr('class', 'axis-break').attr('transform', `translate(${x},${ay})`);
        g.append('rect').attr('x', -7).attr('y', -9).attr('width', 14).attr('height', 18);
        g.append('path').attr('d', 'M-5,-8 L-1,-3 L-5,2 L-1,7 M1,-8 L5,-3 L1,2 L5,7');
        g.append('title').text(`轴在 ${seg.from} 处压缩：左右两段比例不同`);
        g.append('text').attr('class', 'break-label').attr('y', L.totalH - AXIS_H + 26).text('轴压缩');
      }
      const label = gAxis.append('text').attr('class', 'seg-label').attr('x', (seg.x0 + seg.x1) / 2).attr('y', 10).text(`${seg.from}–${seg.to}`);
    });
  }

  function drawNodes() {
    const sel = gNodes.selectAll('g.node').data(sn, (d) => d.id);
    const ent = appendNodeGlyph(sel.enter().append('g'), model);
    ent.on('mouseenter', (ev, d) => { set({ hoverNode: d.id }); tooltip.show(nodeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverNode: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.nodeClick(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); actions.nodeClick(d.id); } });
    ent.merge(sel).attr('transform', (d) => `translate(${d.x},${d.y})`);
  }

  function edgePath(e) {
    const a = e.source, b = e.target;
    const left = a.x <= b.x ? a : b, right = left === a ? b : a;
    /* 从左节点右上/右下出发到右节点，弧向上拱起；同泳道时拱更高 */
    const same = a.ref._cluster === b.ref._cluster;
    const dx = right.x - left.x, dy = right.y - left.y, L = Math.hypot(dx, dy) || 1;
    const bow = same ? Math.min(90, 28 + L * 0.18) : Math.min(80, L * 0.14);
    const nx = -dy / L, ny = dx / L; /* 法线 */
    const sign = ny < 0 ? 1 : -1; /* 让法线朝上 */
    const cx = (a.x + b.x) / 2 + nx * bow * sign, cy = (a.y + b.y) / 2 + ny * bow * sign;
    const gap = e.ref.type === '对应' ? 5 : 3;
    const p0 = borderPt(a, cx, cy, gap), p1 = borderPt(b, cx, cy, gap);
    return { d: `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}`, mid: [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]] };
  }
  function borderPt(n, tx, ty, gap) {
    const dx = tx - n.x, dy = ty - n.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, hw = n.w / 2 + gap, hh = n.h / 2 + gap;
    const t = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9));
    return [n.x + ux * t, n.y + uy * t];
  }
  function drawEdges() {
    const sel = gEdges.selectAll('g.edge').data(se, (d) => d.id);
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    ent.on('mouseenter', (ev, d) => { set({ hoverEdge: d.id }); tooltip.show(edgeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverEdge: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.edgeClick(d.id); });
    ent.merge(sel).each(function (d) { const g = edgePath(d); setEdgePath(d3.select(this), g.d, g.mid); });
  }

  /* ---- 故事线 ---- */
  function storyHidden() {
    if (!story.active || !story.years.length) return { nodes: null, edges: null, year: null };
    const year = story.years[story.step];
    const nodes = new Set(sn.filter((d) => d.ref.year > year).map((d) => d.id));
    const edges = new Set(se.filter((e) => nodes.has(e.source.id) || nodes.has(e.target.id)).map((e) => e.id));
    return { nodes, edges, year };
  }
  function drawStoryMarker(year) {
    gStory.selectAll('*').remove();
    if (year == null) return;
    const x = layout.scale.x(year) + enc.NODE_W / 2 + 8;
    gStory.append('line').attr('x1', x).attr('x2', x).attr('y1', AXIS_H - 8).attr('y2', layout.totalH);
    gStory.append('text').attr('x', x + 6).attr('y', AXIS_H + 14).text(`${year} 年`);
  }

  function applyState() {
    if (!active) return;
    const s = get();
    const hl = computeHighlight(model, s, visible);
    /* 时间线自己的关系类型开关：不在 typesOn 里的线隐藏 */
    const sh = storyHidden();
    const hiddenEdges = new Set(se.filter((e) => !typesOn.has(e.ref.type)).map((e) => e.id));
    if (sh.edges) for (const id of sh.edges) hiddenEdges.add(id);
    applyClasses({ nodeEls: gNodes.node().children, edgeEls: gEdges.node().children, hl, visible, s, hiddenNodes: null, hiddenEdges });
    /* 故事线用透明度而不是 display，便于淡入 */
    gNodes.selectAll('g.node').each(function (d) { this.classList.toggle('story-hidden', !!(sh.nodes && sh.nodes.has(d.id))); });
    drawStoryMarker(sh.year);
    svgEl.dataset.mode = hl.mode;
    renderStoryStatus();
  }
  function relayout() { computeLayout(); drawLanes(); drawNodes(); drawEdges(); }

  /* ---- 缩放 ---- */
  let kFit = 1;
  const zoomer = makeZoomable({ svg, world, stageEl, inset: { top: 56, right: 10, bottom: 44, left: 10 }, onZoom: (t) => { const z = stageEl.querySelector('[data-zoom-readout]'); if (z && active) z.textContent = `${Math.round((t.k / kFit) * 100)}%`; } });
  function bounds() { return { x0: -10, y0: -50, x1: layout.totalW + 10, y1: layout.totalH + 10, w: layout.totalW + 20, h: layout.totalH + 60 }; }
  function fitAll(animate = true) { kFit = zoomer.fitBounds(bounds(), animate) || 1; const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = '100%'; }
  function fitNodes(ids, animate = true) { const list = ids.map((id) => snById.get(id)).filter((d) => d && visible.nodeVis.has(d.id)); if (list.length) zoomer.fitBounds(boundsOf(list, 40), animate, kFit * 2.2); }
  function zoomToNode(id) { const d = snById.get(id); if (d) zoomer.centerOn(d.x, d.y, Math.max(kFit * 1.6, zoomer.getTransform().k)); }

  /* ---- 视角工具条 ---- */
  let statusEl = null;
  function renderTools() {
    toolsEl.innerHTML = '';
    const lab = document.createElement('span'); lab.className = 'flabel'; lab.textContent = '弧线'; toolsEl.appendChild(lab);
    for (const r of enc.REL) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(typesOn.has(r.zh)));
      b.title = DIALOG_TYPES.includes(r.zh) ? `${r.desc}（对话型，默认显示）` : r.desc;
      b.innerHTML = `<span class="sw line" style="--c:var(--rel-${r.key})"></span><span>${r.zh}</span>`;
      b.addEventListener('click', () => { if (typesOn.has(r.zh)) typesOn.delete(r.zh); else typesOn.add(r.zh); b.setAttribute('aria-pressed', String(typesOn.has(r.zh))); applyState(); });
      toolsEl.appendChild(b);
    }
    const sep = document.createElement('span'); sep.className = 'vt-sep'; toolsEl.appendChild(sep);
    const btn = (text, fn, cls = 'icon-btn small') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); toolsEl.appendChild(b); return b; };
    const toggle = btn(story.active ? '退出故事线' : '逐步展开', () => { story.active = !story.active; if (story.active) story.step = 0; renderTools(); applyState(); if (story.active) fitAll(true); });
    toggle.setAttribute('aria-pressed', String(story.active));
    if (story.active) {
      btn('上一步', () => step(-1)); btn('下一步', () => step(1)); btn('跳到结尾', () => { story.step = story.years.length - 1; applyState(); });
      statusEl = document.createElement('span'); statusEl.className = 'vt-status'; toolsEl.appendChild(statusEl);
      const hint = document.createElement('span'); hint.className = 'vt-hint'; hint.textContent = '← → 键也可以'; toolsEl.appendChild(hint);
    } else statusEl = null;
  }
  function step(delta) { story.step = Math.max(0, Math.min(story.years.length - 1, story.step + delta)); applyState(); }
  function renderStoryStatus() { if (statusEl && story.years.length) statusEl.textContent = `第 ${story.step + 1} 步 / 共 ${story.years.length} 步 · ${story.years[story.step]} 年`; }

  svg.on('click', (ev) => { if (ev.target === svgEl || ev.target.closest('.lanes') || ev.target.closest('.axis')) actions.clearCanvas(); });
  window.addEventListener('keydown', (e) => {
    if (!active || !story.active) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });
  subscribe((s, patch) => {
    if (!active) return;
    if ('filters' in patch || 'progressTick' in patch) { visible = computeVisibility(model, s.filters); relayout(); applyState(); return; }
    if (['node', 'edge', 'gap', 'path', 'hoverNode', 'hoverEdge', 'depth'].some((k) => k in patch)) applyState();
  });

  return {
    show() { active = true; svgEl.removeAttribute('hidden'); visible = computeVisibility(model, get().filters); relayout(); renderTools(); applyState(); fitAll(false); },
    hide() { active = false; svgEl.setAttribute('hidden', ''); },
    fitAll, fitNodes, zoomToNode, zoomBy: zoomer.zoomBy, applyState,
    backToSelection() { const s = get(); if (s.path) fitNodes(s.path.nodes); else if (s.gap) fitNodes(gapNodeIds(s.gap)); else if (s.edge) { const e = model.edgeById.get(s.edge); if (e) fitNodes([e.from, e.to]); } else if (s.node) zoomToNode(s.node); },
    story,
  };
  function gapNodeIds(gid) { const g = model.gapById.get(gid); if (!g) return []; const ids = new Set(g.nodes || []); for (const e of model.edgesByGap.get(gid) || []) { ids.add(e.from); ids.add(e.to); } return [...ids]; }
}
