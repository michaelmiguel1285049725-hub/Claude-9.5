/* 加载内容包并建立索引。校验错误不阻断：无法渲染的关系被剔除并记录在 model.dropped 里。 */
import { validatePack } from './validate.js';
import { clusterColor } from './encoding.js';

export async function fetchJSON(url, { optional = false } = {}) {
  let res;
  try { res = await fetch(url, { cache: 'no-cache' }); }
  catch (e) { if (optional) return null; throw new Error(`无法请求 ${url}：${e.message}`); }
  if (!res.ok) { if (optional) return null; throw new Error(`无法读取 ${url}（HTTP ${res.status}）`); }
  try { return await res.json(); }
  catch (e) { throw new Error(`${url} 不是合法的 JSON：${e.message}`); }
}

export async function loadPack(packId) {
  const pack = await fetchJSON(`packs/${packId}/pack.json`);
  return { pack };
}

export function buildModel(pack) {
  const validation = validatePack(pack);
  const domain = pack.domain || {};
  const clusters = (Array.isArray(domain.clusters) ? domain.clusters : []).filter((c) => c && typeof c.id === 'string');
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  clusters.forEach((c, i) => { c._color = clusterColor(c, i); c._index = i; });

  const nodes = (Array.isArray(pack.nodes) ? pack.nodes : []).filter((n) => n && typeof n.id === 'string');
  /* cluster 不存在的节点归到一个临时簇，仍然渲染 */
  let unknown = null;
  for (const n of nodes) {
    if (!clusterById.has(n.cluster)) {
      if (!unknown) {
        unknown = { id: '__unknown', name: '未知研究线', desc: '内容包里 cluster 字段无效的节点', side: 'both', main: false, anchor: [0.5, 0.5], _color: 'var(--muted)', _index: clusters.length };
        clusters.push(unknown); clusterById.set(unknown.id, unknown);
      }
      n._cluster = unknown.id;
    } else n._cluster = n.cluster;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const dropped = [];
  const edges = [];
  for (const e of (Array.isArray(pack.edges) ? pack.edges : [])) {
    if (!e || typeof e.id !== 'string' || !byId.has(e.from) || !byId.has(e.to) || e.from === e.to) { dropped.push(e); continue; }
    edges.push(e);
  }
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const gaps = (Array.isArray(pack.gaps) ? pack.gaps : []).filter((g) => g && typeof g.id === 'string');
  const gapById = new Map(gaps.map((g) => [g.id, g]));

  const out = new Map(), inc = new Map(), edgesOf = new Map();
  for (const n of nodes) { out.set(n.id, []); inc.set(n.id, []); edgesOf.set(n.id, []); }
  for (const e of edges) { out.get(e.from).push(e); inc.get(e.to).push(e); edgesOf.get(e.from).push(e); edgesOf.get(e.to).push(e); }

  const nodesByCluster = new Map(clusters.map((c) => [c.id, []]));
  for (const n of nodes) nodesByCluster.get(n._cluster).push(n);
  const edgesByGap = new Map(gaps.map((g) => [g.id, []]));
  for (const e of edges) if (e.gap && edgesByGap.has(e.gap)) edgesByGap.get(e.gap).push(e);
  const gapsOfNode = new Map(nodes.map((n) => [n.id, []]));
  for (const g of gaps) for (const id of (g.nodes || [])) if (gapsOfNode.has(id)) gapsOfNode.get(id).push(g);

  return { pack, domain, clusters, clusterById, nodes, byId, edges, edgeById, gaps, gapById, out, inc, edgesOf, nodesByCluster, edgesByGap, gapsOfNode, dropped, validation };
}
