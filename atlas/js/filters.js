/* 筛选：可见性只在这里算一次，三个视角和找路径都读同一组结果。 */
import * as enc from './encoding.js';
import { get, set, defaultFilters } from './state.js';
import * as storage from './storage.js';
import * as progress from './progress.js';

export function computeVisibility(model, f) {
  const digested = progress.set();
  const nodeVis = new Set();
  for (const n of model.nodes) {
    if (f.clusters[n._cluster] === false) continue;
    if (f.kinds[n.kind] === false) continue;
    if (f.undigestedOnly && digested.has(n.id)) continue;
    nodeVis.add(n.id);
  }
  const edgeVis = new Set();
  for (const e of model.edges) {
    if (f.types[e.type] === false || f.status[e.status] === false) continue;
    if (f.sourceOnly && e.basis !== '来源') continue;
    if (f.gapsOnly && e.status !== '未验证') continue;
    if (!nodeVis.has(e.from) || !nodeVis.has(e.to)) continue;
    edgeVis.add(e.id);
  }
  if (f.hideUnlinked) {
    const linked = new Set();
    for (const id of edgeVis) { const e = model.edgeById.get(id); linked.add(e.from); linked.add(e.to); }
    for (const id of [...nodeVis]) if (!linked.has(id)) nodeVis.delete(id);
  }
  return { nodeVis, edgeVis, hiddenNodes: model.nodes.length - nodeVis.size, hiddenEdges: model.edges.length - edgeVis.size };
}

/* 与默认值合并，保证新加的键存在 */
export function restoreFilters(model) {
  const def = defaultFilters(model);
  const saved = storage.load('filters', null);
  if (!saved || typeof saved !== 'object') return def;
  const out = { ...def };
  for (const k of ['types', 'status', 'clusters', 'kinds']) {
    out[k] = { ...def[k] };
    if (saved[k] && typeof saved[k] === 'object') for (const key of Object.keys(def[k])) if (typeof saved[k][key] === 'boolean') out[k][key] = saved[k][key];
  }
  for (const k of ['sourceOnly', 'gapsOnly', 'hideUnlinked', 'undigestedOnly']) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  return out;
}

export function isDefault(f, model) {
  const def = defaultFilters(model);
  return JSON.stringify(f) === JSON.stringify(def);
}

/* 筛选栏 UI */
export function buildFilterBar(container, model, { onPathMode, onResetLayout, onExportLayout }) {
  container.innerHTML = '';
  const groups = [];
  const mkGroup = (label, cls = '') => {
    const g = document.createElement('div'); g.className = 'fgroup ' + cls;
    const l = document.createElement('span'); l.className = 'flabel'; l.textContent = label; g.appendChild(l);
    container.appendChild(g); groups.push(g); return g;
  };
  const chip = (parent, { text, color, swatch, pressed, title, onToggle, prominent }) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (prominent ? ' prominent' : ''); b.setAttribute('aria-pressed', String(!!pressed)); if (title) b.title = title;
    if (swatch) { const s = document.createElement('span'); s.className = 'sw ' + swatch; if (color) s.style.setProperty('--c', color); b.appendChild(s); }
    const t = document.createElement('span'); t.textContent = text; b.appendChild(t);
    b.addEventListener('click', () => { const next = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(next)); onToggle(next); });
    parent.appendChild(b); return b;
  };
  const chips = [];
  const commit = () => { const f = { ...get().filters }; storage.save('filters', f); set({ filters: f }); };
  const f = () => get().filters;

  const gType = mkGroup('关系');
  for (const r of enc.REL) chips.push({ key: ['types', r.zh], el: chip(gType, { text: r.zh, color: `var(--rel-${r.key})`, swatch: 'line', pressed: f().types[r.zh], title: r.desc, onToggle: (v) => { f().types[r.zh] = v; commit(); } }) });
  const gStatus = mkGroup('状态');
  for (const s of enc.STATUS_ORDER) chips.push({ key: ['status', s], el: chip(gStatus, { text: s, swatch: 'dash-' + (s === '确立' ? 'solid' : s === '初步' ? 'dashed' : 'dotted'), pressed: f().status[s], title: enc.STATUS[s].rule, onToggle: (v) => { f().status[s] = v; commit(); } }) });
  const gBasis = mkGroup('依据', 'basis');
  chips.push({ key: ['sourceOnly'], el: chip(gBasis, { text: '只看有文献来源的线', prominent: true, pressed: f().sourceOnly, title: '打开后隐藏所有 Claude 加工的线（带空心圆的线）', onToggle: (v) => { f().sourceOnly = v; commit(); } }) });
  chips.push({ key: ['gapsOnly'], el: chip(gBasis, { text: '只看空缺', pressed: f().gapsOnly, title: '只显示「未验证」的线，并在右侧列出空缺问题', onToggle: (v) => { f().gapsOnly = v; commit(); set({ panel: v ? 'gaps' : (get().panel === 'gaps' ? 'closed' : get().panel) }); } }) });
  const gCluster = mkGroup('研究线');
  for (const c of model.clusters) chips.push({ key: ['clusters', c.id], el: chip(gCluster, { text: c.name, color: c._color, swatch: 'dot', pressed: f().clusters[c.id], title: c.desc || '', onToggle: (v) => { f().clusters[c.id] = v; commit(); } }) });
  const gKind = mkGroup('类型');
  for (const k of enc.KIND_ORDER) chips.push({ key: ['kinds', k], el: chip(gKind, { text: k, pressed: f().kinds[k], title: enc.KINDS[k].desc, onToggle: (v) => { f().kinds[k] = v; commit(); } }) });
  const gMore = mkGroup('');
  chips.push({ key: ['hideUnlinked'], el: chip(gMore, { text: '隐藏无连线节点', pressed: f().hideUnlinked, onToggle: (v) => { f().hideUnlinked = v; commit(); } }) });
  chips.push({ key: ['undigestedOnly'], el: chip(gMore, { text: '只看未消化', pressed: f().undigestedOnly, onToggle: (v) => { f().undigestedOnly = v; commit(); } }) });

  const gAct = mkGroup('', 'actions');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'icon-btn small'; reset.textContent = '重置筛选';
  reset.addEventListener('click', () => { set({ filters: defaultFilters(model) }); storage.remove('filters'); if (get().panel === 'gaps') set({ panel: 'closed' }); api.refresh(); });
  gAct.appendChild(reset);
  const pathBtn = document.createElement('button'); pathBtn.type = 'button'; pathBtn.className = 'icon-btn small'; pathBtn.id = 'pathModeBtn'; pathBtn.textContent = '找路径';
  pathBtn.addEventListener('click', () => onPathMode());
  gAct.appendChild(pathBtn);
  const lay = document.createElement('button'); lay.type = 'button'; lay.className = 'icon-btn small'; lay.textContent = '重置布局'; lay.title = '清除你拖动固定过的节点位置';
  lay.addEventListener('click', () => onResetLayout()); gAct.appendChild(lay);
  const exp = document.createElement('button'); exp.type = 'button'; exp.className = 'icon-btn small'; exp.textContent = '导出布局'; exp.title = '下载 layout.json，放到内容包目录后布局就固定了';
  exp.addEventListener('click', () => onExportLayout()); gAct.appendChild(exp);

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
