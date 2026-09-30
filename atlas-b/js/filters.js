// 筛选：三个视角共用。filters 记录"关掉了什么"，这样内容包新增的取值默认是开着的。
import { REL_TYPES, STATUSES, KINDS } from './encoding.js';

export const DEFAULT_FILTERS = {
  offTypes: [], offStatuses: [], offClusters: [], offKinds: [],
  sourceOnly: false,    // 只看有文献来源的线
  gapsOnly: false,      // 只看空缺
  hideIsolated: false,  // 隐藏没有可见连线的节点
  undigestedOnly: false, // 只看未消化（阶段 4）
};

// 从 localStorage 读回来的值要清洗：只保留合法取值
export function sanitizeFilters(raw, model) {
  const f = { ...DEFAULT_FILTERS };
  if (!raw || typeof raw !== 'object') return f;
  const pick = (arr, allowed) => (Array.isArray(arr) ? arr.filter(v => allowed.includes(v)) : []);
  f.offTypes = pick(raw.offTypes, REL_TYPES);
  f.offStatuses = pick(raw.offStatuses, STATUSES);
  f.offKinds = pick(raw.offKinds, KINDS);
  f.offClusters = pick(raw.offClusters, model.clusters.map(c => c.id));
  for (const k of ['sourceOnly', 'gapsOnly', 'hideIsolated', 'undigestedOnly']) f[k] = raw[k] === true;
  return f;
}

// 空缺线：挂了 gap 的线，以及所有"未验证"的线（阶段 0 第 1 条决定）
export const isGapEdge = e => !!e.gap || e.status === '未验证';

// 一条关系本身是否通过关系类筛选（不看两端节点）
export function edgePasses(e, f) {
  if (f.offTypes.includes(e.type)) return false;
  if (f.offStatuses.includes(e.status)) return false;
  if (f.sourceOnly && e.basis !== '来源') return false;
  if (f.gapsOnly && !isGapEdge(e)) return false;
  return true;
}

export function nodePasses(n, f, digested) {
  if (f.offClusters.includes(n.cluster)) return false;
  if (f.offKinds.includes(n.kind)) return false;
  if (f.undigestedOnly && digested && digested.has(n.id)) return false;
  return true;
}

// 组合逻辑：线可见 ⇔ 通过关系筛选且两端节点可见；节点可见 ⇔ 通过研究线和类型筛选
export function computeVisibility(model, f, digested = null) {
  let nodes = new Set(model.nodes.filter(n => nodePasses(n, f, digested)).map(n => n.id));
  let edges = new Set(model.edges.filter(e => edgePasses(e, f) && nodes.has(e.from) && nodes.has(e.to)).map(e => e.id));
  if (f.hideIsolated) {
    const linked = new Set();
    for (const e of model.edges) if (edges.has(e.id)) { linked.add(e.from); linked.add(e.to); }
    nodes = new Set([...nodes].filter(id => linked.has(id)));
  }
  return {
    nodes, edges,
    hiddenNodes: model.nodes.length - nodes.size,
    hiddenEdges: model.edges.length - edges.size,
    visibleEdgeList: model.edges.filter(e => edges.has(e.id)),
  };
}

export const isDefault = f => activeCount(f) === 0;

// 生效的筛选条件数（显示在"筛选"按钮的角标上）
export function activeCount(f) {
  return f.offTypes.length + f.offStatuses.length + f.offClusters.length + f.offKinds.length
    + ['sourceOnly', 'gapsOnly', 'hideIsolated', 'undigestedOnly'].filter(k => f[k]).length;
}

