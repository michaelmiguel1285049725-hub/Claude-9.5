/* 启动：读 ?pack= → 加载内容包 → 校验 → 建索引 → 顶栏 / 抽屉 / 图例 / 三个视角 / 面板 / 路由。 */
import { loadPack, buildModel } from './data.js';
import * as enc from './encoding.js';
import * as storage from './storage.js';
import { get, set, subscribe } from './state.js';
import { createNetwork } from './views/network.js';
import { createMaturity } from './views/maturity.js';
import { createTimeline } from './views/timeline.js';
import { computeVisibility, restoreFilters } from './filters.js';
import { initDrawer, applyFilters } from './drawer.js';
import { initTopbar } from './topbar.js';
import { renderLegend } from './legend.js';
import { initPanel } from './panel.js';
import { initSearch } from './search.js';
import * as tooltip from './tooltip.js';
import * as progress from './progress.js';
import { initRouter } from './router.js';
import { buildPrompt } from './prompt.js';
import { defaultFilters } from './state.js';
import { extraInset } from './zoomable.js';

const $ = (id) => document.getElementById(id);
const esc = tooltip.esc;

function fatal(title, detail) {
  const div = document.createElement('div');
  div.id = 'fatal';
  div.innerHTML = `<div class="box"><h2></h2><pre></pre></div>`;
  div.querySelector('h2').textContent = title;
  div.querySelector('pre').textContent = detail || '';
  document.body.appendChild(div);
}

function packIdFromURL() {
  const p = new URLSearchParams(location.search).get('pack') || 'ai-bias';
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(p) ? p : null;
}

function renderHeader(model) {
  const d = model.domain;
  document.title = d.title ? `${d.title} · 领域学习地图` : '领域学习地图';
  $('title').textContent = d.title || '领域学习地图';
  /* 副标题和版本号放进标题的悬停提示 */
  const ver = [d.version ? `v${d.version}` : '', d.data_date || ''].filter(Boolean).join(' · ');
  $('brand').title = [d.subtitle, ver].filter(Boolean).join('\n');
  if (d.status_note) { const s = $('draft'); s.textContent = /草稿|draft/i.test(d.status_note) ? '草稿' : '说明'; s.title = d.status_note; s.hidden = false; }
}

function renderBanner(model) {
  const { errors, warnings } = model.validation;
  const dropped = model.dropped.length;
  const b = $('banner');
  if (!errors.length && !dropped) { b.hidden = true; return; }
  const li = (x) => `<li><code>${esc(x.where)}${x.field ? ' · ' + esc(x.field) : ''}</code>${esc(x.msg)}</li>`;
  b.innerHTML = `<summary>内容包有 ${errors.length} 处问题${dropped ? `，${dropped} 条关系无法绘制` : ''}（其余部分照常渲染）</summary><ul>${errors.map(li).join('')}</ul>`;
  b.hidden = false;
  if (warnings.length) console.info('内容包提示：', warnings);
}

function setupTheme() {
  const btn = $('theme');
  const apply = (t) => { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); };
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysDark = (() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } })();
    const next = cur ? null : (sysDark ? 'light' : 'dark');
    apply(next); storage.saveGlobal('theme', next);
    btn.title = next ? `当前：${next === 'dark' ? '深色' : '浅色'}（点击恢复跟随系统）` : '当前：跟随系统';
  });
}

function toast(msg) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
  }
}

