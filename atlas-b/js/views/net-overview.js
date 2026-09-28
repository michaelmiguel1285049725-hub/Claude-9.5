// 关系网第一层：研究线概览。只画研究线气泡和研究线之间的汇总连线。
import { REL_TYPES, relColor } from '../encoding.js';
import { esc } from './shared.js';

const d3 = window.d3;
const MARGIN = 60, R_MIN = 36, R_MAX = 72;

export function createOverview({ svg, model, tooltip, actions, getDigested }) {
  const g = svg.append('g').attr('class', 'ov');
  const gLink = g.append('g').attr('class', 'ov-links');
  const gBubble = g.append('g').attr('class', 'ov-bubbles');
  let vis = null;
  let size = { W: 800, H: 600 };

  // 每条研究线相关的空缺数（空缺的 nodes 里有这条研究线的节点）
  const gapCount = new Map(model.clusters.map(c => [c.id, model.gaps.filter(gp => (gp.nodes || []).some(id => model.nodeById.get(id)?.cluster === c.id)).length]));
  const maxN = Math.max(1, ...model.clusters.map(c => model.nodes.filter(n => n.cluster === c.id).length));

  function data() {
    const digested = getDigested();
    const bubbles = model.clusters.map(c => {
      const members = model.nodes.filter(n => n.cluster === c.id);
      const shown = members.filter(n => vis.nodes.has(n.id));
      if (!shown.length) return null;
      const r = Math.max(R_MIN, Math.min(R_MAX, R_MAX * Math.sqrt(shown.length) / Math.sqrt(maxN)));
      return {
        c, r, n: shown.length,
        x: MARGIN + c.anchor[0] * (size.W - MARGIN * 2),
        y: MARGIN + c.anchor[1] * (size.H - MARGIN * 2),
        done: members.filter(n => digested.has(n.id)).length, total: members.length,
        intra: vis.visibleEdgeList.filter(e => model.nodeById.get(e.from).cluster === c.id && model.nodeById.get(e.to).cluster === c.id).length,
        gaps: gapCount.get(c.id) || 0,
      };
    }).filter(Boolean);
    const byId = new Map(bubbles.map(b => [b.c.id, b]));
    const links = new Map();
    for (const e of vis.visibleEdgeList) {
      const a = model.nodeById.get(e.from).cluster, b = model.nodeById.get(e.to).cluster;
      if (a === b || !byId.has(a) || !byId.has(b)) continue;
      const [p, q] = [a, b].sort((x, y) => model.clusters.findIndex(c => c.id === x) - model.clusters.findIndex(c => c.id === y));
      const k = p + '|' + q;
      if (!links.has(k)) links.set(k, { a: byId.get(p), b: byId.get(q), count: 0, types: {}, src: 0, proc: 0 });
      const l = links.get(k);
      l.count++; l.types[e.type] = (l.types[e.type] || 0) + 1;
      e.basis === '加工' ? l.proc++ : l.src++;
    }
    return { bubbles, links: [...links.values()] };
  }

  // 直线会穿过第三个气泡时，改成向外弯的弧线
  function linkPath(l, bubbles) {
    const { a, b } = l;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    let bend = 0;
    for (const o of bubbles) {
      if (o === a || o === b) continue;
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.y - a.y) * dy) / (len * len)));
      const px = a.x + t * dx, py = a.y + t * dy;
      const dist = Math.hypot(o.x - px, o.y - py);
      const need = o.r + 18 - dist;
      if (need > 0 && t > 0.05 && t < 0.95) {
        const side = ((o.x - a.x) * -dy + (o.y - a.y) * dx) > 0 ? -1 : 1;   // 往远离气泡的一侧弯
        bend = side * Math.max(Math.abs(bend), (need + o.r * 0.2) * 2);
      }
    }
    const nx = -dy / len, ny = dx / len;
    const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
    const at = t => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    return { d: bend ? `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`, at };
  }

  function render() {
    if (!vis) return;
    const { bubbles, links } = data();
    const lg = gLink.selectAll('g.ov-link').data(links, l => l.a.c.id + '|' + l.b.c.id).join(enter => {
      const x = enter.append('g').attr('class', 'ov-link');
      x.append('path').attr('class', 'ov-link-hit');
      x.append('path').attr('class', 'ov-link-line');
      x.append('circle').attr('class', 'ov-link-badge').attr('r', 11);
      x.append('text').attr('class', 'ov-link-num').attr('text-anchor', 'middle').attr('dominant-baseline', 'central');
      return x;
    });
    // 数字徽章默认放在线的中点；如果压在别的线或别的徽章上，就沿自己的线挪开
    const paths = links.map(l => ({ l, p: linkPath(l, bubbles) }));
    const samples = paths.map(({ p }) => d3.range(0, 1.0001, 0.02).map(p.at));
    const placed = [];
    const clear = (pt, i) => placed.every(q => Math.hypot(q.x - pt.x, q.y - pt.y) > 30)
      && samples.every((pts, j) => j === i || pts.every(q => Math.hypot(q.x - pt.x, q.y - pt.y) > 16))
      && bubbles.every(b => Math.hypot(b.x - pt.x, b.y - pt.y) > b.r + 16);
    paths.forEach(({ l, p }, i) => {
      const pt = [0.5, 0.42, 0.58, 0.35, 0.65, 0.28, 0.72].map(p.at).find(q => clear(q, i)) || p.at(0.5);
      placed.push(pt);
      l.badge = pt; l.d = p.d;
    });
    lg.each(function (l) {
      const s = d3.select(this);
      s.selectAll('path').attr('d', l.d);
      s.select('.ov-link-line').style('stroke-width', 1 + l.count * 0.8);
      s.select('.ov-link-badge').attr('cx', l.badge.x).attr('cy', l.badge.y);
      s.select('.ov-link-num').attr('x', l.badge.x).attr('y', l.badge.y).text(l.count);
    });

    const bg = gBubble.selectAll('g.ov-bubble').data(bubbles, b => b.c.id).join(enter => {
      const x = enter.append('g').attr('class', 'ov-bubble').attr('tabindex', 0).attr('role', 'button');
      x.append('circle').attr('class', 'ov-ring-bg');
      x.append('circle').attr('class', 'ov-ring');
      x.append('circle').attr('class', 'ov-core');
      x.append('text').attr('class', 'ov-name').attr('text-anchor', 'middle');
      x.append('text').attr('class', 'ov-count').attr('text-anchor', 'middle');
      const gb = x.append('g').attr('class', 'ov-gap');
      gb.append('circle').attr('r', 11);
      gb.append('text').attr('text-anchor', 'middle').attr('dominant-baseline', 'central');
      return x;
    });
    bg.attr('transform', b => `translate(${b.x},${b.y})`)
      .classed('main', b => !!b.c.main)
      .attr('data-cluster', b => b.c.id)
      .attr('aria-label', b => `${b.c.name}，${b.n} 个节点，已消化 ${b.done} / ${b.total}`);
    bg.select('.ov-core').attr('r', b => b.r);
    bg.select('.ov-ring-bg').attr('r', b => b.r + 6);
    bg.select('.ov-ring').attr('r', b => b.r + 6)
      .attr('stroke-dasharray', b => { const C = 2 * Math.PI * (b.r + 6); return `${C * (b.total ? b.done / b.total : 0)} ${C}`; })
      .attr('transform', 'rotate(-90)')
      .attr('display', b => (b.done ? null : 'none'));
    bg.select('.ov-name').attr('y', -3).text(b => b.c.name);
    bg.select('.ov-count').attr('y', 16).text(b => `${b.n} 个节点`);
    bg.select('.ov-gap').attr('display', b => (b.gaps ? null : 'none'))
      .attr('transform', b => `translate(${b.r * 0.72 + 6},${-b.r * 0.72 - 6})`)
      .select('text').text(b => b.gaps);
  }

  // ---------- 交互 ----------
  gLink.on('pointerover', ev => {
    const el = ev.target.closest('g.ov-link'); if (!el) return;
    const l = d3.select(el).datum();
    el.classList.add('hover');
    const rows = REL_TYPES.filter(t => l.types[t]).map(t => `<span class="tt-rel" style="color:${relColor(t)}">${t} ${l.types[t]}</span>`).join(' · ');
    tooltip.show(`<div class="tt-head">${esc(l.a.c.name)} — ${esc(l.b.c.name)}</div><div class="tt-body">${rows}</div><div class="tt-meta">共 ${l.count} 条：来源 ${l.src} 条、加工 ${l.proc} 条</div>`, ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => { const el = ev.target.closest('g.ov-link'); if (el) el.classList.remove('hover'); tooltip.hide(); });

  gBubble.on('pointerover', ev => {
    const el = ev.target.closest('g.ov-bubble'); if (!el) return;
    const b = d3.select(el).datum();
    if (ev.target.closest('.ov-gap')) {
      tooltip.show(`<div class="tt-head">${b.gaps} 个相关空缺问题</div><div class="tt-meta">点"空缺"按钮查看</div>`, ev);
      return;
    }
    tooltip.show(`<div class="tt-head">${esc(b.c.name)} <span class="tt-id">${esc(b.c.id)}</span></div>${b.c.desc ? `<div class="tt-body">${esc(b.c.desc)}</div>` : ''}<div class="tt-meta">${b.n} 个节点 · 内部 ${b.intra} 条关系 · 已消化 ${b.done} / ${b.total}</div>`, ev);
  }).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide())
    .on('click', ev => {
      const el = ev.target.closest('g.ov-bubble'); if (!el) return;
      ev.stopPropagation();
      tooltip.hide();
      actions.openCluster(d3.select(el).datum().c.id);
    })
    .on('keydown', ev => {
      const el = ev.target.closest('g.ov-bubble');
      if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); actions.openCluster(d3.select(el).datum().c.id); }
    });

  return {
    g,
    setVisibility(v) { vis = v; render(); },
    resize(s) { size = s; render(); },
    render,
    // 当前画面上出现的东西（给图例用）
    legend() { return { overview: true, gaps: [...gapCount.values()].some(Boolean) }; },
    bubbleOf(cid) { return data().bubbles.find(b => b.c.id === cid) || null; },
  };
}
