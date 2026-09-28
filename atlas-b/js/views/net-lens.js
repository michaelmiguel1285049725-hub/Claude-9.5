// 关系网第三层：关系透镜。一个节点居中，左栏"指向它的"，右栏"它指向的"，按关系类型分组。
// 每个侧边节点用一条三次贝塞尔曲线连到中心；颜色、线型、箭头、加工空心圆与编码表完全一致。
import { nodeBox, centerBox, drawNode, styleEdgePath, relSampleSvg, CARD, CENTER } from '../glyph.js';
import { REL_TYPES, relColor } from '../encoding.js';
import { clusterOf } from '../data.js';
import { esc, reduceMotion } from './shared.js';

const d3 = window.d3;
const TOP = 112, BOTTOM = 36, GROUP_H = 24, GROUP_GAP = 18, ROW_GAP = 6, MORE_H = 30, FOLD = 6;
const NARROW = 720;   // 比这更窄（手机）时，透镜改成可上下滚动的列表

export function createLensView({ svg, root, model, tooltip, actions, getDigested }) {
  const g = svg.append('g').attr('class', 'lens').attr('display', 'none');
  const list = d3.select(root).append('div').attr('class', 'lens-list').attr('hidden', true);
  const defs = svg.append('defs');
  const clipL = defs.append('clipPath').attr('id', 'lensClipL').append('rect');
  const clipR = defs.append('clipPath').attr('id', 'lensClipR').append('rect');
  const gHead = g.append('g').attr('class', 'lens-heads');
  const gCurve = g.append('g').attr('class', 'edges lens-curves');
  const gColL = g.append('g').attr('clip-path', 'url(#lensClipL)').append('g').attr('class', 'lens-col');
  const gColR = g.append('g').attr('clip-path', 'url(#lensClipR)').append('g').attr('class', 'lens-col');
  const gCenter = g.append('g').attr('class', 'lens-center');
  const gFoot = g.append('g').attr('class', 'lens-foot');

  let vis = null, center = null, size = { W: 800, H: 600 };
  let inset = 0;                     // 右侧抽屉打开时让出的宽度，透镜在剩下的空间里排版
  let expanded = new Set();          // 展开了的分组：`${center}|${side}|${type}`
  let showHidden = { L: false, R: false };
  let scroll = { L: 0, R: 0 };
  let geom = null;                   // 当前排版结果
  let gapSel = null;                 // 从空缺列表进来时，属于这个空缺的关系加粗高亮

  // 分组内：先按研究线顺序，再按编号
  const clusterRank = id => { const i = model.clusters.findIndex(c => c.id === model.nodeById.get(id)?.cluster); return i < 0 ? 99 : i; };
  const bySide = (side, edges) => REL_TYPES.map(t => ({
    t,
    list: edges.filter(e => e.type === t).map(e => ({ e, other: side === 'L' ? e.from : e.to }))
      .sort((a, b) => clusterRank(a.other) - clusterRank(b.other) || (a.other < b.other ? -1 : 1)),
  })).filter(gr => gr.list.length);

  function layout() {
    const W = Math.max(640, size.W - inset), H = size.H;
    const cx = W / 2, cy = TOP + (H - TOP - BOTTOM) / 2;
    const dist = Math.max(270, Math.min(430, W * 0.27));
    const all = model.edgesByNode.get(center) || [];
    const shown = e => vis.edges.has(e.id);
    const sides = {};
    for (const side of ['L', 'R']) {
      const mine = all.filter(e => (side === 'L' ? e.to === center : e.from === center));
      const visible = mine.filter(shown), hidden = mine.filter(e => !shown(e));
      const edges = showHidden[side] ? mine : visible;
      const groups = bySide(side, edges);
      // 排成一列行：组标题、卡片、"再展开 N 个"
      const rows = [];
      let y = 0;
      groups.forEach((gr, gi) => {
        if (gi) y += GROUP_GAP;
        rows.push({ kind: 'group', t: gr.t, n: gr.list.length, y }); y += GROUP_H;
        const key = `${center}|${side}|${gr.t}`;
        const open = expanded.has(key) || gr.list.length <= FOLD;
        const items = open ? gr.list : gr.list.slice(0, FOLD);
        items.forEach(it => { rows.push({ kind: 'card', ...it, hiddenByFilter: !shown(it.e), y: y + CARD.h / 2 }); y += CARD.h + ROW_GAP; });
        if (!open) { rows.push({ kind: 'more', key, n: gr.list.length - FOLD, t: gr.t, y }); y += MORE_H; }
      });
      const total = Math.max(0, y - ROW_GAP);
      const x = side === 'L' ? cx - dist : cx + dist;
      const availTop = TOP + 18, availH = H - BOTTOM - 26 - availTop;
      const scrollable = total > availH;
      const top = scrollable ? availTop : availTop + (availH - total) / 2;
      scroll[side] = scrollable ? Math.max(0, Math.min(scroll[side], total - availH)) : 0;
      sides[side] = { x, rows, top, total, availTop, availH, scrollable, count: edges.length, visibleCount: visible.length, hiddenCount: hidden.length };
    }
    return { cx, cy, sides };
  }

  function cardY(S, r, side) { return S.top + r.y - scroll[side]; }

  // ---------- 绘制 ----------
  function render() {
    if (!vis || !center) return;
    const n = model.nodeById.get(center);
    const narrow = size.W < NARROW;
    list.attr('hidden', narrow ? null : true);
    g.attr('visibility', narrow ? 'hidden' : null);
    if (narrow) { renderList(n); return; }
    geom = layout();
    const { cx, cy, sides } = geom;
    const digested = getDigested();

    // 栏标题
    gHead.selectAll('*').remove();
    for (const side of ['L', 'R']) {
      const S = sides[side];
      gHead.append('text').attr('class', 'lens-title').attr('x', S.x).attr('y', TOP - 4).attr('text-anchor', 'middle')
        .text(side === 'L' ? `指向它的（${S.count}）` : `它指向的（${S.count}）`);
    }

    // 裁剪区域（栏内滚动）
    for (const [side, clip] of [['L', clipL], ['R', clipR]]) {
      const S = sides[side];
      clip.attr('x', S.x - CARD.w / 2 - 20).attr('y', S.availTop - 4).attr('width', CARD.w + 40).attr('height', S.availH + 8);
    }

    // 两栏
    for (const [side, col] of [['L', gColL], ['R', gColR]]) {
      const S = sides[side];
      col.selectAll('*').remove();
      for (const r of S.rows) {
        const y = cardY(S, r, side);
        if (r.kind === 'group') {
          const gg = col.append('g').attr('class', 'lens-group').attr('transform', `translate(${S.x - CARD.w / 2},${y})`);
          gg.append('rect').attr('class', 'lens-swatch').attr('x', 0).attr('y', 6).attr('width', 12).attr('height', 12).attr('rx', 2).style('fill', relColor(r.t));
          gg.append('text').attr('class', 'lens-group-t').attr('x', 18).attr('y', 12).attr('dominant-baseline', 'central')
            .text(`${r.t} · ${r.n}`).style('fill', relColor(r.t));
        } else if (r.kind === 'card') {
          const nd = model.nodeById.get(r.other);
          const c = col.append('g').attr('class', `node lens-card${r.hiddenByFilter ? ' filtered' : ''}`).attr('data-id', r.other).attr('data-edge', r.e.id)
            .attr('tabindex', 0).attr('role', 'button').attr('aria-label', `${nd.id} ${nd.name}，${r.e.type}，移到中心`)
            .attr('transform', `translate(${S.x},${y})`).datum({ n: nd, e: r.e, side });
          drawNode(c, nd, nodeBox(nd), { clusterColor: clusterOf(model, nd).color, digested: digested.has(nd.id) });
        } else {
          const m = col.append('g').attr('class', 'lens-more').attr('tabindex', 0).attr('role', 'button').attr('data-key', r.key)
            .attr('transform', `translate(${S.x - CARD.w / 2},${y})`);
          m.append('rect').attr('width', CARD.w).attr('height', MORE_H - 6).attr('rx', 6);
          m.append('text').attr('x', CARD.w / 2).attr('y', (MORE_H - 6) / 2).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(`再展开 ${r.n} 个`);
        }
      }
    }

    // 中心节点
    gCenter.selectAll('*').remove();
    const cc = gCenter.append('g').attr('class', 'node center').attr('data-id', center).attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', `${n.id} ${n.name}，打开详情`).attr('transform', `translate(${cx},${cy})`).datum({ n });
    drawNode(cc, n, centerBox(n), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) });
    // 空缺标签
    const gaps = model.gaps.filter(gp => (gp.nodes || []).includes(center));
    if (gaps.length) {
      const tg = gCenter.append('g').attr('class', 'lens-gaps').attr('transform', `translate(${cx},${cy + CENTER.h / 2 + 22})`);
      const label = tg.append('text').attr('class', 'lens-gap-label').attr('text-anchor', 'end').attr('dominant-baseline', 'central').attr('x', -4 - (gaps.length * 52 - 6) / 2).text('空缺');
      gaps.forEach((gp, i) => {
        const chip = tg.append('g').attr('class', 'lens-gap').attr('tabindex', 0).attr('role', 'button').attr('data-gap', gp.id)
          .attr('aria-label', `空缺 ${gp.id} ${gp.title}`).attr('transform', `translate(${-(gaps.length * 52 - 6) / 2 + i * 52},-12)`);
        chip.append('rect').attr('width', 46).attr('height', 24).attr('rx', 12);
        chip.append('text').attr('x', 23).attr('y', 12).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(gp.id);
        chip.append('title').text(`${gp.id} ${gp.title}（${gp.status}）`);
      });
      label.attr('x', -(gaps.length * 52 - 6) / 2 - 8);
    }

    // 没有任何关系
    gFoot.selectAll('*').remove();
    const noRel = !(model.edgesByNode.get(center) || []).length;
    if (noRel) gFoot.append('text').attr('class', 'lens-empty').attr('x', cx).attr('y', cy + CENTER.h / 2 + 60).attr('text-anchor', 'middle').text('这个节点目前没有记录任何关系');
    // 因筛选隐藏
    for (const side of ['L', 'R']) {
      const S = sides[side];
      if (!S.hiddenCount) continue;
      const t = gFoot.append('text').attr('class', 'lens-hidden').attr('tabindex', 0).attr('role', 'button').attr('data-side', side)
        .attr('x', S.x).attr('y', size.H - BOTTOM + 4).attr('text-anchor', 'middle')
        .text(showHidden[side] ? `正在临时显示因筛选隐藏的 ${S.hiddenCount} 条 · 收起` : `因筛选隐藏了 ${S.hiddenCount} 条`);
    }
    // 滚动提示
    for (const side of ['L', 'R']) {
      const S = sides[side];
      if (!S.scrollable) continue;
      const pct = scroll[side] / (S.total - S.availH);
      gFoot.append('rect').attr('class', 'lens-scrollbar').attr('x', side === 'L' ? S.x - CARD.w / 2 - 14 : S.x + CARD.w / 2 + 10).attr('y', S.availTop + pct * (S.availH - 40)).attr('width', 4).attr('height', 40).attr('rx', 2);
    }
    drawCurves();
  }

  // ---------- 窄屏：列表形式（颜色、线型、加工标记与画布一致） ----------
  function renderList(n) {
    const all = model.edgesByNode.get(center) || [];
    const c = clusterOf(model, n);
    const gaps = model.gaps.filter(gp => (gp.nodes || []).includes(center));
    const section = side => {
      const mine = all.filter(e => (side === 'L' ? e.to === center : e.from === center));
      const visible = mine.filter(e => vis.edges.has(e.id));
      const edges = showHidden[side] ? mine : visible;
      const groups = bySide(side, edges);
      const hidden = mine.length - visible.length;
      const item = ({ e, other }) => {
        const o = model.nodeById.get(other);
        const st = e.status === '确立' ? 'solid' : e.status === '初步' ? 'dash' : 'dot';
        return `<li><button type="button" class="ll-item${vis.edges.has(e.id) ? '' : ' filtered'}${o.ai_related ? ' ai' : ''}" data-node="${esc(other)}" data-edge="${esc(e.id)}">
          <span class="dot" style="background:${clusterOf(model, o).color}"></span><span class="mono">${esc(other)}</span><span class="nm">${esc(o.name)}</span>
          <span class="ll-mark"><i class="ll-line st-${st}" style="border-color:${relColor(e.type)}"></i>${e.basis === '加工' ? `<i class="ll-proc" style="border-color:${relColor(e.type)}"></i>` : ''}</span></button></li>`;
      };
      return `<section class="ll-sec"><h3>${side === 'L' ? `指向它的（${edges.length}）` : `它指向的（${edges.length}）`}</h3>
        ${groups.length ? groups.map(gr => `<div class="ll-group"><div class="ll-head">${relSampleSvg(gr.t, '确立', 26)}<b style="color:${relColor(gr.t)}">${esc(gr.t)} · ${gr.list.length}</b></div><ul>${gr.list.map(item).join('')}</ul></div>`).join('') : '<p class="ll-none">—</p>'}
        ${hidden ? `<button type="button" class="ll-hidden" data-side="${side}">${showHidden[side] ? `正在临时显示因筛选隐藏的 ${hidden} 条 · 收起` : `因筛选隐藏了 ${hidden} 条`}</button>` : ''}</section>`;
    };
    list.html(`<button type="button" class="ll-center${n.ai_related ? ' ai' : ''}" data-center>
        <span class="mono">${esc(n.id)}</span><b>${esc(n.name)}</b><span class="ll-sub"><span class="dot" style="background:${c.color}"></span>${esc(c.name)} · 点击看详情</span></button>
      ${gaps.length ? `<div class="ll-gaps">空缺 ${gaps.map(gp => `<button type="button" data-gap="${esc(gp.id)}">${esc(gp.id)}</button>`).join('')}</div>` : ''}
      ${all.length ? section('L') + section('R') : '<p class="ll-none">这个节点目前没有记录任何关系</p>'}`);
    list.node().scrollTop = 0;
  }
  list.on('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if ('center' in b.dataset) return actions.selectNode(center, { detail: true });
    if (b.dataset.gap) return actions.selectGap(b.dataset.gap, { zoom: false });
    if (b.classList.contains('ll-hidden')) { showHidden[b.dataset.side] = !showHidden[b.dataset.side]; return render(); }
    if (b.dataset.node) actions.openLens(b.dataset.node, { from: 'lens' });
  });

  // 曲线：在中心节点边缘上的落点，按侧边卡片的上下顺序均匀分布，避免交叉
  function drawCurves() {
    const { cx, cy, sides } = geom;
    const items = [];
    for (const side of ['L', 'R']) {
      const S = sides[side];
      const cards = S.rows.filter(r => r.kind === 'card');
      cards.forEach((r, i) => {
        const y = cardY(S, r, side);
        const inView = y >= S.availTop - 2 && y <= S.availTop + S.availH + 2;
        const yk = cy - CENTER.h / 2 + 8 + (i + 0.5) * ((CENTER.h - 16) / cards.length);
        let p0, p3;
        if (side === 'L') { p0 = { x: S.x + CARD.w / 2 + 2, y }; p3 = { x: cx - CENTER.w / 2 - 2, y: yk }; }
        else { p0 = { x: cx + CENTER.w / 2 + 2, y: yk }; p3 = { x: S.x - CARD.w / 2 - 2, y }; }
        if (!inView) return;
        const dx = (p3.x - p0.x) * 0.5;
        const p1 = { x: p0.x + dx, y: p0.y }, p2 = { x: p3.x - dx, y: p3.y };
        items.push({
          e: r.e, side, filtered: r.hiddenByFilter,
          d: `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
          mid: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 },
        });
      });
    }
    const sel = gCurve.selectAll('g.edge').data(items, d => d.e.id + d.side).join(enter => {
      const x = enter.append('g').attr('class', 'edge');
      x.append('path').attr('class', 'edge-hit');
      x.append('path').attr('class', 'edge-line');
      x.append('circle').attr('class', 'edge-proc').attr('r', 4);
      x.each(function (d) { styleEdgePath(d3.select(this).select('.edge-line'), d.e); });
      return x;
    });
    sel.attr('data-id', d => d.e.id).classed('filtered', d => d.filtered).classed('gap-hi', d => !!gapSel && d.e.gap === gapSel);
    sel.select('.edge-hit').attr('d', d => d.d);
    sel.select('.edge-line').attr('d', d => d.d);
    sel.select('.edge-proc').attr('cx', d => d.mid.x).attr('cy', d => d.mid.y).style('stroke', d => relColor(d.e.type))
      .attr('display', d => (d.e.basis === '加工' ? null : 'none'));
  }

  // ---------- 悬停：这条线加粗到 3px，其他线降到 25% ----------
  const lensTip = e => {
    const a = model.nodeById.get(e.from), b = model.nodeById.get(e.to);
    return `<div class="tt-head">${esc(a.id)} ${esc(a.name)} <span class="tt-rel" style="color:${relColor(e.type)}">—${esc(e.type)}→</span> ${esc(b.id)} ${esc(b.name)}</div>
      <div class="tt-body">${esc(e.reason || '')}</div>
      <div class="tt-meta">${esc(e.status)} · ${e.basis === '加工' ? 'Claude 加工' : '来源'}${e.unverified ? ' · 未经检索核验' : ''}</div>`;
  };
  function hover(edgeId) {
    g.classed('lens-hover', !!edgeId);
    gCurve.selectAll('g.edge').classed('hi', d => d.e.id === edgeId);
    g.selectAll('.lens-card').classed('hi', d => d.e.id === edgeId);
  }
  function onOver(ev) {
    const card = ev.target.closest('.lens-card'), curve = ev.target.closest('.lens-curves g.edge');
    const e = card ? d3.select(card).datum().e : curve ? d3.select(curve).datum().e : null;
    if (e) { hover(e.id); tooltip.show(lensTip(e), ev); return; }
    const c = ev.target.closest('.node.center');
    if (c) { const n = d3.select(c).datum().n; tooltip.show(`<div class="tt-head"><span class="tt-id">${esc(n.id)}</span>${esc(n.name)}</div>${n.gist ? `<div class="tt-body">${esc(n.gist)}</div>` : ''}<div class="tt-meta">点击查看详情</div>`, ev); }
  }
  function onOut(ev) {
    const el = ev.target.closest('.lens-card, .lens-curves g.edge, .node.center');
    if (el && !el.contains(ev.relatedTarget)) { hover(null); tooltip.hide(); }
  }
  g.on('pointerover', onOver).on('pointermove', ev => tooltip.move(ev)).on('pointerout', onOut);

  // ---------- 点击 ----------
  let busy = false;
  function recenter(cardEl) {
    if (busy) return;
    const { n } = d3.select(cardEl).datum();
    tooltip.hide();
    if (reduceMotion()) { actions.openLens(n.id, { from: 'lens' }); return; }
    // 被点的卡片平滑移到中心，旧的侧边内容淡出
    busy = true;
    const clone = gCenter.append('g').attr('class', 'node lens-moving').attr('transform', d3.select(cardEl).attr('transform'));
    const pt = cardEl.getCTM(), base = g.node().getCTM().inverse().multiply(pt);
    clone.attr('transform', `translate(${base.e},${base.f})`);
    drawNode(clone, n, nodeBox(n), { clusterColor: clusterOf(model, n).color, digested: getDigested().has(n.id) });
    d3.select(cardEl).attr('opacity', 0);
    g.selectAll('.lens-col, .lens-curves, .lens-heads, .lens-foot, .lens-center > .node.center, .lens-gaps').transition().duration(180).attr('opacity', 0);
    clone.transition().duration(250).ease(d3.easeCubicOut).attr('transform', `translate(${geom.cx},${geom.cy})`)
      .on('end', () => {
        busy = false;
        g.selectAll('.lens-col, .lens-curves, .lens-heads, .lens-foot').attr('opacity', 0);
        actions.openLens(n.id, { from: 'lens' });
        g.selectAll('.lens-col, .lens-curves, .lens-heads, .lens-foot').transition().duration(220).attr('opacity', 1);
      });
  }
  g.on('click', ev => {
    const card = ev.target.closest('.lens-card');
    if (card) { ev.stopPropagation(); recenter(card); return; }
    const curve = ev.target.closest('.lens-curves g.edge');
    if (curve) { ev.stopPropagation(); actions.selectEdge(d3.select(curve).datum().e.id); return; }
    if (ev.target.closest('.node.center')) { ev.stopPropagation(); actions.selectNode(center, { detail: true }); return; }
    const gap = ev.target.closest('.lens-gap');
    if (gap) { ev.stopPropagation(); actions.selectGap(gap.dataset.gap, { zoom: false }); return; }
    const more = ev.target.closest('.lens-more');
    if (more) { ev.stopPropagation(); expanded.add(more.dataset.key); render(); actions.legendDirty(); return; }
    const hid = ev.target.closest('.lens-hidden');
    if (hid) { ev.stopPropagation(); showHidden[hid.dataset.side] = !showHidden[hid.dataset.side]; render(); actions.legendDirty(); }
  });
  g.on('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target.closest('.lens-card, .node.center, .lens-gap, .lens-more, .lens-hidden');
    if (!t) return;
    ev.preventDefault();
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // 栏内滚动：鼠标在哪一栏上就滚哪一栏，中心节点不动
  svg.on('wheel.lens', ev => {
    if (g.attr('display') === 'none' || !geom) return;
    const [mx] = d3.pointer(ev, svg.node());
    const side = mx < geom.cx ? 'L' : 'R';
    const S = geom.sides[side];
    if (!S.scrollable) return;
    ev.preventDefault();
    scroll[side] = Math.max(0, Math.min(S.total - S.availH, scroll[side] + ev.deltaY));
    render();
  }, { passive: false });

  return {
    g,
    show(id) {
      if (id !== center) { showHidden = { L: false, R: false }; scroll = { L: 0, R: 0 }; }
      center = id;
      g.attr('display', null);
      render();
    },
    hide() { g.attr('display', 'none'); list.attr('hidden', true); hover(null); },
    setInset(px) { if (px === inset) return; inset = px; if (center && g.attr('display') !== 'none') render(); },
    setGap(id) { if (id === gapSel) return; gapSel = id; if (geom && g.attr('display') !== 'none') drawCurves(); },
    setVisibility(v) { vis = v; if (center && g.attr('display') !== 'none') render(); },
    resize(s) { size = s; if (center && g.attr('display') !== 'none') render(); },
    render,
    // 给测试和图例用：当前两栏的内容
    snapshot() {
      if (!geom) return null;
      const out = {};
      for (const side of ['L', 'R']) {
        const S = geom.sides[side];
        out[side] = { count: S.count, hidden: S.hiddenCount, groups: [] };
        let cur = null;
        for (const r of S.rows) {
          if (r.kind === 'group') { cur = { t: r.t, n: r.n, items: [] }; out[side].groups.push(cur); }
          else if (r.kind === 'card') cur.items.push({ id: r.other, status: r.e.status, proc: r.e.basis === '加工' });
        }
      }
      return out;
    },
    legend() {
      if (!geom) return {};
      const edges = [], nodes = [model.nodeById.get(center)];
      for (const side of ['L', 'R']) for (const r of geom.sides[side].rows) if (r.kind === 'card') { edges.push(r.e); nodes.push(model.nodeById.get(r.other)); }
      return { nodes, edges };
    },
  };
}
