// 启动与编排：读取 ?pack= → 加载内容包 → 校验提示 → 建立全局状态 → 各模块订阅状态。
// 所有用户操作都走 actions，改的是全局状态；视角、面板、抽屉只负责按状态重画。
import { loadPack } from './data.js';
import { summarizePack } from './validate.js';
import { createStore, globalStore } from './storage.js';
import { createState } from './state.js';
import { createNetworkView } from './views/network.js';
import { createMaturityView } from './views/maturity.js';
import { createTimelineView } from './views/timeline.js';
import { renderLegend } from './legend.js';
import { defineMarkers, relSampleSvg } from './glyph.js';
import { sanitizeFilters, computeVisibility, createFilterBar, relaxSuggestions, activeCount } from './filters.js';
import { findPaths, connected } from './pathfinder.js';
import { createPanel } from './panel.js';
import { createSearch } from './search.js';
import { createTooltip } from './tooltip.js';
import { renderTrail, routeText } from './trail.js';
import { REL_TYPES } from './encoding.js';
import { encodeHash, decodeHash, isStep } from './hash.js';

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
    $('#themeBtn').title = `深浅色：${label}（点击切换）`;
    $('#themeBtn').setAttribute('aria-label', `深浅色：${label}`);
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
    <p class="hint">如果是在自己电脑上直接双击打开的：需要先在仓库目录运行 <code>python3 -m http.server</code>，再访问 <code>http://localhost:8000/atlas-b/</code>。</p></div>`;
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