// 两个节点在当前筛选下不连通时：逐项放宽筛选，看放宽哪一项就能连通
export function relaxSuggestions(model, f, digested, from, to, connectedFn) {
  const tries = [
    ['关系类型', { offTypes: [] }, f.offTypes.length > 0],
    ['状态', { offStatuses: [] }, f.offStatuses.length > 0],
    ['只看有文献来源的线', { sourceOnly: false }, f.sourceOnly],
    ['只看空缺', { gapsOnly: false }, f.gapsOnly],
    ['研究线', { offClusters: [] }, f.offClusters.length > 0],
    ['节点类型', { offKinds: [] }, f.offKinds.length > 0],
    ['隐藏没有可见连线的节点', { hideIsolated: false }, f.hideIsolated],
    ['只看未消化', { undigestedOnly: false }, f.undigestedOnly],
  ];
  const ok = relaxed => {
    const v = computeVisibility(model, relaxed, digested);
    return v.nodes.has(from) && v.nodes.has(to) && connectedFn(v.visibleEdgeList, from, to);
  };
  const single = tries.filter(t => t[2] && ok({ ...f, ...t[1] })).map(t => t[0]);
  if (single.length) return { single, all: false };
  const active = tries.filter(t => t[2]);
  const allOff = active.reduce((acc, t) => ({ ...acc, ...t[1] }), { ...f });
  return { single: [], all: active.length > 0 && ok(allOff), active: active.map(t => t[0]) };
}

// ---------- 筛选栏界面 ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createFilterBar(el, { model, relSample, onChange }) {
  const chip = (f, v, label, extra = '') => `<button type="button" class="chip" data-f="${f}" data-v="${esc(v)}" aria-pressed="true">${extra}${esc(label)}</button>`;
  el.innerHTML = `
    <div class="fgroup"><span class="flabel">关系类型</span>${REL_TYPES.map(t => chip('offTypes', t, t, relSample(t))).join('')}</div>
    <div class="fgroup"><span class="flabel">状态</span>${STATUSES.map(s => chip('offStatuses', s, s, relSample('继承', s))).join('')}</div>
    <div class="fgroup"><span class="flabel">依据</span>
      <button type="button" class="chip key src" data-flag="sourceOnly" aria-pressed="false" title="隐藏所有 Claude 加工的关系（中点带空心圆的线）">只看有文献来源的线</button>
      <button type="button" class="chip key gap" data-flag="gapsOnly" aria-pressed="false" title="只显示空缺线：挂了空缺编号的，以及所有未验证的">只看空缺</button>
    </div>
    <div class="fgroup"><span class="flabel">研究线</span>${model.clusters.map(c => chip('offClusters', c.id, c.name, `<span class="dot" style="background:${c.color}"></span>`)).join('')}</div>
    <div class="fgroup"><span class="flabel">节点类型</span>${KINDS.map(k => chip('offKinds', k, k)).join('')}</div>
    <div class="fgroup"><span class="flabel">其他</span>
      <button type="button" class="chip" data-flag="undigestedOnly" aria-pressed="false">只看未消化</button>
      <button type="button" class="chip" data-flag="hideIsolated" aria-pressed="false" title="成熟度、时间线里隐藏没有可见关系的节点">隐藏无关系节点</button>
      <button type="button" class="btn reset" data-reset>恢复全部</button>
    </div>`;

  let current = { ...DEFAULT_FILTERS };
  function sync(f) {
    current = f;
    el.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(!f[b.dataset.f].includes(b.dataset.v))));
    el.querySelectorAll('[data-flag]').forEach(b => b.setAttribute('aria-pressed', String(!!f[b.dataset.flag])));
    el.querySelector('[data-reset]').disabled = isDefault(f);
  }
  el.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const f = { ...current };
    if (b.dataset.f) {
      const arr = new Set(f[b.dataset.f]);
      arr.has(b.dataset.v) ? arr.delete(b.dataset.v) : arr.add(b.dataset.v);
      f[b.dataset.f] = [...arr];
    } else if (b.dataset.flag) f[b.dataset.flag] = !f[b.dataset.flag];
    else if ('reset' in b.dataset) Object.assign(f, DEFAULT_FILTERS);
    else return;
    onChange(f);
  });
  return { sync };
}
