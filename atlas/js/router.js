/* URL hash ↔ 状态：#view=network&node=C-04&depth=2&edge=E-07&gap=G-03&path=E-02,E-34
   刷新后恢复；浏览器后退 / 前进回到上一个状态。筛选偏好不进 URL（在 localStorage）。 */
import { get, set, subscribe } from './state.js';

const KEYS = ['view', 'node', 'edge', 'gap', 'path', 'depth'];

export function toHash(s) {
  const p = new URLSearchParams();
  if (s.view && s.view !== 'network') p.set('view', s.view);
  if (s.node) p.set('node', s.node);
  if (s.edge) p.set('edge', s.edge);
  if (s.gap) p.set('gap', s.gap);
  if (s.path && s.path.edges) p.set('path', s.path.edges.join(','));
  if (s.depth === 2) p.set('depth', '2');
  const str = p.toString();
  return str ? '#' + str.replace(/%2C/g, ',') : '';
}

/* 由边 id 序列重建路径对象（节点顺序按相邻边的公共节点推断） */
export function pathFromEdgeIds(model, ids) {
  const edges = ids.map((id) => model.edgeById.get(id)).filter(Boolean);
  if (!edges.length || edges.length !== ids.length) return null;
  let start;
  if (edges.length === 1) start = edges[0].from;
  else { const e0 = edges[0], e1 = edges[1]; const shared = [e0.from, e0.to].find((x) => x === e1.from || x === e1.to); if (!shared) return null; start = e0.from === shared ? e0.to : e0.from; }
  const nodes = [start], steps = [];
  let cur = start;
  for (const e of edges) {
    if (e.from !== cur && e.to !== cur) return null;
    const other = e.from === cur ? e.to : e.from;
    steps.push({ edge: e, other, reverse: e.to === cur });
    nodes.push(other); cur = other;
  }
  return { nodes, edges: edges.map((e) => e.id), steps };
}

export function fromHash(model, hash) {
  const p = new URLSearchParams((hash || '').replace(/^#/, ''));
  const out = { view: 'network', node: null, edge: null, gap: null, path: null, depth: 1 };
  const v = p.get('view'); if (['network', 'maturity', 'timeline'].includes(v)) out.view = v;
  const n = p.get('node'); if (n && model.byId.has(n)) out.node = n;
  const e = p.get('edge'); if (e && model.edgeById.has(e)) out.edge = e;
  const g = p.get('gap'); if (g && model.gapById.has(g)) out.gap = g;
  const pa = p.get('path'); if (pa) out.path = pathFromEdgeIds(model, pa.split(',').filter(Boolean));
  if (p.get('depth') === '2') out.depth = 2;
  return out;
}

export function initRouter({ model }) {
  let applying = false;
  function apply(parsed) {
    applying = true;
    const s = get();
    const patch = { ...parsed };
    if (parsed.path) { patch.panel = 'path'; patch.pathQuery = { from: parsed.path.nodes[0], to: parsed.path.nodes[parsed.path.nodes.length - 1], sourceFirst: !!(s.pathQuery && s.pathQuery.sourceFirst) }; }
    else if (parsed.gap) patch.panel = 'gaps';
    else if (parsed.edge) patch.panel = 'edge';
    else if (parsed.node) patch.panel = 'node';
    else patch.panel = s.panel === 'path' ? 'path' : s.filters.gapsOnly ? 'gaps' : 'closed';
    set(patch);
    applying = false;
  }
  subscribe((s, patch) => {
    if (applying) return;
    if (!KEYS.some((k) => k in patch)) return;
    const h = toHash(s);
    if (location.hash === h || (!h && !location.hash)) return;
    try { history.pushState(null, '', h || location.pathname + location.search); } catch (e) { /* file:// 等环境下忽略 */ }
  });
  window.addEventListener('popstate', () => apply(fromHash(model, location.hash)));
  return { applyCurrent() { apply(fromHash(model, location.hash)); }, toHash, fromHash: (h) => fromHash(model, h) };
}
