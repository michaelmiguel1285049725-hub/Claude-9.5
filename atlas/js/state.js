/* 全局状态与订阅。单一对象；set(patch) 后通知所有订阅者，参数为 (state, patch)。URL hash 同步在 router.js 里做。 */
import { REL_ORDER, STATUS_ORDER, KIND_ORDER } from './encoding.js';

export function defaultFilters(model) {
  return {
    types: Object.fromEntries(REL_ORDER.map((t) => [t, true])),
    status: Object.fromEntries(STATUS_ORDER.map((s) => [s, true])),
    sourceOnly: false,
    gapsOnly: false,
    clusters: Object.fromEntries((model?.clusters || []).map((c) => [c.id, true])),
    kinds: Object.fromEntries(KIND_ORDER.map((k) => [k, true])),
    hideUnlinked: false,
    undigestedOnly: false,
    showAllEdges: false,   // 关系网全览里画出全部节点关系线（显示选项，不算筛选）
  };
}

const state = {
  view: 'network',      // network | maturity | timeline
  mode: 'overview',     // 关系网层级：overview | cluster | lens
  focusCluster: null,   // 研究线聚焦时的研究线 id
  trail: [],            // 路径导航：[{ kind:'cluster'|'node', id }]
  node: null,           // 选中节点 id（透镜里 = 中心节点）
  edge: null,           // 选中关系 id
  depth: 1,             // 聚焦深度 1 | 2
  gap: null,            // 选中空缺 id
  path: null,           // 当前高亮路径 { nodes:[], edges:[], steps:[] }
  pathQuery: null,      // 找路径的起终点 { from, to, sourceFirst }
  hoverNode: null,
  hoverEdge: null,
  level: 2,
  filters: defaultFilters(null),
  panel: 'closed',      // closed | node | edge | path | gaps
  progressTick: 0,      // 已消化集合变化时 +1，让各视角刷新
};

const subs = new Set();
export function get() { return state; }
export function set(patch) {
  const changed = {};
  for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { state[k] = patch[k]; changed[k] = patch[k]; }
  if (Object.keys(changed).length) subs.forEach((f) => { try { f(state, changed); } catch (e) { console.error(e); } });
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
