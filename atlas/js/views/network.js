// 视角一：关系网。
// 阶段 1：稳定的力导向布局、簇背景、节点与关系的全部视觉编码、平移缩放、适配全部。
import { nodeBox, drawNode, styleEdgePath } from '../glyph.js';
import { REL, ZOOM_FAR, ZOOM_NEAR } from '../encoding.js';
import { clusterOf } from '../data.js';

const d3 = window.d3;

// 世界坐标：固定大小，与窗口无关。簇的 anchor（0–1）映射到这块画布上。
export const WORLD = { w: 1600, h: 1000 };
const HULL_PAD = 30;
const SEED = 42;

// ---------- 布局 ----------
// 优先级：本机拖动过的位置 > layout.json > 固定种子的力导向模拟
export function computeLayout(model, { saved = null, fileLayout = null } = {}) {
  const boxes = new Map(model.nodes.map(n => [n.id, nodeBox(n)]));
  const fixed = {};
  const fromFile = fileLayout && fileLayout.nodes && typeof fileLayout.nodes === 'object' ? fileLayout.nodes : {};
  for (const n of model.nodes) {
    const p = (saved && saved[n.id]) || fromFile[n.id];
    if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) fixed[n.id] = p;
  }

  const rng = d3.randomLcg(SEED);
  const sim = model.nodes.map(n => {
    const c = clusterOf(model, n);
    const ax = c.anchor[0] * WORLD.w, ay = c.anchor[1] * WORLD.h;
    const b = boxes.get(n.id);
    const f = fixed[n.id];
    return {
      id: n.id, cluster: n.cluster, ax, ay, w: b.w, h: b.h,
      x: f ? f[0] : ax + (rng() - 0.5) * 120,
      y: f ? f[1] : ay + (rng() - 0.5) * 90,
      fx: f ? f[0] : null, fy: f ? f[1] : null,
    };
  });

  const free = sim.filter(d => d.fx == null).length;
  if (free > 0) {
    const links = model.edges.map(e => ({ source: e.from, target: e.to, same: model.nodeById.get(e.from).cluster === model.nodeById.get(e.to).cluster }));
    const s = d3.forceSimulation(sim)
      .randomSource(d3.randomLcg(SEED))
      .force('link', d3.forceLink(links).id(d => d.id).distance(l => (l.same ? 120 : 240)).strength(l => (l.same ? 0.25 : 0.03)))
      .force('charge', d3.forceManyBody().strength(-200).distanceMax(360))
      .force('x', d3.forceX(d => d.ax).strength(0.07))
      .force('y', d3.forceY(d => d.ay).strength(0.3))
      .force('collide', rectCollide(16))
      .stop();
    for (let i = 0; i < 300; i++) s.tick();
    // 收尾：只做防重叠，保证任何两个节点都不相叠
    const rc = rectCollide(16, 1);
    rc.initialize(sim);
    for (let i = 0; i < 80; i++) rc(1);
  }

  const pos = new Map(sim.map(d => [d.id, { x: d.fx ?? d.x, y: d.fy ?? d.y }]));
  return { pos, boxes };
}

// 按节点实际矩形尺寸防重叠（d3.forceCollide 只支持圆形）
function rectCollide(pad, strength = 0.7) {
  let nodes = [];
  function force(alpha) {
    const k = strength * Math.max(alpha, 0.3);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        // 不同研究线之间多留出两层簇背景的宽度，簇背景就不会叠在一起
        const gap = a.cluster === b.cluster ? pad : pad + HULL_PAD * 2;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const aFixed = a.fx != null, bFixed = b.fx != null;
        if (aFixed && bFixed) continue;
        const wa = aFixed ? 0 : bFixed ? 1 : 0.5, wb = 1 - wa;
        if (ox < oy) {
          const s = (dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx)) * ox * k;
          a.x -= s * wa; b.x += s * wb;
        } else {
          const s = (dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy)) * oy * k;
          a.y -= s * wa; b.y += s * wb;
        }
      }
    }
  }
  force.initialize = ns => { nodes = ns; };
  return force;
}

