// 路径导航（面包屑）：全貌 › 研究线 › 节点 › 节点 …，最多显示最近 8 个节点。
// 点任意一段回到那一步；"复制这条路线"把走过的节点写成文字链。
import { REL_TYPES } from './encoding.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MAX = 8;

// 两个相邻节点之间的关系：有多条时取固定顺序里最靠前的类型；没有直接关系写"（跳转）"
export function routeText(ids, model) {
  const label = id => `${id} ${model.nodeById.get(id)?.name ?? ''}`.trim();
  let s = label(ids[0]);
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1], b = ids[i];
    const between = model.edges.filter(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))
      .sort((x, y) => REL_TYPES.indexOf(x.type) - REL_TYPES.indexOf(y.type));
    const e = between[0];
    s += e ? (e.from === a ? ` —${e.type}→ ` : ` ←${e.type}— `) : ' →（跳转）→ ';
    s += label(b);
  }
  return s;
}

export function renderTrail(el, net, model) {
  const seg = [];
  seg.push(`<button type="button" class="tr-seg" data-go="overview"${net.level === 'overview' ? ' aria-current="page"' : ''}>全貌</button>`);
  if (net.cluster && net.level !== 'overview') {
    const c = model.clusterById.get(net.cluster);
    seg.push(`<button type="button" class="tr-seg" data-go="cluster"${net.level === 'cluster' ? ' aria-current="page"' : ''}>${esc(c?.name ?? net.cluster)}</button>`);
  }
  if (net.level === 'lens') {
    const start = Math.max(0, net.trail.length - MAX);
    if (start > 0) seg.push(`<span class="tr-more" title="${esc(net.trail.slice(0, start).join(' › '))}">…</span>`);
    net.trail.slice(start).forEach((id, k) => {
      const i = start + k;
      const n = model.nodeById.get(id);
      seg.push(`<button type="button" class="tr-seg node" data-go="${i}"${i === net.pos ? ' aria-current="page"' : ''}><span class="mono">${esc(id)}</span>${esc(n?.name ?? '')}</button>`);
    });
  }
  const canCopy = net.level === 'lens' && net.pos >= 0;
  el.innerHTML = `<div class="tr-line">${seg.join('<span class="tr-sep" aria-hidden="true">›</span>')}
    ${canCopy ? '<button type="button" class="tr-copy" data-copy title="把走过的节点复制成文字链">复制这条路线</button>' : ''}</div>`;
}
