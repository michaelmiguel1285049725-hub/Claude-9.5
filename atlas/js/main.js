// 启动：读取 ?pack= 参数 → 加载内容包 → 校验提示 → 渲染视角与图例。
import { loadPack } from './data.js';
import { summarizePack } from './validate.js';
import { createStore, globalStore } from './storage.js';
import { createState } from './state.js';
import { createNetworkView } from './views/network.js';
import { buildLegend } from './legend.js';
import { defineMarkers } from './glyph.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 深浅色：跟随系统 / 浅色 / 深色 ----------
const THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const btn = $('#themeBtn');
  const label = (THEMES.find(x => x[0] === t) || THEMES[0])[1];
  btn.textContent = `配色：${label}`;
  btn.title = `配色：${label}（点击切换）`;
}
function initTheme() {
  let t = globalStore.get('theme', 'auto');
  applyTheme(t);
  $('#themeBtn').addEventListener('click', () => {
    const i = THEMES.findIndex(x => x[0] === t);
    t = THEMES[(i + 1) % THEMES.length][0];
    globalStore.set('theme', t);
    applyTheme(t);
  });
}

// ---------- 校验提示条 ----------
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

async function start() {
  initTheme();
  if (!window.d3) { fatal('D3 可视化库没有加载成功（需要联网访问 cdn.jsdelivr.net）。'); return; }

  const param = new URLSearchParams(location.search).get('pack');
  const packId = param && /^[a-z0-9][a-z0-9_-]*$/i.test(param) ? param : 'ai-bias';

  let model;
  try { model = await loadPack(packId); } catch (err) { fatal(err.message); return; }
  const store = createStore(packId);

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

  const state = createState({ view: 'network', level: 'mid' });
  const net = createNetworkView({
    root: $('#views'), model, store, fileLayout: model.layout,
    onLevel: lv => state.set({ level: lv }),
  });
  $('#fitBtn').addEventListener('click', () => net.fitAll());

  buildLegend($('#legend'), model);
  // 窄一点的屏幕上图例默认收起，避免挡住画布
  if (innerWidth < 1500) $('#legend').open = false;

  window.__atlas = { model, state, net };   // 方便在控制台里检查
}

start();
