/* 视角一：关系网。阶段 1：稳定布局（种子力导向 / layout.json / 用户固定）、簇背景、关系线、节点、缩放平移与语义级别属性。 */
import * as enc from '../encoding.js';
import { get, set, subscribe } from '../state.js';
import * as storage from '../storage.js';

export const WORLD_W = 1360;
export const WORLD_H = 880;
const HULL_PAD = 30;

/* 矩形防重叠力：按节点实际尺寸 + 间距推开；不同研究线的节点之间留更大空隙，让簇背景尽量不重叠
   （n ≤ 200 时 O(n²) 足够快，只在加载时跑 300 次） */
function rectCollide(pad, crossPad, strength) {
  let nodes = [];
  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        if (dx === 0 && dy === 0) { dx = 0.01 * (i - j); dy = 0.01; }
        const p = a.ref._cluster === b.ref._cluster ? pad : crossPad;
        const ox = (a.w + b.w) / 2 + p[0] - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + p[1] - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) { const s = (dx < 0 ? -1 : 1) * ox * 0.5 * strength; if (a.fx == null) a.x -= s; if (b.fx == null) b.x += s; }
          else { const s = (dy < 0 ? -1 : 1) * oy * 0.5 * strength; if (a.fy == null) a.y -= s; if (b.fy == null) b.y += s; }
        }
      }
    }
  }
  force.initialize = (n) => { nodes = n; };
  return force;
}

/* 从节点中心朝 (tx,ty) 方向，与节点外框（外扩 gap）的交点 */
function borderPoint(n, tx, ty, gap) {
  const dx = tx - n.x, dy = ty - n.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const hw = n.w / 2 + gap, hh = n.h / 2 + gap;
  const t = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9));
  return [n.x + ux * t, n.y + uy * t];
}

