// 启动与编排：读取 ?pack= → 加载内容包 → 校验提示 → 建立全局状态 → 各模块订阅状态。
// 所有用户操作都走 actions，改的是全局状态；视角和面板只负责按状态重画。
import { loadPack } from './data.js';
import { summarizePack } from './validate.js';
import { createStore, globalStore } from './storage.js';
import { createState } from './state.js';
import { createNetworkView } from './views/network.js';
import { buildLegend } from './legend.js';
import { defineMarkers, relSampleSvg } from './glyph.js';
import { sanitizeFilters, computeVisibility, createFilterBar, relaxSuggestions } from './filters.js';
import { findPaths, connected } from './pathfinder.js';
import { createPanel } from './panel.js';
import { createSearch } from './search.js';
import { createTooltip } from './tooltip.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 深浅色：跟随系统 / 浅色 / 深色 ----------
const THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
function initTheme() {
  let t = globalStore.get('theme', 'auto');
  const apply = () => {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const label = (THEMES.find(x => x[0] === t) || THEMES[0])[1];
    $('#themeBtn').textContent = `配色：${label}`;
    $('#themeBtn').title = '点击切换：跟随系统 → 浅色 → 深色';
  };
  apply();
  $('#themeBtn').addEventListener('click', () => {
    t = THEMES[(THEMES.findIndex(x => x[0] === t) + 1) % THEMES.length][0];
    globalStore.set('theme', t);
    apply();
  });
}

