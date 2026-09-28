// 网址记录状态：#view=network&level=lens&cluster=C&node=C-04&trail=C-04,C-06
// 刷新后恢复到同一状态；浏览器后退键按"层级 / 中心节点"逐步后退。
const VIEWS = ['network', 'maturity', 'timeline'];
const LEVELS = ['overview', 'cluster', 'lens'];

export function encodeHash(st) {
  const p = new URLSearchParams();
  p.set('view', st.view);
  if (st.view === 'network') {
    p.set('level', st.net.level);
    if (st.net.cluster && st.net.level !== 'overview') p.set('cluster', st.net.cluster);
    if (st.net.level === 'lens') {
      p.set('node', st.net.trail[st.net.pos]);
      p.set('trail', st.net.trail.join(','));
    }
  } else if (st.sel?.kind === 'node') {
    p.set('node', st.sel.id);
  }
  return p.toString().replace(/%2C/g, ',');
}

// 读出来的值逐项检查，不合法的部分忽略
export function decodeHash(hash, model) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.includes('=')) return null;
  const p = new URLSearchParams(raw);
  const view = VIEWS.includes(p.get('view')) ? p.get('view') : 'network';
  const node = model.nodeById.has(p.get('node')) ? p.get('node') : null;
  const out = { view };
  if (view === 'network') {
    let level = LEVELS.includes(p.get('level')) ? p.get('level') : 'overview';
    const cluster = model.clusterById.has(p.get('cluster')) ? p.get('cluster') : null;
    if (level === 'lens' && !node) level = cluster ? 'cluster' : 'overview';
    if (level === 'cluster' && !cluster) level = 'overview';
    if (level === 'lens') {
      let trail = (p.get('trail') || '').split(',').filter(id => model.nodeById.has(id)).slice(-50);
      if (!trail.includes(node)) trail = [node];
      const pos = trail.lastIndexOf(node);
      out.net = { level, cluster: cluster || model.nodeById.get(node).cluster, trail, pos };
      out.sel = { kind: 'node', id: node };
    } else {
      out.net = { level, cluster: level === 'cluster' ? cluster : null, trail: [], pos: -1 };
      out.sel = null;
    }
  } else {
    out.sel = node ? { kind: 'node', id: node } : null;
  }
  return out;
}

// 哪些变化值得占一个"后退"步：视角、层级、研究线、中心节点
export function isStep(a, b) {
  if (!a || !b) return true;
  if (a.view !== b.view) return true;
  if (a.view === 'network') return a.net.level !== b.net.level || a.net.cluster !== b.net.cluster || a.net.trail[a.net.pos] !== b.net.trail[b.net.pos];
  return false;
}
