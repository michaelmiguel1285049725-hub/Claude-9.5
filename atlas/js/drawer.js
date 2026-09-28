/* 筛选抽屉：从顶栏"筛选"按钮下方展开，覆盖在画布上，不挤压画布。可见性计算在 filters.js。 */
import * as enc from './encoding.js';
import { get, set, defaultFilters } from './state.js';
import * as storage from './storage.js';

/* 写入筛选：保存到 localStorage 并通知所有订阅者 */
export function applyFilters(f) { storage.save('filters', f); set({ filters: f }); }

/* 生效的筛选条件数（显示在"筛选"按钮角标上）。"全览中显示全部关系线"是显示选项，不算筛选。 */
export function countActiveFilters(f, model) {
  const def = defaultFilters(model);
  let n = 0;
  for (const k of ['types', 'status', 'clusters', 'kinds']) for (const key of Object.keys(def[k])) if (f[k][key] === false) n++;
  for (const k of ['sourceOnly', 'gapsOnly', 'hideUnlinked', 'undigestedOnly']) if (f[k]) n++;
  return n;
}

export function initDrawer({ el, model, onPathMode }) {
  const chips = [];
  const f = () => get().filters;
  const commit = () => applyFilters({ ...f() });

  const mkGroup = (label, cls = '') => {
    const g = document.createElement('div'); g.className = 'fgroup ' + cls;
    if (label) { const l = document.createElement('span'); l.className = 'flabel'; l.textContent = label; g.appendChild(l); }
    el.appendChild(g); return g;
  };
  const chip = (parent, { text, color, swatch, pressed, title, onToggle, cls = '' }) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip ' + cls; b.setAttribute('aria-pressed', String(!!pressed)); if (title) b.title = title;
    if (swatch) { const s = document.createElement('span'); s.className = 'sw ' + swatch; if (color) s.style.setProperty('--c', color); b.appendChild(s); }
    const t = document.createElement('span'); t.textContent = text; b.appendChild(t);
    b.addEventListener('click', () => { const next = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(next)); onToggle(next); });
    parent.appendChild(b); return b;
  };

  el.innerHTML = '';
  const head = document.createElement('div'); head.className = 'pop-head'; head.innerHTML = '筛选 <span class="pop-sub">对三个视角同时生效</span>'; el.appendChild(head);

  const gType = mkGroup('关系类型');
  for (const r of enc.REL) chips.push({ key: ['types', r.zh], el: chip(gType, { text: r.zh, color: `var(--rel-${r.key})`, swatch: 'line', pressed: f().types[r.zh], title: r.desc, onToggle: (v) => { f().types[r.zh] = v; commit(); } }) });
  const gStatus = mkGroup('状态');
  for (const s of enc.STATUS_ORDER) chips.push({ key: ['status', s], el: chip(gStatus, { text: s, swatch: 'dash-' + (s === '确立' ? 'solid' : s === '初步' ? 'dashed' : 'dotted'), pressed: f().status[s], title: enc.STATUS[s].rule, onToggle: (v) => { f().status[s] = v; commit(); } }) });
  const gCluster = mkGroup('研究线');
  for (const c of model.clusters) chips.push({ key: ['clusters', c.id], el: chip(gCluster, { text: c.name, color: c._color, swatch: 'dot', pressed: f().clusters[c.id], title: c.desc || '', onToggle: (v) => { f().clusters[c.id] = v; commit(); } }) });
  const gKind = mkGroup('节点类型');
  for (const k of enc.KIND_ORDER) chips.push({ key: ['kinds', k], el: chip(gKind, { text: k, pressed: f().kinds[k], title: enc.KINDS[k].desc, onToggle: (v) => { f().kinds[k] = v; commit(); } }) });
  const gMore = mkGroup('其他');
  chips.push({ key: ['gapsOnly'], el: chip(gMore, { text: '只看空缺', pressed: f().gapsOnly, title: '只显示「未验证」的线', onToggle: (v) => { f().gapsOnly = v; commit(); } }) });
  chips.push({ key: ['hideUnlinked'], el: chip(gMore, { text: '隐藏无连线节点', pressed: f().hideUnlinked, onToggle: (v) => { f().hideUnlinked = v; commit(); } }) });
  chips.push({ key: ['undigestedOnly'], el: chip(gMore, { text: '只看未消化', pressed: f().undigestedOnly, onToggle: (v) => { f().undigestedOnly = v; commit(); } }) });
  const gShow = mkGroup('关系网显示');
  chips.push({ key: ['showAllEdges'], el: chip(gShow, { text: '全览中显示全部关系线', pressed: f().showAllEdges, title: '默认全览只画研究线之间的汇总连线；打开后画出所有节点之间的线', onToggle: (v) => { f().showAllEdges = v; commit(); } }) });

  const gAct = mkGroup('', 'actions');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'icon-btn small'; reset.textContent = '重置筛选';
  reset.addEventListener('click', () => { const d = defaultFilters(model); d.showAllEdges = f().showAllEdges; applyFilters(d); api.refresh(); });
  gAct.appendChild(reset);
  const pathBtn = document.createElement('button'); pathBtn.type = 'button'; pathBtn.className = 'icon-btn small'; pathBtn.id = 'pathModeBtn'; pathBtn.textContent = '找路径';
  pathBtn.addEventListener('click', () => onPathMode());
  gAct.appendChild(pathBtn);

  const api = {
    refresh() {
      const cur = get().filters;
      for (const c of chips) {
        const v = c.key.length === 2 ? cur[c.key[0]][c.key[1]] : cur[c.key[0]];
        c.el.setAttribute('aria-pressed', String(!!v));
      }
      pathBtn.setAttribute('aria-pressed', String(get().panel === 'path'));
    },
  };
  api.refresh();
  return api;
}