function showIssues(issues, pack) {
  const bar = $('#issues');
  if (!issues.length) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<details><summary>数据校验发现 ${issues.length} 个问题（${esc(summarizePack(pack))}）· 能画的部分已照常显示</summary>
    <ul>${issues.map(i => `<li><b>${esc(i.where)}</b><span class="f">${esc(i.field)}</span>${esc(i.msg)}</li>`).join('')}</ul></details>`;
}

function fatal(msg) {
  $('#stage').innerHTML = `<div class="fatal"><h2>页面没能加载</h2><p>${esc(msg)}</p>
    <p class="hint">如果是在自己电脑上直接双击打开的：需要先在仓库目录运行 <code>python3 -m http.server</code>，再访问 <code>http://localhost:8000/atlas/</code>。</p></div>`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回旧办法 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function start() {
  initTheme();
  if (!window.d3) { fatal('D3 可视化库没有加载成功（需要联网访问 cdn.jsdelivr.net）。'); return; }

  const param = new URLSearchParams(location.search).get('pack');
  const packId = param && /^[a-z0-9][a-z0-9_-]*$/i.test(param) ? param : 'ai-bias';

  let model;
  try { model = await loadPack(packId); } catch (err) { fatal(err.message); return; }
  const store = createStore(packId);

  // ---------- 标题 ----------
  const d = model.domain;
  document.title = `${d.title || packId} · 学习地图`;
  $('#title').textContent = d.title || packId;
  $('#subtitle').textContent = d.subtitle || '';
  const meta = [d.version && `v${d.version}`, d.data_date].filter(Boolean).join(' · ');
  $('#ver').textContent = meta; $('#ver').hidden = !meta;
  if (d.status_note) {
    const chip = $('#draft');
    chip.hidden = false;
    chip.textContent = /草稿|draft/i.test(d.status_note + d.version) ? '草稿' : '说明';
    chip.title = d.status_note;
    chip.setAttribute('aria-label', d.status_note);
  }
  showIssues(model.issues, model.pack);
  defineMarkers(window.d3.select('#defs defs'));

  // ---------- 全局状态 ----------
  const digested = new Set((store.get('digested', []) || []).filter(id => model.nodeById.has(id)));
  const state = createState({
    view: 'network',
    sel: null,                 // { kind: 'node' | 'edge' | 'gap', id }
    depth: 1,
    filters: sanitizeFilters(store.get('filters'), model),
    path: { active: false, from: null, to: null, prefer: false, chosen: 0 },
    panelCollapsed: false,
    panelHidden: false,
  });
  let vis = computeVisibility(model, state.get().filters, digested);
  let pathRes = { paths: [] };

  const tooltip = createTooltip($('#stage'));
  // 一个空缺涉及的节点：它列出的节点 + 挂在它名下的线的两端
  const gapNodeIds = id => {
    const ids = new Set(model.gapById.get(id)?.nodes || []);
    for (const e of model.edges) if (e.gap === id) { ids.add(e.from); ids.add(e.to); }
    return [...ids];
  };

  // ---------- 操作 ----------
  const actions = {
    state: () => state.get(),
    clickNode(id) {
      const st = state.get();
      if (st.path.active) {
        const p = st.path;
        if (!p.from) actions.setPathEnd('from', id);
        else if (!p.to && id !== p.from) actions.setPathEnd('to', id);
        else state.set({ path: { ...p, from: id, to: null, chosen: 0 } });
        return;
      }
      if (st.sel?.kind === 'node' && st.sel.id === id) actions.clearSelection();   // 再点一次同一个节点：退出聚焦
      else actions.selectNode(id);
    },
    selectNode(id, { zoom = false } = {}) {
      state.set({ sel: { kind: 'node', id }, panelHidden: false, path: { ...state.get().path, active: false } });
      if (zoom) net.ensureVisible(id);
    },
    selectEdge(id, { zoom = false } = {}) {
      state.set({ sel: { kind: 'edge', id }, panelHidden: false, path: { ...state.get().path, active: false } });
      const e = model.edgeById.get(id);
      if (zoom && e) net.zoomToNodes([e.from, e.to]);
    },
    selectGap(id) {
      const st = state.get();
      if (st.sel?.kind === 'gap' && st.sel.id === id) { state.set({ sel: null }); return; }
      state.set({ sel: { kind: 'gap', id }, panelHidden: false, path: { ...st.path, active: false } });
      net.zoomToNodes(gapNodeIds(id));
    },
    clearSelection() {
      if (state.get().path.active) return;   // 找路径时点空白不退出
      if (state.get().sel) state.set({ sel: null });
    },
    closePanel() {
      state.set({ sel: null, panelHidden: true, path: { ...state.get().path, active: false } });
    },
    togglePanelCollapsed() { state.set({ panelCollapsed: !state.get().panelCollapsed }); },
    setDepth(depth) { state.set({ depth }); },
    startPath(from = null) {
      state.set({ sel: null, panelHidden: false, path: { ...state.get().path, active: true, from, to: null, chosen: 0 } });
    },
    exitPath() { state.set({ path: { ...state.get().path, active: false } }); },
    setPathEnd(which, id) {
      const p = { ...state.get().path, [which]: id, chosen: 0 };
      state.set({ path: p });
      if (p.from && p.to && pathRes.paths[0]) net.zoomToNodes(pathRes.paths[0].nodes);
    },
    swapPath() { const p = state.get().path; state.set({ path: { ...p, from: p.to, to: p.from, chosen: 0 } }); },
    setPreferSource(prefer) { state.set({ path: { ...state.get().path, prefer, chosen: 0 } }); },
    choosePath(i) {
      state.set({ path: { ...state.get().path, chosen: i } });
      if (pathRes.paths[i]) net.zoomToNodes(pathRes.paths[i].nodes);
    },
    setFilters(filters) { state.set({ filters, panelHidden: false }); },
    async copy(text, msg) { toast((await copyText(text)) ? msg : '复制失败，请手动选择文字复制'); },
  };

  // ---------- 模块 ----------
  const net = createNetworkView({
    root: $('#views'), model, store, fileLayout: model.layout, tooltip, actions,
    getDigested: () => digested,
  });
  const panel = createPanel($('#panel'), { model, actions });
  const filterBar = createFilterBar($('#filterbar'), { model, relSample: (t, s) => relSampleSvg(t, s, 24), onChange: f => actions.setFilters(f) });
  const search = createSearch($('#search'), $('#searchList'), { model, onPick: id => actions.selectNode(id, { zoom: true }) });
  buildLegend($('#legend'), model);
  if (innerWidth < 1500) $('#legend').open = false;   // 窄一点的屏幕上图例默认收起

  // ---------- 状态 → 画面 ----------
  function computePaths(st) {
    const p = st.path;
    if (!p.active || !p.from || !p.to || p.from === p.to) return { paths: [] };
    const bothVisible = vis.nodes.has(p.from) && vis.nodes.has(p.to);
    const paths = bothVisible ? findPaths(vis.visibleEdgeList, p.from, p.to, { preferSource: p.prefer }) : [];
    return paths.length ? { paths } : { paths, suggest: relaxSuggestions(model, st.filters, digested, p.from, p.to, connected) };
  }

  function updateSummary() {
    const el = $('#filterSummary');
    if (!vis.hiddenEdges && !vis.hiddenNodes) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `已隐藏 ${vis.hiddenEdges} 条线、${vis.hiddenNodes} 个节点 · <u>一键恢复</u>`;
  }

  function renderAll(st, prev) {
    if (!prev || st.filters !== prev.filters) {
      store.set('filters', st.filters);
      vis = computeVisibility(model, st.filters, digested);
      net.setVisibility(vis);
      filterBar.sync(st.filters);
      updateSummary();
    }
    pathRes = computePaths(st);
    const chosen = st.path.active ? pathRes.paths[st.path.chosen] || pathRes.paths[0] || null : null;
    net.setView({
      sel: st.path.active ? null : st.sel,
      depth: st.depth,
      path: chosen,
      gap: !st.path.active && st.sel?.kind === 'gap' ? st.sel.id : null,
      pathPick: st.path.active ? { from: st.path.from, to: st.path.to } : false,
    });
    const keepScroll = prev && prev.sel === st.sel && prev.path.active === st.path.active;
    panel.render(st, vis, { pathRes, keepScroll });
    $('#app').classList.toggle('panel-open', !!panel.mode() && !st.panelCollapsed);
    $('#pathBtn').setAttribute('aria-pressed', String(st.path.active));
    $('#focusBtn').disabled = !(st.sel || chosen);
  }
  state.subscribe(renderAll);
  renderAll(state.get(), null);

  // ---------- 按钮与快捷键 ----------
  $('#filterSummary').addEventListener('click', () => actions.setFilters(sanitizeFilters(null, model)));
  $('#fitBtn').addEventListener('click', () => net.fitAll());
  $('#focusBtn').addEventListener('click', () => {
    const st = state.get();
    if (st.path.active && pathRes.paths.length) return net.zoomToNodes((pathRes.paths[st.path.chosen] || pathRes.paths[0]).nodes);
    if (!st.sel) return;
    if (st.sel.kind === 'node') net.zoomToNodes([st.sel.id]);
    else if (st.sel.kind === 'edge') { const e = model.edgeById.get(st.sel.id); net.zoomToNodes([e.from, e.to]); }
    else if (st.sel.kind === 'gap') net.zoomToNodes(gapNodeIds(st.sel.id));
  });
  $('#pathBtn').addEventListener('click', () => (state.get().path.active ? actions.exitPath() : actions.startPath(state.get().sel?.kind === 'node' ? state.get().sel.id : null)));
  $('#resetLayoutBtn').addEventListener('click', () => {
    if (net.hasCustomLayout() && !confirm('重置后，你拖动过的节点会回到自动布局的位置。继续吗？')) return;
    net.resetLayout();
    toast('布局已重置');
  });
  $('#exportLayoutBtn').addEventListener('click', () => {
    download('layout.json', net.exportLayout());
    toast('已导出 layout.json，放进内容包目录即可固定布局');
  });
  $('#panelTab').addEventListener('click', () => actions.togglePanelCollapsed());

  document.addEventListener('keydown', ev => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if (ev.key === '/' && !typing) { ev.preventDefault(); search.focus(); return; }
    if (ev.key === 'Escape' && !typing) {
      const st = state.get();
      if (st.path.active) actions.exitPath();
      else if (st.sel) state.set({ sel: null });
    }
  });

  window.__atlas = { model, state, net, actions, vis: () => vis, paths: () => pathRes };   // 方便在控制台里检查
}

start();
