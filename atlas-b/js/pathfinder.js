// 找路径：把关系当作无向边，只走当前筛选下可见的线。纯函数，不碰页面。
// 一条路径 = { nodes: [id...], steps: [{ edge, forward }] }，forward=false 表示逆着箭头走。

function adjacency(edges) {
  const adj = new Map();
  const add = (a, b, edge, forward) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, edge, forward });
  };
  for (const e of edges) { add(e.from, e.to, e, true); add(e.to, e.from, e, false); }
  // 固定遍历顺序（按关系编号），保证每次结果一样
  for (const list of adj.values()) list.sort((p, q) => (p.edge.id < q.edge.id ? -1 : p.edge.id > q.edge.id ? 1 : 0));
  return adj;
}

const procCount = p => p.steps.filter(s => s.edge.basis === '加工').length;
const untestedCount = p => p.steps.filter(s => s.edge.status === '未验证').length;
const key = p => p.steps.map(s => s.edge.id).join('>');

// 最短路径（步数最少）：BFS
export function shortestPath(edges, from, to) {
  if (from === to) return null;
  const adj = adjacency(edges);
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const s of adj.get(cur) || []) {
      if (prev.has(s.to)) continue;
      prev.set(s.to, { node: cur, step: s });
      queue.push(s.to);
    }
  }
  return prev.has(to) ? unwind(prev, to) : null;
}

// 优先走文献路径：加权最短路（来源 1，加工 3，未验证再加 2）
export const stepWeight = e => (e.basis === '加工' ? 3 : 1) + (e.status === '未验证' ? 2 : 0);
export function weightedPath(edges, from, to) {
  if (from === to) return null;
  const adj = adjacency(edges);
  const dist = new Map([[from, 0]]);
  const prev = new Map([[from, null]]);
  const done = new Set();
  // 节点数最多几百，用简单的线性扫描代替优先队列
  while (true) {
    let cur = null, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; cur = n; }
    if (cur == null || cur === to) break;
    done.add(cur);
    for (const s of adj.get(cur) || []) {
      const nd = best + stepWeight(s.edge);
      if (nd < (dist.get(s.to) ?? Infinity)) { dist.set(s.to, nd); prev.set(s.to, { node: cur, step: s }); }
    }
  }
  return prev.has(to) ? unwind(prev, to) : null;
}

function unwind(prev, to) {
  const nodes = [to], steps = [];
  let cur = to;
  while (prev.get(cur)) {
    const { node, step } = prev.get(cur);
    steps.unshift({ edge: step.edge, forward: step.forward });
    nodes.unshift(node);
    cur = node;
  }
  return { nodes, steps };
}

// 所有长度不超过 maxLen 的简单路径（不重复经过节点）
export function simplePaths(edges, from, to, maxLen = 5, cap = 5000) {
  const adj = adjacency(edges);
  const out = [];
  const nodes = [from], steps = [], onPath = new Set([from]);
  (function dfs(cur) {
    if (out.length >= cap) return;
    if (cur === to) { out.push({ nodes: [...nodes], steps: [...steps] }); return; }
    if (steps.length >= maxLen) return;
    for (const s of adj.get(cur) || []) {
      if (onPath.has(s.to)) continue;
      onPath.add(s.to); nodes.push(s.to); steps.push({ edge: s.edge, forward: s.forward });
      dfs(s.to);
      onPath.delete(s.to); nodes.pop(); steps.pop();
    }
  })(from);
  return out;
}

// 主结果 + 最多 3 条备选（长度 ≤ 5，按长度升序，同长度时"加工"少的在前）
export function findPaths(edges, from, to, { preferSource = false } = {}) {
  const main = preferSource ? weightedPath(edges, from, to) : shortestPath(edges, from, to);
  if (!main) return [];
  const mainKey = key(main);
  const alts = simplePaths(edges, from, to, 5)
    .filter(p => key(p) !== mainKey)
    .sort((a, b) => a.steps.length - b.steps.length || procCount(a) - procCount(b) || untestedCount(a) - untestedCount(b) || (key(a) < key(b) ? -1 : 1))
    .slice(0, 3);
  return [main, ...alts].map(p => ({ ...p, proc: procCount(p), untested: untestedCount(p), weight: p.steps.reduce((w, s) => w + stepWeight(s.edge), 0) }));
}

// 写成一条链：R-04 计算理性 —继承→ R-05 资源理性 ←解释— …
export function formatPath(p, nodeById) {
  const label = id => `${id} ${nodeById.get(id)?.name ?? ''}`.trim();
  let s = label(p.nodes[0]);
  p.steps.forEach((st, i) => {
    s += st.forward ? ` —${st.edge.type}→ ` : ` ←${st.edge.type}— `;
    s += label(p.nodes[i + 1]);
  });
  return s;
}

export const connected = (edges, from, to) => !!shortestPath(edges, from, to);
