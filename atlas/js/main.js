/* 启动：读 ?pack= → 加载内容包 → 校验 → 建索引 → 渲染头部 / 筛选栏 / 图例 / 关系网 / 面板。 */
import { loadPack, buildModel } from './data.js';
import * as enc from './encoding.js';
import * as storage from './storage.js';
import { get, set, subscribe } from './state.js';
import { createNetwork } from './views/network.js';
import { createMaturity } from './views/maturity.js';
import { createTimeline } from './views/timeline.js';
import { buildFilterBar, computeVisibility, restoreFilters } from './filters.js';
import { initPanel } from './panel.js';
import { initSearch } from './search.js';
import { createMinimap } from './minimap.js';
import * as tooltip from './tooltip.js';
import * as progress from './progress.js';
import { initRouter } from './router.js';
import { buildPrompt } from './prompt.js';

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
  $('subtitle').textContent = d.subtitle || '';
  const ver = [d.version ? `v${d.version}` : '', d.data_date || ''].filter(Boolean).join(' · ');
  if (ver) { $('ver').textContent = ver; $('ver').hidden = false; }
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

function swLine(rel) {
  const c = `var(--rel-${rel.key})`;
  const start = rel.both ? ` marker-start="url(#mk-${rel.key}-start)"` : '';
  return `<svg class="sw" style="--c:${c}" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M4 8 L40 8" stroke-width="${rel.width}" marker-end="url(#mk-${rel.key})"${start}/></svg>`;
}
function swDash(dash) {
  return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
}
function swProc() {
  return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"/><circle class="proc" cx="22" cy="8" r="4"/></svg>`;
}

