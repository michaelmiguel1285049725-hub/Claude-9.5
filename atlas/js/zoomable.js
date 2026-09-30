/* 成熟度地图与时间线共用的缩放 / 平移 / 适配。 */
export function prefersReduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

/* 额外的适配边距：图例弹层展开时右侧预留宽度，让"适配全部"避开它，任何视角都不被遮挡 */
export const extraInset = { right: 0 };

export function makeZoomable({ svg, world, stageEl, extent = [0.15, 6], inset = { top: 10, right: 10, bottom: 44, left: 10 }, onZoom }) {
  const d3 = window.d3;
  let transform = d3.zoomIdentity;
  const zoom = d3.zoom().scaleExtent(extent).on('zoom', (ev) => { transform = ev.transform; world.attr('transform', transform); if (onZoom) onZoom(transform); });
  svg.call(zoom).on('dblclick.zoom', null);
  const sel = (animate) => (animate && !prefersReduced() ? svg.transition().duration(300) : svg);
  function fitBounds(b, animate = true, maxK) {
    const r = stageEl.getBoundingClientRect();
    const aw = r.width - inset.left - inset.right - extraInset.right, ah = r.height - inset.top - inset.bottom;
    let k = Math.min(aw / b.w, ah / b.h);
    if (maxK) k = Math.min(k, maxK);
    const t = d3.zoomIdentity.translate(inset.left + (aw - b.w * k) / 2 - b.x0 * k, inset.top + (ah - b.h * k) / 2 - b.y0 * k).scale(k);
    sel(animate).call(zoom.transform, t);
    return k;
  }
  function centerOn(x, y, k, animate = true) {
    const r = stageEl.getBoundingClientRect();
    sel(animate).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - x * k, r.height / 2 - y * k).scale(k));
  }
  function zoomBy(f) { (prefersReduced() ? svg : svg.transition().duration(200)).call(zoom.scaleBy, f); }
  return { zoom, fitBounds, centerOn, zoomBy, getTransform: () => transform };
}

export function boundsOf(list, pad = 24) {
  const d3 = window.d3;
  const x0 = d3.min(list, (d) => d.x - d.w / 2) - pad, x1 = d3.max(list, (d) => d.x + d.w / 2) + pad;
  const y0 = d3.min(list, (d) => d.y - d.h / 2) - pad, y1 = d3.max(list, (d) => d.y + d.h / 2) + pad;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/* 右侧面板（浮层）打开后，如果选中的节点被它盖住，就把画布向左平移到能看见为止；不改缩放 */
export function panClearOfPanel({ svg, zoom, transform, stageEl, node, margin = 16 }) {
  const panel = document.getElementById('panel');
  if (!panel || !node) return false;
  const pr = panel.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
  if (!pr.width) return false;
  const panelLeft = pr.left - sr.left;
  const right = transform.x + (node.x + node.w / 2) * transform.k;
  const left = transform.x + (node.x - node.w / 2) * transform.k;
  const limit = panelLeft - margin;
  if (right <= limit) return false;
  const dx = Math.min(right - limit, Math.max(0, left - margin)); /* 至少让左缘不出画布 */
  if (dx <= 0) return false;
  (prefersReduced() ? svg : svg.transition().duration(250)).call(zoom.translateBy, -dx / transform.k, 0);
  return true;
}
