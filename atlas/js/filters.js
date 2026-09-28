/* 筛选：可见性只在这里算一次，三个视角和找路径都读同一组结果。抽屉 UI 在 drawer.js。 */
import { defaultFilters } from './state.js';
import * as storage from './storage.js';
import * as progress from './progress.js';

export function computeVisibility(model, f) {
  const digested = progress.set();
  const nodeVis = new Set();
  for (const n of model.nodes) {
    if (f.clusters[n._cluster] === false) continue;
    if (f.kinds[n.kind] === false) continue;
    if (f.undigestedOnly && digested.has(n.id)) continue;
    nodeVis.add(n.id);
  }
  const edgeVis = new Set();
  for (const e of model.edges) {
    if (f.types[e.type] === false || f.status[e.status] === false) continue;
    if (f.sourceOnly && e.basis !== '来源') continue;
    if (f.gapsOnly && e.status !== '未验证') continue;
    if (!nodeVis.has(e.from) || !nodeVis.has(e.to)) continue;
    edgeVis.add(e.id);
  }
  if (f.hideUnlinked) {
    const linked = new Set();
    for (const id of edgeVis) { const e = model.edgeById.get(id); linked.add(e.from); linked.add(e.to); }
    for (const id of [...nodeVis]) if (!linked.has(id)) nodeVis.delete(id);
  }
  return { nodeVis, edgeVis, hiddenNodes: model.nodes.length - nodeVis.size, hiddenEdges: model.edges.length - edgeVis.size };
}

/* 与默认值合并，保证新加的键存在 */
export function restoreFilters(model) {
  const def = defaultFilters(model);
  const saved = storage.load('filters', null);
  if (!saved || typeof saved !== 'object') return def;
  const out = { ...def };
  for (const k of ['types', 'status', 'clusters', 'kinds']) {
    out[k] = { ...def[k] };
    if (saved[k] && typeof saved[k] === 'object') for (const key of Object.keys(def[k])) if (typeof saved[k][key] === 'boolean') out[k][key] = saved[k][key];
  }
  for (const k of ['sourceOnly', 'gapsOnly', 'hideUnlinked', 'undigestedOnly', 'showAllEdges']) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  return out;
}
