/* 三个视角共用的图形：节点卡片、关系线样式、提示文本。保证颜色 / 线型 / 形状在各视角完全一致。 */
import * as enc from './encoding.js';
import * as tooltip from './tooltip.js';
const esc = tooltip.esc;

function shapeAttrs(sel) {
  sel.attr('x', (d) => -d.w / 2).attr('y', (d) => -d.h / 2).attr('width', (d) => d.w).attr('height', (d) => d.h)
    .attr('rx', (d) => { const k = enc.KINDS[d.ref.kind] || enc.KINDS.现象; return k.capsule ? d.h / 2 : k.rx; })
    .attr('stroke-dasharray', (d) => (enc.KINDS[d.ref.kind]?.dashed ? '4 3' : null));
}

/* ent：已 append 的 g.node enter 选择集；datum 形如 { id, ref, w, h } */
export function appendNodeGlyph(ent, model) {
  const d3 = window.d3;
  ent.attr('class', 'node')
    .attr('data-id', (d) => d.id)
    .attr('data-kind', (d) => d.ref.kind)
    .attr('data-cluster', (d) => d.ref._cluster)
    .attr('data-ai', (d) => (d.ref.ai_related ? '1' : '0'))
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.id} ${d.ref.name}`)
    .style('--cl', (d) => model.clusterById.get(d.ref._cluster)?._color || 'var(--muted)');
  ent.append('rect').attr('class', 'shape').call(shapeAttrs);
  ent.filter((d) => enc.KINDS[d.ref.kind]?.bar).append('line').attr('class', 'kind-bar')
    .attr('x1', (d) => -d.w / 2 + 4).attr('x2', (d) => -d.w / 2 + 4).attr('y1', (d) => -d.h / 2 + 7).attr('y2', (d) => d.h / 2 - 7);
  const fo = ent.append('foreignObject').attr('x', (d) => -d.w / 2).attr('y', (d) => -d.h / 2).attr('width', (d) => d.w).attr('height', (d) => d.h);
  fo.append('xhtml:div').attr('class', 'lbl').each(function (d) {
    const name = document.createElement('div'); name.className = 'name'; name.textContent = d.ref.name;
    const sub = document.createElement('div'); sub.className = 'sub lv3';
    const id = document.createElement('span'); id.className = 'id'; id.textContent = d.id;
    const yr = document.createElement('span'); yr.className = 'yr'; yr.textContent = d.ref.year;
    sub.append(id, yr); this.append(name, sub);
  });
  ent.append('circle').attr('class', 'cl-dot').attr('cx', (d) => -d.w / 2).attr('cy', (d) => -d.h / 2).attr('r', 5);
  const det = ent.append('g').attr('class', 'lv3 details');
  const ev = det.append('g').attr('class', 'ev').attr('data-ev', (d) => d.ref.evidence).attr('transform', (d) => `translate(${d.w / 2 - 10},${d.h / 2})`);
  ev.append('rect').attr('x', -15).attr('y', -8).attr('width', 30).attr('height', 16).attr('rx', 8);
  ev.append('text').attr('y', 4).text((d) => d.ref.evidence);
  ev.append('title').text((d) => `证据等级 ${d.ref.evidence}：${enc.EVIDENCE[d.ref.evidence]?.desc || ''}`);
  const cr = det.append('g').attr('class', 'crowd').attr('transform', (d) => `translate(0,${d.h / 2})`);
  cr.each(function (d) {
    const n = enc.CROWDING[d.ref.crowding]?.n || 1;
    const g = d3.select(this);
    for (let i = 0; i < n; i++) g.append('circle').attr('cx', (i - (n - 1) / 2) * 7).attr('r', 2.4);
    g.append('title').text(`拥挤度 ${d.ref.crowding}：${enc.CROWDING[d.ref.crowding]?.desc || ''}`);
  });
  const marks = det.append('g').attr('class', 'marks').attr('transform', (d) => `translate(${d.w / 2},${-d.h / 2})`);
  marks.each(function (d) {
    const g = d3.select(this);
    let x = 0;
    if (Array.isArray(d.ref.alerts) && d.ref.alerts.length) {
      const m = g.append('g').attr('class', 'mark alert').attr('transform', `translate(${x},0)`);
      m.append('circle').attr('r', 7.5); m.append('text').attr('y', 4).text('!');
      m.append('title').text('重要警示：' + d.ref.alerts.join('；'));
      x -= 16;
    }
    if (d.ref.unverified) {
      const m = g.append('g').attr('class', 'mark unverified').attr('transform', `translate(${x},0)`);
      m.append('circle').attr('r', 7.5); m.append('text').attr('y', 4).text('?');
      m.append('title').text(enc.UNVERIFIED_TEXT);
    }
  });
  det.append('g').attr('class', 'done').attr('transform', (d) => `translate(${-d.w / 2},${d.h / 2})`)
    .each(function () { const g = d3.select(this); g.append('circle').attr('r', 7); g.append('path').attr('d', 'M-3.5,0 L-1,2.6 L3.6,-2.6'); });
  return ent;
}

/* ent：已 append 的 g.edge enter 选择集；datum 形如 { id, ref } */
export function appendEdgeGlyph(ent) {
  ent.attr('class', 'edge')
    .attr('data-id', (d) => d.id)
    .attr('data-type', (d) => d.ref.type)
    .attr('data-status', (d) => d.ref.status)
    .attr('data-basis', (d) => d.ref.basis)
    .style('--c', (d) => enc.relColor(d.ref.type));
  ent.append('path').attr('class', 'halo');
  ent.append('path').attr('class', 'line')
    .attr('stroke-width', (d) => enc.relByZh[d.ref.type]?.width || 1.6)
    .attr('stroke-dasharray', (d) => enc.STATUS[d.ref.status]?.dash || null)
    .attr('marker-end', (d) => `url(#mk-${enc.relByZh[d.ref.type]?.key || 'inherit'})`)
    .attr('marker-start', (d) => (enc.relByZh[d.ref.type]?.both ? `url(#mk-${enc.relByZh[d.ref.type].key}-start)` : null));
  ent.filter((d) => d.ref.basis === '加工').append('circle').attr('class', 'proc').attr('r', 4);
  ent.append('path').attr('class', 'hit');
  return ent;
}
/* 给一条 g.edge 设置路径 d 与中点 */
export function setEdgePath(g, d, mid) {
  g.select('path.hit').attr('d', d);
  g.select('path.line').attr('d', d);
  g.select('path.halo').attr('d', d);
  g.select('circle.proc').attr('cx', mid[0]).attr('cy', mid[1]);
}

