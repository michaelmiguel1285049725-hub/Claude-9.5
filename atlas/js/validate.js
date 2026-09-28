/* 内容包校验。纯函数，浏览器与 Node（tools/validate.mjs）共用。
   返回 { errors, warnings, summary }。errors 阻断性问题（页面顶部红条列出）；warnings 只是提示。 */

export const ENUMS = {
  kind: ['理论', '现象', '方法', '发现', '概念'],
  evidence: ['A', 'B', 'C', 'N/A'],
  crowding: ['饱和', '活跃', '稀疏'],
  basis: ['来源', '加工'],
  edgeType: ['继承', '解释', '支持', '挑战', '修正', '削弱', '加剧', '对应'],
  edgeStatus: ['确立', '初步', '未验证'],
  gapStatus: ['几乎空白', '有初步工作', '已基本解决'],
  side: ['human', 'ai', 'both'],
};

export const LIMITS = { gist: 20, reason: 24, yearMin: 1900, yearMax: 2100 };

const len = (s) => Array.from(String(s ?? '')).length;
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isArr = Array.isArray;

export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  const err = (where, field, msg) => errors.push({ where, field, msg });
  const warn = (where, field, msg) => warnings.push({ where, field, msg });

  if (!pack || typeof pack !== 'object') {
    err('pack', '', '内容包不是一个 JSON 对象');
    return { errors, warnings, summary: {} };
  }
  const domain = pack.domain && typeof pack.domain === 'object' ? pack.domain : null;
  const nodes = isArr(pack.nodes) ? pack.nodes : [];
  const edges = isArr(pack.edges) ? pack.edges : [];
  const gaps = isArr(pack.gaps) ? pack.gaps : [];
  const clusters = domain && isArr(domain.clusters) ? domain.clusters : [];

  if (!domain) err('domain', '', '缺少 domain');
  if (!isArr(pack.nodes)) err('nodes', '', '缺少 nodes 数组');
  if (!isArr(pack.edges)) err('edges', '', '缺少 edges 数组');
  if (!isArr(pack.gaps)) err('gaps', '', '缺少 gaps 数组');
  if (domain && !isArr(domain.clusters)) err('domain', 'clusters', '缺少 clusters 数组');

  /* domain */
  if (domain) {
    for (const f of ['pack_id', 'title']) if (!isStr(domain[f]) || !domain[f]) err('domain', f, '缺少或不是字符串');
    if (isArr(domain.timeline_breaks)) {
      let total = 0;
      domain.timeline_breaks.forEach((b, i) => {
        const w = `domain.timeline_breaks[${i}]`;
        if (!Number.isFinite(b?.from) || !Number.isFinite(b?.to)) err(w, 'from/to', '必须是数字');
        else if (b.from >= b.to) err(w, 'from/to', 'from 必须小于 to');
        if (!Number.isFinite(b?.share) || b.share <= 0) err(w, 'share', '必须是大于 0 的数');
        else total += b.share;
        if (i > 0 && domain.timeline_breaks[i - 1]?.to !== b?.from) warn(w, 'from', '与上一段的 to 不衔接');
      });
      if (domain.timeline_breaks.length && Math.abs(total - 1) > 0.02) warn('domain.timeline_breaks', 'share', `各段 share 之和为 ${total.toFixed(2)}，不等于 1（会按比例归一化）`);
    }
  }

  /* 规则 1：所有 id 唯一（节点、关系、空缺、簇一起算） */
  const seen = new Map();
  const checkId = (kind, obj, i) => {
    const id = obj?.id;
    const where = `${kind}[${i}]`;
    if (!isStr(id) || !id) { err(where, 'id', '缺少 id'); return null; }
    if (seen.has(id)) err(id, 'id', `与 ${seen.get(id)} 的 id 重复`);
    else seen.set(id, where);
    return id;
  };
  clusters.forEach((c, i) => checkId('domain.clusters', c, i));
  nodes.forEach((n, i) => checkId('nodes', n, i));
  edges.forEach((e, i) => checkId('edges', e, i));
  gaps.forEach((g, i) => checkId('gaps', g, i));

  const clusterIds = new Set(clusters.map((c) => c?.id).filter(isStr));
  const nodeIds = new Set(nodes.map((n) => n?.id).filter(isStr));
  const gapIds = new Set(gaps.map((g) => g?.id).filter(isStr));

  /* clusters */
  clusters.forEach((c, i) => {
    const w = c?.id || `domain.clusters[${i}]`;
    if (!isStr(c?.name) || !c.name) err(w, 'name', '缺少名称');
    if (c?.side != null && !ENUMS.side.includes(c.side)) err(w, 'side', `取值 "${c.side}" 不合法（${ENUMS.side.join(' / ')}）`);
    if (c?.anchor != null && !(isArr(c.anchor) && c.anchor.length === 2 && c.anchor.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)))
      err(w, 'anchor', '应为 [x, y]，取值 0–1');
    if (c?.anchor == null) warn(w, 'anchor', '没有 anchor，关系网会把它放在画布中央附近');
  });

  /* nodes */
  nodes.forEach((n, i) => {
    const w = n?.id || `nodes[${i}]`;
    if (!isStr(n?.name) || !n.name) err(w, 'name', '缺少中文名');
    if (!isStr(n?.name_en)) err(w, 'name_en', '缺少英文名');
    /* 规则 3：枚举 */
    if (!ENUMS.kind.includes(n?.kind)) err(w, 'kind', `取值 "${n?.kind}" 不合法（${ENUMS.kind.join(' / ')}）`);
    if (!ENUMS.evidence.includes(n?.evidence)) err(w, 'evidence', `取值 "${n?.evidence}" 不合法（${ENUMS.evidence.join(' / ')}）`);
    if (!ENUMS.crowding.includes(n?.crowding)) err(w, 'crowding', `取值 "${n?.crowding}" 不合法（${ENUMS.crowding.join(' / ')}）`);
    if (!ENUMS.basis.includes(n?.gist_basis)) err(w, 'gist_basis', `取值 "${n?.gist_basis}" 不合法（来源 / 加工）`);
    /* 规则 6：cluster 存在 */
    if (!isStr(n?.cluster) || !clusterIds.has(n.cluster)) err(w, 'cluster', `研究线 "${n?.cluster}" 不在 domain.clusters 里`);
    /* 规则 5：年份 */
    if (!Number.isInteger(n?.year) || n.year < LIMITS.yearMin || n.year > LIMITS.yearMax) err(w, 'year', `应为 ${LIMITS.yearMin}–${LIMITS.yearMax} 的整数，现在是 ${JSON.stringify(n?.year)}`);
    /* 规则 4：gist 长度 */
    if (!isStr(n?.gist) || !n.gist) err(w, 'gist', '缺少一句话');
    else if (len(n.gist) > LIMITS.gist) err(w, 'gist', `${len(n.gist)} 字，超过 ${LIMITS.gist} 字`);
    if (!isArr(n?.refs)) err(w, 'refs', '应为字符串数组');
    else n.refs.forEach((r, j) => { if (!isStr(r)) err(w, `refs[${j}]`, '不是字符串'); });
    if (!isBool(n?.ai_related)) err(w, 'ai_related', '应为布尔值');
    if (!isBool(n?.unverified)) err(w, 'unverified', '应为布尔值');
    if (n?.alerts != null && !(isArr(n.alerts) && n.alerts.every(isStr))) err(w, 'alerts', '应为字符串数组');
    if (n?.note != null && !isStr(n.note)) err(w, 'note', '应为字符串');
  });

  /* edges */
  const pairSeen = new Map();
  edges.forEach((e, i) => {
    const w = e?.id || `edges[${i}]`;
    /* 规则 2：端点与 gap 存在 */
    if (!isStr(e?.from) || !nodeIds.has(e.from)) err(w, 'from', `指向不存在的节点 "${e?.from}"`);
    if (!isStr(e?.to) || !nodeIds.has(e.to)) err(w, 'to', `指向不存在的节点 "${e?.to}"`);
    if (isStr(e?.from) && e.from === e.to) err(w, 'from/to', '起点和终点是同一个节点');
    if (e?.gap != null && (!isStr(e.gap) || !gapIds.has(e.gap))) err(w, 'gap', `指向不存在的空缺 "${e?.gap}"`);
    /* 规则 3：枚举 */
    if (!ENUMS.edgeType.includes(e?.type)) err(w, 'type', `取值 "${e?.type}" 不合法（${ENUMS.edgeType.join(' / ')}）`);
    if (!ENUMS.edgeStatus.includes(e?.status)) err(w, 'status', `取值 "${e?.status}" 不合法（${ENUMS.edgeStatus.join(' / ')}）`);
    if (!ENUMS.basis.includes(e?.basis)) err(w, 'basis', `取值 "${e?.basis}" 不合法（来源 / 加工）`);
    /* 规则 4：reason 长度 */
    if (!isStr(e?.reason) || !e.reason) err(w, 'reason', '缺少理由');
    else if (len(e.reason) > LIMITS.reason) err(w, 'reason', `${len(e.reason)} 字，超过 ${LIMITS.reason} 字`);
    /* 规则 7：加工必须有 ref */
    if (e?.basis === '加工' && (!isStr(e.ref) || !e.ref.trim())) err(w, 'ref', '依据为「加工」的关系必须填写 ref');
    if (e?.ref != null && !isStr(e.ref)) err(w, 'ref', '应为字符串');
    if (!isBool(e?.unverified)) err(w, 'unverified', '应为布尔值');
    /* 规则 8：同一对节点、同一类型不重复（不分方向） */
    if (isStr(e?.from) && isStr(e?.to) && isStr(e?.type)) {
      const key = [e.from, e.to].sort().join('|') + '|' + e.type;
      if (pairSeen.has(key)) err(w, 'from/to/type', `与 ${pairSeen.get(key)} 重复：同一对节点之间已有「${e.type}」关系`);
      else pairSeen.set(key, w);
    }
    if (e?.status === '未验证' && e?.gap == null) warn(w, 'gap', '状态为「未验证」但没有关联空缺问题');
  });

  /* gaps */
  const gapsWithEdges = new Set(edges.map((e) => e?.gap).filter(isStr));
  gaps.forEach((g, i) => {
    const w = g?.id || `gaps[${i}]`;
    if (!isStr(g?.title) || !g.title) err(w, 'title', '缺少标题');
    if (!ENUMS.gapStatus.includes(g?.status)) err(w, 'status', `取值 "${g?.status}" 不合法（${ENUMS.gapStatus.join(' / ')}）`);
    if (!isArr(g?.nodes)) err(w, 'nodes', '应为节点 id 数组');
    else g.nodes.forEach((x) => { if (!nodeIds.has(x)) err(w, 'nodes', `指向不存在的节点 "${x}"`); });
    if (!isStr(g?.summary)) err(w, 'summary', '缺少一句话');
    if (!isBool(g?.key)) err(w, 'key', '应为布尔值');
    if (isStr(g?.id) && !gapsWithEdges.has(g.id)) warn(w, '', '没有任何关系线的 gap 字段指向它，高亮时只会显示它的节点');
  });

  /* 孤立节点 */
  const linked = new Set();
  edges.forEach((e) => { linked.add(e?.from); linked.add(e?.to); });
  nodes.forEach((n) => { if (isStr(n?.id) && !linked.has(n.id)) warn(n.id, '', '没有任何关系线'); });

  return {
    errors,
    warnings,
    summary: { nodes: nodes.length, edges: edges.length, gaps: gaps.length, clusters: clusters.length },
  };
}
