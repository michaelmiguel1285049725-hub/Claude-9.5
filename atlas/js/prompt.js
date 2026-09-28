/* "复制给 Claude 的提问"模板。 */
import * as enc from './encoding.js';

export function buildPrompt(model, id) {
  const n = model.byId.get(id); if (!n) return '';
  const c = model.clusterById.get(n._cluster);
  const lines = [];
  for (const t of enc.REL_ORDER) {
    for (const e of (model.out.get(id) || []).filter((e) => e.type === t)) { const o = model.byId.get(e.to); lines.push(`→ ${e.type} → ${o.id} ${o.name}（${e.status}，${e.basis}）`); }
    for (const e of (model.inc.get(id) || []).filter((e) => e.type === t)) { const o = model.byId.get(e.from); lines.push(`← ${e.type} ← ${o.id} ${o.name}（${e.status}，${e.basis}）`); }
  }
  return [
    `请讲解节点 ${n.id}「${n.name}」（${n.name_en}）。`,
    `按这个顺序：它为什么必须是这样 → 机制 → 连到我自己的经历。`,
    `请标出哪些内容来自文献、哪些是你的加工。`,
    `它在地图上的位置：研究线「${c?.name || n._cluster}」，证据 ${n.evidence}，拥挤度 ${n.crowding}。`,
    `它的关系：`,
    lines.length ? lines.join('\n') : '（没有关系线）',
  ].join('\n');
}
