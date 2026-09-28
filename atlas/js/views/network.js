// 视角一：关系网，三层下钻。
// 第一层 研究线概览 → 第二层 研究线展开 → 第三层 关系透镜。任何时候只渲染当前这一层。
import { createOverview } from './net-overview.js';
import { createClusterView } from './net-cluster.js';
import { createLensView } from './net-lens.js';
import { createPathView } from './net-path.js';

const d3 = window.d3;

export function createNetworkView({ root, model, store, tooltip, actions, getDigested, toolsEl }) {
  const svg = d3.select(root).append('svg').attr('class', 'canvas net').attr('role', 'application').attr('aria-label', '关系网');
  const common = { svg, model, store, tooltip, actions, getDigested };
  const overview = createOverview(common);
  const cluster = createClusterView(common);
  const lens = createLensView(common);
  const pathv = createPathView({ ...common, root });

  let net = { level: 'overview', cluster: null, trail: [], pos: -1 };
  let size = { W: 800, H: 600 };
  const measure = () => ({ W: svg.node().clientWidth || 800, H: svg.node().clientHeight || 600 });

  function show(prev) {
    const level = pathv.active() ? 'path' : net.level;
    tooltip.hide();
    overview.g.attr('display', level === 'overview' ? null : 'none');
    if (level === 'cluster') {
      // 从概览点进来：从那个气泡的位置展开
      const from = prev && prev.level === 'overview' ? overview.bubbleOf(net.cluster) : null;
      cluster.show(net.cluster, { from });
      toolsEl.hidden = false;
      cluster.tools(toolsEl);
    } else {
      cluster.hide();
      toolsEl.hidden = true;
      toolsEl.innerHTML = '';
    }
    if (level === 'lens') lens.show(net.trail[net.pos]); else lens.hide();
    svg.attr('data-level', level);
  }

  new ResizeObserver(() => {
    size = measure();
    overview.resize(size); cluster.resize(size); lens.resize(size); pathv.resize(size);
  }).observe(svg.node());

  const current = () => (pathv.active() ? pathv : net.level === 'overview' ? overview : net.level === 'cluster' ? cluster : lens);

  return {
    setVisibility(v) { overview.setVisibility(v); cluster.setVisibility(v); lens.setVisibility(v); },
    setView(v) { lens.setGap(v.gap); },
    setPath(p, res) {
      const was = pathv.active();
      pathv.set(p, res);
      if (was !== pathv.active()) show(null);
      actions.legendDirty();
    },
    focusPathInput: () => pathv.focusInput(),
    setPanelInset(px) { lens.setInset(px); },
    pathSummary: () => pathv.summary(),
    setNet(n, prev) { net = n; show(prev); actions.legendDirty(); },
    refreshDigested() { overview.render(); cluster.render(); lens.render(); },
    onShow() { size = measure(); overview.resize(size); cluster.resize(size); lens.resize(size); pathv.resize(size); show(null); },
    onHide() { toolsEl.hidden = true; },
    fitAll() {},
    zoomToNodes() {},
    ensureVisible() {},
    legend() { return current().legend(); },
    lensSnapshot: () => lens.snapshot(),
  };
}