async function boot() {
  if (!window.d3) { fatal('D3 未能加载', '请检查网络：需要从 cdn.jsdelivr.net 读取 d3@7.9.0。'); return; }
  const packId = packIdFromURL();
  if (!packId) { fatal('内容包编号不合法', '?pack= 只能包含小写字母、数字和连字符。'); return; }
  let loaded;
  try { loaded = await loadPack(packId); }
  catch (e) { fatal('内容包加载失败', e.message); return; }
  const model = buildModel(loaded.pack);
  storage.setPrefix(model.domain.pack_id || packId);
  progress.load();
  set({ filters: restoreFilters(model) });
  window.__atlas = { model };

  $('defs').innerHTML = enc.markerDefsHTML();
  tooltip.init();
  renderHeader(model);
  renderBanner(model);
  setupTheme();

  /* ---- 关系网 ---- */
  const network = createNetwork({
    svgEl: $('canvas'), stageEl: $('stage'), model,
    onNodeClick(id) {
      const s = get();
      if (s.panel !== 'path') return false;
      const q = s.pathQuery || { from: null, to: null, sourceFirst: false };
      if (!q.from || (q.from && q.to)) set({ pathQuery: { ...q, from: id, to: null }, path: null });
      else if (id !== q.from) set({ pathQuery: { ...q, to: id }, path: null });
      return true;
    },
  });
  window.__atlas.network = network;

  const actions = {
    nodeClick(id) {
      const s = get();
      if (s.panel === 'path') {
        const q = s.pathQuery || { from: null, to: null, sourceFirst: false };
        if (!q.from || (q.from && q.to)) set({ pathQuery: { ...q, from: id, to: null }, path: null });
        else if (id !== q.from) set({ pathQuery: { ...q, to: id }, path: null });
        return;
      }
      if (s.node === id && !s.edge && !s.path && !s.gap) set({ node: null, edge: null, panel: 'closed' });
      else set({ node: id, edge: null, path: null, gap: null, panel: 'node' });
    },
    edgeClick(id) { set({ edge: id, path: null, gap: null, panel: 'edge' }); },
    clearCanvas() { const s = get(); const panel = s.panel === 'path' ? 'path' : s.panel === 'gaps' ? 'gaps' : 'closed'; set({ node: null, edge: null, path: null, gap: null, panel }); },
    clear() { set({ node: null, edge: null, path: null, gap: null, panel: 'closed' }); },
    closePanel() { const s = get(); set({ node: null, edge: null, path: null, gap: null, panel: 'closed', pathQuery: s.panel === 'path' ? null : s.pathQuery }); },
    selectNode(id, { zoom = false } = {}) { if (!model.byId.has(id)) return; set({ node: id, edge: null, path: null, gap: null, panel: 'node' }); if (zoom) current().zoomToNode(id); },
    selectEdge(id, { zoom = false } = {}) { if (!model.edgeById.has(id)) return; set({ edge: id, path: null, gap: null, panel: 'edge' }); if (zoom) { const e = model.edgeById.get(id); current().fitNodes([e.from, e.to]); } },
    selectGap(id, { zoom = true } = {}) { if (!model.gapById.has(id)) return; set({ gap: id, node: null, edge: null, path: null, panel: 'gaps' }); if (zoom) current().fitNodes(network.gapNodeIds(id)); },
    openGaps() { const s = get(); if (s.panel === 'gaps') actions.closePanel(); else set({ panel: 'gaps', node: null, edge: null, path: null }); },
    openLens(id) { actions.selectNode(id, { zoom: true }); }, /* 阶段 C 改为进入关系透镜 */
    back() { current().backToSelection(); },
    async copy(text) { toast((await copyText(text)) ? `已复制 ${text}` : '复制失败，请手动选择'); },
    async copyPrompt(id) { const t = buildPrompt(model, id); toast((await copyText(t)) ? '已复制讲解请求，去粘贴给 Claude' : '复制失败'); },
    toggleDigested(id) { const now = progress.toggle(id); set({ progressTick: get().progressTick + 1 }); toast(now ? `已标记 ${id} 为已消化` : `已取消 ${id} 的已消化标记`); },
    toast,
    pathFrom(id) { const q = get().pathQuery || {}; set({ pathQuery: { from: id, to: null, sourceFirst: !!q.sourceFirst }, path: null, node: null, edge: null, gap: null, panel: 'path' }); },
    showPath(p) { set({ path: { nodes: p.nodes, edges: p.edges, steps: p.steps }, node: null, edge: null, gap: null }); current().fitNodes(p.nodes); },
  };
  window.__atlas.actions = actions;

  /* ---- 三个视角 ---- */
  const maturity = createMaturity({ svgEl: $('maturity'), stageEl: $('stage'), model, actions, toolsEl: $('viewTools') });
  const timeline = createTimeline({ svgEl: $('timeline'), stageEl: $('stage'), model, actions, toolsEl: $('viewTools') });
  const views = { network, maturity, timeline };
  window.__atlas.views = views;
  const HINTS = {
    network: '拖动平移 · 滚轮缩放 · 悬停看关系 · 点节点看详情 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角 · <kbd>/</kbd> 搜索 · <kbd>Esc</kbd> 返回',
    maturity: '横轴证据等级 · 纵轴拥挤度 · 点节点看跨格关系 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角 · <kbd>Esc</kbd> 返回',
    timeline: '横轴年份（分段压缩） · 每条研究线一条泳道 · 悬停年份看当年节点 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角',
  };
  const svgOf = { network: $('canvas'), maturity: $('maturity'), timeline: $('timeline') };
  function current() { return views[get().view] || network; }
  function showView(name, { keepSelection = true } = {}) {
    if (!views[name]) name = 'network';
    for (const [k, v] of Object.entries(views)) if (k !== name && k !== 'network') v.hide();
    if (name !== 'network') $('canvas').setAttribute('hidden', ''); else $('canvas').removeAttribute('hidden');
    $('viewTools').hidden = name === 'network';
    $('simpleToggle').hidden = name !== 'network';
    topbar.setHint(HINTS[name]);
    document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    if (name !== 'network') views[name].show(); else { network.fitAll(false); network.applyState(); }
    const s = get();
    if (keepSelection) setTimeout(() => { if (s.path) current().fitNodes(s.path.nodes); else if (s.gap) current().fitNodes(network.gapNodeIds(s.gap)); else if (s.edge) { const e = model.edgeById.get(s.edge); if (e) current().fitNodes([e.from, e.to]); } else if (s.node) current().zoomToNode(s.node); }, 30);
    refreshLegend();
  }
  document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => set({ view: b.dataset.view })));
  subscribe((s, patch) => { if ('view' in patch) showView(s.view); });

  /* ---- 顶栏、抽屉、图例 ---- */
  const drawer = initDrawer({
    el: $('drawer'), model,
    onPathMode() {
      const s = get();
      if (s.panel === 'path') set({ panel: 'closed', path: null });
      else set({ panel: 'path', node: null, edge: null, gap: null, path: null, pathQuery: get().pathQuery || { from: null, to: null, sourceFirst: false } });
      topbar.close();
    },
  });
  const topbar = initTopbar({
    model,
    onOpen(name) { if (name === 'legendPop') { refreshLegend(); extraInset.right = 340; current().fitAll(true); } if (name === 'drawer') drawer.refresh(); },
    onClose(name) { if (name === 'legendPop') { extraInset.right = 0; current().fitAll(true); } },
  });
  window.__atlas.topbar = topbar;
  function refreshLegend() { if (topbar.isOpen() === 'legendPop') renderLegend($('legendBody'), model, svgOf[get().view] || $('canvas')); }
  $('gapsBtn').addEventListener('click', () => actions.openGaps());

  /* ---- 面板（覆盖式） / 搜索 ---- */
  initPanel({ el: $('panelBody'), model, actions });
  initSearch($('search'), model, (id) => actions.openLens(id));
  function syncPanel() {
    const s = get();
    const open = s.panel !== 'closed';
    const p = $('panel');
    if (open) { p.hidden = false; requestAnimationFrame(() => p.classList.add('open')); }
    else { p.classList.remove('open'); setTimeout(() => { if (get().panel === 'closed') p.hidden = true; }, 220); }
    $('gapsBtn').setAttribute('aria-pressed', String(s.panel === 'gaps'));
  }
  syncPanel();

  /* ---- 画布左上角的筛选摘要 ---- */
  function renderSummary() {
    const s = get();
    const v = computeVisibility(model, s.filters);
    const el = $('summary');
    if (!v.hiddenEdges && !v.hiddenNodes) { el.hidden = true; return; }
    el.innerHTML = `已隐藏 ${v.hiddenEdges} 条关系、${v.hiddenNodes} 个节点 · <button type="button" id="restoreFilters">恢复全部</button>`;
    el.hidden = false;
    $('restoreFilters').addEventListener('click', () => { const d = defaultFilters(model); d.showAllEdges = get().filters.showAllEdges; applyFilters(d); });
  }
  renderSummary();

  $('fit').addEventListener('click', () => current().fitAll(true));
  $('back').addEventListener('click', () => current().backToSelection());
  const updateBack = () => { const s = get(); $('back').disabled = !(s.node || s.edge || s.path || s.gap); };
  updateBack();

  subscribe((s, patch) => {
    if ('filters' in patch) { drawer.refresh(); renderSummary(); }
    if ('progressTick' in patch) renderSummary();
    if ('panel' in patch) { drawer.refresh(); syncPanel(); }
    if (['node', 'edge', 'path', 'gap'].some((k) => k in patch)) updateBack();
    if (['filters', 'node', 'edge', 'gap', 'path', 'hoverNode', 'progressTick'].some((k) => k in patch)) refreshLegend();
  });
  window.addEventListener('resize', () => current().fitAll(false));

  /* ---- 键盘 ---- */
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { tooltip.hide(); if (topbar.close()) return; actions.closePanel(); }
    else if (e.key === '/') { e.preventDefault(); $('search').focus(); }
    else if (e.key === '+' || e.key === '=') current().zoomBy(1.25);
    else if (e.key === '-') current().zoomBy(0.8);
    else if (e.key === '0' || e.key === 'f') current().fitAll(true);
    else if (e.key === '1') set({ view: 'network' });
    else if (e.key === '2') set({ view: 'maturity' });
    else if (e.key === '3') set({ view: 'timeline' });
  });
  /* 面板关闭按钮由 panel.js 通过 actions.clear 触发；点画布空白处也会关闭 */

  /* ---- URL hash：恢复与后退 ---- */
  const router = initRouter({ model });
  router.applyCurrent();
  showView(get().view, { keepSelection: true });
}

boot();
