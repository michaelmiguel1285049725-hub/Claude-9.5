/* 全局状态与订阅。单一对象；set(patch) 后通知所有订阅者，参数为 (state, patch)。URL hash 同步在 main.js 里做。 */
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
  };
}

const state = {
  view: 'network',      // network | maturity | timeline
  node: null,           // 选中节点 id
  edge: null,           // 选中关系 id
  depth: 1,             // 聚焦深度 1 | 2
  gap: null,            // 选中空缺 id
  path: null,           // 当前高亮路径 { nodes:[], edges:[] }
  hoverNode: null,
  hoverEdge: null,
  level: 2,             // 关系网语义缩放级别 1 | 2 | 3
  filters: defaultFilters(null),
  panel: 'closed',      // closed | node | edge | path | gaps
};

const subs = new Set();
export function get() { return state; }
export function set(patch) {
  const changed = {};
  for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { state[k] = patch[k]; changed[k] = patch[k]; }
  if (Object.keys(changed).length) subs.forEach((f) => { try { f(state, changed); } catch (e) { console.error(e); } });
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
