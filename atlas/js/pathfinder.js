/* 找路径：把关系当无向边。只走当前可见的线。 */

function neighbors(model, edgeVis, id) {
  const out = [];
  for (const e of model.edgesOf.get(id) || []) {
    if (!edgeVis.has(e.id)) continue;
    out.push({ edge: e, other: e.from === id ? e.to : e.from, reverse: e.to === id });
  }
  return out;
}

function toPath(steps, from) {
  return { nodes: [from, ...steps.map((s) => s.other)], edges: steps.map((s) => s.edge.id), steps };
}

/* BFS 最短路径 */
export function shortest(model, edgeVis, from, to) {
  if (from === to) return { nodes: [from], edges: [], steps: [] };
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    for (const nb of neighbors(model, edgeVis, cur)) {
      if (prev.has(nb.other)) continue;
      prev.set(nb.other, { from: cur, step: nb });
      if (nb.other === to) {
        const steps = []; let x = to;
        while (prev.get(x)) { steps.unshift(prev.get(x).step); x = prev.get(x).from; }
        return toPath(steps, from);
      }
      q.push(nb.other);
    }
  }
  return null;
}

/* 简单路径枚举：长度 ≤ maxLen，最多收集 cap 条 */
export function simplePaths(model, edgeVis, from, to, maxLen = 5, cap = 3000) {
  const found = [];
  const stack = [];
  const onPath = new Set([from]);
  function dfs(cur) {
    if (found.length >= cap) return;
    if (stack.length >= maxLen) return;
    for (const nb of neighbors(model, edgeVis, cur)) {
      if (onPath.has(nb.other)) continue;
      stack.push(nb);
      if (nb.other === to) found.push(toPath([...stack], from));
      else { onPath.add(nb.other); dfs(nb.other); onPath.delete(nb.other); }
      stack.pop();
      if (found.length >= cap) return;
    }
  }
  dfs(from);
  return found;
}

export function pathStats(p) {
  let proc = 0, unv = 0;
  for (const s of p.steps) { if (s.edge.basis === '加工') proc++; if (s.edge.status === '未验证') unv++; }
  return { len: p.steps.length, proc, unv };
}

/* 备选路径：按长度升序，同长度加工少的在前；排除与 exclude 相同的边序列 */
export function alternatives(model, edgeVis, from, to, exclude, maxLen = 5, count = 3) {
  const all = simplePaths(model, edgeVis, from, to, maxLen);
  const key = (p) => p.edges.join('>');
  const ex = exclude ? key(exclude) : null;
  return all.filter((p) => key(p) !== ex)
    .sort((a, b) => { const sa = pathStats(a), sb = pathStats(b); return sa.len - sb.len || sa.proc - sb.proc || sa.unv - sb.unv; })
    .slice(0, count);
}

/* 加权最短路径：来源 = 1，加工 = 3，未验证再加 2 */
export function weight(e) { return (e.basis === '加工' ? 3 : 1) + (e.status === '未验证' ? 2 : 0); }
export function weightedShortest(model, edgeVis, from, to) {
  if (from === to) return { nodes: [from], edges: [], steps: [] };
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  const pq = [[0, from]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, cur] = pq.shift();
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const nb of neighbors(model, edgeVis, cur)) {
      const nd = d + weight(nb.edge);
      if (nd < (dist.has(nb.other) ? dist.get(nb.other) : Infinity)) { dist.set(nb.other, nd); prev.set(nb.other, { from: cur, step: nb }); pq.push([nd, nb.other]); }
    }
  }
  if (!prev.has(to)) return null;
  const steps = []; let x = to;
  while (prev.get(x)) { steps.unshift(prev.get(x).step); x = prev.get(x).from; }
  return toPath(steps, from);
}

/* 不连通时：用全部关系再找一次，报告是哪些筛选挡住了 */
export function blockers(model, filters, from, to) {
  const all = new Set(model.edges.map((e) => e.id));
  const p = shortest(model, all, from, to);
  if (!p) return { connectedAtAll: false, hints: [] };
  const hints = new Set();
  for (const s of p.steps) {
    const e = s.edge;
    if (filters.types[e.type] === false) hints.add(`关系类型「${e.type}」`);
    if (filters.status[e.status] === false) hints.add(`状态「${e.status}」`);
    if (filters.sourceOnly && e.basis === '加工') hints.add('「只看有文献来源的线」');
    if (filters.gapsOnly && e.status !== '未验证') hints.add('「只看空缺」');
  }
  for (const id of p.nodes) {
    const n = model.byId.get(id);
    if (filters.clusters[n._cluster] === false) hints.add(`研究线「${model.clusterById.get(n._cluster)?.name || n._cluster}」`);
    if (filters.kinds[n.kind] === false) hints.add(`节点类型「${n.kind}」`);
  }
  if (filters.undigestedOnly) hints.add('「只看未消化」');
  return { connectedAtAll: true, hints: [...hints] };
}