export function createNetwork({ svgEl, stageEl, model, layout }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const world = svg.select('#world');
  const gHulls = world.append('g').attr('class', 'hulls');
  const gEdges = world.append('g').attr('class', 'edges');
  const gNodes = world.append('g').attr('class', 'nodes');

  /* ---- 布局数据（不改内容包对象，另建一层） ---- */
  const sn = model.nodes.map((n) => ({ id: n.id, ref: n, w: enc.NODE_W, h: enc.NODE_H, x: 0, y: 0 }));
  const snById = new Map(sn.map((d) => [d.id, d]));
  const se = model.edges.map((e) => ({ id: e.id, ref: e, source: snById.get(e.from), target: snById.get(e.to) }));
  /* 同一对节点之间的多条线：编号，用来画对称弧线 */
  const pairGroups = new Map();
  for (const e of se) {
    const key = [e.source.id, e.target.id].sort().join('|');
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(e);
  }

  const anchorOf = (d) => {
    const c = model.clusterById.get(d.ref._cluster);
    const a = (c && c.anchor) || [0.5, 0.5];
    return [a[0] * WORLD_W, a[1] * WORLD_H];
  };

  let layoutSource = 'sim';
  function computeLayout({ ignorePinned = false } = {}) {
    const rnd = d3.randomLcg(42);
    for (const d of sn) {
      const [ax, ay] = anchorOf(d);
      d.x = ax + (rnd() - 0.5) * 140; d.y = ay + (rnd() - 0.5) * 140; d.fx = null; d.fy = null;
    }
    const fromFile = layout && layout.positions && typeof layout.positions === 'object' ? layout.positions : null;
    let useFile = false;
    if (fromFile) {
      let hit = 0;
      for (const d of sn) { const p = fromFile[d.id]; if (Array.isArray(p) && p.length === 2) { d.x = p[0]; d.y = p[1]; hit++; } }
      useFile = hit === sn.length;
    }
    if (!useFile) {
      layoutSource = 'sim';
      const sim = d3.forceSimulation(sn).randomSource(rnd)
        .force('link', d3.forceLink(se).id((d) => d.id).distance(140).strength(0.08))
        .force('charge', d3.forceManyBody().strength(-200).distanceMax(240))
        .force('x', d3.forceX((d) => anchorOf(d)[0]).strength(0.3))
        .force('y', d3.forceY((d) => anchorOf(d)[1]).strength(0.3))
        .force('rect', rectCollide([16, 14], [84, 90], 0.7))
        .stop();
      for (let i = 0; i < 300; i++) sim.tick();
    } else layoutSource = 'file';
    for (const d of sn) { d.x = Math.round(d.x); d.y = Math.round(d.y); }
    if (!ignorePinned) {
      const pinned = storage.load('pinned', {}) || {};
      for (const d of sn) { const p = pinned[d.id]; if (Array.isArray(p) && p.length === 2) { d.x = p[0]; d.y = p[1]; d.fx = p[0]; d.fy = p[1]; } }
    }
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

  /* ---- 绘制 ---- */
  function drawHulls() {
    const data = model.clusters.map((c) => ({ c, nodes: sn.filter((d) => d.ref._cluster === c.id) })).filter((d) => d.nodes.length);
    const sel = gHulls.selectAll('g.hull').data(data, (d) => d.c.id);
    const ent = sel.enter().append('g').attr('class', 'hull').attr('data-cluster', (d) => d.c.id).style('--c', (d) => d.c._color);
    ent.append('path').attr('class', 'hull-area');
    ent.append('text').attr('class', 'hull-label').classed('main', (d) => !!d.c.main);
    const all = ent.merge(sel);
    all.select('path').attr('d', (d) => {
      const pts = [];
      for (const n of d.nodes) pts.push([n.x - n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y - n.h / 2], [n.x + n.w / 2, n.y + n.h / 2], [n.x - n.w / 2, n.y + n.h / 2]);
      const hull = pts.length >= 3 ? d3.polygonHull(pts) : pts;
      return 'M' + hull.map((p) => p.join(',')).join('L') + 'Z';
    });
    all.select('text')
      .attr('x', (d) => d3.mean(d.nodes, (n) => n.x))
      .attr('y', (d) => d3.min(d.nodes, (n) => n.y - n.h / 2) - HULL_PAD - 10)
      .text((d) => d.c.name);
    all.select('text').each(function (d) {
      /* 簇名后面加节点数（小字） */
      const t = d3.select(this); t.selectAll('tspan').remove(); t.text(d.c.name);
      t.append('tspan').attr('class', 'hull-count').attr('dx', 6).text(d.nodes.length);
    });
  }

  function drawEdges() {
    const sel = gEdges.selectAll('g.edge').data(se, (d) => d.id);
    const ent = sel.enter().append('g')
      .attr('class', 'edge')
      .attr('data-id', (d) => d.id)
      .attr('data-type', (d) => d.ref.type)
      .attr('data-status', (d) => d.ref.status)
      .attr('data-basis', (d) => d.ref.basis)
      .style('--c', (d) => enc.relColor(d.ref.type));
    ent.append('path').attr('class', 'hit');
    ent.append('path').attr('class', 'line')
      .attr('stroke-width', (d) => enc.relByZh[d.ref.type]?.width || 1.6)
      .attr('stroke-dasharray', (d) => enc.STATUS[d.ref.status]?.dash || null)
      .attr('marker-end', (d) => `url(#mk-${enc.relByZh[d.ref.type]?.key || 'inherit'})`)
      .attr('marker-start', (d) => (enc.relByZh[d.ref.type]?.both ? `url(#mk-${enc.relByZh[d.ref.type].key}-start)` : null));
    ent.filter((d) => d.ref.basis === '加工').append('circle').attr('class', 'proc').attr('r', 4);
    const all = ent.merge(sel);
    all.each(function (d) {
      const g = edgeGeom(d);
      const el = d3.select(this);
      el.select('path.hit').attr('d', g.d);
      el.select('path.line').attr('d', g.d);
      el.select('circle.proc').attr('cx', g.mid[0]).attr('cy', g.mid[1]);
    });
  }

  function shapeAttrs(sel) {
    sel.attr('x', (d) => -d.w / 2).attr('y', (d) => -d.h / 2).attr('width', (d) => d.w).attr('height', (d) => d.h)
      .attr('rx', (d) => { const k = enc.KINDS[d.ref.kind] || enc.KINDS.现象; return k.capsule ? d.h / 2 : k.rx; })
      .attr('stroke-dasharray', (d) => (enc.KINDS[d.ref.kind]?.dashed ? '4 3' : null));
  }

  function drawNodes() {
    const sel = gNodes.selectAll('g.node').data(sn, (d) => d.id);
    const ent = sel.enter().append('g')
      .attr('class', 'node')
      .attr('data-id', (d) => d.id)
      .attr('data-kind', (d) => d.ref.kind)
      .attr('data-cluster', (d) => d.ref._cluster)
      .attr('data-ai', (d) => (d.ref.ai_related ? '1' : '0'))
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => `${d.id} ${d.ref.name}`)
      .style('--cl', (d) => model.clusterById.get(d.ref._cluster)?._color || 'var(--muted)');
    ent.append('rect').attr('class', 'shape').call(shapeAttrs);
    ent.filter((d) => enc.KINDS[d.ref.kind]?.bar).append('line').attr('class', 'kind-bar')
      .attr('x1', (d) => -d.w / 2 + 4).attr('x2', (d) => -d.w / 2 + 4).attr('y1', (d) => -d.h / 2 + 7).attr('y2', (d) => d.h / 2 - 7);
    /* 标签：中文名（最多两行）+ 近距离时的编号 / 年份 */
    const fo = ent.append('foreignObject').attr('x', (d) => -d.w / 2).attr('y', (d) => -d.h / 2).attr('width', (d) => d.w).attr('height', (d) => d.h);
    fo.append('xhtml:div').attr('class', 'lbl').each(function (d) {
      const div = this;
      const name = document.createElement('div'); name.className = 'name'; name.textContent = d.ref.name; name.title = `${d.id} ${d.ref.name}`;
      const sub = document.createElement('div'); sub.className = 'sub lv3';
      const id = document.createElement('span'); id.className = 'id'; id.textContent = d.id;
      const yr = document.createElement('span'); yr.className = 'yr'; yr.textContent = d.ref.year;
      sub.append(id, yr); div.append(name, sub);
    });
    /* 研究线小色点：左上角 */
    ent.append('circle').attr('class', 'cl-dot').attr('cx', (d) => -d.w / 2).attr('cy', (d) => -d.h / 2).attr('r', 5);
    /* 近距离细节：证据徽章、拥挤度、角标 */
    const det = ent.append('g').attr('class', 'lv3 details');
    const ev = det.append('g').attr('class', 'ev').attr('data-ev', (d) => d.ref.evidence)
      .attr('transform', (d) => `translate(${d.w / 2 - 10},${d.h / 2})`);
    ev.append('rect').attr('x', -15).attr('y', -8).attr('width', 30).attr('height', 16).attr('rx', 8);
    ev.append('text').attr('y', 4).text((d) => d.ref.evidence);
    ev.append('title').text((d) => `证据等级 ${d.ref.evidence}：${enc.EVIDENCE[d.ref.evidence]?.desc || ''}`);
    const cr = det.append('g').attr('class', 'crowd').attr('transform', (d) => `translate(0,${d.h / 2})`);
    cr.each(function (d) {
      const n = enc.CROWDING[d.ref.crowding]?.n || 1;
      const g = d3.select(this);
      for (let i = 0; i < n; i++) g.append('circle').attr('cx', (i - (n - 1) / 2) * 7).attr('r', 2.4);
      g.append('title').text(`拥挤度 ${d.ref.crowding}：${enc.CROWDING[d.ref.crowding]?.desc || ''}`);
    });
    const marks = det.append('g').attr('class', 'marks').attr('transform', (d) => `translate(${d.w / 2},${-d.h / 2})`);
    marks.each(function (d) {
      const g = d3.select(this);
      let x = 0;
      if (Array.isArray(d.ref.alerts) && d.ref.alerts.length) {
        const m = g.append('g').attr('class', 'mark alert').attr('transform', `translate(${x},0)`);
        m.append('circle').attr('r', 7.5); m.append('text').attr('y', 4).text('!');
        m.append('title').text('重要警示：' + d.ref.alerts.join('；'));
        x -= 16;
      }
      if (d.ref.unverified) {
        const m = g.append('g').attr('class', 'mark unverified').attr('transform', `translate(${x},0)`);
        m.append('circle').attr('r', 7.5); m.append('text').attr('y', 4).text('?');
        m.append('title').text(enc.UNVERIFIED_TEXT);
      }
    });
    det.append('g').attr('class', 'done').attr('transform', (d) => `translate(${-d.w / 2},${d.h / 2})`)
      .each(function () { const g = d3.select(this); g.append('circle').attr('r', 7); g.append('path').attr('d', 'M-3.5,0 L-1,2.6 L3.6,-2.6'); });

    ent.merge(sel).attr('transform', (d) => `translate(${d.x},${d.y})`);
  }

  function drawAll() { drawHulls(); drawEdges(); drawNodes(); }
  drawAll();

  /* ---- 缩放 / 平移 + 语义级别（相对于"适配全部"的倍率） ---- */
  let kFit = 1;
  const zoom = d3.zoom().scaleExtent([0.12, 6]).on('zoom', (ev) => {
    world.attr('transform', ev.transform);
    updateLevel(ev.transform.k);
  });
  svg.call(zoom).on('dblclick.zoom', null);
  function updateLevel(k) {
    const rel = k / kFit;
    const lvl = rel < 0.6 ? 1 : rel < 1.4 ? 2 : 3;
    if (svgEl.getAttribute('data-level') !== String(lvl)) { svgEl.setAttribute('data-level', String(lvl)); set({ level: lvl }); }
    stageEl.dataset.zoom = Math.round(rel * 100);
    const z = stageEl.querySelector('[data-zoom-readout]'); if (z) z.textContent = `${Math.round(rel * 100)}%`;
  }
  function bounds() {
    const x0 = d3.min(sn, (d) => d.x - d.w / 2) - HULL_PAD - 12, x1 = d3.max(sn, (d) => d.x + d.w / 2) + HULL_PAD + 12;
    const y0 = d3.min(sn, (d) => d.y - d.h / 2) - HULL_PAD - 34, y1 = d3.max(sn, (d) => d.y + d.h / 2) + HULL_PAD + 12;
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  const FIT_INSET = { top: 10, right: 10, bottom: 44, left: 10 }; /* 底部留出快捷键提示条 */
  function fitAll(animate = true) {
    const r = stageEl.getBoundingClientRect();
    const b = bounds();
    const aw = r.width - FIT_INSET.left - FIT_INSET.right, ah = r.height - FIT_INSET.top - FIT_INSET.bottom;
    const k = Math.min(aw / b.w, ah / b.h);
    kFit = k;
    const t = d3.zoomIdentity.translate(FIT_INSET.left + (aw - b.w * k) / 2 - b.x0 * k, FIT_INSET.top + (ah - b.h * k) / 2 - b.y0 * k).scale(k);
    const sel = animate && !prefersReduced() ? svg.transition().duration(300) : svg;
    sel.call(zoom.transform, t);
  }
  function prefersReduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  fitAll(false);

  function zoomBy(f) { (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }
  function zoomToNode(id, relK = 1.6) {
    const d = snById.get(id); if (!d) return;
    const r = stageEl.getBoundingClientRect();
    const k = kFit * relK;
    const t = d3.zoomIdentity.translate(r.width / 2 - d.x * k, r.height / 2 - d.y * k).scale(k);
    (prefersReduced() ? svg : svg.transition().duration(300)).call(zoom.transform, t);
  }

  return {
    fitAll, zoomBy, zoomToNode,
    redraw: drawAll,
    nodes: sn,
    edges: se,
    layoutSource: () => layoutSource,
    exportLayout() {
      const positions = {}; for (const d of sn) positions[d.id] = [Math.round(d.x), Math.round(d.y)];
      return { version: 1, world: [WORLD_W, WORLD_H], generated: new Date().toISOString().slice(0, 10), positions };
    },
  };
}
