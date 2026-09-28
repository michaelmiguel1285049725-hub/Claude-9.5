/* 高亮计算：三个视角共用。优先级：路径 > 空缺 > 选中关系 > 聚焦节点 > 悬停节点。 */
import * as progress from './progress.js';

export function neighborhood(model, visible, id, depth) {
  const n1 = new Set([id]), e1 = new Set();
  for (const e of model.edgesOf.get(id) || []) if (visible.edgeVis.has(e.id)) { e1.add(e.id); n1.add(e.from === id ? e.to : e.from); }
  const n2 = new Set(), e2 = new Set();
  if (depth >= 2) for (const x of [...n1]) if (x !== id) for (const e of model.edgesOf.get(x) || []) {
    if (!visible.edgeVis.has(e.id) || e1.has(e.id)) continue;
    e2.add(e.id); const o = e.from === x ? e.to : e.from; if (!n1.has(o)) n2.add(o);
  }
  return { n1, e1, n2, e2 };
}

export function computeHighlight(model, s, visible) {
  let mode = 'none', nHi = new Set(), eHi = new Set(), nHi2 = new Set(), eHi2 = new Set();
  if (s.path) { mode = 'path'; nHi = new Set(s.path.nodes); eHi = new Set(s.path.edges); }
  else if (s.gap && model.gapById.has(s.gap)) {
    mode = 'gap'; const g = model.gapById.get(s.gap);
    nHi = new Set((g.nodes || []).filter((id) => visible.nodeVis.has(id)));
    for (const e of model.edgesByGap.get(s.gap) || []) if (visible.edgeVis.has(e.id)) { eHi.add(e.id); nHi.add(e.from); nHi.add(e.to); }
  }
  else if (s.edge && model.edgeById.has(s.edge)) { mode = 'edge'; const e = model.edgeById.get(s.edge); eHi.add(e.id); nHi.add(e.from); nHi.add(e.to); }
  else if (s.node && model.byId.has(s.node)) { mode = 'focus'; const nb = neighborhood(model, visible, s.node, s.depth); nHi = nb.n1; eHi = nb.e1; nHi2 = nb.n2; eHi2 = nb.e2; }
  else if (s.hoverNode && model.byId.has(s.hoverNode)) { mode = 'hover'; const nb = neighborhood(model, visible, s.hoverNode, 1); nHi = nb.n1; eHi = nb.e1; }
  return { mode, nHi, eHi, nHi2, eHi2, faintCls: mode === 'hover' ? 'dim' : 'faint' };
}

/* 把高亮结果套到 DOM 上。extraHidden：视角自己额外隐藏的元素 id 集合（例如时间线故事模式） */
export function applyClasses({ nodeEls, edgeEls, hl, visible, s, hiddenNodes, hiddenEdges }) {
  const { mode, nHi, eHi, nHi2, eHi2, faintCls } = hl;
  for (const el of nodeEls) {
    const id = el.dataset.id;
    const hidden = !visible.nodeVis.has(id) || !!(hiddenNodes && hiddenNodes.has(id));
    el.classList.toggle('hidden', hidden);
    const hi = nHi.has(id), hi2 = nHi2.has(id);
    el.classList.toggle('active', id === s.node);
    el.classList.toggle('hi', hi);
    el.classList.toggle('hi2', !hi && hi2);
    el.classList.toggle('dim', mode !== 'none' && !hi && !hi2 && faintCls === 'dim');
    el.classList.toggle('faint', mode !== 'none' && !hi && !hi2 && faintCls === 'faint');
    el.classList.toggle('digested', progress.has(id));
  }
  for (const el of edgeEls) {
    const id = el.dataset.id;
    const hidden = !visible.edgeVis.has(id) || !!(hiddenEdges && hiddenEdges.has(id));
    el.classList.toggle('hidden', hidden);
    const hi = eHi.has(id), hi2 = eHi2.has(id);
    el.classList.toggle('active', id === s.edge);
    el.classList.toggle('hi', hi || id === s.hoverEdge);
    el.classList.toggle('hi2', !hi && hi2);
    el.classList.toggle('dim', mode !== 'none' && !hi && !hi2 && faintCls === 'dim');
    el.classList.toggle('faint', mode !== 'none' && !hi && !hi2 && faintCls === 'faint');
  }
}
