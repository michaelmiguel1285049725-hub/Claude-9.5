/* 路径导航（面包屑）：全貌 › 研究线 › 节点 › 节点 …；最多保留最近 8 段，更早的折叠成 "…"。 */
import * as enc from './encoding.js';
import { get, set } from './state.js';
import { esc } from './tooltip.js';

const MAX_SEGMENTS = 8;

/* 两个节点之间的直接关系（任意方向），按类型固定顺序取第一条 */
export function directEdge(model, a, b) {
  const list = (model.edgesOf.get(a) || []).filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  list.sort((p, q) => enc.REL_ORDER.indexOf(p.type) - enc.REL_ORDER.indexOf(q.type));
  return list[0] || null;
}

/* 把节点链写成文字：A —类型→ B、A ←类型— B、A →（跳转）→ B */
export function routeText(model, ids) {
  const label = (id) => { const n = model.byId.get(id); return n ? `${n.id} ${n.name}` : id; };
  if (!ids.length) return '';
  let out = label(ids[0]);
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1], b = ids[i];
    const e = directEdge(model, a, b);
    if (!e) out += ' →（跳转）→ ';
    else if (e.from === a) out += ` —${e.type}→ `;
    else out += ` ←${e.type}— `;
    out += label(b);
  }
  return out;
}

export function initTrail({ el, model, actions }) {
  function segments() {
    const s = get();
    const segs = [{ kind: 'root', label: '全貌' }];
    const trail = Array.isArray(s.trail) ? s.trail : [];
    let clusterId = s.mode === 'cluster' ? s.focusCluster : (trail.length ? model.byId.get(trail[0])?._cluster : null);
    if (clusterId && model.clusterById.has(clusterId)) segs.push({ kind: 'cluster', id: clusterId, label: model.clusterById.get(clusterId).name });
    for (const id of trail) { const n = model.byId.get(id); if (n) segs.push({ kind: 'node', id, label: `${n.id} ${n.name}` }); }
    return segs;
  }
  function render() {
    const s = get();
    const segs = segments();
    if (s.view !== 'network' || segs.length <= 1) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    let shown = segs, folded = 0;
    if (segs.length > MAX_SEGMENTS) { folded = segs.length - MAX_SEGMENTS; shown = [segs[0], ...segs.slice(folded + 1)]; }
    const html = [];
    shown.forEach((sg, i) => {
      if (i > 0) html.push('<span class="tr-sep">›</span>');
      if (i === 1 && folded) html.push(`<span class="tr-fold" title="更早的 ${folded} 段已折叠">…</span><span class="tr-sep">›</span>`);
      const last = i === shown.length - 1;
      html.push(`<button type="button" class="tr-seg${last ? ' cur' : ''}" data-kind="${sg.kind}" data-id="${esc(sg.id || '')}" ${last ? 'aria-current="page"' : ''}>${esc(sg.label)}</button>`);
    });
    const nodeIds = segs.filter((x) => x.kind === 'node').map((x) => x.id);
    if (nodeIds.length >= 1) html.push(`<button type="button" class="tr-copy icon-btn tiny" data-act="copy" title="复制成文字链，关系类型取自实际经过的关系">复制这条路线</button>`);
    el.innerHTML = html.join('');
  }
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'copy') { const ids = (get().trail || []); actions.copy(routeText(model, ids), '已复制这条路线'); return; }
    const kind = b.dataset.kind, id = b.dataset.id;
    if (kind === 'root') actions.goOverview();
    else if (kind === 'cluster') actions.goCluster(id);
    else if (kind === 'node') actions.goTrailNode(id);
  });
  return { render, segments, routeText: (ids) => routeText(model, ids) };
}