function renderLegend(model) {
  const parts = [];
  parts.push(`<section><h4>关系类型 · 颜色（箭头 A → B）</h4><ul>${enc.REL.map((r) => `<li title="${esc(r.desc)}">${swLine(r)}<span>${r.zh}</span><span class="ex">${esc(r.desc)}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>状态 · 线型</h4><ul>${enc.STATUS_ORDER.map((s) => `<li title="${esc(enc.STATUS[s].rule)}">${swDash(enc.STATUS[s].dash)}<span>${s}</span><span class="ex">${esc(enc.STATUS[s].rule)}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>依据</h4><ul><li>${swDash(null)}<span>来源</span><span class="ex">文献结论</span></li><li>${swProc()}<span>加工</span><span class="ex">Claude 的推断或连接（中点空心圆）</span></li></ul></section>`);
  parts.push(`<section><h4>节点形状 · 类型</h4><ul>
    <li><span class="shape" style="border-radius:3px"></span>理论</li>
    <li><span class="shape" style="border-radius:8px"></span>现象</li>
    <li><span class="shape" style="border-radius:999px"></span>方法</li>
    <li><span class="shape bar" style="border-radius:6px"></span>发现<span class="ex">左侧粗色条</span></li>
    <li><span class="shape" style="border-radius:6px;border-style:dashed"></span>概念<span class="ex">虚线边框</span></li>
  </ul></section>`);
  parts.push(`<section><h4>填充 · 人类侧 / AI 侧</h4><ul><li><span class="shape" style="border-radius:6px"></span>人类侧</li><li><span class="shape ai" style="border-radius:6px"></span>AI 相关</li></ul></section>`);
  parts.push(`<section><h4>研究线 · 左上角色点</h4><ul>${model.clusters.map((c) => `<li title="${esc(c.desc || '')}"><span class="dot" style="--c:${c._color}"></span><span${c.main ? ' style="font-weight:600"' : ''}>${esc(c.name)}</span><span class="ex">${(model.nodesByCluster.get(c.id) || []).length} 个${c.main ? ' · 主线' : ''}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>近距离细节（放大后显示）</h4><ul>
    ${['A', 'B', 'C', 'N/A'].map((g) => `<li><span class="pill${g === 'N/A' ? ' na' : ''}" style="--c:${enc.EVIDENCE[g].color}">${g}</span>证据 ${g}<span class="ex">${esc(enc.EVIDENCE[g].desc)}</span></li>`).join('')}
    ${enc.CROWDING_ORDER.map((k) => `<li><span class="crowd">${'<i></i>'.repeat(enc.CROWDING[k].n)}</span>${k}<span class="ex">${esc(enc.CROWDING[k].desc)}</span></li>`).join('')}
    <li><span class="mk">?</span>未核验<span class="ex">${esc(enc.UNVERIFIED_TEXT)}</span></li>
    <li><span class="mk alert">!</span>重要警示</li>
    <li><span class="mk done">✓</span>已消化</li>
  </ul></section>`);
  parts.push(`<p class="note">节点位置只表示所属研究线和相邻关系，不表示重要性。簇背景淡色 = 研究线。缩小到 60% 以下进入簇视图，放大到 140% 以上显示细节。</p>`);
  $('legendBody').innerHTML = parts.join('');
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

function downloadJSON(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
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
  window.__atlas = { model, layout: loaded.layout };

  $('defs').innerHTML = enc.markerDefsHTML();
  tooltip.init();
  renderHeader(model);
  renderBanner(model);
  renderLegend(model);
  setupTheme();

  /* ---- 关系网 ---- */
  const network = createNetwork({
    svgEl: $('canvas'), stageEl: $('stage'), model, layout: loaded.layout,
    /* 路径模式下点节点 = 填起点 / 终点 */
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
    /* 画布上的点击（三视角共用）：路径模式下填起终点，否则切换选中 */
    nodeClick(id) {
      const s = get();
      if (s.panel === 'path') {
        const q = s.pathQuery || { from: null, to: null, sourceFirst: false };
        if (!q.from || (q.from && q.to)) set({ pathQuery: { ...q, from: id, to: null }, path: null });
        else if (id !== q.from) set({ pathQuery: { ...q, to: id }, path: null });
        return;
      }
      if (s.node === id && !s.edge && !s.path && !s.gap) set({ node: null, edge: null, panel: s.filters.gapsOnly ? 'gaps' : 'closed' });
      else set({ node: id, edge: null, path: null, gap: null, panel: 'node' });
    },
    edgeClick(id) { set({ edge: id, path: null, gap: null, panel: 'edge' }); },
    clearCanvas() { const s = get(); const panel = s.panel === 'path' ? 'path' : s.filters.gapsOnly ? 'gaps' : 'closed'; set({ node: null, edge: null, path: null, gap: null, panel }); },
    clear() { set({ node: null, edge: null, path: null, gap: null, panel: get().filters.gapsOnly ? 'gaps' : 'closed' }); },
    selectNode(id, { zoom = false } = {}) { if (!model.byId.has(id)) return; set({ node: id, edge: null, path: null, gap: null, panel: 'node' }); if (zoom) current().zoomToNode(id); },
    selectEdge(id, { zoom = false } = {}) { if (!model.edgeById.has(id)) return; set({ edge: id, path: null, gap: null, panel: 'edge' }); if (zoom) { const e = model.edgeById.get(id); current().fitNodes([e.from, e.to]); } },
    selectGap(id, { zoom = true } = {}) { if (!model.gapById.has(id)) return; set({ gap: id, node: null, edge: null, path: null, panel: 'gaps' }); if (zoom) current().fitNodes(network.gapNodeIds(id)); },
    back() { current().backToSelection(); },
    async copy(text) { toast((await copyText(text)) ? `已复制 ${text}` : '复制失败，请手动选择'); },
    async copyPrompt(id) { const t = buildPrompt(model, id); toast((await copyText(t)) ? '已复制讲解请求，去粘贴给 Claude' : '复制失败'); },
    toggleDigested(id) { const now = progress.toggle(id); set({ progressTick: get().progressTick + 1 }); toast(now ? `已标记 ${id} 为已消化` : `已取消 ${id} 的已消化标记`); renderProgress(); },
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
    network: '拖动平移 · 滚轮缩放 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角 · <kbd>/</kbd> 搜索 · <kbd>Esc</kbd> 取消',
    maturity: '横轴证据等级 · 纵轴拥挤度 · 点节点看跨格关系 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角',
    timeline: '横轴年份（分段压缩） · 每条研究线一条泳道 · 悬停年份看当年节点 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 切换视角',
  };
  function current() { return views[get().view] || network; }
  function showView(name, { keepSelection = true } = {}) {
    if (!views[name]) name = 'network';
    for (const [k, v] of Object.entries(views)) if (k !== name && k !== 'network') v.hide();
    if (name !== 'network') $('canvas').setAttribute('hidden', ''); else $('canvas').removeAttribute('hidden');
    $('minimap').hidden = name !== 'network';
    $('viewTools').hidden = name === 'network';
    $('hint').innerHTML = HINTS[name];
    document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    if (name !== 'network') views[name].show(); else { network.fitAll(false); network.applyState(); }
    const s = get();
    if (keepSelection) setTimeout(() => { if (s.path) current().fitNodes(s.path.nodes); else if (s.gap) current().fitNodes(network.gapNodeIds(s.gap)); else if (s.edge) { const e = model.edgeById.get(s.edge); if (e) current().fitNodes([e.from, e.to]); } else if (s.node) current().zoomToNode(s.node); }, 30);
  }
  document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => set({ view: b.dataset.view })));
  subscribe((s, patch) => { if ('view' in patch) showView(s.view); });

  /* ---- 筛选栏 ---- */
  const filterBar = buildFilterBar($('filters'), model, {
    onPathMode() {
      const s = get();
      if (s.panel === 'path') set({ panel: s.filters.gapsOnly ? 'gaps' : 'closed', path: null });
      else set({ panel: 'path', node: null, edge: null, gap: null, path: null, pathQuery: get().pathQuery || { from: null, to: null, sourceFirst: false } });
    },
    onResetLayout() { network.resetLayout(); toast('已恢复自动布局'); },
    onExportLayout() { downloadJSON('layout.json', network.exportLayout()); toast('已下载 layout.json'); },
  });

  /* ---- 面板 / 搜索 / 小地图 ---- */
  initPanel({ el: $('panelBody'), model, actions });
  initSearch($('search'), model, (id) => actions.selectNode(id, { zoom: true }));
  createMinimap({ container: $('minimap'), network, model });

  /* ---- 学习进度条 ---- */
  function renderProgress() {
    const el = $('progress');
    const total = model.nodes.length, done = model.nodes.filter((n) => progress.has(n.id)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.innerHTML = `<div class="pg-total"><span class="pg-label">已消化</span><span class="pg-bar"><i style="width:${pct}%"></i></span><span class="pg-num">${done} / ${total}</span></div>` +
      `<div class="pg-clusters">${model.clusters.map((c) => { const pr = progress.clusterProgress(model, c.id); const p2 = pr.total ? Math.round((pr.done / pr.total) * 100) : 0; return `<span class="pg-c" title="${esc(c.name)}：已消化 ${pr.done} / ${pr.total}"><i class="dot" style="--c:${c._color}"></i>${esc(c.name)} <b>${pr.done}/${pr.total}</b><span class="pg-mini"><i style="width:${p2}%;background:${c._color}"></i></span></span>`; }).join('')}</div>`;
  }
  renderProgress();
  window.__atlas.renderProgress = renderProgress;

  /* ---- 面板收起 / 展开 ---- */
  const panelToggle = $('panelToggle');
  function setPanelOpen(open) {
    $('main').classList.toggle('panel-closed', !open);
    panelToggle.setAttribute('aria-pressed', String(!open));
    panelToggle.title = open ? '收起右侧面板' : '展开右侧面板';
    storage.saveGlobal('panelOpen', open);
    setTimeout(() => current().fitAll(false), 20);
  }
  panelToggle.addEventListener('click', () => setPanelOpen($('main').classList.contains('panel-closed')));
  if (storage.loadGlobal('panelOpen', true) === false) setPanelOpen(false);

  /* ---- 画布上方的筛选摘要 ---- */
  function renderSummary() {
    const s = get();
    const v = computeVisibility(model, s.filters);
    const el = $('summary');
    if (!v.hiddenEdges && !v.hiddenNodes) { el.hidden = true; return; }
    el.innerHTML = `已隐藏 ${v.hiddenEdges} 条线、${v.hiddenNodes} 个节点 <button type="button" id="restoreFilters">恢复</button>`;
    el.hidden = false;
    $('restoreFilters').addEventListener('click', () => { $('filters').querySelector('.fgroup.actions button').click(); });
  }
  renderSummary();

  $('fit').addEventListener('click', () => current().fitAll(true));
  $('back').addEventListener('click', () => current().backToSelection());
  const updateBack = () => { const s = get(); $('back').disabled = !(s.node || s.edge || s.path || s.gap); };
  updateBack();

  subscribe((s, patch) => {
    if ('filters' in patch) { filterBar.refresh(); renderSummary(); }
    if ('progressTick' in patch) { renderSummary(); renderProgress(); }
    /* 选中节点时若面板收起，自动展开 */
    if (('node' in patch || 'edge' in patch || 'gap' in patch || 'path' in patch) && (s.node || s.edge || s.gap || s.path) && $('main').classList.contains('panel-closed')) setPanelOpen(true);
    if ('panel' in patch) filterBar.refresh();
    if (['node', 'edge', 'path', 'gap'].some((k) => k in patch)) updateBack();
  });
  window.addEventListener('resize', () => current().fitAll(false));

  /* ---- 键盘 ---- */
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { tooltip.hide(); actions.clear(); }
    else if (e.key === '/') { e.preventDefault(); $('search').focus(); }
    else if (e.key === '+' || e.key === '=') current().zoomBy(1.25);
    else if (e.key === '-') current().zoomBy(0.8);
    else if (e.key === '0' || e.key === 'f') current().fitAll(true);
    else if (e.key === '1') set({ view: 'network' });
    else if (e.key === '2') set({ view: 'maturity' });
    else if (e.key === '3') set({ view: 'timeline' });
  });
  /* ---- URL hash：恢复与后退 ---- */
  const router = initRouter({ model });
  router.applyCurrent();
  showView(get().view, { keepSelection: true });
}

boot();
