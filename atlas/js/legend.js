// 图例：只列当前画面上实际出现的东西。
// 视角提供 { nodes, edges, overview, gaps }，这里按固定顺序挑出出现过的类型、状态、形状和角标。
import { REL_TYPES, REL, STATUSES, STATUS, KINDS, KIND, relColor } from './encoding.js';
import { drawShape, drawCornerBadge, styleEdgePath, miniSvg } from './glyph.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lineSample(e, { proc = false } = {}) {
  const s = miniSvg(46, 16);
  styleEdgePath(s.append('path').attr('d', 'M4,8 L40,8'), e);
  if (proc) s.append('circle').attr('class', 'edge-proc').attr('cx', 22).attr('cy', 8).attr('r', 4).style('stroke', relColor(e.type));
  return s.node();
}
function row(sample, label, note) {
  const li = document.createElement('li');
  const sw = document.createElement('span'); sw.className = 'lg-sw';
  if (sample) sw.appendChild(sample);
  const t = document.createElement('span'); t.className = 'lg-t';
  t.innerHTML = `<b>${esc(label)}</b>${note ? `<span class="lg-n">${esc(note)}</span>` : ''}`;
  li.append(sw, t);
  return li;
}
function section(title, items) {
  const sec = document.createElement('section');
  sec.innerHTML = `<h4>${esc(title)}</h4>`;
  const ul = document.createElement('ul');
  items.forEach(i => ul.appendChild(i));
  sec.appendChild(ul);
  return sec;
}

export function renderLegend(el, { nodes = [], edges = [], overview = false, gaps = false, digested = new Set() } = {}) {
  el.innerHTML = '';
  if (overview) {
    const bubble = main => { const s = miniSvg(46, 26); s.append('circle').attr('cx', 23).attr('cy', 13).attr('r', 11).attr('class', 'ov-core'); if (main) s.select('circle').attr('style', 'fill:var(--accent-fill);stroke:var(--accent);stroke-width:2'); return s.node(); };
    const link = () => { const s = miniSvg(46, 16); s.append('path').attr('d', 'M4,8 L42,8').attr('class', 'ov-link-line').style('stroke-width', 3.4); s.append('circle').attr('cx', 23).attr('cy', 8).attr('r', 7).attr('class', 'ov-link-badge'); return s.node(); };
    const ring = () => { const s = miniSvg(46, 26); s.append('circle').attr('cx', 23).attr('cy', 13).attr('r', 10).attr('class', 'ov-ring-bg'); s.append('path').attr('d', 'M23,3 A10,10 0 0 1 33,13').attr('class', 'ov-ring'); return s.node(); };
    const items = [
      row(bubble(true), '主线研究线', '气泡越大，节点越多'),
      row(bubble(false), '其他研究线', ''),
      row(link(), '汇总连线', '越粗关系越多，圆里是条数'),
      row(ring(), '外圈绿弧', '已消化的比例'),
    ];
    if (gaps) {
      const s = miniSvg(46, 24); const g = s.append('g').attr('class', 'ov-gap').attr('transform', 'translate(23,12)');
      g.append('circle').attr('r', 10); g.append('text').attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text('3');
      items.push(row(s.node(), '琥珀徽章', '相关空缺问题数'));
    }
    el.appendChild(section('研究线概览', items));
  }

  const types = REL_TYPES.filter(t => edges.some(e => e.type === t));
  if (types.length) el.appendChild(section('关系类型', types.map(t => row(lineSample({ type: t, status: '确立' }), t, REL[t].meaning))));
  const sts = STATUSES.filter(s => edges.some(e => e.status === s));
  if (sts.length) el.appendChild(section('关系状态', sts.map(s => row(lineSample({ type: '继承', status: s }), s, STATUS[s].rule))));
  const hasProc = edges.some(e => e.basis === '加工'), hasSrc = edges.some(e => e.basis === '来源');
  if (hasProc || hasSrc) {
    const items = [];
    if (hasSrc) items.push(row(lineSample({ type: '解释', status: '确立' }), '来源', '文献结论'));
    if (hasProc) items.push(row(lineSample({ type: '解释', status: '确立' }, { proc: true }), '加工', '中点空心圆 = Claude 的推断或连接'));
    el.appendChild(section('关系依据', items));
  }

  const kinds = KINDS.filter(k => nodes.some(n => n.kind === k));
  if (kinds.length) {
    el.appendChild(section('节点类型', kinds.map(k => {
      const s = miniSvg(46, 22);
      drawShape(s.append('g').attr('transform', 'translate(23,11)'), { kind: k, w: 40, h: 18, ai: false });
      return row(s.node(), k, KIND[k].desc);
    })));
    const fills = [];
    if (nodes.some(n => n.ai_related)) fills.push(true);
    if (nodes.some(n => !n.ai_related)) fills.push(false);
    el.appendChild(section('节点填充', fills.map(ai => {
      const s = miniSvg(46, 22);
      drawShape(s.append('g').attr('transform', 'translate(23,11)'), { kind: '现象', w: 40, h: 18, ai });
      return row(s.node(), ai ? 'AI 相关' : '其他', ai ? '浅粉填充' : '中性浅灰');
    })));
    const marks = [];
    if (nodes.some(n => n.unverified)) marks.push(['q', '?', '据已有知识补充，本次未经检索核验']);
    if (nodes.some(n => Array.isArray(n.alerts) && n.alerts.length)) marks.push(['alert', '!', '有重要警示，详见详情']);
    if (nodes.some(n => digested.has(n.id))) marks.push(['done', '✓', '我已消化']);
    if (marks.length) el.appendChild(section('角标', marks.map(([type, label, note]) => {
      const s = miniSvg(46, 18); drawCornerBadge(s, type, 23, 9); return row(s.node(), label, note);
    })));
  }
  if (!el.children.length) el.innerHTML = '<p class="lg-empty">当前画面没有需要说明的图形。</p>';
}
