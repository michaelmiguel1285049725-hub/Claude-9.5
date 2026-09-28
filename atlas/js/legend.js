// 图例：全部由编码表生成，保证和画布上的画法一致。常驻左下角，可折叠。
import { REL_TYPES, REL, STATUSES, STATUS, KINDS, KIND, EVIDENCE, CROWDINGS, CROWDING, relColor } from './encoding.js';
import { drawShape, drawEvidenceBadge, drawCrowding, drawCornerBadge, styleEdgePath, miniSvg } from './glyph.js';

const d3 = window.d3;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lineSample(e, { proc = false } = {}) {
  const s = miniSvg(46, 16);
  const path = s.append('path').attr('d', 'M4,8 L40,8');
  styleEdgePath(path, e);
  if (proc) s.append('circle').attr('class', 'edge-proc').attr('cx', 22).attr('cy', 8).attr('r', 4).style('stroke', relColor(e.type));
  return s.node();
}

function row(sample, label, note) {
  const li = document.createElement('li');
  const sw = document.createElement('span'); sw.className = 'lg-sw';
  if (sample) sw.appendChild(sample);
  li.appendChild(sw);
  const t = document.createElement('span'); t.className = 'lg-t';
  t.innerHTML = `<b>${esc(label)}</b>${note ? `<span class="lg-n">${esc(note)}</span>` : ''}`;
  li.appendChild(t);
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

export function buildLegend(el, model) {
  el.innerHTML = '<summary>图例</summary><div class="body"></div>';
  const body = el.querySelector('.body');

  body.appendChild(section('关系类型 · 颜色', REL_TYPES.map(t => row(lineSample({ type: t, status: '确立' }), t, REL[t].meaning))));
  body.appendChild(section('关系状态 · 线型', STATUSES.map(s => row(lineSample({ type: '继承', status: s }), s, STATUS[s].rule))));
  body.appendChild(section('关系依据', [
    row(lineSample({ type: '解释', status: '确立' }), '来源', '文献结论'),
    row(lineSample({ type: '解释', status: '确立' }, { proc: true }), '加工', '中点空心圆 = Claude 的推断或连接'),
  ]));

  body.appendChild(section('节点类型 · 形状', KINDS.map(k => {
    const s = miniSvg(46, 22);
    drawShape(s.append('g').attr('transform', 'translate(23,11)'), { kind: k, w: 40, h: 18, ai: false });
    return row(s.node(), k, KIND[k].desc);
  })));

  body.appendChild(section('节点填充', [true, false].map(ai => {
    const s = miniSvg(46, 22);
    drawShape(s.append('g').attr('transform', 'translate(23,11)'), { kind: '现象', w: 40, h: 18, ai });
    return row(s.node(), ai ? 'AI 相关' : '其他', ai ? '浅粉填充' : '中性浅灰');
  })));

  if (model.clusters.length) {
    body.appendChild(section('研究线 · 节点左上角色点与背景', model.clusters.map(c => {
      const s = miniSvg(46, 16);
      s.append('rect').attr('class', 'hull').attr('x', 3).attr('y', 1).attr('width', 40).attr('height', 14).attr('rx', 7).style('--cc', c.color);
      s.append('circle').attr('class', 'nd-cluster').attr('cx', 23).attr('cy', 8).attr('r', 4.5).style('fill', c.color);
      const li = row(s.node(), `${c.id} · ${c.name}`, c.main ? '主线' : '');
      if (c.main) li.classList.add('main');
      return li;
    })));
  }

  body.appendChild(section('证据等级 · 放大后显示', ['A', 'B', 'C', 'N/A'].map(ev => {
    const s = miniSvg(46, 16);
    drawEvidenceBadge(s, ev, 36, 8);
    return row(s.node(), ev, EVIDENCE[ev].meaning);
  })));

  body.appendChild(section('拥挤度 · 放大后显示', CROWDINGS.map(c => {
    const s = miniSvg(46, 16);
    drawCrowding(s, c, 32, 8);
    return row(s.node(), c, CROWDING[c].meaning);
  })));

  body.appendChild(section('角标', [
    ['q', '?', '据已有知识补充，本次未经检索核验'],
    ['alert', '!', '有重要警示，详见面板'],
    ['done', '✓', '我已消化'],
  ].map(([type, label, note]) => {
    const s = miniSvg(46, 18);
    drawCornerBadge(s, type, 23, 9);
    return row(s.node(), label, note);
  })));

  const p = document.createElement('p');
  p.className = 'lg-foot';
  p.textContent = '节点下方为编号；放大后再显示年份、拥挤度和证据等级。';
  body.appendChild(p);

  // 底部渐隐：提示还能往下滚（沿用 v3 的做法）
  const sync = () => el.classList.toggle('more', el.open && body.scrollTop + body.clientHeight < body.scrollHeight - 2);
  body.addEventListener('scroll', sync, { passive: true });
  el.addEventListener('toggle', sync);
  addEventListener('resize', sync);
  requestAnimationFrame(sync);
}
