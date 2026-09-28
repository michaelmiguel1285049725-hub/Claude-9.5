// 节点与关系的绘制原件，三个视角和图例共用，保证同一种含义处处长得一样。
import { REL, REL_TYPES, KIND, EVIDENCE, CROWDING, relColor } from './encoding.js';

const d3 = window.d3;
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- 文字宽度估算 ----------
// 不用浏览器实测，而用字符数估算：这样节点尺寸在任何电脑上都一样，布局才稳定。
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿“”‘’]/;
export function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    if (WIDE.test(ch)) w += size;
    else if (ch === ' ') w += size * 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += size * 0.62;
    else w += size * 0.52;
  }
  return w;
}
const monoWidth = (s, size) => [...String(s)].length * size * 0.6;

// 把名字切成词元：中文逐字，英文按单词
function tokens(s) { return String(s).match(/[A-Za-z0-9.+\-–'’/&]+|\s+|./gu) || []; }

// 最多 maxLines 行，超出省略
export function wrapText(s, size, maxWidth, maxLines = 2) {
  const total = textWidth(s, size);
  if (total <= maxWidth) return [String(s)];
  const target = Math.min(maxWidth, Math.ceil(total / maxLines) + size);
  const lines = [];
  let cur = '';
  for (const t of tokens(s)) {
    if (cur && textWidth(cur + t, size) > target && lines.length < maxLines - 1) {
      lines.push(cur.trim());
      cur = t.trimStart();
    } else cur += t;
  }
  lines.push(cur.trim());
  let last = lines[lines.length - 1];
  if (textWidth(last, size) > maxWidth) {
    while (last.length && textWidth(last + '…', size) > maxWidth) last = [...last].slice(0, -1).join('');
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

// ---------- 节点尺寸 ----------
// 所有节点卡片统一 168×40：一行"编号 + 中文名"。名称放不下先缩到 12px，再放不下就省略（完整名在悬停提示里）。
// 透镜中心卡片 180×60：两行（编号、名称）。
export const CARD = { w: 168, h: 40, idSize: 12, nameSize: 13, minNameSize: 12, pad: 11, gap: 7 };
export const CENTER = { w: 180, h: 60, idSize: 13, nameSize: 15, pad: 12 };

function fitLine(text, size, minSize, maxWidth) {
  if (textWidth(text, size) <= maxWidth) return { text, size };
  if (textWidth(text, minSize) <= maxWidth) return { text, size: minSize };
  let t = String(text);
  while (t.length && textWidth(t + '…', minSize) > maxWidth) t = [...t].slice(0, -1).join('');
  return { text: t + '…', size: minSize, cut: true };
}

export function nodeBox(n) {
  const idW = monoWidth(n.id, CARD.idSize);
  const name = fitLine(n.name || n.id, CARD.nameSize, CARD.minNameSize, CARD.w - CARD.pad * 2 - idW - CARD.gap);
  return { w: CARD.w, h: CARD.h, idW, name };
}

export function centerBox(n) {
  const name = fitLine(n.name || n.id, CENTER.nameSize, 13, CENTER.w - CENTER.pad * 2);
  return { w: CENTER.w, h: CENTER.h, name, center: true };
}

// ---------- 形状 ----------
function shapeRadius(kind, h) {
  switch (KIND[kind]?.shape) {
    case 'theory': return 3;
    case 'method': return h / 2;
    case 'finding': return 6;
    default: return 8;           // 现象、概念
  }
}

// 画节点外形（不含文字），g 为 d3 选择集，坐标以中心为原点
export function drawShape(g, { kind, w, h, ai }) {
  const x = -w / 2, y = -h / 2, r = shapeRadius(kind, h);
  const shape = KIND[kind]?.shape || 'phenom';
  g.append('rect').attr('class', `nd-shape shape-${shape}${ai ? ' is-ai' : ''}`)
    .attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', r).attr('ry', r);
  if (shape === 'finding') {
    // 左侧粗色条：与圆角吻合的半圆角条
    g.append('path').attr('class', `nd-bar${ai ? ' is-ai' : ''}`)
      .attr('d', `M${x + 6},${y} L${x + 6},${y + h} A6,6 0 0 1 ${x},${y + h - 6} L${x},${y + 6} A6,6 0 0 1 ${x + 6},${y} Z`);
  }
}

// 证据徽章：A 绿、B 琥珀、C 灰、N/A 虚线空心。返回宽度
export function drawEvidenceBadge(g, ev, xRight, yMid) {
  const key = EVIDENCE[ev]?.key || 'na';
  const label = ev || '?';
  const w = Math.max(16, Math.round(monoWidth(label, 11) + 8));
  const b = g.append('g').attr('class', `ev-badge ev-${key}`);
  b.append('rect').attr('x', xRight - w).attr('y', yMid - 7).attr('width', w).attr('height', 14).attr('rx', 3);
  b.append('text').attr('x', xRight - w / 2).attr('y', yMid).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(label);
  return w;
}

// 拥挤度：三个小点，实心个数 = 饱和 3 / 活跃 2 / 稀疏 1
export function drawCrowding(g, crowding, xRight, yMid) {
  const lv = CROWDING[crowding]?.level || 0;
  const c = g.append('g').attr('class', 'crowd');
  for (let i = 0; i < 3; i++) {
    c.append('circle').attr('cx', xRight - 2.4 - (2 - i) * 6).attr('cy', yMid).attr('r', 2.4)
      .attr('class', i < lv ? 'on' : 'off');
  }
  return 17;
}

// 角标："?" 未核验、"!" 警示、"✓" 已消化
export function drawCornerBadge(g, type, cx, cy) {
  const b = g.append('g').attr('class', `corner corner-${type}`).attr('transform', `translate(${cx},${cy})`);
  b.append('circle').attr('r', 7.5);
  if (type === 'done') b.append('path').attr('d', 'M-3.4,0.2 L-1,2.7 L3.6,-2.4');
  else b.append('text').attr('text-anchor', 'middle').attr('dominant-baseline', 'central').attr('y', 0.5).text(type === 'alert' ? '!' : '?');
  return b;
}

// 完整节点卡片：外形 + 编号 + 名称 + 研究线色点 + 角标（"?" 未核验、"!" 警示、"✓" 已消化）。
export function drawNode(g, n, box, { clusterColor, digested = false } = {}) {
  const { w, h } = box;
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  drawShape(g, { kind: n.kind, w, h, ai: !!n.ai_related });
  if (box.center) {
    g.append('text').attr('class', 'nd-id center').attr('x', 0).attr('y', -9).attr('text-anchor', 'middle').attr('dominant-baseline', 'central').text(n.id);
    g.append('text').attr('class', 'nd-name center').attr('x', 0).attr('y', 11).attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .style('font-size', box.name.size + 'px').text(box.name.text);
  } else {
    const shift = KIND[n.kind]?.shape === 'finding' ? 4 : 0;   // 左侧色条让出位置
    g.append('text').attr('class', 'nd-id').attr('x', x0 + CARD.pad + shift).attr('y', 0).attr('dominant-baseline', 'central').text(n.id);
    g.append('text').attr('class', 'nd-name').attr('x', x0 + CARD.pad + shift + box.idW + CARD.gap).attr('y', 0).attr('dominant-baseline', 'central')
      .style('font-size', box.name.size + 'px').text(box.name.text);
  }
  // 研究线色点：跨在左上角的边框上
  g.append('circle').attr('class', 'nd-cluster').attr('cx', x0 + 12).attr('cy', y0).attr('r', 4.5).style('fill', clusterColor);
  // 右上角：先放 "!"，再往左放 "?"
  let cx = x1 - 11;
  if (Array.isArray(n.alerts) && n.alerts.length) { drawCornerBadge(g, 'alert', cx, y0); cx -= 18; }
  if (n.unverified) drawCornerBadge(g, 'q', cx, y0);
  if (digested) drawCornerBadge(g, 'done', x0 + 12, y1);
}

// ---------- 箭头 marker ----------
// 每种关系单独一个 marker，颜色直接写死在 marker 里（不依赖 context-stroke）。
// markerUnits=userSpaceOnUse：箭头大小不随线宽变化。
const HEADS = {
  arrow:  { vb: [10, 8],  ref: [9.5, 4], draw: m => m.append('path').attr('d', 'M0,0 L10,4 L0,8 Z').attr('class', 'mk-fill') },
  solid:  { vb: [12, 12], ref: [11.5, 6], draw: m => m.append('path').attr('d', 'M0,0 L12,6 L0,12 Z').attr('class', 'mk-fill') },
  hollow: { vb: [13, 12], ref: [12, 6], draw: m => m.append('path').attr('d', 'M1,1 L12,6 L1,11 Z').attr('class', 'mk-hollow') },
  tee:    { vb: [4, 14],  ref: [3, 7],  draw: m => m.append('path').attr('d', 'M2,0 L2,14').attr('class', 'mk-tee') },
  double: { vb: [13, 10], ref: [12, 5], draw: m => m.append('path').attr('d', 'M1,1 L6,5 L1,9 M7,1 L12,5 L7,9').attr('class', 'mk-double') },
  dots:   { vb: [8, 8],   ref: [4, 4],  draw: m => m.append('circle').attr('cx', 4).attr('cy', 4).attr('r', 3).attr('class', 'mk-fill') },
};

export const markerId = type => `mk-${REL[type]?.key || 'inherit'}`;

export function defineMarkers(defsSel) {
  for (const t of REL_TYPES) {
    const spec = HEADS[REL[t].head];
    const m = defsSel.append('marker').attr('id', markerId(t))
      .attr('viewBox', `0 0 ${spec.vb[0]} ${spec.vb[1]}`)
      .attr('markerWidth', spec.vb[0]).attr('markerHeight', spec.vb[1])
      .attr('refX', spec.ref[0]).attr('refY', spec.ref[1])
      .attr('markerUnits', 'userSpaceOnUse').attr('orient', 'auto')
      .style('--mc', relColor(t));
    spec.draw(m);
  }
}

// 给一条关系线设置颜色、线型、箭头
export function styleEdgePath(sel, e) {
  const rel = REL[e.type] || REL['继承'];
  sel.attr('class', `edge-line rel-${rel.key} st-${e.status === '确立' ? 'solid' : e.status === '初步' ? 'dash' : 'dot'}`)
    .style('stroke', relColor(e.type))
    .style('stroke-width', rel.width)
    .attr('marker-end', `url(#${markerId(e.type)})`);
  if (rel.head === 'dots') sel.attr('marker-start', `url(#${markerId(e.type)})`);
}

// 在一个独立小 SVG 里画节点样例（图例用）
export function miniSvg(w, h) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  return d3.select(svg);
}

// 关系线小样（HTML 字符串，筛选栏和面板用），与画布上的画法一致
export function relSampleSvg(type, status = '确立', w = 30) {
  const rel = REL[type] || REL['继承'];
  const st = status === '确立' ? 'solid' : status === '初步' ? 'dash' : 'dot';
  const mk = `url(#${markerId(type)})`;
  return `<svg class="rel-sample" width="${w}" height="10" aria-hidden="true"><path d="M2,5 L${w - 4},5" class="edge-line st-${st}" style="stroke:${relColor(type)};stroke-width:${rel.width}" marker-end="${mk}"${rel.head === 'dots' ? ` marker-start="${mk}"` : ''}/></svg>`;
}
