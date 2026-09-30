/* 视角三：时间线。横轴年份（按 timeline_breaks 分段压缩），纵向按研究线分泳道；泳道名固定在左侧；
   默认只画同泳道的对话型弧线，跨泳道弧线只在悬停 / 选中节点时画；支持故事线逐步展开。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as tooltip from '../tooltip.js';
import { computeVisibility } from '../filters.js';
import { appendNodeGlyph, appendEdgeGlyph, setEdgePath, nodeTip, edgeTip, borderPoint } from '../glyph.js';
import { computeHighlight, applyClasses } from '../highlight.js';
import { prefersReduced, extraInset, panClearOfPanel } from '../zoomable.js';
const esc = tooltip.esc;

const AXIS_W = 1500, LABEL_W = 140, AXIS_H = 44, LANE_PAD = 22, ROW_GAP = 10, NODE_GAP_X = 12, MAX_STACK = 4;
const DIALOG_TYPES = ['继承', '支持', '挑战', '修正'];
const INSET = { top: 56, right: 40, bottom: 40, left: 20 };

export function createTimeline({ svgEl, stageEl, model, actions, toolsEl }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('g.world');
  const gLanes = world.append('g').attr('class', 'lanes');
  const gAxis = world.append('g').attr('class', 'axis');
  const gEdges = world.append('g').attr('class', 'edges');
  const gCross = world.append('g').attr('class', 'edges cross');
  const gNodes = world.append('g').attr('class', 'nodes');
  const gStory = world.append('g').attr('class', 'story');
  /* 年份轴与泳道名画在 world 之外：滚动时轴贴顶、泳道名贴左 */
  const gAxisFixed = svg.append('g').attr('class', 'axis axis-fixed');
  const gLabels = svg.append('g').attr('class', 'lane-labels');
  svg.append('defs').append('clipPath').attr('id', 'laneLabelClip').append('rect').attr('x', 0).attr('y', 0).attr('width', LABEL_W - 2).attr('height', 4000);
  gLabels.attr('clip-path', 'url(#laneLabelClip)');

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
    if (minY < breaks[0].from) breaks[0] = { ...breaks[0], from: minY };
    if (maxY > breaks[breaks.length - 1].to) breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], to: maxY + 1 };
    const total = breaks.reduce((a, b) => a + b.share, 0);
    let x = 0;
    const segs = breaks.map((b) => { const w = (b.share / total) * AXIS_W; const s = { from: b.from, to: b.to, x0: x, x1: x + w, share: b.share / total }; x += w; return s; });
    const fx = (year) => {
      const s = segs.find((g) => year >= g.from && year <= g.to) || (year < segs[0].from ? segs[0] : segs[segs.length - 1]);
      const t = Math.max(0, Math.min(1, (year - s.from) / (s.to - s.from)));
      return s.x0 + t * (s.x1 - s.x0);
    };
    return { segs, x: fx, x1: AXIS_W };
  }
  function ticksFor(seg) {
    const span = seg.to - seg.from, px = seg.x1 - seg.x0;
    const step = [1, 2, 5, 10, 20, 25, 50].find((st) => (span / st) <= px / 64) || 50;
    const out = [];
    for (let y = Math.ceil(seg.from / step) * step; y <= seg.to; y += step) out.push(y);
    if (!out.includes(seg.from)) out.unshift(seg.from);
    return out;
  }

  /* ---- 布局：每摞最多 4 个，超出向右错开 ---- */
  function computeLayout() {
    const scale = buildScale();
    const lanes = [];
    let y = AXIS_H;
    for (const c of model.clusters) {
      const nodes = sn.filter((d) => d.ref._cluster === c.id && visible.nodeVis.has(d.id)).sort((a, b) => a.ref.year - b.ref.year || a.id.localeCompare(b.id));
      const rows = []; /* 每行最右边缘 */
      for (const d of nodes) {
        d.x = scale.x(d.ref.year); d._shifted = false;
        let r = 0;
        while (r < MAX_STACK && rows[r] != null && rows[r] + NODE_GAP_X > d.x - d.w / 2) r++;
        if (r >= MAX_STACK) {
          /* 四行都被占：放到最早空出来的那一行，向右错开 */
          let best = 0; for (let i = 1; i < MAX_STACK; i++) if (rows[i] < rows[best]) best = i;
          r = best; d.x = rows[r] + NODE_GAP_X + d.w / 2; d._shifted = true;
        }
        rows[r] = d.x + d.w / 2; d._row = r;
      }
      const nRows = Math.max(1, Math.min(MAX_STACK, rows.length));
      const h = LANE_PAD * 2 + nRows * (enc.NODE_H + ROW_GAP) - ROW_GAP;
      for (const d of nodes) d.y = y + LANE_PAD + d._row * (enc.NODE_H + ROW_GAP) + enc.NODE_H / 2;
      lanes.push({ c, y0: y, y1: y + h, nodes });
      y += h;
    }
    const maxX = Math.max(scale.x1, ...sn.filter((d) => visible.nodeVis.has(d.id)).map((d) => d.x + d.w / 2 + 10));
    layout = { scale, lanes, totalH: y, totalW: maxX };
    story.years = [...new Set(sn.filter((d) => visible.nodeVis.has(d.id)).map((d) => d.ref.year))].sort((a, b) => a - b);
    if (story.step > story.years.length - 1) story.step = Math.max(0, story.years.length - 1);
  }

  /* ---- 绘制 ---- */
  function drawLanes() {
    const L = layout;
    gLanes.selectAll('*').remove(); gAxis.selectAll('*').remove(); gLabels.selectAll('*').remove(); gAxisFixed.selectAll('*').remove();
    L.lanes.forEach((ln, i) => {
      gLanes.append('rect').attr('class', 'lane' + (i % 2 ? ' alt' : '')).attr('x', 0).attr('y', ln.y0).attr('width', L.totalW).attr('height', ln.y1 - ln.y0);
    });
    /* 轴 */
    const ay = AXIS_H - 12;
    gAxisFixed.append('rect').attr('class', 'axis-bg').attr('x', -20).attr('y', -40).attr('width', L.totalW + 60).attr('height', AXIS_H + 36);
    gAxisFixed.append('line').attr('class', 'axis-line').attr('x1', 0).attr('x2', L.scale.x1).attr('y1', ay).attr('y2', ay);
    L.scale.segs.forEach((seg, i) => {
      for (const yr of ticksFor(seg)) {
        const x = L.scale.x(yr);
        gAxis.append('line').attr('class', 'gridline').attr('x1', x).attr('x2', x).attr('y1', AXIS_H).attr('y2', L.totalH);
        const g = gAxisFixed.append('g').attr('class', 'tick').attr('transform', `translate(${x},${ay})`);
        g.append('line').attr('y1', 0).attr('y2', 6);
        g.append('text').attr('y', -6).text(yr);
        g.append('rect').attr('class', 'tick-hit').attr('x', -16).attr('y', -22).attr('width', 32).attr('height', 30);
        g.on('mouseenter', (ev) => {
          const list = sn.filter((d) => d.ref.year === yr && visible.nodeVis.has(d.id));
          tooltip.show(`<b>${yr} 年</b>` + (list.length ? list.map((d) => `<div class="tip-row"><span class="tip-id">${esc(d.id)}</span> ${esc(d.ref.name)}</div>`).join('') : '<div class="tip-sub">这一年没有节点</div>'), ev.clientX, ev.clientY);
        }).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
      }
      if (i > 0) {
        const x = seg.x0;
        const g = gAxisFixed.append('g').attr('class', 'axis-break').attr('transform', `translate(${x},${ay})`);
        g.append('rect').attr('x', -7).attr('y', -9).attr('width', 14).attr('height', 18);
        g.append('path').attr('d', 'M-5,-8 L-1,-3 L-5,2 L-1,7 M1,-8 L5,-3 L1,2 L5,7');
        g.append('title').text(`轴在 ${seg.from} 处压缩：左右两段每年的宽度不同`);
      }
      gAxisFixed.append('text').attr('class', 'seg-label').attr('x', (seg.x0 + seg.x1) / 2).attr('y', 10).text(`${seg.from}–${seg.to} · ${Math.round(seg.share * 100)}%`);
    });
    /* 泳道名固定列（屏幕坐标，placeLabels 里定位） */
    gLabels.append('rect').attr('class', 'label-bg').attr('x', 0).attr('y', 0).attr('width', LABEL_W).attr('height', 4000);
    L.lanes.forEach((ln) => {
      const g = gLabels.append('g').attr('class', 'lane-label-g').attr('data-cluster', ln.c.id);
      g.append('rect').attr('class', 'lane-mark').attr('x', LABEL_W - 4).attr('width', 4).style('fill', ln.c._color);
      const t = g.append('text').attr('class', 'lane-label' + (ln.c.main ? ' main' : '')).attr('x', 12).text(ln.c.name);
      t.append('tspan').attr('class', 'lane-count').attr('dx', 6).text(ln.nodes.length);
      g.append('text').attr('class', 'lane-desc').attr('x', 12).text(ln.c.desc || '');
      g.append('title').text(`${ln.c.name}${ln.c.desc ? '：' + ln.c.desc : ''}`);
    });
    gLabels.append('text').attr('class', 'axis-name').attr('x', 12).attr('y', 0).text('年份 →');
    placeLabels();
  }
  function placeLabels() {
    const t = transform;
    const ay = scrollMode ? Math.max(t.y, INSET.top) : t.y;
    gAxisFixed.attr('transform', `translate(${t.x},${ay}) scale(${t.k})`);
    gLabels.selectAll('g.lane-label-g').each(function () {
      const ln = layout.lanes.find((l) => l.c.id === this.dataset.cluster); if (!ln) return;
      const y0 = t.y + ln.y0 * t.k, h = (ln.y1 - ln.y0) * t.k;
      const g = d3.select(this).attr('transform', `translate(0,${y0})`);
      g.select('rect.lane-mark').attr('y', 0).attr('height', h);
      g.select('text.lane-label').attr('y', Math.min(24, h / 2 + 5));
      g.select('text.lane-desc').attr('y', Math.min(42, h - 6)).attr('display', h < 50 ? 'none' : null);
    });
    gLabels.select('text.axis-name').attr('y', ay + (AXIS_H - 8) * t.k);
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
    ent.merge(sel).attr('transform', (d) => `translate(${d.x},${d.y})`).classed('shifted', (d) => !!d._shifted);
  }

  function edgePath(e) {
    const a = e.source, b = e.target;
    const same = a.ref._cluster === b.ref._cluster;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const bow = same ? Math.min(90, 28 + L * 0.18) : Math.min(80, L * 0.14);
    const nx = -dy / L, ny = dx / L;
    const sign = ny < 0 ? 1 : -1;
    const cx = (a.x + b.x) / 2 + nx * bow * sign, cy = (a.y + b.y) / 2 + ny * bow * sign;
    const gap = e.ref.type === '对应' ? 5 : 3;
    const p0 = borderPoint(a, cx, cy, gap), p1 = borderPoint(b, cx, cy, gap);
    return { d: `M${p0[0]},${p0[1]} Q${cx},${cy} ${p1[0]},${p1[1]}`, mid: [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]] };
  }
  function bindEdge(ent) {
    ent.on('mouseenter', (ev, d) => { set({ hoverEdge: d.id }); tooltip.show(edgeTip(model, d.ref), ev.clientX, ev.clientY); })
      .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
      .on('mouseleave', () => { set({ hoverEdge: null }); tooltip.hide(); })
      .on('click', (ev, d) => { ev.stopPropagation(); tooltip.hide(); actions.edgeClick(d.id); });
  }
  /* 同泳道弧线：常驻 */
  function drawEdges() {
    const same = se.filter((e) => e.source.ref._cluster === e.target.ref._cluster);
    const sel = gEdges.selectAll('g.edge').data(same, (d) => d.id);
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    bindEdge(ent);
    ent.merge(sel).each(function (d) { const g = edgePath(d); setEdgePath(d3.select(this), g.d, g.mid); });
  }
  /* 跨泳道弧线：只画悬停 / 选中节点的（以及路径 / 空缺 / 选中关系涉及的） */
  function drawCross(ids) {
    const data = se.filter((e) => e.source.ref._cluster !== e.target.ref._cluster && ids.has(e.id) && visible.edgeVis.has(e.id));
    const sel = gCross.selectAll('g.edge').data(data, (d) => d.id);
    sel.exit().remove();
    const ent = appendEdgeGlyph(sel.enter().append('g'));
    bindEdge(ent);
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
    const sh = storyHidden();
    /* 跨泳道：悬停或选中节点的全部跨泳道关系 + 高亮集合里的 */
    const focusNode = s.hoverNode || s.node;
    const crossIds = new Set([...hl.eHi, ...hl.eHi2]);
    if (focusNode) for (const e of model.edgesOf.get(focusNode) || []) crossIds.add(e.id);
    drawCross(crossIds);
    const hiddenEdges = new Set(se.filter((e) => e.source.ref._cluster === e.target.ref._cluster && !typesOn.has(e.ref.type)).map((e) => e.id));
    if (sh.edges) for (const id of sh.edges) hiddenEdges.add(id);
    applyClasses({ nodeEls: gNodes.node().children, edgeEls: [...gEdges.node().children, ...gCross.node().children], hl, visible, s, hiddenNodes: null, hiddenEdges });
    gNodes.selectAll('g.node').each(function (d) { this.classList.toggle('story-hidden', !!(sh.nodes && sh.nodes.has(d.id))); });
    drawStoryMarker(sh.year);
    svgEl.dataset.mode = hl.mode;
    renderStoryStatus();
  }
  function relayout() { computeLayout(); drawLanes(); drawNodes(); drawEdges(); }

  /* ---- 缩放：字号不低于 13px，宽度放不下时横向滚动 ---- */
  let transform = d3.zoomIdentity, kFit = 1, scrollMode = false;
  const zoom = d3.zoom().scaleExtent([0.2, 6]).filter((ev) => !(scrollMode && ev.type === 'wheel')).on('zoom', (ev) => { transform = ev.transform; world.attr('transform', transform); placeLabels(); const z = stageEl.querySelector('[data-zoom-readout]'); if (z && active) z.textContent = `${Math.round((transform.k / kFit) * 100)}%`; });
  svg.call(zoom).on('dblclick.zoom', null);
  svgEl.addEventListener('wheel', (ev) => { if (!active || !scrollMode) return; ev.preventDefault(); const dx = ev.shiftKey ? ev.deltaY : ev.deltaX; const dy = ev.shiftKey ? 0 : ev.deltaY; svg.call(zoom.translateBy, -dx / transform.k, -dy / transform.k); }, { passive: false });
  function fitAll(animate = true) {
    const r = stageEl.getBoundingClientRect();
    const left = INSET.left + LABEL_W;
    const aw = r.width - left - INSET.right - extraInset.right, ah = r.height - INSET.top - INSET.bottom;
    const bw = layout.totalW + 20, bh = layout.totalH + 20;
    const kAll = Math.min(aw / bw, ah / bh);
    /* 放不下时不再缩小：字号保持 13px，改为上下左右滚动，轴贴顶、泳道名贴左 */
    let k = kAll;
    scrollMode = false;
    if (kAll < 1) { k = 1; scrollMode = true; }
    kFit = k;
    zoom.scaleExtent(scrollMode ? [k, k] : [0.2, 6]);
    if (scrollMode) zoom.translateExtent([[-10 - left / k, -10 - INSET.top / k], [Math.max(layout.totalW + 10 + INSET.right / k, (r.width - left) / k - 10), Math.max(layout.totalH + 10 + INSET.bottom / k, (r.height - INSET.top) / k - 10)]]);
    else zoom.translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]);
    const tx = scrollMode ? left + 10 * k : left + (aw - bw * k) / 2 + 10 * k;
    const ty = scrollMode ? INSET.top + 10 * k : INSET.top + (ah - bh * k) / 2 + 10 * k;
    (animate && !prefersReduced() ? svg.transition().duration(300) : svg).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = '100%';
  }
  function centerOn(x, y, k, animate = true) {
    const r = stageEl.getBoundingClientRect();
    (animate && !prefersReduced() ? svg.transition().duration(300) : svg).call(zoom.transform, d3.zoomIdentity.translate((r.width + LABEL_W) / 2 - x * k, r.height / 2 - y * k).scale(k));
  }
  function fitNodes(ids, animate = true) {
    const list = ids.map((id) => snById.get(id)).filter((d) => d && visible.nodeVis.has(d.id)); if (!list.length) return;
    centerOn(d3.mean(list, (d) => d.x), d3.mean(list, (d) => d.y), scrollMode ? kFit : Math.max(kFit, Math.min(kFit * 2.2, transform.k)), animate);
  }
  function ensureVisible(id) { const d = snById.get(id); if (d) panClearOfPanel({ svg, zoom, transform, stageEl, node: d }); }
  function zoomToNode(id) { const d = snById.get(id); if (d) centerOn(d.x, d.y, scrollMode ? kFit : Math.max(kFit * 1.6, transform.k)); }
  function zoomBy(f) { if (scrollMode) return; (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }

  /* ---- 视角工具条 ---- */
  let statusEl = null;
  function renderTools() {
    toolsEl.innerHTML = '';
    const lab = document.createElement('span'); lab.className = 'flabel'; lab.textContent = '同泳道弧线'; toolsEl.appendChild(lab);
    for (const r of enc.REL) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(typesOn.has(r.zh)));
      b.title = DIALOG_TYPES.includes(r.zh) ? `${r.desc}（对话型，默认显示）` : r.desc;
      b.innerHTML = `<span class="sw line" style="--c:var(--rel-${r.key})"></span><span>${r.zh}</span>`;
      b.addEventListener('click', () => { if (typesOn.has(r.zh)) typesOn.delete(r.zh); else typesOn.add(r.zh); b.setAttribute('aria-pressed', String(typesOn.has(r.zh))); applyState(); });
      toolsEl.appendChild(b);
    }
    const sep = document.createElement('span'); sep.className = 'vt-sep'; toolsEl.appendChild(sep);
    const btn = (text, fn, cls = 'icon-btn small') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); toolsEl.appendChild(b); return b; };
    const toggle = btn(story.active ? '退出故事线' : '逐步展开', () => { story.active = !story.active; if (story.active) story.step = 0; renderTools(); applyState(); });
    toggle.setAttribute('aria-pressed', String(story.active));
    if (story.active) {
      btn('上一步', () => step(-1)); btn('下一步', () => step(1)); btn('跳到结尾', () => { story.step = story.years.length - 1; applyState(); });
      statusEl = document.createElement('span'); statusEl.className = 'vt-status'; toolsEl.appendChild(statusEl);
      const hint = document.createElement('span'); hint.className = 'vt-hint'; hint.textContent = '← → 键也可以'; toolsEl.appendChild(hint);
    } else { statusEl = null; const hint = document.createElement('span'); hint.className = 'vt-hint'; hint.textContent = scrollMode ? '滚轮 / 拖动滚动画面 · 悬停节点看跨泳道关系' : '悬停节点看跨泳道关系'; toolsEl.appendChild(hint); }
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
    show() { active = true; svgEl.removeAttribute('hidden'); visible = computeVisibility(model, get().filters); relayout(); applyState(); fitAll(false); renderTools(); },
    hide() { active = false; svgEl.setAttribute('hidden', ''); },
    fitAll, fitNodes, zoomToNode, zoomBy, applyState, ensureVisible,
    isScrollMode: () => scrollMode,
    backToSelection() { const s = get(); if (s.path) fitNodes(s.path.nodes); else if (s.gap) fitNodes(gapNodeIds(s.gap)); else if (s.edge) { const e = model.edgeById.get(s.edge); if (e) fitNodes([e.from, e.to]); } else if (s.node) zoomToNode(s.node); },
    story,
  };
  function gapNodeIds(gid) { const g = model.gapById.get(gid); if (!g) return []; const ids = new Set(g.nodes || []); for (const e of model.edgesByGap.get(gid) || []) { ids.add(e.from); ids.add(e.to); } return [...ids]; }
}