// ---------- 几何 ----------
// 从矩形中心朝 (tx,ty) 方向，求与矩形边（外扩 pad）的交点
function boxEdgePoint(c, b, tx, ty, pad) {
  const dx = tx - c.x, dy = ty - c.y;
  if (!dx && !dy) return { x: c.x, y: c.y };
  const sx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// 每条关系的几何：同一对节点之间有多条线时，按统一方向对称地弯开
export function edgeGeometry(model, layout) {
  const groups = new Map();
  for (const e of model.edges) {
    const k = [e.from, e.to].sort().join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const geo = new Map();
  for (const [k, list] of groups) {
    const [aId, bId] = k.split('|');
    const A = layout.pos.get(aId), B = layout.pos.get(bId);
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const px = -(B.y - A.y) / len, py = (B.x - A.x) / len;   // 统一的垂直方向
    list.sort((p, q) => (p.id < q.id ? -1 : 1));
    list.forEach((e, i) => {
      const off = (i - (list.length - 1) / 2) * 34;
      const S = layout.pos.get(e.from), T = layout.pos.get(e.to);
      const sb = layout.boxes.get(e.from), tb = layout.boxes.get(e.to);
      const mx = (S.x + T.x) / 2 + px * off * 2, my = (S.y + T.y) / 2 + py * off * 2; // 二次曲线控制点
      const curved = off !== 0;
      const cx = curved ? mx : T.x, cy = curved ? my : T.y;
      const p0 = boxEdgePoint(S, sb, cx, cy, 2);
      const p1 = boxEdgePoint(T, tb, curved ? mx : S.x, curved ? my : S.y, 2);
      const d = curved ? `M${p0.x},${p0.y} Q${mx},${my} ${p1.x},${p1.y}` : `M${p0.x},${p0.y} L${p1.x},${p1.y}`;
      const mid = curved
        ? { x: 0.25 * p0.x + 0.5 * mx + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * my + 0.25 * p1.y }
        : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      geo.set(e.id, { d, mid });
    });
  }
  return geo;
}

// 簇背景：节点外扩 30px 后的凸包，再圆滑
function hullPath(points) {
  const h = d3.polygonHull(points);
  if (!h) return null;
  return d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5))(h);
}
function clusterHull(members, layout) {
  const pts = [];
  for (const id of members) {
    const p = layout.pos.get(id), b = layout.boxes.get(id);
    const hw = b.w / 2 + HULL_PAD, hh = b.h / 2 + HULL_PAD;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      // 圆角矩形外廓的近似：超椭圆
      const cx = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.35;
      const cy = Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
      pts.push([p.x + cx * hw, p.y + cy * hh]);
    }
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { d: hullPath(pts), minY: Math.min(...ys), minX: Math.min(...xs), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// ---------- 渲染 ----------
export function createNetworkView({ root, model, store, fileLayout = null, onLevel }) {
  const svg = d3.select(root).append('svg').attr('class', 'canvas net').attr('data-level', 'mid')
    .attr('role', 'img').attr('aria-label', '关系网');
  const viewport = svg.append('g').attr('class', 'viewport');
  const gHull = viewport.append('g').attr('class', 'hulls');
  const gEdge = viewport.append('g').attr('class', 'edges');
  const gNode = viewport.append('g').attr('class', 'nodes');
  const gLabel = viewport.append('g').attr('class', 'hull-labels');

  const layout = computeLayout(model, { saved: store.get('layout'), fileLayout });
  let bounds = null;

  function render() {
    const geo = edgeGeometry(model, layout);

    // 簇背景
    const hulls = model.clusters.map(c => {
      const members = model.nodes.filter(n => n.cluster === c.id).map(n => n.id);
      return members.length ? { c, ...clusterHull(members, layout) } : null;
    }).filter(Boolean);
    gHull.selectAll('path').data(hulls, d => d.c.id).join('path')
      .attr('class', 'hull').attr('data-cluster', d => d.c.id).attr('d', d => d.d).style('--cc', d => d.c.color);
    gLabel.selectAll('text').data(hulls, d => d.c.id).join('text')
      .attr('class', d => `hull-label${d.c.main ? ' main' : ''}`)
      .attr('x', d => (d.minX + d.maxX) / 2).attr('y', d => d.minY - 8).attr('text-anchor', 'middle')
      .each(function (d) {
        const t = d3.select(this); t.selectAll('*').remove();
        t.append('tspan').text(d.c.name);
        t.append('tspan').attr('class', 'hull-id').attr('dx', 6).text(d.c.id);
      });

    // 关系：可点击的加宽区域 + 可见的线 + "加工"空心圆
    const eg = gEdge.selectAll('g.edge').data(model.edges, e => e.id).join(enter => {
      const g = enter.append('g').attr('class', 'edge');
      g.append('path').attr('class', 'edge-hit');
      g.append('path');
      g.append('circle').attr('class', 'edge-proc').attr('r', 4);
      return g;
    });
    eg.attr('data-id', e => e.id).attr('data-type', e => e.type).attr('data-status', e => e.status).attr('data-basis', e => e.basis);
    eg.select('.edge-hit').attr('d', e => geo.get(e.id).d);
    eg.select('path:nth-child(2)').attr('d', e => geo.get(e.id).d).each(function (e) { styleEdgePath(d3.select(this), e); });
    eg.select('.edge-proc')
      .attr('cx', e => geo.get(e.id).mid.x).attr('cy', e => geo.get(e.id).mid.y)
      .style('stroke', e => `var(--rel-${REL[e.type]?.key || 'inherit'})`)
      .attr('display', e => (e.basis === '加工' ? null : 'none'));

    // 节点
    gNode.selectAll('g.node').data(model.nodes, n => n.id).join(enter => enter.append('g').attr('class', 'node')
      .each(function (n) {
        drawNode(d3.select(this), n, layout.boxes.get(n.id), { clusterColor: clusterOf(model, n).color });
      }))
      .attr('data-id', n => n.id)
      .attr('transform', n => { const p = layout.pos.get(n.id); return `translate(${p.x},${p.y})`; });

    // 内容边界（适配全部用）
    const xs = [], ys = [];
    for (const h of hulls) { xs.push(h.minX, h.maxX); ys.push(h.minY - 24, h.maxY); }
    for (const n of model.nodes) { const p = layout.pos.get(n.id), b = layout.boxes.get(n.id); xs.push(p.x - b.w / 2, p.x + b.w / 2); ys.push(p.y - b.h / 2, p.y + b.h / 2); }
    bounds = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : { x0: 0, x1: WORLD.w, y0: 0, y1: WORLD.h };
  }

  // ---------- 平移缩放 ----------
  let baseK = 1;           // "适配全部"时的缩放比例；语义缩放级别以它为 1
  let level = 'mid';
  const zoom = d3.zoom().on('zoom', ev => {
    viewport.attr('transform', ev.transform);
    updateLevel(ev.transform.k);
  });
  svg.call(zoom).on('dblclick.zoom', null);

  function updateLevel(k) {
    const rel = k / baseK;
    const lv = rel < ZOOM_FAR ? 'far' : rel >= ZOOM_NEAR ? 'near' : 'mid';
    if (lv !== level) { level = lv; svg.attr('data-level', lv); onLevel && onLevel(lv); }
  }

  function fitTransform(b, pad = 28) {
    const el = svg.node();
    const W = el.clientWidth || 800, H = el.clientHeight || 600;
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    return { k, t: d3.zoomIdentity.translate(W / 2 - k * (b.x0 + bw / 2), H / 2 - k * (b.y0 + bh / 2)).scale(k) };
  }

  function computeBase() {
    baseK = fitTransform(bounds).k;
    zoom.scaleExtent([baseK * 0.25, baseK * 5]);
  }

  function fitAll(animate = true) {
    computeBase();
    const { t } = fitTransform(bounds);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    (animate && !reduce ? svg.transition().duration(260) : svg).call(zoom.transform, t);
  }

  render();
  requestAnimationFrame(() => fitAll(false));
  window.addEventListener('resize', () => { const k = d3.zoomTransform(svg.node()).k; computeBase(); updateLevel(k); });

  return {
    svg,
    fitAll,
    getLevel: () => level,
    positions: () => layout.pos,
  };
}