export function nodeTip(model, n) {
  const c = model.clusterById.get(n._cluster);
  return `<div class="tip-head"><span class="tip-id">${esc(n.id)}</span><b>${esc(n.name)}</b></div><div class="tip-sub">${esc(n.gist)} <span class="bm-tag ${n.gist_basis === '加工' ? 'proc' : 'src'}">${esc(n.gist_basis)}</span></div><div class="tip-meta">${esc(n.kind)} · ${esc(c?.name || '')} · ${n.year} · 证据 ${esc(n.evidence)} · ${esc(n.crowding)}${n.unverified ? ' · <span class="tip-warn">? 未核验</span>' : ''}${n.alerts?.length ? ' · <span class="tip-danger">! 警示</span>' : ''}</div>`;
}
export function edgeTip(model, e) {
  const a = model.byId.get(e.from), b = model.byId.get(e.to);
  return `<div class="tip-head"><b>${esc(a.name)}</b> <span class="tip-rel" style="--c:${enc.relColor(e.type)}">—${esc(e.type)}→</span> <b>${esc(b.name)}</b></div><div class="tip-sub">${esc(e.reason)}</div><div class="tip-meta">${esc(e.status)} · <span class="bm-tag ${e.basis === '加工' ? 'proc' : 'src'}">${e.basis === '加工' ? 'Claude 加工' : '来源'}</span>${e.gap ? ' · 空缺 ' + esc(e.gap) : ''}${e.unverified ? ' · <span class="tip-warn">? 未核验</span>' : ''}<span class="tip-id"> ${esc(e.id)}</span></div>`;
}

/* 从节点中心朝 (tx,ty) 方向，与节点外框（外扩 gap）的交点 */
export function borderPoint(n, tx, ty, gap) {
  const dx = tx - n.x, dy = ty - n.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const hw = n.w / 2 + gap, hh = n.h / 2 + gap;
  const t = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9));
  return [n.x + ux * t, n.y + uy * t];
}
