/* 学习进度：已消化节点集合，存 localStorage。阶段 4 补面板按钮与簇进度显示。 */
import * as storage from './storage.js';
let digested = new Set();
export function load() { const arr = storage.load('digested', []); digested = new Set(Array.isArray(arr) ? arr : []); return digested; }
export function has(id) { return digested.has(id); }
export function toggle(id) { if (digested.has(id)) digested.delete(id); else digested.add(id); storage.save('digested', [...digested]); return digested.has(id); }
export function set() { return digested; }
export function clusterProgress(model, clusterId) {
  const nodes = model.nodesByCluster.get(clusterId) || [];
  return { done: nodes.filter((n) => digested.has(n.id)).length, total: nodes.length };
}
