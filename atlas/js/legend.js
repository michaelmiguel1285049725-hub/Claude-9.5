/* 动态图例：只列出当前画面上实际出现的关系类型、状态、依据、节点形状、填充、角标。通过扫描当前视角 SVG 里未隐藏的元素得到。 */
import * as enc from './encoding.js';
import { esc } from './tooltip.js';

function swLine(rel) {
  const c = `var(--rel-${rel.key})`;
  const start = rel.both ? ` marker-start="url(#mk-${rel.key}-start)"` : '';
  return `<svg class="sw" style="--c:${c}" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M4 8 L40 8" stroke-width="${rel.width}" marker-end="url(#mk-${rel.key})"${start}/></svg>`;
}
function swDash(dash) { return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`; }
function swProc() { return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"/><circle class="proc" cx="22" cy="8" r="4"/></svg>`; }
function swSummary() { return `<svg class="sw" style="--c:var(--muted)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8" stroke-width="4" style="opacity:.6"/><circle cx="22" cy="8" r="6" style="fill:var(--panel);stroke:var(--muted);stroke-width:1"/><text x="22" y="11" style="font:600 8px var(--mono);text-anchor:middle;fill:var(--ink-2)">5</text></svg>`; }

const isShown = (el) => !el.classList.contains('hidden') && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';

export function collectVisible(svgEl) {
  const out = { types: new Set(), status: new Set(), basis: new Set(), kinds: new Set(), ai: false, human: false, unverified: false, alert: false, digested: false, summary: false, bubbles: false, gaps: false, badges: svgEl.hasAttribute('data-badges') };
  for (const e of svgEl.querySelectorAll('g.edge')) {
    if (!isShown(e)) continue;
    out.types.add(e.dataset.type); out.status.add(e.dataset.status); out.basis.add(e.dataset.basis);
  }
  for (const n of svgEl.querySelectorAll('g.node')) {
    if (!isShown(n)) continue;
    out.kinds.add(n.dataset.kind);
    if (n.dataset.ai === '1') out.ai = true; else out.human = true;
    if (n.querySelector('.mark.unverified')) out.unverified = true;
    if (n.querySelector('.mark.alert')) out.alert = true;
    if (n.classList.contains('digested')) out.digested = true;
  }
  for (const l of svgEl.querySelectorAll('g.clink')) if (isShown(l)) { out.summary = true; break; }
  for (const b of svgEl.querySelectorAll('g.bubble')) if (isShown(b)) { out.bubbles = true; break; }
  for (const g of svgEl.querySelectorAll('g.gapcard')) if (isShown(g)) { out.gaps = true; break; }
  return out;
}

export function renderLegend(container, model, svgEl) {
  const v = collectVisible(svgEl);
  const parts = [];
  const li = (sw, name, ex) => `<li>${sw}<span>${esc(name)}</span>${ex ? `<span class="ex">${esc(ex)}</span>` : ''}</li>`;
  const types = enc.REL.filter((r) => v.types.has(r.zh));
  if (types.length) parts.push(`<section><h4>关系类型 · 颜色（箭头 A → B）</h4><ul>${types.map((r) => li(swLine(r), r.zh, r.desc)).join('')}</ul></section>`);
  const st = enc.STATUS_ORDER.filter((s) => v.status.has(s));
  if (st.length) parts.push(`<section><h4>状态 · 线型</h4><ul>${st.map((s) => li(swDash(enc.STATUS[s].dash), s, enc.STATUS[s].rule)).join('')}</ul></section>`);
  if (v.basis.size) parts.push(`<section><h4>依据</h4><ul>${v.basis.has('来源') ? li(swDash(null), '来源', '文献结论') : ''}${v.basis.has('加工') ? li(swProc(), '加工', 'Claude 的推断或连接（中点空心圆）') : ''}</ul></section>`);
  if (v.summary) parts.push(`<section><h4>研究线之间的汇总连线</h4><ul>${li(swSummary(), '汇总连线', '粗细 = 关系数，圆徽章写数字；悬停看分项')}</ul></section>`);
  if (v.bubbles) parts.push(`<section><h4>研究线气泡</h4><ul>${li('<span class="bubble-sw"></span>', '气泡', '大小 = 节点数；外圈 = 学习进度')}</ul></section>`);
  const shapes = { 理论: '<span class="shape" style="border-radius:3px"></span>', 现象: '<span class="shape" style="border-radius:8px"></span>', 方法: '<span class="shape" style="border-radius:999px"></span>', 发现: '<span class="shape bar" style="border-radius:6px"></span>', 概念: '<span class="shape" style="border-radius:6px;border-style:dashed"></span>' };
  const kinds = enc.KIND_ORDER.filter((k) => v.kinds.has(k));
  if (kinds.length) parts.push(`<section><h4>节点形状 · 类型</h4><ul>${kinds.map((k) => li(shapes[k], k, k === '发现' ? '左侧粗色条' : k === '概念' ? '虚线边框' : '')).join('')}</ul></section>`);
  if (v.ai || v.human) parts.push(`<section><h4>填充</h4><ul>${v.human ? li('<span class="shape" style="border-radius:6px"></span>', '人类侧', '') : ''}${v.ai ? li('<span class="shape ai" style="border-radius:6px"></span>', 'AI 相关', '') : ''}</ul></section>`);
  if (v.kinds.size) parts.push(`<section><h4>研究线 · 左上角色点</h4><ul>${model.clusters.map((c) => `<li><span class="dot" style="--c:${c._color}"></span><span${c.main ? ' style="font-weight:600"' : ''}>${esc(c.name)}</span><span class="ex">${(model.nodesByCluster.get(c.id) || []).length} 个${c.main ? ' · 主线' : ''}</span></li>`).join('')}</ul></section>`);
  const marks = [];
  if (v.badges) marks.push(...['A', 'B', 'C', 'N/A'].map((g) => `<li><span class="pill${g === 'N/A' ? ' na' : ''}" style="--c:${enc.EVIDENCE[g].color}">${g}</span>证据 ${g}<span class="ex">${esc(enc.EVIDENCE[g].desc)}</span></li>`));
  if (v.unverified) marks.push(`<li><span class="mk">?</span>未核验<span class="ex">${esc(enc.UNVERIFIED_TEXT)}</span></li>`);
  if (v.alert) marks.push(`<li><span class="mk alert">!</span>重要警示</li>`);
  if (v.digested) marks.push(`<li><span class="mk done">✓</span>已消化</li>`);
  if (marks.length) parts.push(`<section><h4>徽章与角标</h4><ul>${marks.join('')}</ul></section>`);
  if (v.gaps) parts.push(`<section><h4>空缺问题</h4><ul>${li('<span class="shape" style="border-radius:6px;border-style:dashed;border-color:var(--gap-some)"></span>', '虚线空心卡片', '★ 为重点问题')}</ul></section>`);
  container.innerHTML = parts.length ? parts.join('') : '<p class="empty">当前画面没有可解释的编码。</p>';
}
