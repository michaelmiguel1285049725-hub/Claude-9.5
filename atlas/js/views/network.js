// 视角一：关系网。
// 稳定布局、簇背景、语义缩放三级（簇视图 / 名称 / 细节）、悬停与聚焦高亮、
// 拖动固定、重置与导出布局、小地图、缩放到簇。只读全局状态，不直接改别的模块。
import { nodeBox, drawNode, styleEdgePath } from '../glyph.js';
import { REL_TYPES, ZOOM_FAR, ZOOM_NEAR, relColor } from '../encoding.js';
import { clusterOf } from '../data.js';

const d3 = window.d3;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  if (sim.some(d => d.fx == null)) {
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
function edgeGeometry(edges, layout) {
  const groups = new Map();
  for (const e of edges) {
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
      const p0 = boxEdgePoint(S, sb, curved ? mx : T.x, curved ? my : T.y, 2);
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
function clusterHull(members, layout) {
  const pts = [];
  for (const id of members) {
    const p = layout.pos.get(id), b = layout.boxes.get(id);
    const hw = b.w / 2 + HULL_PAD, hh = b.h / 2 + HULL_PAD;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const cx = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.35;   // 超椭圆 ≈ 圆角矩形外廓
      const cy = Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
      pts.push([p.x + cx * hw, p.y + cy * hh]);
    }
  }
  const hull = d3.polygonHull(pts);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return {
    d: hull ? d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5))(hull) : null,
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

// ---------- 视图 ----------
export function createNetworkView({ root, model, store, fileLayout = null, tooltip, actions, getDigested }) {
  const svg = d3.select(root).append('svg').attr('class', 'canvas net').attr('data-level', 'mid')
    .attr('role', 'application').attr('aria-label', '关系网画布');
  const viewport = svg.append('g').attr('class', 'viewport');
  const gHull = viewport.append('g').attr('class', 'hulls');
  const gEdge = viewport.append('g').attr('class', 'edges');
  const gNode = viewport.append('g').attr('class', 'nodes');
  const gLabel = viewport.append('g').attr('class', 'hull-labels');
  const gFar = svg.append('g').attr('class', 'far');   // 簇视图：不跟随缩放变换，按屏幕坐标画，字号不会缩小
  const gFarLinks = gFar.append('g'), gFarBubbles = gFar.append('g');

  let layout = computeLayout(model, { saved: store.get('layout'), fileLayout });
  let geo = new Map();
  let hulls = [];
  let bounds = null;
  let vis = { nodes: new Set(model.nodes.map(n => n.id)), edges: new Set(model.edges.map(e => e.id)), visibleEdgeList: model.edges };
  let view = { sel: null, depth: 1, path: null, gap: null, pathPick: false };
  let hoverNode = null, hoverEdge = null;

  // ---------- 绘制 ----------
  function drawEdges() {
    geo = edgeGeometry(model.edges, layout);
    const eg = gEdge.selectAll('g.edge').data(model.edges, e => e.id).join(enter => {
      const g = enter.append('g').attr('class', 'edge');
      g.append('path').attr('class', 'edge-hit');
      g.append('path').attr('class', 'edge-line');
      g.append('circle').attr('class', 'edge-proc').attr('r', 4);
      g.each(function (e) { styleEdgePath(d3.select(this).select('.edge-line'), e); });
      return g;
    });
    eg.attr('data-id', e => e.id);
    eg.select('.edge-hit').attr('d', e => geo.get(e.id).d);
    eg.select('.edge-line').attr('d', e => geo.get(e.id).d);
    eg.select('.edge-proc')
      .attr('cx', e => geo.get(e.id).mid.x).attr('cy', e => geo.get(e.id).mid.y)
      .style('stroke', e => relColor(e.type))
      .attr('display', e => (e.basis === '加工' ? null : 'none'));
  }

  function drawHulls() {
    hulls = model.clusters.map(c => {
      const members = model.nodes.filter(n => n.cluster === c.id && vis.nodes.has(n.id)).map(n => n.id);
      return members.length ? { c, members, ...clusterHull(members, layout) } : null;
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
  }

  function drawNodes() {
    const digested = getDigested();
    gNode.selectAll('g.node').data(model.nodes, n => n.id).join(enter => enter.append('g').attr('class', 'node')
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', n => `${n.id} ${n.name}`)
      .each(function (n) {
        drawNode(d3.select(this), n, layout.boxes.get(n.id), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) });
      }))
      .attr('data-id', n => n.id)
      .attr('transform', n => { const p = layout.pos.get(n.id); return `translate(${p.x},${p.y})`; });
  }

  // "已消化"角标变化时只重画节点内部
  function redrawNodeGlyphs() {
    const digested = getDigested();
    gNode.selectAll('g.node').each(function (n) {
      const g = d3.select(this);
      g.selectAll('*').remove();
      drawNode(g, n, layout.boxes.get(n.id), { clusterColor: clusterOf(model, n).color, digested: digested.has(n.id) });
    });
  }

  function computeBounds() {
    const xs = [], ys = [];
    for (const h of hulls) { xs.push(h.minX, h.maxX); ys.push(h.minY - 24, h.maxY); }
    for (const n of model.nodes) {
      if (!vis.nodes.has(n.id)) continue;
      const p = layout.pos.get(n.id), b = layout.boxes.get(n.id);
      xs.push(p.x - b.w / 2, p.x + b.w / 2); ys.push(p.y - b.h / 2, p.y + b.h / 2);
    }
    bounds = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : { x0: 0, x1: WORLD.w, y0: 0, y1: WORLD.h };
  }

  // ---------- 簇视图（远距离） ----------
  function farData() {
    const digested = getDigested();
    const bubbles = model.clusters.map(c => {
      const members = model.nodes.filter(n => n.cluster === c.id && vis.nodes.has(n.id));
      if (!members.length) return null;
      const all = model.nodes.filter(n => n.cluster === c.id);
      const cx = d3.mean(members, n => layout.pos.get(n.id).x), cy = d3.mean(members, n => layout.pos.get(n.id).y);
      return { c, n: members.length, cx, cy, done: all.filter(n => digested.has(n.id)).length, total: all.length };
    }).filter(Boolean);
    const byC = new Map(bubbles.map(b => [b.c.id, b]));
    const links = new Map();
    for (const e of vis.visibleEdgeList) {
      const a = model.nodeById.get(e.from).cluster, b = model.nodeById.get(e.to).cluster;
      if (a === b || !byC.has(a) || !byC.has(b)) continue;
      const k = [a, b].sort().join('|');
      if (!links.has(k)) links.set(k, { a: byC.get([a, b].sort()[0]), b: byC.get([a, b].sort()[1]), count: 0, types: {} });
      const l = links.get(k); l.count++; l.types[e.type] = (l.types[e.type] || 0) + 1;
    }
    return { bubbles, links: [...links.values()] };
  }

  function drawFar() {
    if (level !== 'far') return;
    const t = d3.zoomTransform(svg.node());
    const { bubbles, links } = farData();
    // 气泡半径按节点数，但不超过到最近气泡距离的一半，避免重叠
    const scr = new Map(bubbles.map(b => [b.c.id, t.apply([b.cx, b.cy])]));
    const nearest = b => Math.min(Infinity, ...bubbles.filter(o => o !== b).map(o => Math.hypot(scr.get(o.c.id)[0] - scr.get(b.c.id)[0], scr.get(o.c.id)[1] - scr.get(b.c.id)[1])));
    const R = b => Math.max(26, Math.min(34 + 12 * Math.sqrt(b.n), nearest(b) * 0.48));
    gFarLinks.selectAll('g.far-link').data(links, l => l.a.c.id + l.b.c.id).join(enter => {
      const g = enter.append('g').attr('class', 'far-link');
      g.append('line').attr('class', 'far-link-hit');
      g.append('line').attr('class', 'far-link-line');
      return g;
    }).each(function (l) {
      const [x1, y1] = t.apply([l.a.cx, l.a.cy]), [x2, y2] = t.apply([l.b.cx, l.b.cy]);
      d3.select(this).selectAll('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      d3.select(this).select('.far-link-line').style('stroke-width', Math.min(16, 1.5 + l.count * 1.3));
    });
    gFarBubbles.selectAll('g.bubble').data(bubbles, b => b.c.id).join(enter => {
      const g = enter.append('g').attr('class', 'bubble').attr('tabindex', 0).attr('role', 'button');
      g.append('circle');
      g.append('text').attr('class', 'bubble-name').attr('text-anchor', 'middle');
      g.append('text').attr('class', 'bubble-count').attr('text-anchor', 'middle');
      g.append('text').attr('class', 'bubble-prog').attr('text-anchor', 'middle');
      return g;
    }).each(function (b) {
      const [x, y] = t.apply([b.cx, b.cy]), r = R(b);
      const g = d3.select(this).attr('transform', `translate(${x},${y})`).attr('aria-label', `${b.c.name}：${b.n} 个节点，双击放大`)
        .classed('main', !!b.c.main);
      g.select('circle').attr('r', r).style('--cc', b.c.color);
      g.select('.bubble-name').attr('y', -8).text(b.c.name);
      g.select('.bubble-count').attr('y', 9).text(`${b.c.id} · ${b.n} 个节点`);
      g.select('.bubble-prog').attr('y', 25).text(`已消化 ${b.done}/${b.total}`);
    });
  }

  // ---------- 高亮 ----------
  // 优先级：路径 > 空缺 > 选中的关系 > 聚焦的节点 > 悬停
  function neighbors(id, depth) {
    const one = new Set([id]), edges1 = new Set();
    for (const e of vis.visibleEdgeList) {
      if (e.from === id) { one.add(e.to); edges1.add(e.id); }
      else if (e.to === id) { one.add(e.from); edges1.add(e.id); }
    }
    const two = new Set(), edges2 = new Set();
    if (depth >= 2) {
      for (const e of vis.visibleEdgeList) {
        if (edges1.has(e.id)) continue;
        if (one.has(e.from) || one.has(e.to)) {
          edges2.add(e.id);
          if (!one.has(e.from)) two.add(e.from);
          if (!one.has(e.to)) two.add(e.to);
        }
      }
    }
    return { nodes: one, edges: edges1, nodes2: two, edges2 };
  }

  function highlightSet() {
    if (view.path) return { mode: 'focus', nodes: new Set(view.path.nodes), edges: new Set(view.path.steps.map(s => s.edge.id)), nodes2: new Set(), edges2: new Set() };
    if (view.gap) {
      const g = model.gapById.get(view.gap);
      if (g) {
        const edges = new Set(model.edges.filter(e => e.gap === g.id).map(e => e.id));
        const nodes = new Set(Array.isArray(g.nodes) ? g.nodes : []);
        for (const e of model.edges) if (edges.has(e.id)) { nodes.add(e.from); nodes.add(e.to); }
        return { mode: 'focus', nodes, edges, nodes2: new Set(), edges2: new Set() };
      }
    }
    if (view.sel?.kind === 'edge') {
      const e = model.edgeById.get(view.sel.id);
      if (e) return { mode: 'focus', nodes: new Set([e.from, e.to]), edges: new Set([e.id]), nodes2: new Set(), edges2: new Set(), selEdge: e.id };
    }
    if (view.sel?.kind === 'node' && model.nodeById.has(view.sel.id)) return { mode: 'focus', ...neighbors(view.sel.id, view.depth), selNode: view.sel.id };
    if (hoverNode) return { mode: 'hover', ...neighbors(hoverNode, 1) };
    if (hoverEdge) {
      const e = model.edgeById.get(hoverEdge);
      return { mode: 'hover', nodes: new Set([e.from, e.to]), edges: new Set([e.id]), nodes2: new Set(), edges2: new Set() };
    }
    return null;
  }

  function paint() {
    const h = highlightSet();
    svg.classed('mode-focus', h?.mode === 'focus').classed('mode-hover', h?.mode === 'hover');
    gNode.selectAll('g.node')
      .classed('hidden', n => !vis.nodes.has(n.id))
      .classed('hi', n => !!h && h.nodes.has(n.id))
      .classed('hi2', n => !!h && h.nodes2.has(n.id))
      .classed('sel', n => h?.selNode === n.id)
      .classed('path-end', n => !!view.pathPick && (view.pathPick.from === n.id || view.pathPick.to === n.id));
    gEdge.selectAll('g.edge')
      .classed('hidden', e => !vis.edges.has(e.id))
      .classed('hi', e => !!h && h.edges.has(e.id))
      .classed('hi2', e => !!h && h.edges2.has(e.id))
      .classed('sel', e => h?.selEdge === e.id);
    svg.classed('picking', !!view.pathPick);
  }

  // ---------- 平移缩放 ----------
  let baseK = 1;           // "适配全部"时的缩放比例；语义缩放级别以它为 1
  let level = 'mid';
  const zoom = d3.zoom()
    .on('zoom', ev => {
      viewport.attr('transform', ev.transform);
      updateLevel(ev.transform.k);
      drawFar();
      minimap.update();
      tooltip.hide();
    });
  svg.call(zoom).on('dblclick.zoom', null);

  function updateLevel(k) {
    const rel = k / baseK;
    const lv = rel < ZOOM_FAR ? 'far' : rel >= ZOOM_NEAR ? 'near' : 'mid';
    if (lv !== level) {
      level = lv; svg.attr('data-level', lv);
      if (lv === 'far') { hoverNode = hoverEdge = null; paint(); }
      else gFarLinks.selectAll('*').remove(), gFarBubbles.selectAll('*').remove();
    }
  }

  const size = () => ({ W: svg.node().clientWidth || 800, H: svg.node().clientHeight || 600 });
  function fitTransform(b, pad = 28, maxRel = Infinity) {
    const { W, H } = size();
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, baseK * maxRel);
    return { k, t: d3.zoomIdentity.translate(W / 2 - k * (b.x0 + bw / 2), H / 2 - k * (b.y0 + bh / 2)).scale(k) };
  }
  function computeBase() {
    const { W, H } = size();
    const bw = Math.max(1, bounds.x1 - bounds.x0), bh = Math.max(1, bounds.y1 - bounds.y0);
    baseK = Math.min((W - 56) / bw, (H - 56) / bh);
    zoom.scaleExtent([baseK * 0.2, baseK * 5]);
  }
  function go(t, animate = true) {
    (animate && !reduceMotion() ? svg.transition().duration(260) : svg).call(zoom.transform, t);
  }
  function fitAll(animate = true) { computeBase(); go(fitTransform(bounds).t, animate); }

  // 缩放到一组节点：至少到"名称"级别，最多放大到 1.8 倍
  function zoomToNodes(ids, { animate = true } = {}) {
    const xs = [], ys = [];
    for (const id of ids) {
      const p = layout.pos.get(id), b = layout.boxes.get(id);
      if (!p) continue;
      xs.push(p.x - b.w / 2, p.x + b.w / 2); ys.push(p.y - b.h / 2, p.y + b.h / 2);
    }
    if (!xs.length) return;
    const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const { t, k } = fitTransform(b, 70, 1.8);
    if (k / baseK < ZOOM_FAR) {   // 太分散时也保持在能看见节点的级别
      const { W, H } = size(); const k2 = baseK * ZOOM_FAR;
      go(d3.zoomIdentity.translate(W / 2 - k2 * (b.x0 + b.x1) / 2, H / 2 - k2 * (b.y0 + b.y1) / 2).scale(k2), animate);
    } else go(t, animate);
  }
  function zoomToCluster(cid) {
    const ids = model.nodes.filter(n => n.cluster === cid && vis.nodes.has(n.id)).map(n => n.id);
    zoomToNodes(ids);
  }
  // 节点不在视口里时才移动，已经看得到就不动（减少跳动）
  function ensureVisible(id) {
    const p = layout.pos.get(id); if (!p) return;
    const t = d3.zoomTransform(svg.node());
    const [x, y] = t.apply([p.x, p.y]);
    const { W, H } = size();
    if (level === 'far' || x < 60 || y < 40 || x > W - 60 || y > H - 40) zoomToNodes([id]);
  }

  // ---------- 小地图 ----------
  const minimap = (() => {
    const W = 150, H = 94;
    const box = d3.select(root.parentNode).append('div').attr('class', 'minimap').attr('title', '小地图：点击跳转');
    const m = box.append('svg').attr('width', W).attr('height', H);
    const gm = m.append('g'), vp = m.append('rect').attr('class', 'mm-view');
    let s = 1, ox = 0, oy = 0;
    function drawBase() {
      const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
      s = Math.min((W - 8) / bw, (H - 8) / bh);
      ox = (W - bw * s) / 2 - bounds.x0 * s; oy = (H - bh * s) / 2 - bounds.y0 * s;
      gm.attr('transform', `translate(${ox},${oy}) scale(${s})`);
      gm.selectAll('path.mm-hull').data(hulls, d => d.c.id).join('path').attr('class', 'mm-hull').attr('d', d => d.d).style('--cc', d => d.c.color);
      gm.selectAll('rect.mm-node').data(model.nodes.filter(n => vis.nodes.has(n.id)), n => n.id).join('rect').attr('class', 'mm-node')
        .attr('x', n => layout.pos.get(n.id).x - layout.boxes.get(n.id).w / 2).attr('y', n => layout.pos.get(n.id).y - layout.boxes.get(n.id).h / 2)
        .attr('width', n => layout.boxes.get(n.id).w).attr('height', n => layout.boxes.get(n.id).h)
        .style('fill', n => clusterOf(model, n).color);
    }
    function update() {
      const t = d3.zoomTransform(svg.node()); const { W: vw, H: vh } = size();
      const [x0, y0] = t.invert([0, 0]), [x1, y1] = t.invert([vw, vh]);
      vp.attr('x', ox + x0 * s).attr('y', oy + y0 * s).attr('width', Math.max(2, (x1 - x0) * s)).attr('height', Math.max(2, (y1 - y0) * s));
    }
    function jump(ev) {
      const [mx, my] = d3.pointer(ev, m.node());
      const wx = (mx - ox) / s, wy = (my - oy) / s;
      const t = d3.zoomTransform(svg.node()); const { W: vw, H: vh } = size();
      svg.call(zoom.transform, d3.zoomIdentity.translate(vw / 2 - wx * t.k, vh / 2 - wy * t.k).scale(t.k));
    }
    m.on('click', jump).call(d3.drag().on('drag', jump));
    return { drawBase, update };
  })();

  // ---------- 交互 ----------
  const nodeTip = n => `<div class="tt-head"><span class="tt-id">${esc(n.id)}</span>${esc(n.name)}</div>${n.gist ? `<div class="tt-body">${esc(n.gist)}</div>` : ''}`;
  const edgeTip = e => {
    const a = model.nodeById.get(e.from), b = model.nodeById.get(e.to);
    return `<div class="tt-head">${esc(a.name)} <span class="tt-rel" style="color:${relColor(e.type)}">—${esc(e.type)}→</span> ${esc(b.name)}</div>
      <div class="tt-body">${esc(e.reason || '')}</div>
      <div class="tt-meta">${esc(e.status)} · ${e.basis === '加工' ? 'Claude 加工' : '来源'}${e.unverified ? ' · 未经检索核验' : ''}</div>`;
  };

  gNode.on('pointerover', ev => {
    const el = ev.target.closest('g.node'); if (!el) return;
    const n = d3.select(el).datum();
    if (hoverNode !== n.id) { hoverNode = n.id; hoverEdge = null; paint(); }
    tooltip.show(nodeTip(n), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => {
      const el = ev.target.closest('g.node');
      if (el && !el.contains(ev.relatedTarget)) { hoverNode = null; paint(); tooltip.hide(); }
    });
  gEdge.on('pointerover', ev => {
    const el = ev.target.closest('g.edge'); if (!el) return;
    const e = d3.select(el).datum();
    if (hoverEdge !== e.id) { hoverEdge = e.id; hoverNode = null; paint(); }
    tooltip.show(edgeTip(e), ev);
  }).on('pointermove', ev => tooltip.move(ev))
    .on('pointerout', ev => {
      const el = ev.target.closest('g.edge');
      if (el && !el.contains(ev.relatedTarget)) { hoverEdge = null; paint(); tooltip.hide(); }
    });
  gEdge.on('click', ev => {
    const el = ev.target.closest('g.edge'); if (!el) return;
    ev.stopPropagation();
    actions.selectEdge(d3.select(el).datum().id);
  });
  gNode.on('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest('g.node'); if (!el) return;
    ev.preventDefault();
    actions.clickNode(d3.select(el).datum().id);
  });

  // 拖动：移动超过 4px 才算拖动，否则算点击
  const drag = d3.drag()
    .clickDistance(4)
    .on('drag', function (ev, n) {
      // 真正开始拖动才把节点提到最上层（在按下时移动 DOM 会让浏览器取消这次点击）
      if (!this.classList.contains('dragging')) d3.select(this).raise();
      const p = layout.pos.get(n.id);
      p.x = ev.x; p.y = ev.y;
      d3.select(this).attr('transform', `translate(${p.x},${p.y})`).classed('dragging', true);
      tooltip.hide();
      drawEdges(); drawHulls();
    })
    .on('end', function (ev, n) {
      const el = d3.select(this);
      if (!el.classed('dragging')) return;
      el.classed('dragging', false);
      const saved = store.get('layout', {}) || {};
      const p = layout.pos.get(n.id);
      saved[n.id] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      store.set('layout', saved);
      computeBounds(); minimap.drawBase(); minimap.update();
      paint();
    })
    .subject((ev, n) => { const p = layout.pos.get(n.id); return { x: p.x, y: p.y }; });
  gNode.on('click', ev => {
    const el = ev.target.closest('g.node'); if (!el) return;
    ev.stopPropagation();
    actions.clickNode(d3.select(el).datum().id);
  });

  // 点空白处退出聚焦
  svg.on('click', ev => {
    if (ev.defaultPrevented) return;
    if (ev.target.closest('.node,.edge,.bubble,.far-link')) return;
    actions.clearSelection();
  });
  // 双击簇背景或簇气泡：缩放到这个簇
  gHull.on('dblclick', ev => { const el = ev.target.closest('path.hull'); if (el) zoomToCluster(el.dataset.cluster); });
  gFarBubbles.on('dblclick', ev => { const el = ev.target.closest('g.bubble'); if (el) zoomToCluster(d3.select(el).datum().c.id); })
    .on('keydown', ev => { const el = ev.target.closest('g.bubble'); if (el && ev.key === 'Enter') zoomToCluster(d3.select(el).datum().c.id); })
    .on('pointerover', ev => {
      const el = ev.target.closest('g.bubble'); if (!el) return;
      const b = d3.select(el).datum();
      tooltip.show(`<div class="tt-head">${esc(b.c.name)} <span class="tt-id">${esc(b.c.id)}</span></div>${b.c.desc ? `<div class="tt-body">${esc(b.c.desc)}</div>` : ''}<div class="tt-meta">${b.n} 个节点 · 已消化 ${b.done} / ${b.total} · 双击放大</div>`, ev);
    }).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide());
  gFarLinks.on('pointerover', ev => {
    const el = ev.target.closest('g.far-link'); if (!el) return;
    const l = d3.select(el).datum();
    const rows = REL_TYPES.filter(t => l.types[t]).map(t => `<span class="tt-rel" style="color:${relColor(t)}">${t} ${l.types[t]}</span>`).join(' · ');
    tooltip.show(`<div class="tt-head">${esc(l.a.c.name)} ↔ ${esc(l.b.c.name)}</div><div class="tt-body">共 ${l.count} 条关系</div><div class="tt-meta">${rows}</div>`, ev);
  }).on('pointermove', ev => tooltip.move(ev)).on('pointerout', () => tooltip.hide());

  function fullRender() {
    drawHulls(); drawEdges(); drawNodes();
    gNode.selectAll('g.node').call(drag);
    computeBounds();
    minimap.drawBase();
  }

  fullRender();
  paint();
  requestAnimationFrame(() => { fitAll(false); minimap.update(); });
  new ResizeObserver(() => { const k = d3.zoomTransform(svg.node()).k; computeBase(); updateLevel(k); drawFar(); minimap.drawBase(); minimap.update(); }).observe(svg.node());

  return {
    fitAll,
    zoomToNodes,
    ensureVisible,
    getLevel: () => level,
    positions: () => layout.pos,
    // 筛选变化
    setVisibility(v) {
      vis = v;
      drawHulls(); computeBounds(); minimap.drawBase(); minimap.update();
      if (hoverNode && !vis.nodes.has(hoverNode)) hoverNode = null;
      paint(); drawFar();
    },
    // 选中 / 路径 / 空缺变化
    setView(v) { view = { ...view, ...v }; paint(); },
    refreshDigested() { redrawNodeGlyphs(); drawFar(); },
    resetLayout() {
      store.del('layout');
      layout = computeLayout(model, { saved: null, fileLayout });
      gNode.selectAll('g.node').attr('transform', n => { const p = layout.pos.get(n.id); return `translate(${p.x},${p.y})`; });
      drawHulls(); drawEdges(); computeBounds(); minimap.drawBase(); paint(); fitAll();
    },
    exportLayout() {
      const nodes = {};
      for (const n of model.nodes) { const p = layout.pos.get(n.id); nodes[n.id] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; }
      return { pack_id: model.domain.pack_id, generated: new Date().toISOString().slice(0, 10), world: WORLD, nodes };
    },
    hasCustomLayout: () => Object.keys(store.get('layout', {}) || {}).length > 0,
  };
}
