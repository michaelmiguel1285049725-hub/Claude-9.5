/* 顶栏：弹层（筛选抽屉 / 图例 / 进度）的互斥与定位、只看来源开关、进度圆环、操作提示条。 */
import { get, set, subscribe } from './state.js';
import * as storage from './storage.js';
import * as progress from './progress.js';
import { esc } from './tooltip.js';
import { applyFilters, countActiveFilters } from './drawer.js';

const $ = (id) => document.getElementById(id);

export function initTopbar({ model, onOpen, onClose }) {
  const pops = {
    drawer: { btn: $('filtersBtn'), el: $('drawer') },
    legendPop: { btn: $('legendBtn'), el: $('legendPop') },
    progressPop: { btn: $('progressBtn'), el: $('progressPop') },
  };
  let openName = null;

  function position(name) {
    const { btn, el } = pops[name];
    const r = btn.getBoundingClientRect();
    const top = Math.round(r.bottom + 6);
    el.style.top = top + 'px';
    el.style.maxHeight = `calc(100vh - ${top + 12}px)`;
    /* 先显示再量宽度，保证不出右边界 */
    const w = el.getBoundingClientRect().width;
    let left = r.left;
    if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - 8 - w);
    el.style.left = Math.round(left) + 'px';
  }
  function open(name) {
    if (openName && openName !== name) close();
    const p = pops[name];
    p.el.hidden = false;
    p.btn.setAttribute('aria-expanded', 'true');
    openName = name;
    if (onOpen) onOpen(name);
    position(name);
  }
  function close() {
    if (!openName) return false;
    const p = pops[openName];
    p.el.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
    const was = openName;
    openName = null;
    if (onClose) onClose(was);
    return true;
  }
  function toggle(name) { if (openName === name) close(); else open(name); }
  for (const name of Object.keys(pops)) pops[name].btn.addEventListener('click', () => toggle(name));
  /* 用捕获阶段：d3.zoom 会在 SVG 上阻止 mousedown 冒泡 */
  document.addEventListener('mousedown', (ev) => {
    if (!openName) return;
    const p = pops[openName];
    if (p.el.contains(ev.target) || p.btn.contains(ev.target)) return;
    close();
  }, true);
  window.addEventListener('resize', () => { if (openName) position(openName); });

  /* ---- 只看有文献来源 ---- */
  const srcBtn = $('sourceOnly');
  srcBtn.addEventListener('click', () => { const f = { ...get().filters, sourceOnly: !get().filters.sourceOnly }; applyFilters(f); });
  function syncFilterButtons() {
    const f = get().filters;
    srcBtn.setAttribute('aria-pressed', String(!!f.sourceOnly));
    const n = countActiveFilters(f, model);
    const b = $('filtersBadge');
    b.hidden = !n; b.textContent = n;
    $('filtersBtn').classList.toggle('has-active', n > 0);
  }

  /* ---- 进度圆环与弹层 ---- */
  const ringFg = document.querySelector('#progressBtn .ring-fg');
  const C = 2 * Math.PI * 8;
  function renderProgress() {
    const total = model.nodes.length, done = model.nodes.filter((n) => progress.has(n.id)).length;
    const frac = total ? done / total : 0;
    ringFg.style.strokeDasharray = `${(frac * C).toFixed(2)} ${C.toFixed(2)}`;
    $('progressText').textContent = `${done}/${total}`;
    $('progressBtn').title = `已消化 ${done} / ${total}`;
    const f = get().filters;
    $('progressPop').innerHTML = `<div class="pop-head">学习进度 <span class="pop-sub">已消化 ${done} / ${total}</span></div>
      <ul class="pg-list">${model.clusters.map((c) => { const pr = progress.clusterProgress(model, c.id); const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0; return `<li><i class="dot" style="--c:${c._color}"></i><span class="pg-name${c.main ? ' main' : ''}">${esc(c.name)}</span><span class="pg-bar"><i style="width:${pct}%;background:${c._color}"></i></span><b>${pr.done}/${pr.total}</b></li>`; }).join('')}</ul>
      <label class="p-toggle pop-toggle"><input type="checkbox" id="undigestedToggle" ${f.undigestedOnly ? 'checked' : ''}> 只看未消化</label>
      <p class="pop-note">在节点详情里点"标记已消化"来记录进度。进度只存在这台浏览器里。</p>`;
    $('undigestedToggle').addEventListener('change', (ev) => applyFilters({ ...get().filters, undigestedOnly: ev.target.checked }));
  }

  /* ---- 操作提示条：首次打开 5 秒后淡出；"?" 再次查看 ---- */
  const hint = $('hint');
  let hintTimer = null;
  function showHint(ms = 5000) {
    hint.hidden = false;
    requestAnimationFrame(() => hint.classList.add('show'));
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.classList.remove('show'); setTimeout(() => { hint.hidden = true; }, 700); }, ms);
  }
  $('helpBtn').addEventListener('click', () => showHint(6000));
  if (!storage.loadGlobal('hintSeen', false)) { showHint(5000); storage.saveGlobal('hintSeen', true); }

  subscribe((s, patch) => {
    if ('filters' in patch) { syncFilterButtons(); if (openName === 'progressPop') renderProgress(); }
    if ('progressTick' in patch) renderProgress();
  });
  syncFilterButtons();
  renderProgress();

  return { open, close, toggle, isOpen: () => openName, renderProgress, showHint, setHint(html) { hint.innerHTML = html; } };
}