async function start() {
  initTheme();
  if (!window.d3) { fatal('D3 可视化库没有加载成功（需要联网访问 cdn.jsdelivr.net）。'); return; }

  const param = new URLSearchParams(location.search).get('pack');
  const packId = param && /^[a-z0-9][a-z0-9_-]*$/i.test(param) ? param : 'ai-bias';

  let model;
  try { model = await loadPack(packId); } catch (err) { fatal(err.message); return; }
  const store = createStore(packId);

  // ---------- 标题：副标题和版本放进悬停提示 ----------
  const d = model.domain;
  document.title = `${d.title || packId} · 学习地图`;
  $('#title').textContent = d.title || packId;
  $('#brand').title = [d.subtitle, [d.version && `v${d.version}`, d.data_date].filter(Boolean).join(' · '), d.status_note].filter(Boolean).join('\n');
  if (d.status_note) {
    const chip = $('#draft');
    chip.hidden = false;
    chip.textContent = /草稿|draft/i.test(d.status_note + d.version) ? '草稿' : '说明';
  }
  showIssues(model.issues, model.pack);
  defineMarkers(window.d3.select('#defs defs'));

  // ---------- 全局状态 ----------
  const digested = new Set((store.get('digested', []) || []).filter(id => model.nodeById.has(id)));
  const VIEWS = ['network', 'maturity', 'timeline'];
  const state = createState({
    view: 'network',
    net: { level: 'overview', cluster: null, trail: [], pos: -1 },   // 关系网：层级、研究线、透镜走过的节点
    sel: null,                 // { kind: 'node' | 'edge' | 'gap', id }
    depth: 1,
    filters: sanitizeFilters(store.get('filters'), model),
    path: { active: false, from: null, to: null, prefer: false },
    gapSel: null,              // 空缺列表里展开的那一个（关系网里把它的关系加粗）
    panel: null,               // 右侧抽屉：'detail' | 'gaps' | null（找路径时另算）
    notionEdit: false,
    drawer: null,              // 'filter' | 'legend' | null
  });
  const notion = store.get('notion', {}) || {};
  let vis = computeVisibility(model, state.get().filters, digested);
  let pathRes = { paths: [] };

  const tooltip = createTooltip($('#stage'));
  // 一个空缺涉及的节点：它列出的节点 + 挂在它名下的线的两端
  const gapNodeIds = id => {
    const ids = new Set(model.gapById.get(id)?.nodes || []);
    for (const e of model.edges) if (e.gap === id) { ids.add(e.from); ids.add(e.to); }
    return [...ids];
  };

  // 在关系透镜里，中心节点始终算作选中（切到其他视角时它保持选中）
  const lensSel = st => (st.view === 'network' && st.net.level === 'lens' ? { kind: 'node', id: st.net.trail[st.net.pos] } : null);

  // 复制给 Claude 的提问
  function promptFor(id) {
    const n = model.nodeById.get(id), c = model.clusterById.get(n.cluster);
    // 先"指向它的"、再"它指向的"，各自按关系类型的固定顺序
    const order = e => (e.from === id ? 100 : 0) + REL_TYPES.indexOf(e.type);
    const lines = [...(model.edgesByNode.get(id) || [])].sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : 1)).map(e => {
      const out = e.from === id, o = model.nodeById.get(out ? e.to : e.from);
      return `${out ? '→' : '←'} ${e.type} ${out ? '→' : '←'} ${o.id} ${o.name}（${e.status}，${e.basis}）`;
    });
    return `请讲解节点 ${n.id}「${n.name}」（${n.name_en || ''}）。
按这个顺序：它为什么必须是这样 → 机制 → 连到我自己的经历。
请标出哪些内容来自文献、哪些是你的加工。
它在地图上的位置：研究线「${c ? c.name : n.cluster}」，证据 ${n.evidence}，拥挤度 ${n.crowding}。
它的关系：
${lines.length ? lines.join('\n') : '（目前没有记录任何关系）'}`;
  }

  // ---------- 操作 ----------
  const actions = {
    state: () => state.get(),
    // 成熟度、时间线里点节点
    clickNode(id) {
      const st = state.get();
      if (st.sel?.kind === 'node' && st.sel.id === id) actions.clearSelection();   // 再点一次同一个节点：退出聚焦
      else actions.selectNode(id);
    },
    selectNode(id, { zoom = false, detail = true } = {}) {
      state.set({ sel: { kind: 'node', id }, panel: detail ? 'detail' : state.get().panel, notionEdit: false, path: { ...state.get().path, active: false } });
      if (zoom) cur().ensureVisible(id);
    },
    selectEdge(id, { zoom = false } = {}) {
      state.set({ sel: { kind: 'edge', id }, panel: 'detail', path: { ...state.get().path, active: false } });
      const e = model.edgeById.get(id);
      if (zoom && e) cur().zoomToNodes([e.from, e.to]);
    },
    // 点一个空缺：关系网里进入它第一个节点的透镜并加粗它的关系；另外两个视角里高亮并缩放过去
    selectGap(id, { zoom = true } = {}) {
      const st = state.get();
      if (st.gapSel === id && st.panel === 'gaps') { state.set({ gapSel: null }); return; }
      const g = model.gapById.get(id); if (!g) return;
      state.set({ gapSel: id, panel: 'gaps', path: { ...st.path, active: false } });
      if (st.view === 'network') {
        const first = (g.nodes || []).find(n => model.nodeById.has(n));
        if (first && !(st.net.level === 'lens' && (g.nodes || []).includes(st.net.trail[st.net.pos]))) actions.openLens(first, { from: 'other', keepPanel: true });
      } else if (zoom) cur().zoomToNodes(gapNodeIds(id));
    },
    // 面板里点一个节点：关系网里切换透镜中心，其他视角里选中它
    focusNode(id) {
      if (state.get().view === 'network') actions.openLens(id, { from: 'other' });
      else actions.selectNode(id, { zoom: true, detail: true });
    },
    clearSelection() {
      const st = state.get();
      if (st.path.active) return;   // 找路径时点空白不退出
      if (st.sel) state.set({ sel: lensSel(st), panel: null });
    },
    // 关抽屉：透镜里保留中心节点的选中，其他视角清除选中
    closePanel() { const st = state.get(); state.set({ sel: lensSel(st), panel: null, gapSel: null }); },
    setDepth(depth) { state.set({ depth }); },
    // 找路径：结果画在关系网画布上
    startPath(from = null) {
      state.set({ view: 'network', panel: null, path: { ...state.get().path, active: true, from, to: null } });
      requestAnimationFrame(() => views.network.focusPathInput());
    },
    exitPath() { state.set({ path: { ...state.get().path, active: false } }); },
    setPathEnd(which, id) { state.set({ path: { ...state.get().path, [which]: id } }); },
    swapPath() { const p = state.get().path; state.set({ path: { ...p, from: p.to, to: p.from } }); },
    setPreferSource(prefer) { state.set({ path: { ...state.get().path, prefer } }); },
    setView(v) { if (VIEWS.includes(v) && v !== state.get().view) state.set({ view: v }); },
    setFilters(filters) { state.set({ filters }); },
    toggleGapList() {
      const st = state.get();
      const open = st.panel === 'gaps';
      state.set({ panel: open ? null : 'gaps', gapSel: open ? null : st.gapSel });
    },
    setDrawer(drawer) { state.set({ drawer }); },
    // 关系网层级
    openCluster(cluster) { state.set({ view: 'network', net: { level: 'cluster', cluster, trail: [], pos: -1 }, sel: null }); },
    goOverview() { state.set({ net: { level: 'overview', cluster: null, trail: [], pos: -1 }, sel: null }); },
    goCluster() {
      const net = state.get().net;
      if (!net.cluster) return actions.goOverview();
      state.set({ net: { level: 'cluster', cluster: net.cluster, trail: [], pos: -1 }, sel: null });
    },
    // 进入关系透镜。from: 'cluster' 从研究线点进来；'lens' 在透镜里点侧边节点；其他 = 搜索或别的视角跳过来
    openLens(id, { from = 'other', keepPanel = false } = {}) {
      const st = state.get(), net = st.net;
      const node = model.nodeById.get(id); if (!node) return;
      let next;
      if (from === 'lens' && net.level === 'lens') {
        const trail = [...net.trail.slice(0, net.pos + 1), id];
        next = { level: 'lens', cluster: net.cluster, trail, pos: trail.length - 1 };
      } else if (from === 'cluster' && net.cluster) {
        next = { level: 'lens', cluster: net.cluster, trail: [id], pos: 0 };
      } else {
        next = { level: 'lens', cluster: node.cluster, trail: [id], pos: 0 };
      }
      const leaveGap = !keepPanel && st.gapSel && !(model.gapById.get(st.gapSel)?.nodes || []).includes(id);
      state.set({ view: 'network', net: next, sel: { kind: 'node', id }, notionEdit: false, path: { ...st.path, active: false },
        ...(leaveGap && st.panel !== 'gaps' ? { gapSel: null } : {}) });
    },
    trailGo(i) {
      const net = state.get().net;
      if (i < 0 || i >= net.trail.length) return;
      state.set({ net: { ...net, pos: i }, sel: { kind: 'node', id: net.trail[i] }, notionEdit: false });
    },
    copyRoute() {
      const net = state.get().net;
      actions.copy(routeText(net.trail.slice(0, net.pos + 1), model), '路线已复制');
    },
    copyPrompt(id) { actions.copy(promptFor(id), '提问已复制，可以粘贴到和 Claude 的对话里'); },
    toggleDigested(id) {
      digested.has(id) ? digested.delete(id) : digested.add(id);
      store.set('digested', [...digested]);
      for (const v of Object.values(views)) v.refreshDigested();
      const st = state.get();
      if (st.filters.undigestedOnly) state.set({ filters: { ...st.filters } });   // 重新计算"只看未消化"
      else state.set({ notionEdit: st.notionEdit });
    },
    setNotion(id, url) {
      if (url) notion[id] = url; else delete notion[id];
      store.set('notion', notion);
      state.set({ notionEdit: false });
      toast(url ? 'Notion 链接已保存' : 'Notion 链接已清除');
    },
    editNotion(on) { state.set({ notionEdit: on }); },
    legendDirty() { scheduleLegend(); },
    async copy(text, msg) { toast((await copyText(text)) ? msg : '复制失败，请手动选择文字复制'); },
  };

  // ---------- 模块 ----------
  const viewRoot = v => document.querySelector(`.view[data-view="${v}"]`);
  const toolsFor = v => document.querySelector(`.view-tools[data-for="${v}"]`);
  const common = { model, store, tooltip, actions, getDigested: () => digested };
  const views = {
    network: createNetworkView({ root: viewRoot('network'), toolsEl: toolsFor('network'), ...common }),
    maturity: createMaturityView({ root: viewRoot('maturity'), toolsEl: toolsFor('maturity'), ...common }),
    timeline: createTimelineView({ root: viewRoot('timeline'), toolsEl: toolsFor('timeline'), ...common }),
  };
  const cur = () => views[state.get().view];
  const panel = createPanel($('#panel'), { model, actions, getDigested: () => digested, getNotion: id => notion[id] || '' });
  const filterBar = createFilterBar($('#filterDrawer'), { model, relSample: (t, s) => relSampleSvg(t, s, 24), onChange: f => actions.setFilters(f) });
  // 搜索选中后直接进入该节点的关系透镜
  const search = createSearch($('#search'), $('#searchList'), { model, onPick: id => actions.openLens(id, { from: 'search' }) });

  // 图例：打开时才生成，画面变化后在下一帧重建
  let legendQueued = false;
  function scheduleLegend() {
    if (legendQueued || state.get().drawer !== 'legend') return;
    legendQueued = true;
    requestAnimationFrame(() => {
      legendQueued = false;
      if (state.get().drawer !== 'legend') return;
      renderLegend($('#legend'), { ...(cur().legend ? cur().legend() : {}), digested });
    });
  }

  // ---------- 状态 → 画面 ----------
  function computePaths(st) {
    const p = st.path;
    if (!p.active || !p.from || !p.to || p.from === p.to) return { paths: [] };
    const bothVisible = vis.nodes.has(p.from) && vis.nodes.has(p.to);
    const paths = bothVisible ? findPaths(vis.visibleEdgeList, p.from, p.to, { preferSource: p.prefer }) : [];
    return paths.length ? { paths } : { paths, suggest: relaxSuggestions(model, st.filters, digested, p.from, p.to, connected) };
  }

  function updateFilterUi(st) {
    const el = $('#filterSummary');
    if (!vis.hiddenEdges && !vis.hiddenNodes) el.hidden = true;
    else {
      el.hidden = false;
      el.innerHTML = `已隐藏 ${vis.hiddenEdges} 条关系、${vis.hiddenNodes} 个节点 · <u>恢复全部</u>`;
    }
    const n = activeCount(st.filters);
    $('#filterCount').hidden = !n;
    $('#filterCount').textContent = n;
    $('#sourceOnly').checked = st.filters.sourceOnly;
  }

  function renderAll(st, prev) {
    if (!prev || st.filters !== prev.filters) {
      store.set('filters', st.filters);
      vis = computeVisibility(model, st.filters, digested);
      for (const v of Object.values(views)) v.setVisibility(vis);
      filterBar.sync(st.filters);
      updateFilterUi(st);
    }
    pathRes = computePaths(st);
    const viewState = { sel: st.sel, depth: st.depth, gap: st.gapSel };
    for (const v of Object.values(views)) v.setView(viewState);
    views.network.setPath(st.path, pathRes);
    if (!prev || st.net !== prev.net) {
      views.network.setNet(st.net, prev ? prev.net : null);
      renderTrail($('#trail'), st.net, model);
    }
    $('#trail').hidden = st.view !== 'network' || st.path.active;
    $('#backBtn').hidden = !(st.view === 'network' && st.net.level === 'lens' && !st.path.active);
    if (!prev || st.view !== prev.view) showView(st, prev);
    const keepScroll = prev && prev.sel === st.sel && prev.panel === st.panel && prev.path.active === st.path.active;
    panel.render(st, vis, { pathRes, keepScroll });
    views.network.setPanelInset(panel.mode() ? Math.min(380, $('#panel').offsetWidth || 380) : 0);
    // 抽屉
    $('#filterDrawer').hidden = st.drawer !== 'filter';
    $('#filterBtn').setAttribute('aria-expanded', String(st.drawer === 'filter'));
    $('#legend').hidden = st.drawer !== 'legend';
    $('#legendBtn').setAttribute('aria-expanded', String(st.drawer === 'legend'));
    $('#pathBtn').setAttribute('aria-pressed', String(st.path.active));
    $('#gapBtn').setAttribute('aria-pressed', String(st.panel === 'gaps'));
    $('#focusBtn').disabled = !(st.sel || st.gapSel);
    scheduleLegend();
    writeHash(st, prev);
  }
  // 切换视角：保留选中，并把选中的对象滚动到可见位置
  function showView(st, prev) {
    tooltip.hide();
    for (const v of VIEWS) {
      viewRoot(v).hidden = v !== st.view;
      const tools = toolsFor(v); if (tools && v !== 'network') tools.hidden = v !== st.view;
      document.querySelector(`.seg [data-view="${v}"]`).setAttribute('aria-pressed', String(v === st.view));
    }
    document.querySelectorAll('.zoom-only').forEach(el => { el.hidden = st.view === 'network'; });
    if (prev && views[prev.view].onHide) views[prev.view].onHide();
    const v = views[st.view];
    v.onShow();
    if (!prev) return;
    if (st.sel?.kind === 'node') v.ensureVisible(st.sel.id);
    else if (st.sel?.kind === 'edge') { const e = model.edgeById.get(st.sel.id); if (e) v.zoomToNodes([e.from, e.to]); }
    else if (st.gapSel) v.zoomToNodes(gapNodeIds(st.gapSel));
  }

  // ---------- 网址 ----------
  // 视角、层级、研究线、中心节点变化时占一个"后退"步；其余变化只改写当前这一步
  let applyingHash = false;
  function writeHash(st, prev) {
    if (applyingHash) return;
    const h = '#' + encodeHash(st);
    if (h === location.hash) return;
    try {
      if (prev && isStep(prev, st)) history.pushState(null, '', h);
      else history.replaceState(null, '', h);
    } catch { /* 某些嵌入环境不允许改网址 */ }
  }
  function applyHash() {
    const patch = decodeHash(location.hash, model);
    if (!patch) return;
    applyingHash = true;
    state.set({ ...patch, path: { ...state.get().path, active: false }, panel: null, gapSel: null });
    applyingHash = false;
  }
  addEventListener('popstate', applyHash);
  state.subscribe(renderAll);
  // 打开页面时，网址里带着状态就先恢复它
  { const patch = decodeHash(location.hash, model); if (patch) Object.assign(state.get(), patch); }
  renderAll(state.get(), null);

  // ---------- 按钮 ----------
  $('#filterSummary').addEventListener('click', () => actions.setFilters(sanitizeFilters(null, model)));
  $('#sourceOnly').addEventListener('change', ev => actions.setFilters({ ...state.get().filters, sourceOnly: ev.target.checked }));
  $('#filterBtn').addEventListener('click', () => actions.setDrawer(state.get().drawer === 'filter' ? null : 'filter'));
  $('#legendBtn').addEventListener('click', () => actions.setDrawer(state.get().drawer === 'legend' ? null : 'legend'));
  $('#gapBtn').addEventListener('click', () => actions.toggleGapList());
  $('#fitBtn').addEventListener('click', () => cur().fitAll());
  document.querySelectorAll('.seg [data-view]').forEach(b => b.addEventListener('click', () => actions.setView(b.dataset.view)));
  $('#focusBtn').addEventListener('click', () => {
    const st = state.get();
    if (st.gapSel && !st.sel) return cur().zoomToNodes(gapNodeIds(st.gapSel));
    if (!st.sel) return;
    if (st.sel.kind === 'node') cur().zoomToNodes([st.sel.id]);
    else if (st.sel.kind === 'edge') { const e = model.edgeById.get(st.sel.id); cur().zoomToNodes([e.from, e.to]); }
  });
  $('#pathBtn').addEventListener('click', () => (state.get().path.active ? actions.exitPath() : actions.startPath(state.get().sel?.kind === 'node' ? state.get().sel.id : null)));

  $('#backBtn').addEventListener('click', () => actions.goCluster());
  $('#trail').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if ('copy' in b.dataset) return actions.copyRoute();
    const go = b.dataset.go;
    if (go === 'overview') actions.goOverview();
    else if (go === 'cluster') actions.goCluster();
    else if (go != null) actions.trailGo(+go);
  });

  // 点抽屉外部关闭筛选抽屉（图例是浮层，只用按钮或 Esc 关）
  // 这一下点击只负责关抽屉，不会同时点到下面的气泡或节点
  document.addEventListener('pointerdown', ev => {
    if (state.get().drawer !== 'filter' || ev.target.closest('#filterDrawer, #filterBtn')) return;
    actions.setDrawer(null);
    if (ev.target.closest('#stage')) {
      const swallow = e => { e.stopPropagation(); e.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
    }
  });

  // ---------- 快捷键 ----------
  // Esc 的顺序：先关抽屉和浮层，再退出故事线 / 找路径 / 选中，最后返回关系网的上一层
  document.addEventListener('keydown', ev => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if (ev.key === '/' && !typing) { ev.preventDefault(); search.focus(); return; }
    if (!typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && ['1', '2', '3'].includes(ev.key)) { actions.setView(VIEWS[+ev.key - 1]); return; }
    if (ev.key === 'Escape' && typing && ev.target.closest('.pathbar')) { ev.target.blur(); actions.exitPath(); return; }
    if (ev.key !== 'Escape' || typing) return;
    const st = state.get();
    if (st.drawer) actions.setDrawer(null);
    else if (st.view === 'timeline' && views.timeline.storyActive()) views.timeline.endStory();
    else if (st.path.active) actions.exitPath();
    else if (st.panel) actions.closePanel();
    else if (st.view === 'network' && st.net.level === 'lens') actions.goCluster();
    else if (st.view === 'network' && st.net.level === 'cluster') actions.goOverview();
    else if (st.sel) actions.clearSelection();
  });

  window.__atlas = { model, state, views, actions, routeText: ids => routeText(ids, model), promptFor, vis: () => vis, paths: () => views.network.pathSummary() };   // 方便在控制台里检查
}

start();
