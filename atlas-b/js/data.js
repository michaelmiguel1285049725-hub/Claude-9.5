// 加载内容包、运行校验、建立索引。数据原样保留，不做任何改写。
import { validatePack } from './validate.js';
import { clusterColor } from './encoding.js';

export async function loadPack(packId) {
  const base = `packs/${encodeURIComponent(packId)}/`;
  let pack;
  try {
    const r = await fetch(base + 'pack.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    pack = await r.json();
  } catch (err) {
    throw new Error(`读取内容包 ${base}pack.json 失败（${err.message}）`);
  }

  const issues = validatePack(pack);
  return { ...buildModel(pack), issues, packId };
}

export function buildModel(pack) {
  const domain = pack.domain || {};
  const clusters = (Array.isArray(domain.clusters) ? domain.clusters : []).map((c, i) => ({
    ...c, index: i, color: clusterColor(c, i),
    anchor: Array.isArray(c.anchor) && c.anchor.length === 2 ? c.anchor : [0.5, 0.5],
  }));
  const clusterById = new Map(clusters.map(c => [c.id, c]));

  const nodes = (Array.isArray(pack.nodes) ? pack.nodes : []).filter(n => n && n.id);
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // 能画出来的关系：两端节点都存在。校验问题照常列出，但不影响其余部分渲染。
  const allEdges = (Array.isArray(pack.edges) ? pack.edges : []).filter(e => e && e.id);
  const edges = allEdges.filter(e => nodeById.has(e.from) && nodeById.has(e.to) && e.from !== e.to);

  const gaps = (Array.isArray(pack.gaps) ? pack.gaps : []).filter(g => g && g.id);
  const gapById = new Map(gaps.map(g => [g.id, g]));

  const edgesByNode = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) { edgesByNode.get(e.from).push(e); edgesByNode.get(e.to).push(e); }

  return { pack, domain, clusters, clusterById, nodes, nodeById, edges, edgeById: new Map(edges.map(e => [e.id, e])), gaps, gapById, edgesByNode };
}

// 找不到所属研究线的节点，用一个中性占位，保证仍能画出来
export function clusterOf(model, n) {
  return model.clusterById.get(n.cluster) || { id: n.cluster, name: n.cluster || '（未知研究线）', anchor: [0.5, 0.5], color: 'var(--muted)', index: -1 };
}
