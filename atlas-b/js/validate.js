// 内容包校验：浏览器加载时和命令行 tools/validate.mjs 共用同一套规则。
// 返回问题列表，每项 { where: 哪条数据, field: 哪个字段, msg: 什么问题 }。不修改数据。
import {
  REL_TYPES, STATUSES, BASES, KINDS, EVIDENCES, CROWDINGS, GAP_STATUSES, SIDES, TEXT_LIMITS,
} from './encoding.js';

const isStr = v => typeof v === 'string';
const isNonEmpty = v => isStr(v) && v.trim() !== '';
const isBool = v => typeof v === 'boolean';
const len = s => [...String(s ?? '')].length;   // 按字符计数（中文一个字算 1）

export function validatePack(pack) {
  const issues = [];
  const add = (where, field, msg) => issues.push({ where, field, msg });

  if (!pack || typeof pack !== 'object') { add('内容包', '-', '不是一个 JSON 对象'); return issues; }
  const domain = pack.domain && typeof pack.domain === 'object' ? pack.domain : null;
  const nodes = Array.isArray(pack.nodes) ? pack.nodes : [];
  const edges = Array.isArray(pack.edges) ? pack.edges : [];
  const gaps = Array.isArray(pack.gaps) ? pack.gaps : [];
  if (!domain) add('内容包', 'domain', '缺少 domain');
  if (!Array.isArray(pack.nodes)) add('内容包', 'nodes', '缺少 nodes 数组');
  if (!Array.isArray(pack.edges)) add('内容包', 'edges', '缺少 edges 数组');
  if (!Array.isArray(pack.gaps)) add('内容包', 'gaps', '缺少 gaps 数组');

  const enumCheck = (where, field, v, allowed) => {
    if (!allowed.includes(v)) add(where, field, `取值「${v ?? '（空）'}」不合法，应为：${allowed.join(' / ')}`);
  };
  const need = (obj, where, fields) => {
    for (const f of fields) if (obj[f] === undefined || obj[f] === null) add(where, f, '字段缺失');
  };

  // ---- domain / clusters ----
  const clusters = domain && Array.isArray(domain.clusters) ? domain.clusters : [];
  if (domain) {
    need(domain, 'domain', ['pack_id', 'title', 'clusters']);
    clusters.forEach((c, i) => {
      const where = `研究线 ${c?.id ?? '#' + (i + 1)}`;
      need(c, where, ['id', 'name', 'side', 'main', 'anchor']);
      if (c.side !== undefined) enumCheck(where, 'side', c.side, SIDES);
      if (c.main !== undefined && !isBool(c.main)) add(where, 'main', '应为 true / false');
      if (c.anchor !== undefined) {
        const a = c.anchor;
        if (!Array.isArray(a) || a.length !== 2 || a.some(v => typeof v !== 'number' || v < 0 || v > 1))
          add(where, 'anchor', '应为 [x, y]，两个 0–1 之间的数');
      }
    });
    const tb = domain.timeline_breaks;
    if (tb !== undefined) {
      if (!Array.isArray(tb) || !tb.length) add('domain', 'timeline_breaks', '应为非空数组');
      else {
        let sum = 0;
        tb.forEach((b, i) => {
          const where = `时间轴分段 #${i + 1}`;
          if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || b.from >= b.to) add(where, 'from/to', '应为整数且 from < to');
          if (typeof b.share !== 'number' || b.share <= 0) add(where, 'share', '应为大于 0 的数');
          else sum += b.share;
          if (i > 0 && tb[i - 1].to !== b.from) add(where, 'from', `应与上一段的 to（${tb[i - 1].to}）相接`);
        });
        if (Math.abs(sum - 1) > 0.011) add('domain', 'timeline_breaks', `各段 share 之和为 ${sum.toFixed(2)}，应为 1`);
      }
    }
  }

  // ---- 规则 1：所有 id 唯一 ----
  const seen = new Map();
  const reg = (id, where) => {
    if (!isNonEmpty(id)) { add(where, 'id', '缺少 id'); return; }
    if (seen.has(id)) add(id, 'id', `编号重复（与${seen.get(id)}重复）`);
    else seen.set(id, where.replace(/ .*/, ''));
  };
  clusters.forEach((c, i) => reg(c?.id, `研究线 #${i + 1}`));
  nodes.forEach((n, i) => reg(n?.id, `节点 #${i + 1}`));
  edges.forEach((e, i) => reg(e?.id, `关系 #${i + 1}`));
  gaps.forEach((g, i) => reg(g?.id, `空缺 #${i + 1}`));

  const nodeIds = new Set(nodes.map(n => n?.id));
  const gapIds = new Set(gaps.map(g => g?.id));
  const clusterIds = new Set(clusters.map(c => c?.id));

  // ---- nodes ----
  nodes.forEach((n, i) => {
    const where = n?.id || `节点 #${i + 1}`;
    need(n, where, ['name', 'name_en', 'kind', 'cluster', 'year', 'evidence', 'crowding', 'gist', 'gist_basis', 'refs', 'ai_related', 'unverified']);
    if (n.kind !== undefined) enumCheck(where, 'kind', n.kind, KINDS);                       // 规则 3
    if (n.evidence !== undefined) enumCheck(where, 'evidence', n.evidence, EVIDENCES);
    if (n.crowding !== undefined) enumCheck(where, 'crowding', n.crowding, CROWDINGS);
    if (n.gist_basis !== undefined) enumCheck(where, 'gist_basis', n.gist_basis, BASES);
    if (n.gist !== undefined && len(n.gist) > TEXT_LIMITS.gist)                            // 规则 4
      add(where, 'gist', `${len(n.gist)} 字，超过 ${TEXT_LIMITS.gist} 字上限`);
    if (n.year !== undefined && (!Number.isInteger(n.year) || n.year < 1900 || n.year > 2100)) // 规则 5
      add(where, 'year', `「${n.year}」不是 1900–2100 的整数`);
    if (n.cluster !== undefined && !clusterIds.has(n.cluster))                               // 规则 6
      add(where, 'cluster', `研究线「${n.cluster}」不存在于 domain.clusters`);
    if (n.refs !== undefined && (!Array.isArray(n.refs) || n.refs.some(r => !isStr(r)))) add(where, 'refs', '应为字符串数组');
    if (n.alerts !== undefined && (!Array.isArray(n.alerts) || n.alerts.some(r => !isStr(r)))) add(where, 'alerts', '应为字符串数组');
    if (n.ai_related !== undefined && !isBool(n.ai_related)) add(where, 'ai_related', '应为 true / false');
    if (n.unverified !== undefined && !isBool(n.unverified)) add(where, 'unverified', '应为 true / false');
  });

  // ---- edges ----
  const pairs = new Map();
  edges.forEach((e, i) => {
    const where = e?.id || `关系 #${i + 1}`;
    need(e, where, ['from', 'to', 'type', 'status', 'basis', 'reason']);
    if (e.from !== undefined && !nodeIds.has(e.from)) add(where, 'from', `指向不存在的节点「${e.from}」`); // 规则 2
    if (e.to !== undefined && !nodeIds.has(e.to)) add(where, 'to', `指向不存在的节点「${e.to}」`);
    if (e.from !== undefined && e.from === e.to) add(where, 'from/to', '起点和终点是同一个节点');
    if (e.gap !== undefined && e.gap !== null && e.gap !== '' && !gapIds.has(e.gap)) add(where, 'gap', `指向不存在的空缺「${e.gap}」`);
    if (e.type !== undefined) enumCheck(where, 'type', e.type, REL_TYPES);                     // 规则 3
    if (e.status !== undefined) enumCheck(where, 'status', e.status, STATUSES);
    if (e.basis !== undefined) enumCheck(where, 'basis', e.basis, BASES);
    if (e.reason !== undefined && len(e.reason) > TEXT_LIMITS.reason)                          // 规则 4
      add(where, 'reason', `${len(e.reason)} 字，超过 ${TEXT_LIMITS.reason} 字上限`);
    if (e.basis === '加工' && !isNonEmpty(e.ref)) add(where, 'ref', '依据为「加工」的关系必须填写 ref'); // 规则 7
    if (e.unverified !== undefined && !isBool(e.unverified)) add(where, 'unverified', '应为 true / false');
    // 规则 8：同一对节点、同一类型不重复（"对应"不分方向）
    if (e.from && e.to && e.type) {
      const k = e.type === '对应' ? [e.from, e.to].sort().join('|') + '|' + e.type : `${e.from}|${e.to}|${e.type}`;
      if (pairs.has(k)) add(where, 'type', `与 ${pairs.get(k)} 重复：${e.from} 和 ${e.to} 之间已有一条「${e.type}」`);
      else pairs.set(k, where);
    }
  });

  // ---- gaps ----
  gaps.forEach((g, i) => {
    const where = g?.id || `空缺 #${i + 1}`;
    need(g, where, ['title', 'status', 'nodes', 'summary']);
    if (g.status !== undefined) enumCheck(where, 'status', g.status, GAP_STATUSES);
    if (g.nodes !== undefined) {
      if (!Array.isArray(g.nodes)) add(where, 'nodes', '应为节点编号数组');
      else g.nodes.forEach(id => { if (!nodeIds.has(id)) add(where, 'nodes', `指向不存在的节点「${id}」`); });
    }
    if (g.key !== undefined && !isBool(g.key)) add(where, 'key', '应为 true / false');
  });

  return issues;
}

export function summarizePack(pack) {
  const n = k => (Array.isArray(pack?.[k]) ? pack[k].length : 0);
  const c = Array.isArray(pack?.domain?.clusters) ? pack.domain.clusters.length : 0;
  return `${n('nodes')} 个节点、${n('edges')} 条关系、${n('gaps')} 个空缺、${c} 条研究线`;
}
