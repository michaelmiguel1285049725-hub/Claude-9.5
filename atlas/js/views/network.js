// 视角一：关系网，三层下钻。
// 第一层 研究线概览 → 第二层 研究线展开 → 第三层 关系透镜。任何时候只渲染当前这一层。
import { createOverview } from './net-overview.js';

const d3 = window.d3;

export function createNetworkView({ root, model, tooltip, actions, getDigested }) {
  const svg = d3.select(root).append('svg').attr('class', 'canvas net').attr('role', 'application').attr('aria-label', '关系网');
  const overview = createOverview({ svg, model, tooltip, actions, getDigested });
  const placeholder = d3.select(root).append('div').attr('class', 'net-placeholder').attr('hidden', true);

  let level = 'overview';
  let net = { level: 'overview' };

  function size() { return { W: svg.node().clientWidth || 800, H: svg.node().clientHeight || 600 }; }
  function show() {
    level = net.level || 'overview';
    overview.g.attr('display', level === 'overview' ? null : 'none');
    // 第二、三层在阶段 C 实现
    const pending = level !== 'overview';
    placeholder.attr('hidden', pending ? null : true)
      .html(pending ? `<p>「${model.clusterById.get(net.cluster)?.name ?? ''}」的研究线展开在阶段 C 实现。</p><button type="button" class="btn" data-back>返回全貌</button>` : '');
  }
  placeholder.on('click', ev => { if (ev.target.closest('[data-back]')) actions.goOverview(); });

  new ResizeObserver(() => overview.resize(size())).observe(svg.node());

  return {
    setVisibility(v) { overview.setVisibility(v); },
    setView() {},
    setNet(n) { net = n; show(); },
    refreshDigested() { overview.render(); },
    onShow() { overview.resize(size()); show(); },
    fitAll() {},
    zoomToNodes() {},
    ensureVisible() {},
    legend() { return level === 'overview' ? overview.legend() : {}; },
  };
}
