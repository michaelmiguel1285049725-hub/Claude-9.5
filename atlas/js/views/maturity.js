// 视角二：成熟度地图。横轴证据等级（N/A｜C B A｜空缺），纵轴拥挤度（饱和 / 活跃 / 稀疏）。
// 节点画法与关系网完全一致；点击节点后用细弧线画出它和其他格子里节点的关系。
import { nodeBox, drawNode, drawEvidenceBadge, drawCrowding, wrapText } from '../glyph.js';
import { EVIDENCE, CROWDINGS, CROWDING, GAP_STATUSES } from '../encoding.js';
import { clusterOf } from '../data.js';
import { computeHighlight, applyHighlight, joinEdges, arcBetween, bindInteractions, createZoomCanvas, esc, reduceMotion } from './shared.js';

const d3 = window.d3;
const COLS = ['N/A', 'C', 'B', 'A'];
const LEFT = 104, TOP = 74, PAD = 12, GX = 10, GY = 10, NC = 2, DIVIDER = 26, GAP_W = 250;

export function createMaturityView({ root, model, store, tooltip, actions, getDigested, toolsEl }) {
  const cv = createZoomCanvas(root, 'maturity', { onZoom: () => tooltip.hide() });
  const { svg, viewport } = cv;
  svg.attr('aria-label', '成熟度地图');
  const gGrid = viewport.append('g').attr('class', 'm-grid');
  const gGroup = viewport.append('g').attr('class', 'm-groups');
  const gArc = viewport.append('g').attr('class', 'edges m-arcs');
  const gNode = viewport.append('g').attr('class', 'nodes');
  const gGap = viewport.append('g').attr('class', 'm-gaps');

  const boxes = new Map(model.nodes.map(n => [n.id, nodeBox(n)]));
  const SW = Math.max(...[...boxes.values()].map(b => b.w), 120);
  const CW = NC * SW + (NC - 1) * GX + PAD * 2;
  const colX = c => LEFT + c * CW + (c >= 1 ? DIVIDER : 0);
  const gapX = LEFT + COLS.length * CW + DIVIDER + 18;

  let vis = null, view = { sel: null, depth: 1 }, hover = {};
  let pos = new Map(), cells = [], groups = [];
  let colorByCluster = store.get('maturityClusterBg', false) === true;

  // ---------- 工具栏：按研究线着色格子背景 ----------
  toolsEl.innerHTML = `<button type="button" class="btn" data-m="cluster-bg" aria-pressed="${colorByCluster}" title="在每个格子里按研究线给节点分组着色">按研究线着色格子</button>`;
  toolsEl.querySelector('[data-m="cluster-bg"]').addEventListener('click', ev => {
    colorByCluster = !colorByCluster;
    store.set('maturityClusterBg', colorByCluster);
    ev.currentTarget.setAttribute('aria-pressed', String(colorByCluster));
    svg.classed('cluster-bg', colorByCluster);
  });
  svg.classed('cluster-bg', colorByCluster);

  // ---------- 布局 ----------
  function layout() {
    pos = new Map(); cells = []; groups = [];
    const visible = model.nodes.filter(n => vis.nodes.has(n.id));
    let y = TOP;
    const rowTops = [];
    CROWDINGS.forEach((cr, r) => {
      let rowH = 96;
      const rowCells = [];
      COLS.forEach((ev, c) => {
        const list = visible.filter(n => n.crowding === cr && n.evidence === ev);
        // 按研究线分组（内容包里的顺序），组内按年份
        const byCluster = model.clusters.map(cl => list.filter(n => n.cluster === cl.id).sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1))).filter(g => g.length);
        const orphans = list.filter(n => !model.clusterById.has(n.cluster));
        if (orphans.length) byCluster.push(orphans);
        let cy = y + 30;
        const x0 = colX(c) + PAD;
        byCluster.forEach(g => {
          const top = cy;
          for (let i = 0; i < g.length; i += NC) {
            const row = g.slice(i, i + NC);
            const h = Math.max(...row.map(n => boxes.get(n.id).h));
            row.forEach((n, j) => pos.set(n.id, { x: x0 + j * (SW + GX) + SW / 2, y: cy + h / 2 }));
            cy += h + GY;
          }
          groups.push({ cluster: clusterOf(model, g[0]), x: x0 - 5, y: top - 5, w: CW - PAD * 2 + 10, h: cy - top - GY + 10 });
          cy += 6;
        });
        rowCells.push({ r, c, cr, ev, n: list.length, x: colX(c), y });
        rowH = Math.max(rowH, cy - y + 4);
      });
      rowCells.forEach(cell => { cell.h = rowH; cells.push(cell); });
      rowTops.push({ cr, y, h: rowH });
      y += rowH;
    });
    return { rowTops, gridBottom: y };
  }

  function drawGrid({ rowTops, gridBottom }) {
    gGrid.selectAll('*').remove();
    const W = colX(COLS.length - 1) + CW;
    // 列头
    const head = gGrid.append('g').attr('class', 'm-heads');
    head.append('text').attr('class', 'm-axis').attr('x', LEFT - 10).attr('y', 22).attr('text-anchor', 'end').text('证据等级 →');
    head.append('text').attr('class', 'm-axis').attr('x', 14).attr('y', TOP + 16).text('拥挤度 ↓');
    COLS.forEach((ev, c) => {
      const g = head.append('g').attr('class', 'm-head').attr('transform', `translate(${colX(c) + CW / 2},0)`)
        .datum({ tip: `<div class="tt-head">${esc(ev)}</div><div class="tt-body">${esc(EVIDENCE[ev].meaning)}</div>` });
      drawEvidenceBadge(g, ev, ev === 'N/A' ? 14 : 8, 22);
      g.append('text').attr('class', 'm-head-t').attr('y', 50).attr('text-anchor', 'middle')
        .text(ev === 'N/A' ? '规范理论或框架，不适用证据等级' : EVIDENCE[ev].meaning);
      g.append('rect').attr('class', 'm-hit').attr('x', -CW / 2).attr('y', 4).attr('width', CW).attr('height', TOP - 10);
    });
    const gh = head.append('g').attr('class', 'm-head').attr('transform', `translate(${gapX + GAP_W / 2},0)`)
      .datum({ tip: '<div class="tt-head">空缺</div><div class="tt-body">尚未解决的研究问题</div>' });
    gh.append('text').attr('class', 'm-head-gap').attr('y', 27).attr('text-anchor', 'middle').text('空缺');
    gh.append('text').attr('class', 'm-head-t').attr('y', 50).attr('text-anchor', 'middle').text(`${model.gaps.length} 个问题`);
    gh.append('rect').attr('class', 'm-hit').attr('x', -GAP_W / 2).attr('y', 4).attr('width', GAP_W).attr('height', TOP - 10);
    // 行头
    rowTops.forEach(({ cr, y, h }) => {
      const g = head.append('g').attr('class', 'm-head').attr('transform', `translate(0,${y})`)
        .datum({ tip: `<div class="tt-head">${esc(cr)}</div><div class="tt-body">${esc(CROWDING[cr].meaning)}</div>` });
      g.append('text').attr('class', 'm-row-t').attr('x', 18).attr('y', h / 2 - 2).text(cr);
      drawCrowding(g, cr, 60, h / 2 + 14);
      g.append('rect').attr('class', 'm-hit').attr('x', 6).attr('y', 4).attr('width', LEFT - 14).attr('height', h - 8);
    });
    // 格子
    for (const cell of cells) {
      const g = gGrid.append('g').attr('class', 'm-cell');
      g.append('rect').attr('x', cell.x + 3).attr('y', cell.y + 3).attr('width', CW - 6).attr('height', cell.h - 6).attr('rx', 10);
      g.append('text').attr('class', 'm-count').attr('x', cell.x + CW - 14).attr('y', cell.y + 20).attr('text-anchor', 'end').text(cell.n);
    }
    // N/A 列与其他列之间的竖向分隔线
    gGrid.append('line').attr('class', 'm-divider').attr('x1', colX(1) - DIVIDER / 2).attr('x2', colX(1) - DIVIDER / 2).attr('y1', 8).attr('y2', gridBottom);
    gGrid.append('line').attr('class', 'm-divider').attr('x1', gapX - 14).attr('x2', gapX - 14).attr('y1', 8).attr('y2', gridBottom);
    head.selectAll('.m-head').on('pointerover', (ev, d) => tooltip.show(d.tip, ev)).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide());
    return W;
  }

  function drawGroups() {
    gGroup.selectAll('rect').data(groups).join('rect').attr('class', 'm-group')
      .attr('x', d => d.x).attr('y', d => d.y).attr('width', d => d.w).attr('height', d => d.h).attr('rx', 8)
      .style('--cc', d => d.cluster.color);
  }

  // 空缺列：虚线空心卡片，按状态分组（几乎空白在上）
  function drawGaps() {
    const order = [...GAP_STATUSES];
    let y = TOP + 8;
    const items = [];
    for (const st of order) {
      const list = model.gaps.filter(g => g.status === st);
      if (!list.length) continue;
      items.push({ label: st, y }); y += 22;
      for (const g of list) {
        const lines = wrapText(g.title, 12.5, GAP_W - 36, 2);
        const h = 34 + lines.length * 16;
        items.push({ g, lines, y, h }); y += h + 8;
      }
      y += 6;
    }
    gGap.selectAll('*').remove();
    for (const it of items) {
      if (it.label) {
        gGap.append('text').attr('class', `m-gap-label gs-${it.label === '几乎空白' ? 'blank' : it.label === '有初步工作' ? 'early' : 'solved'}`)
          .attr('x', gapX).attr('y', it.y + 12).text(it.label);
        continue;
      }
      const card = gGap.append('g').attr('class', 'gapcard').attr('data-id', it.g.id).attr('tabindex', 0).attr('role', 'button')
        .attr('transform', `translate(${gapX},${it.y})`).datum(it.g);
      card.append('rect').attr('width', GAP_W).attr('height', it.h).attr('rx', 9);
      card.append('text').attr('class', 'gc-id').attr('x', 12).attr('y', 19).text(it.g.id + (it.g.key ? ' ★' : ''));
      const t = card.append('text').attr('class', 'gc-t');
      it.lines.forEach((l, i) => t.append('tspan').attr('x', 12).attr('y', 40 + i * 16).text(l));
    }
    gGap.selectAll('g.gapcard')
      .on('click', (ev, g) => { ev.stopPropagation(); actions.selectGap(g.id); })
      .on('keydown', (ev, g) => { if (ev.key === 'Enter') actions.selectGap(g.id); })
      .on('pointerover', (ev, g) => tooltip.show(`<div class="tt-head"><span class="tt-id">${esc(g.id)}</span>${esc(g.title)}</div><div class="tt-body">${esc(g.summary || '')}</div><div class="tt-meta">${esc(g.status)}${g.key ? ' · ★ 重点问题' : ''}</div>`, ev))
      .on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide());
    return y;
  }

  function drawNodes() {
    const digested = getDigested();
    const visible = model.nodes.filter(n => pos.has(n.id));
    const anim = !reduceMotion() && gNode.selectAll('g.node').size() > 0;
    const sel = gNode.selectAll('g.node').data(visible, n => n.id).join(
      enter => enter.append('g').attr('class', 'node').attr('data-id', n => n.id).attr('tabindex', 0).attr('role', 'button')
        .attr('aria-label', n => `${n.id} ${n.name}`)
        .attr('transform', n => `translate(${pos.get(n.id).x},${pos.get(n.id).y})`)
        .each(function (n) { drawNode(d3.select(this), n, boxes.get(n.id), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) }); }),
      update => update,
      exit => exit.remove());
    (anim ? sel.transition().duration(250) : sel).attr('transform', n => `translate(${pos.get(n.id).x},${pos.get(n.id).y})`);
  }

  // 只画高亮集合里的关系（聚焦、悬停、路径、空缺），其余时候格子保持干净
  function drawArcs(h) {
    const ids = h ? new Set([...h.edges, ...h.edges2]) : new Set();
    const edges = model.edges.filter(e => ids.has(e.id) && pos.has(e.from) && pos.has(e.to));
    const geo = new Map(edges.map(e => [e.id, arcBetween(pos.get(e.from), boxes.get(e.from), pos.get(e.to), boxes.get(e.to), 0.18)]));
    joinEdges(gArc, edges, geo);
  }

  function paint() {
    const h = computeHighlight(model, vis, view, hover);
    drawArcs(h);
    applyHighlight(svg, gNode.selectAll('g.node'), gArc.selectAll('g.edge'), h, view);
    const gapSel = view.gap || (view.sel?.kind === 'gap' ? view.sel.id : null);
    const nodeGaps = view.sel?.kind === 'node' ? new Set(model.gaps.filter(g => (g.nodes || []).includes(view.sel.id)).map(g => g.id)) : null;
    gGap.selectAll('g.gapcard')
      .classed('sel', g => g.id === gapSel)
      .classed('hi', g => g.id === gapSel || (nodeGaps && nodeGaps.has(g.id)));
    actions.legendDirty();
  }

  function rebuild() {
    const L = layout();
    const W = drawGrid(L);
    drawGroups();
    const gapBottom = drawGaps();
    drawNodes();
    cv.setBounds({ x0: 0, y0: -48, x1: gapX + GAP_W + 16, y1: Math.max(L.gridBottom, gapBottom) + 16 });
    paint();
    return W;
  }

  bindInteractions({ gNode, gEdge: gArc, model, tooltip, actions, onHover: h => { hover = h; paint(); } });
  svg.on('click', ev => { if (!ev.target.closest('.node,.edge,.gapcard')) actions.clearSelection(); });

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
    legend: () => ({ nodes: model.nodes.filter(n => pos.has(n.id)), edges: gArc.selectAll('g.edge').data() }),
    onShow() { if (!fitted) { cv.fitAll(false); fitted = true; } },
    fitAll: () => cv.fitAll(),
    zoomToNodes(ids) { const b = boxOf(ids); if (b) cv.zoomToBox(b); },
    ensureVisible(id) { const b = boxOf([id]); if (b) cv.ensureVisible(b); },
  };
}
