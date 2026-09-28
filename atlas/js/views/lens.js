/* 关系透镜：一个节点居中，左栏"指向它的"，右栏"它指向的"，按关系类型分组。画在屏幕坐标里，不随缩放。 */
import * as enc from '../encoding.js';
import { get, set } from '../state.js';
import * as tooltip from '../tooltip.js';
import * as progress from '../progress.js';
import { appendEdgeGlyph, setEdgePath, nodeTip } from '../glyph.js';
import { prefersReduced } from '../zoomable.js';
const esc = tooltip.esc;

const CW = 180, CH = 36, GAP = 6, GROUP_GAP = 18, GROUP_TITLE = 22, CENTER_W = 180, CENTER_H = 60, COL_DIST = 120, FOLD_AT = 6, SCROLL_ROWS = 12;

export function createLens({ svgEl, stageEl, model, actions, visibleFn }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const root = svg.append('g').attr('class', 'lens').attr('hidden', '');
  const gLines = root.append('g').attr('class', 'lens-lines');
  const gCols = root.append('g').attr('class', 'lens-cols');
  const gCenter = root.append('g').attr('class', 'lens-center');
  const gMeta = root.append('g').attr('class', 'lens-meta');
  const defs = svg.select('defs');
  defs.append('clipPath').attr('id', 'lensClipL').append('rect');
  defs.append('clipPath').attr('id', 'lensClipR').append('rect');

  let center = null;
  let expanded = new Set();   // 已展开的组 key
  let showHidden = false;     // 临时显示被筛选隐藏的关系
  let scroll = { L: 0, R: 0 };
  let hoverEdge = null;
  let layoutCache = null;

  const clusterIndex = new Map(model.clusters.map((c, i) => [c.id, i]));
  const sortNodes = (a, b) => (clusterIndex.get(model.byId.get(a)._cluster) - clusterIndex.get(model.byId.get(b)._cluster)) || a.localeCompare(b);

  /* 构建两栏数据 */
  function buildColumns() {
    const vis = visibleFn();
    const all = model.edgesOf.get(center) || [];
    const mk = (dir) => {
      const edges = all.filter((e) => (dir === 'L' ? e.to === center : e.from === center));
      const visibleEdges = edges.filter((e) => vis.edgeVis.has(e.id));
      const hiddenCount = edges.length - visibleEdges.length;
      const use = showHidden ? edges : visibleEdges;
      const groups = enc.REL_ORDER.map((t) => {
        const list = use.filter((e) => e.type === t).sort((p, q) => sortNodes(dir === 'L' ? p.from : p.to, dir === 'L' ? q.from : q.to));
        return { t, edges: list };
      }).filter((g) => g.edges.length);
      return { dir, groups, count: use.length, hiddenCount };
    };
    return { L: mk('L'), R: mk('R') };
  }

  /* 把一栏排成行：{ type:'title'|'card'|'fold', ... } */
  function rowsOf(col) {
    const rows = [];
    for (const g of col.groups) {
      const key = col.dir + ':' + g.t;
      rows.push({ type: 'title', t: g.t, n: g.edges.length, key });
      const limit = expanded.has(key) ? g.edges.length : Math.min(g.edges.length, FOLD_AT);
      g.edges.slice(0, limit).forEach((e) => rows.push({ type: 'card', e, other: col.dir === 'L' ? e.from : e.to, t: g.t }));
      if (g.edges.length > limit) rows.push({ type: 'fold', key, n: g.edges.length - limit });
      rows.push({ type: 'gap' });
    }
    if (rows.length && rows[rows.length - 1].type === 'gap') rows.pop();
    return rows;
  }
  function rowHeights(rows) {
    let y = 0; const pos = [];
    rows.forEach((r, i) => {
      const h = r.type === 'title' ? GROUP_TITLE : r.type === 'gap' ? GROUP_GAP - GAP : CH;
      pos.push(y); y += h + (r.type === 'gap' ? 0 : GAP);
    });
    return { pos, total: Math.max(0, y - GAP) };
  }

  function layout() {
    const r = stageEl.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const cols = buildColumns();
    const out = { cx, cy, cols: {}, vis: visibleFn() };
    for (const dir of ['L', 'R']) {
      const col = cols[dir];
      const rows = rowsOf(col);
      const { pos, total } = rowHeights(rows);
      const cardCount = rows.filter((x) => x.type === 'card').length;
      const avail = r.height - 150;
      const scrollable = cardCount > SCROLL_ROWS && total > avail;
      const viewH = scrollable ? avail : total;
      const top = cy - viewH / 2;
      const maxScroll = Math.max(0, total - viewH);
      scroll[dir] = Math.max(0, Math.min(maxScroll, scroll[dir]));
      const x = dir === 'L' ? cx - CENTER_W / 2 - COL_DIST - CW : cx + CENTER_W / 2 + COL_DIST;
      out.cols[dir] = { ...col, rows, pos, total, top, viewH, scrollable, maxScroll, x };
    }
    layoutCache = out;
    return out;
  }

  function edgeTipHTML(e) {
    const a = model.byId.get(e.from), b = model.byId.get(e.to);
    return `<div class="tip-head"><b>${esc(a.id)} ${esc(a.name)}</b> <span class="tip-rel" style="--c:${enc.relColor(e.type)}">—${esc(e.type)}→</span> <b>${esc(b.id)} ${esc(b.name)}</b></div><div class="tip-sub">${esc(e.reason)}</div><div class="tip-meta">${esc(e.status)} · ${e.basis === '加工' ? 'Claude 加工' : '来源'}${e.unverified ? ' · <span class="tip-warn">? 未核验</span>' : ''}</div>`;
  }

  function render({ animate = false } = {}) {
    if (!center || !model.byId.has(center)) return;
    const L = layout();
    const n = model.byId.get(center);
    const reduced = prefersReduced();
    /* 中心节点 */
    gCenter.selectAll('*').remove();
    const c = gCenter.attr('transform', `translate(${L.cx},${L.cy})`);
    const kind = enc.KINDS[n.kind] || enc.KINDS.现象;
    c.append('rect').attr('class', 'lc-shape').attr('x', -CENTER_W / 2).attr('y', -CENTER_H / 2).attr('width', CENTER_W).attr('height', CENTER_H).attr('rx', kind.capsule ? CENTER_H / 2 : Math.max(kind.rx, 6)).attr('stroke-dasharray', kind.dashed ? '5 4' : null).classed('ai', !!n.ai_related);
    if (kind.bar) c.append('line').attr('class', 'kind-bar').attr('x1', -CENTER_W / 2 + 5).attr('x2', -CENTER_W / 2 + 5).attr('y1', -CENTER_H / 2 + 9).attr('y2', CENTER_H / 2 - 9);
    c.append('text').attr('class', 'lc-id').attr('y', -8).text(n.id);
    const nameT = c.append('text').attr('class', 'lc-name').attr('y', 14).text(n.name);
    fitText(nameT.node(), CENTER_W - 24);
    c.append('circle').attr('class', 'cl-dot').attr('cx', -CENTER_W / 2).attr('cy', -CENTER_H / 2).attr('r', 5).style('fill', model.clusterById.get(n._cluster)?._color);
    const marks = c.append('g').attr('transform', `translate(${CENTER_W / 2},${-CENTER_H / 2})`);
    let mx = 0;
    if (n.alerts?.length) { const m = marks.append('g').attr('class', 'mark alert').attr('transform', `translate(${mx},0)`); m.append('circle').attr('r', 8); m.append('text').attr('y', 4).text('!'); m.append('title').text('重要警示：' + n.alerts.join('；')); mx -= 18; }
    if (n.unverified) { const m = marks.append('g').attr('class', 'mark unverified').attr('transform', `translate(${mx},0)`); m.append('circle').attr('r', 8); m.append('text').attr('y', 4).text('?'); m.append('title').text(enc.UNVERIFIED_TEXT); }
    if (progress.has(n.id)) { const m = c.append('g').attr('class', 'done').attr('transform', `translate(${-CENTER_W / 2},${CENTER_H / 2})`); m.append('circle').attr('r', 8); m.append('path').attr('d', 'M-4,0 L-1,3 L4,-3'); }
    c.style('cursor', 'pointer')
      .on('click', (ev) => { ev.stopPropagation(); actions.selectNode(center, { zoom: false }); })
      .on('mouseenter', (ev) => tooltip.show(nodeTip(model, n), ev.clientX, ev.clientY)).on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY)).on('mouseleave', () => tooltip.hide());
    /* 空缺标签 */
    gMeta.selectAll('*').remove();
    const gaps = model.gapsOfNode.get(center) || [];
    if (gaps.length) {
      const g = gMeta.append('g').attr('class', 'lens-gaps').attr('transform', `translate(${L.cx},${L.cy + CENTER_H / 2 + 16})`).style('cursor', 'pointer');
      const txt = g.append('text').attr('y', 4).text(`空缺 ${gaps.map((x) => x.id).join('、')}`);
      const w = txt.node().getComputedTextLength() + 16;
      g.insert('rect', 'text').attr('x', -w / 2).attr('y', -9).attr('width', w).attr('height', 18).attr('rx', 9);
      g.append('title').text(gaps.map((x) => `${x.id} ${x.title}（${x.status}）`).join('\n'));
      g.on('click', (ev) => { ev.stopPropagation(); actions.selectGap(gaps[0].id, { zoom: false }); });
    }
    /* 两栏 */
    const noRelations = !L.cols.L.count && !L.cols.R.count && !L.cols.L.hiddenCount && !L.cols.R.hiddenCount;
    gCols.selectAll('*').remove(); gLines.selectAll('*').remove();
    if (noRelations) {
      gMeta.append('text').attr('class', 'lens-empty').attr('x', L.cx).attr('y', L.cy + CENTER_H / 2 + 44).text('这个节点目前没有记录任何关系');
    }
    for (const dir of ['L', 'R']) {
      const col = L.cols[dir];
      const g = gCols.append('g').attr('class', 'lens-col ' + dir);
      const titleY = col.top - 22;
      g.append('text').attr('class', 'lens-colhead').attr('x', col.x + (dir === 'L' ? CW : 0)).attr('y', titleY).attr('text-anchor', dir === 'L' ? 'end' : 'start').text(`${dir === 'L' ? '指向它的' : '它指向的'}（${col.count}）`);
      /* 裁剪区 */
      const clipId = dir === 'L' ? 'lensClipL' : 'lensClipR';
      defs.select('#' + clipId + ' rect').attr('x', col.x - 12).attr('y', col.top - 4).attr('width', CW + 24).attr('height', col.viewH + 8);
      const inner = g.append('g').attr('class', 'lens-col-inner').attr('clip-path', col.scrollable ? `url(#${clipId})` : null);
      const body = inner.append('g').attr('transform', `translate(0,${col.top - scroll[dir]})`);
      const cards = [];
      col.rows.forEach((row, i) => {
        const y = col.pos[i];
        if (row.type === 'title') {
          const t = body.append('g').attr('class', 'lens-gtitle').attr('transform', `translate(${col.x},${y})`);
          t.append('rect').attr('class', 'sw').attr('x', 0).attr('y', 4).attr('width', 14).attr('height', 4).attr('rx', 2).style('fill', enc.relColor(row.t));
          t.append('text').attr('x', 20).attr('y', 10).text(`${row.t} · ${row.n}`);
        } else if (row.type === 'card') {
          const o = model.byId.get(row.other);
          const card = body.append('g').attr('class', 'lens-card').attr('data-edge', row.e.id).attr('data-id', o.id).attr('transform', `translate(${col.x},${y})`).classed('filtered', !L.vis.edgeVis.has(row.e.id));
          const k = enc.KINDS[o.kind] || enc.KINDS.现象;
          card.append('rect').attr('class', 'shape').attr('width', CW).attr('height', CH).attr('rx', k.capsule ? CH / 2 : k.rx).attr('stroke-dasharray', k.dashed ? '4 3' : null).classed('ai', !!o.ai_related);
          if (k.bar) card.append('line').attr('class', 'kind-bar').attr('x1', 4).attr('x2', 4).attr('y1', 7).attr('y2', CH - 7);
          card.append('circle').attr('class', 'cl-dot').attr('cx', 0).attr('cy', 0).attr('r', 4.5).style('fill', model.clusterById.get(o._cluster)?._color);
          card.append('text').attr('class', 'lens-cid').attr('x', 12).attr('y', 22).text(o.id);
          const nt = card.append('text').attr('class', 'lens-cname').attr('x', 58).attr('y', 22).text(o.name);
          fitText(nt.node(), CW - 66);
          if (o.unverified) { const m = card.append('g').attr('class', 'mark unverified').attr('transform', `translate(${CW},0)`); m.append('circle').attr('r', 6.5); m.append('text').attr('y', 3.5).text('?'); m.append('title').text(enc.UNVERIFIED_TEXT); }
          if (o.alerts?.length) { const m = card.append('g').attr('class', 'mark alert').attr('transform', `translate(${CW - (o.unverified ? 15 : 0)},0)`); m.append('circle').attr('r', 6.5); m.append('text').attr('y', 3.5).text('!'); }
          if (progress.has(o.id)) { const m = card.append('g').attr('class', 'done').attr('transform', `translate(0,${CH})`); m.append('circle').attr('r', 6); m.append('path').attr('d', 'M-3,0 L-1,2.2 L3,-2.2'); }
          card.append('title').text(`${o.id} ${o.name}\n${o.gist}`);
          card.style('cursor', 'pointer')
            .on('mouseenter', (ev) => { setHover(row.e.id); tooltip.show(edgeTipHTML(row.e), ev.clientX, ev.clientY); })
            .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
            .on('mouseleave', () => { setHover(null); tooltip.hide(); })
            .on('click', (ev) => { ev.stopPropagation(); tooltip.hide(); recenter(o.id, card); });
          cards.push({ row, y: y + CH / 2, edge: row.e, dir, cardEl: card });
        } else if (row.type === 'fold') {
          const f = body.append('g').attr('class', 'lens-fold').attr('transform', `translate(${col.x},${y})`).style('cursor', 'pointer');
          f.append('rect').attr('width', CW).attr('height', CH).attr('rx', 6);
          f.append('text').attr('x', CW / 2).attr('y', 22).text(`再展开 ${row.n} 个`);
          f.on('click', (ev) => { ev.stopPropagation(); expanded.add(row.key); render(); });
        }
      });
      /* 被筛选隐藏的数量 */
      if (col.hiddenCount) {
        const hy = col.top + col.viewH + 18;
        const t = g.append('text').attr('class', 'lens-hidden').attr('x', col.x + CW / 2).attr('y', hy).style('cursor', 'pointer')
          .text(showHidden ? `已临时显示被筛选隐藏的 ${col.hiddenCount} 条 · 点击收起` : `因筛选隐藏了 ${col.hiddenCount} 条 · 点击可临时显示`);
        t.on('click', (ev) => { ev.stopPropagation(); showHidden = !showHidden; render(); });
      }
      /* 连线：落点在中心节点边缘按栏内顺序均匀分布 */
      const nC = cards.length;
      const lines = gLines.append('g').attr('class', 'lens-lines-' + dir).attr('clip-path', col.scrollable ? `url(#${clipId})` : null);
      cards.forEach((cd, i) => {
        const ly = L.cy - CENTER_H / 2 + ((i + 0.5) * CENTER_H) / nC;
        const cardY = cd.y + col.top - scroll[dir];
        const cardEdgeX = dir === 'L' ? col.x + CW + 3 : col.x - 3;
        const centerEdgeX = dir === 'L' ? L.cx - CENTER_W / 2 - 3 : L.cx + CENTER_W / 2 + 3;
        const isMirror = cd.edge.type === '对应';
        let p0, p1;
        if (dir === 'L') { p0 = [cardEdgeX + (isMirror ? 2 : 0), cardY]; p1 = [centerEdgeX - (isMirror ? 2 : 0), ly]; }
        else { p0 = [centerEdgeX + (isMirror ? 2 : 0), ly]; p1 = [cardEdgeX - (isMirror ? 2 : 0), cardY]; }
        const dx = (p1[0] - p0[0]) * 0.5;
        const d = `M${p0[0]},${p0[1]} C${p0[0] + dx},${p0[1]} ${p1[0] - dx},${p1[1]} ${p1[0]},${p1[1]}`;
        const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 0]; /* 对称三次曲线的中点 */
        const gE = appendEdgeGlyph(lines.append('g').datum({ id: cd.edge.id, ref: cd.edge })).classed('filtered', !L.vis.edgeVis.has(cd.edge.id));
        setEdgePath(gE, d, mid);
        gE.on('mouseenter', (ev) => { setHover(cd.edge.id); tooltip.show(edgeTipHTML(cd.edge), ev.clientX, ev.clientY); })
          .on('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY))
          .on('mouseleave', () => { setHover(null); tooltip.hide(); })
          .on('click', (ev) => { ev.stopPropagation(); tooltip.hide(); actions.selectEdge(cd.edge.id, { zoom: false }); });
      });
      /* 滚动 */
      if (col.scrollable) {
        g.append('rect').attr('class', 'lens-scrollhit').attr('x', col.x - 12).attr('y', col.top - 4).attr('width', CW + 24).attr('height', col.viewH + 8)
          .on('wheel', (ev) => { ev.preventDefault(); ev.stopPropagation(); scroll[dir] = Math.max(0, Math.min(col.maxScroll, scroll[dir] + ev.deltaY)); render(); });
        g.append('text').attr('class', 'lens-scrollhint').attr('x', col.x + CW / 2).attr('y', col.top + col.viewH + 4).text(scroll[dir] < col.maxScroll ? '▾ 滚动查看更多' : '');
      }
    }
    applyHover();
    if (animate && !reduced) { root.style('opacity', 0).transition().duration(250).style('opacity', 1); }
  }

  function fitText(textEl, maxW) {
    let txt = textEl.textContent; const full = txt;
    while (textEl.getComputedTextLength() > maxW && txt.length > 1) { txt = txt.slice(0, -1); textEl.textContent = txt + '…'; }
    if (txt !== full) { const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = full; textEl.appendChild(t); }
  }
  function setHover(id) { hoverEdge = id; applyHover(); }
  function applyHover() {
    const s = get();
    const hi = hoverEdge || s.edge;
    root.classed('has-hover', !!hi);
    gLines.selectAll('g.edge').each(function (d) { this.classList.toggle('hi', !!hi && d.id === hi); this.classList.toggle('dim', !!hi && d.id !== hi); this.classList.toggle('active', s.edge === d.id); });
    gCols.selectAll('g.lens-card').each(function () { const id = this.dataset.edge; this.classList.toggle('hi', !!hi && id === hi); this.classList.toggle('dim', !!hi && id !== hi); });
  }

  /* 点击侧边卡片：卡片平滑移到中心，旧内容淡出、新内容淡入 */
  function recenter(id, cardSel) {
    if (id === center) return;
    const L = layoutCache;
    const reduced = prefersReduced();
    if (reduced || !cardSel || !L) { actions.lensHop(id); return; }
    const parent = cardSel.node().parentNode;
    const m = cardSel.node().getCTM(); const rootM = root.node().getCTM();
    const x0 = m.e - rootM.e, y0 = m.f - rootM.f;
    const ghost = root.append('g').attr('class', 'lens-card lens-ghost').attr('transform', `translate(${x0},${y0})`);
    ghost.node().innerHTML = cardSel.node().innerHTML;
    gLines.transition().duration(160).style('opacity', 0.15);
    gCols.transition().duration(160).style('opacity', 0.15);
    ghost.transition().duration(250).attr('transform', `translate(${L.cx - CW / 2},${L.cy - CH / 2})`).on('end', () => {
      ghost.remove(); gLines.style('opacity', 1); gCols.style('opacity', 1);
      actions.lensHop(id);
    });
  }

  return {
    show(id) {
      const changed = id !== center;
      center = id; if (changed) { expanded = new Set(); showHidden = false; scroll = { L: 0, R: 0 }; hoverEdge = null; }
      root.attr('hidden', null);
      render({ animate: changed });
    },
    hide() { root.attr('hidden', ''); center = null; },
    refresh() { if (center) render(); },
    applyHover,
    isActive: () => !!center,
    center: () => center,
  };
}
