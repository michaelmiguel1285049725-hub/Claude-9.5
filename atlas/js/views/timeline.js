// 视角三：时间线。横轴年份按 domain.timeline_breaks 分段压缩，纵向每条研究线一条泳道。
// 默认只画"对话型"关系（继承、支持、挑战、修正），其余四种可打开；另有"逐步展开"的故事线模式。
import { nodeBox, drawNode } from '../glyph.js';
import { REL_TYPES } from '../encoding.js';
import { clusterOf } from '../data.js';
import { computeHighlight, applyHighlight, joinEdges, arcBetween, bindInteractions, createZoomCanvas, esc } from './shared.js';

const d3 = window.d3;
const DIALOG = ['继承', '支持', '挑战', '修正'];
const LANE_X = 170, AXIS_W = 1750, TOP = 56, ROW_GAP = 12, LANE_PAD = 18;

export function createTimelineView({ root, model, store, tooltip, actions, getDigested, toolsEl }) {
  const cv = createZoomCanvas(root, 'timeline', { onZoom: () => tooltip.hide() });
  const { svg, viewport } = cv;
  svg.attr('aria-label', '时间线');
  const gLane = viewport.append('g').attr('class', 't-lanes');
  const gAxis = viewport.append('g').attr('class', 't-axis');
  const gEdge = viewport.append('g').attr('class', 'edges t-arcs');
  const gNode = viewport.append('g').attr('class', 'nodes');
  const gYear = viewport.append('g').attr('class', 't-yearline');

  const boxes = new Map(model.nodes.map(n => [n.id, nodeBox(n)]));
  let vis = null, view = { sel: null, depth: 1 }, hover = {};
  let pos = new Map(), laneBottom = TOP;
  let allTypes = store.get('timelineAllTypes', false) === true;
  let story = null;   // { years: [...], step }

  // ---------- 时间比例尺：分段线性 ----------
  const breaks = Array.isArray(model.domain.timeline_breaks) && model.domain.timeline_breaks.length
    ? model.domain.timeline_breaks
    : (() => { const ys = model.nodes.map(n => n.year).filter(Number.isFinite); return [{ from: Math.min(...ys) - 1, to: Math.max(...ys) + 1, share: 1 }]; })();
  const dom = [breaks[0].from, ...breaks.map(b => b.to)];
  let acc = 0;
  const shareSum = breaks.reduce((s, b) => s + b.share, 0) || 1;
  const rng = [0, ...breaks.map(b => (acc += b.share / shareSum) * AXIS_W)];
  const x = d3.scaleLinear().domain(dom).range(rng.map(r => LANE_X + r)).clamp(true);

  // ---------- 工具栏 ----------
  toolsEl.innerHTML = `
    <button type="button" class="btn" data-t="types" aria-pressed="${allTypes}" title="默认只显示继承、支持、挑战、修正（谁在回应谁）">显示其余四种关系</button>
    <button type="button" class="btn" data-t="story" aria-pressed="false" title="从最早的年份开始，一步一步出现">逐步展开</button>`;
  toolsEl.querySelector('[data-t="types"]').addEventListener('click', ev => {
    allTypes = !allTypes; store.set('timelineAllTypes', allTypes);
    ev.currentTarget.setAttribute('aria-pressed', String(allTypes));
    drawEdges(); paint();
  });
  toolsEl.querySelector('[data-t="story"]').addEventListener('click', () => (story ? endStory() : startStory()));

  // 故事线控制条
  const bar = d3.select(root).append('div').attr('class', 'storybar').attr('hidden', true).attr('role', 'group').attr('aria-label', '逐步展开');
  bar.html(`<span class="sb-step"></span><span class="sb-year"></span>
    <button type="button" class="btn" data-s="prev">上一步</button><button type="button" class="btn" data-s="next">下一步</button>
    <button type="button" class="btn" data-s="end">跳到结尾</button><button type="button" class="btn" data-s="exit">退出</button>`);
  bar.on('click', ev => {
    const b = ev.target.closest('button'); if (!b || !story) return;
    if (b.dataset.s === 'prev') setStep(story.step - 1);
    if (b.dataset.s === 'next') setStep(story.step + 1);
    if (b.dataset.s === 'end') setStep(story.years.length - 1);
    if (b.dataset.s === 'exit') endStory();
  });

  // ---------- 布局：泳道 + 同一泳道内按年份堆叠，不重叠 ----------
  function layout() {
    pos = new Map();
    const lanes = [];
    let y = TOP + 18;
    const clusters = [...model.clusters];
    if (model.nodes.some(n => !model.clusterById.has(n.cluster))) clusters.push({ id: '__other', name: '（未知研究线）', color: 'var(--muted)' });
    clusters.forEach((c, i) => {
      const list = model.nodes.filter(n => vis.nodes.has(n.id) && (c.id === '__other' ? !model.clusterById.has(n.cluster) : n.cluster === c.id))
        .sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));
      const rows = [];   // 每行记录最右端
      const placed = list.map(n => {
        const b = boxes.get(n.id), cx = x(n.year);
        let r = rows.findIndex(right => right + 10 <= cx - b.w / 2);
        if (r < 0) { rows.push(-Infinity); r = rows.length - 1; }
        rows[r] = cx + b.w / 2;
        return { n, cx, r };
      });
      const rowH = Math.max(46, ...list.map(n => boxes.get(n.id).h)) + ROW_GAP;
      const h = Math.max(64, rows.length * rowH + LANE_PAD * 2 - ROW_GAP);
      placed.forEach(p => pos.set(p.n.id, { x: p.cx, y: y + LANE_PAD + p.r * rowH + boxes.get(p.n.id).h / 2 }));
      lanes.push({ c, y, h, i, count: list.length });
      y += h;
    });
    laneBottom = y;
    return lanes;
  }

  function drawLanes(lanes) {
    gLane.selectAll('*').remove();
    for (const L of lanes) {
      const g = gLane.append('g').attr('class', `t-lane${L.i % 2 ? ' alt' : ''}${L.c.main ? ' main' : ''}`);
      g.append('rect').attr('x', 0).attr('y', L.y).attr('width', LANE_X + AXIS_W + 30).attr('height', L.h);
      g.append('rect').attr('class', 't-lane-mark').attr('x', 0).attr('y', L.y).attr('width', 4).attr('height', L.h).style('fill', L.c.color);
      const t = g.append('text').attr('class', 't-lane-name').attr('x', 16).attr('y', L.y + L.h / 2 - 4);
      t.append('tspan').text(L.c.name);
      g.append('text').attr('class', 't-lane-sub').attr('x', 16).attr('y', L.y + L.h / 2 + 16).text(`${L.c.id === '__other' ? '' : L.c.id + ' · '}${L.count} 个节点`);
    }
  }

  // 刻度：每段按宽度挑步长，分段处画锯齿断轴标记
  function drawAxis() {
    gAxis.selectAll('*').remove();
    const y0 = TOP;
    gAxis.append('line').attr('class', 't-axis-line').attr('x1', LANE_X).attr('x2', LANE_X + AXIS_W).attr('y1', y0).attr('y2', y0);
    const ticks = new Set();
    breaks.forEach(b => {
      const px = x(b.to) - x(b.from), span = b.to - b.from;
      const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => (px / span) * s >= 58) || 100;
      for (let yr = Math.ceil(b.from / step) * step; yr <= b.to; yr += step) ticks.add(yr);
    });
    // 两端年份也标上
    ticks.add(dom[0]); ticks.add(dom[dom.length - 1]);
    const sorted = [...ticks].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || x(t) - x(arr[i - 1]) >= 40);
    for (const t of sorted) {
      gAxis.append('line').attr('class', 't-tick').attr('x1', x(t)).attr('x2', x(t)).attr('y1', y0 - 5).attr('y2', y0);
      gAxis.append('text').attr('class', 't-tick-label').attr('x', x(t)).attr('y', y0 - 10).attr('text-anchor', 'middle').text(t);
      gAxis.append('line').attr('class', 't-grid').attr('x1', x(t)).attr('x2', x(t)).attr('y1', y0 + 2).attr('y2', laneBottom);
    }
    // 断轴标记：锯齿
    breaks.slice(0, -1).forEach(b => {
      const bx = x(b.to);
      gAxis.append('path').attr('class', 't-break').attr('d', `M${bx - 7},${y0 + 7} l4,-7 l4,7 l4,-7 M${bx - 7},${y0 + 11} l4,-7 l4,7 l4,-7`);
      gAxis.append('line').attr('class', 't-break-line').attr('x1', bx).attr('x2', bx).attr('y1', y0 + 12).attr('y2', laneBottom);
    });
    gAxis.append('text').attr('class', 't-axis-title').attr('x', 16).attr('y', y0 - 10).text('年份 →');
    // 悬停年份：整条刻度带都可悬停，显示这一年出现的节点
    gAxis.append('rect').attr('class', 't-axis-hit').attr('x', LANE_X - 10).attr('y', y0 - 30).attr('width', AXIS_W + 20).attr('height', 44)
      .on('pointermove', ev => {
        const [mx] = d3.pointer(ev, viewport.node());
        const yr = Math.round(x.invert(mx));
        const list = model.nodes.filter(n => n.year === yr && vis.nodes.has(n.id));
        gYear.selectAll('*').remove();
        gYear.append('line').attr('x1', x(yr)).attr('x2', x(yr)).attr('y1', y0 - 4).attr('y2', laneBottom);
        gNode.selectAll('g.node').classed('year-hi', n => n.year === yr);
        tooltip.show(`<div class="tt-head">${yr} 年</div>${list.length ? list.map(n => `<div class="tt-body"><span class="tt-id">${esc(n.id)}</span>${esc(n.name)}</div>`).join('') : '<div class="tt-meta">这一年没有节点</div>'}`, ev);
      })
      .on('pointerout', () => { gYear.selectAll('*').remove(); gNode.selectAll('g.node').classed('year-hi', false); tooltip.hide(); });
  }

  function drawNodes() {
    const digested = getDigested();
    gNode.selectAll('g.node').data(model.nodes.filter(n => pos.has(n.id)), n => n.id).join(
      enter => enter.append('g').attr('class', 'node').attr('data-id', n => n.id).attr('tabindex', 0).attr('role', 'button').attr('aria-label', n => `${n.id} ${n.name} ${n.year}`)
        .each(function (n) { drawNode(d3.select(this), n, boxes.get(n.id), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) }); }),
      update => update, exit => exit.remove())
      .attr('transform', n => `translate(${pos.get(n.id).x},${pos.get(n.id).y})`);
  }

  function arcTypesOn() { return allTypes ? REL_TYPES : DIALOG; }
  function drawEdges() {
    const types = new Set(arcTypesOn());
    const edges = vis.visibleEdgeList.filter(e => types.has(e.type) && pos.has(e.from) && pos.has(e.to));
    const geo = new Map(edges.map(e => [e.id, arcBetween(pos.get(e.from), boxes.get(e.from), pos.get(e.to), boxes.get(e.to), 0.2)]));
    joinEdges(gEdge, edges, geo);
  }

  // ---------- 故事线 ----------
  function startStory() {
    const years = [...new Set(model.nodes.filter(n => vis.nodes.has(n.id)).map(n => n.year))].sort((a, b) => a - b);
    if (!years.length) return;
    story = { years, step: 0 };
    toolsEl.querySelector('[data-t="story"]').setAttribute('aria-pressed', 'true');
    bar.attr('hidden', null);
    setStep(0);
  }
  function endStory() {
    story = null;
    toolsEl.querySelector('[data-t="story"]').setAttribute('aria-pressed', 'false');
    bar.attr('hidden', true);
    svg.classed('story', false);
    gNode.selectAll('g.node').classed('st-hidden', false).classed('st-new', false);
    gEdge.selectAll('g.edge').classed('st-hidden', false);
  }
  function setStep(i) {
    if (!story) return;
    story.step = Math.max(0, Math.min(story.years.length - 1, i));
    const yr = story.years[story.step];
    svg.classed('story', true);
    gNode.selectAll('g.node').classed('st-hidden', n => n.year > yr).classed('st-new', n => n.year === yr);
    gEdge.selectAll('g.edge').classed('st-hidden', e => model.nodeById.get(e.from).year > yr || model.nodeById.get(e.to).year > yr);
    bar.select('.sb-step').text(`第 ${story.step + 1} 步 / 共 ${story.years.length} 步`);
    bar.select('.sb-year').text(`${yr} 年`);
    bar.select('[data-s="prev"]').property('disabled', story.step === 0);
    bar.select('[data-s="next"]').property('disabled', story.step === story.years.length - 1);
    bar.select('[data-s="end"]').property('disabled', story.step === story.years.length - 1);
  }

  function paint() {
    const h = computeHighlight(model, vis, view, hover);
    // 聚焦时，被聚焦对象的关系不受"对话型"开关限制，全部画出
    const extra = h ? model.edges.filter(e => (h.edges.has(e.id) || h.edges2.has(e.id)) && pos.has(e.from) && pos.has(e.to)) : [];
    const types = new Set(arcTypesOn());
    const base = vis.visibleEdgeList.filter(e => types.has(e.type) && pos.has(e.from) && pos.has(e.to));
    const all = [...new Map([...base, ...extra].map(e => [e.id, e])).values()];
    const geo = new Map(all.map(e => [e.id, arcBetween(pos.get(e.from), boxes.get(e.from), pos.get(e.to), boxes.get(e.to), 0.2)]));
    joinEdges(gEdge, all, geo);
    applyHighlight(svg, gNode.selectAll('g.node'), gEdge.selectAll('g.edge'), h, view);
    if (story) setStep(story.step);
  }

  function rebuild() {
    const lanes = layout();
    drawLanes(lanes);
    drawAxis();
    drawNodes();
    drawEdges();
    cv.setBounds({ x0: 0, y0: -48, x1: LANE_X + AXIS_W + 30, y1: laneBottom + 12 });
    if (story) startStory();
    paint();
  }

  bindInteractions({ gNode, gEdge, model, tooltip, actions, onHover: h => { hover = h; paint(); } });
  svg.on('click', ev => { if (!ev.target.closest('.node,.edge')) actions.clearSelection(); });

  const boxOf = ids => {
    const xs = [], ys = [];
    for (const id of ids) {
      const p = pos.get(id), b = boxes.get(id); if (!p) continue;
      xs.push(p.x - b.w / 2, p.x + b.w / 2); ys.push(p.y - b.h / 2, p.y + b.h / 2);
    }
    return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null;
  };

  let fitted = false;
  return {
    setVisibility(v) { vis = v; rebuild(); },
    setView(v) { view = { ...view, ...v }; paint(); },
    refreshDigested() { gNode.selectAll('g.node').remove(); drawNodes(); paint(); },
    onShow() { if (!fitted) { cv.fitAll(false); fitted = true; } bar.attr('hidden', story ? null : true); },
    onHide() { bar.attr('hidden', true); },
    fitAll: () => cv.fitAll(),
    zoomToNodes(ids) { const b = boxOf(ids); if (b) cv.zoomToBox(b); },
    ensureVisible(id) { const b = boxOf([id]); if (b) cv.ensureVisible(b); },
    storyActive: () => !!story,
    endStory,
  };
}
