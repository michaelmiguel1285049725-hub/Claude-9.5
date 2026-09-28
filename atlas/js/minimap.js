/* 小地图：画布一角，标出当前视口位置，点击跳转。 */
export function createMinimap({ container, network, model }) {
  const d3 = window.d3;
  const W = 170, H = 110;
  const svg = d3.select(container).append('svg').attr('class', 'minimap').attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);
  const gDots = svg.append('g');
  const view = svg.append('rect').attr('class', 'mm-view');
  const hit = svg.append('rect').attr('class', 'mm-hit').attr('width', W).attr('height', H);
  let b = null, s = 1, ox = 0, oy = 0;
  function scale() {
    b = network.worldBounds();
    s = Math.min((W - 8) / b.w, (H - 8) / b.h);
    ox = (W - b.w * s) / 2 - b.x0 * s; oy = (H - b.h * s) / 2 - b.y0 * s;
  }
  function drawDots() {
    scale();
    const vis = network.visibility();
    const sel = gDots.selectAll('rect').data(network.nodes, (d) => d.id);
    sel.enter().append('rect').merge(sel)
      .attr('x', (d) => ox + (d.x - d.w / 2) * s).attr('y', (d) => oy + (d.y - d.h / 2) * s)
      .attr('width', (d) => d.w * s).attr('height', (d) => d.h * s)
      .style('fill', (d) => model.clusterById.get(d.ref._cluster)?._color || 'var(--muted)')
      .style('opacity', (d) => (vis.nodeVis.has(d.id) ? 0.9 : 0.15));
    sel.exit().remove();
  }
  function drawView(t) {
    const st = network.stageSize();
    const x0 = (0 - t.x) / t.k, y0 = (0 - t.y) / t.k, x1 = (st.w - t.x) / t.k, y1 = (st.h - t.y) / t.k;
    view.attr('x', ox + x0 * s).attr('y', oy + y0 * s).attr('width', (x1 - x0) * s).attr('height', (y1 - y0) * s);
  }
  hit.on('click', (ev) => {
    const [mx, my] = d3.pointer(ev);
    network.centerAt((mx - ox) / s, (my - oy) / s);
  });
  drawDots(); drawView(network.getTransform());
  network.onTransform((t) => { drawDots(); drawView(t); });
  return { refresh() { drawDots(); drawView(network.getTransform()); } };
}
