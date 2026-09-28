/* 启动：读 ?pack= → 加载内容包 → 校验 → 建索引 → 渲染头部 / 图例 / 关系网。 */
import { loadPack, buildModel } from './data.js';
import * as enc from './encoding.js';
import * as storage from './storage.js';
import { get, set, subscribe } from './state.js';
import { createNetwork } from './views/network.js';

const $ = (id) => document.getElementById(id);

function fatal(title, detail) {
  const div = document.createElement('div');
  div.id = 'fatal';
  div.innerHTML = `<div class="box"><h2></h2><pre></pre></div>`;
  div.querySelector('h2').textContent = title;
  div.querySelector('pre').textContent = detail || '';
  document.body.appendChild(div);
}

function packIdFromURL() {
  const p = new URLSearchParams(location.search).get('pack') || 'ai-bias';
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(p) ? p : null;
}

function renderHeader(model) {
  const d = model.domain;
  document.title = d.title ? `${d.title} · 领域学习地图` : '领域学习地图';
  $('title').textContent = d.title || '领域学习地图';
  $('subtitle').textContent = d.subtitle || '';
  const ver = [d.version ? `v${d.version}` : '', d.data_date || ''].filter(Boolean).join(' · ');
  if (ver) { $('ver').textContent = ver; $('ver').hidden = false; }
  if (d.status_note) { const s = $('draft'); s.textContent = /草稿|draft/i.test(d.status_note) ? '草稿' : '说明'; s.title = d.status_note; s.hidden = false; }
}

function renderBanner(model) {
  const { errors, warnings } = model.validation;
  const dropped = model.dropped.length;
  const b = $('banner');
  if (!errors.length && !dropped) { b.hidden = true; return; }
  const li = (x) => `<li><code>${esc(x.where)}${x.field ? ' · ' + esc(x.field) : ''}</code>${esc(x.msg)}</li>`;
  b.innerHTML = `<summary>内容包有 ${errors.length} 处问题${dropped ? `，${dropped} 条关系无法绘制` : ''}（其余部分照常渲染）</summary><ul>${errors.map(li).join('')}</ul>`;
  b.hidden = false;
  if (warnings.length) console.info('内容包提示：', warnings);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function swLine(rel) {
  const c = `var(--rel-${rel.key})`;
  const start = rel.both ? ` marker-start="url(#mk-${rel.key}-start)"` : '';
  return `<svg class="sw" style="--c:${c}" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M4 8 L40 8" stroke-width="${rel.width}" marker-end="url(#mk-${rel.key})"${start}/></svg>`;
}
function swDash(dash) {
  return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
}
function swProc() {
  return `<svg class="sw" style="--c:var(--ink-2)" viewBox="0 0 44 16" aria-hidden="true"><path class="l" d="M2 8 L42 8"/><circle class="proc" cx="22" cy="8" r="4"/></svg>`;
}

function renderLegend(model) {
  const parts = [];
  parts.push(`<section><h4>关系类型 · 颜色（箭头 A → B）</h4><ul>${enc.REL.map((r) => `<li title="${esc(r.desc)}">${swLine(r)}<span>${r.zh}</span><span class="ex">${esc(r.desc)}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>状态 · 线型</h4><ul>${enc.STATUS_ORDER.map((s) => `<li title="${esc(enc.STATUS[s].rule)}">${swDash(enc.STATUS[s].dash)}<span>${s}</span><span class="ex">${esc(enc.STATUS[s].rule)}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>依据</h4><ul><li>${swDash(null)}<span>来源</span><span class="ex">文献结论</span></li><li>${swProc()}<span>加工</span><span class="ex">Claude 的推断或连接（中点空心圆）</span></li></ul></section>`);
  parts.push(`<section><h4>节点形状 · 类型</h4><ul>
    <li><span class="shape" style="border-radius:3px"></span>理论</li>
    <li><span class="shape" style="border-radius:8px"></span>现象</li>
    <li><span class="shape" style="border-radius:999px"></span>方法</li>
    <li><span class="shape bar" style="border-radius:6px"></span>发现<span class="ex">左侧粗色条</span></li>
    <li><span class="shape" style="border-radius:6px;border-style:dashed"></span>概念<span class="ex">虚线边框</span></li>
  </ul></section>`);
  parts.push(`<section><h4>填充 · 人类侧 / AI 侧</h4><ul><li><span class="shape" style="border-radius:6px"></span>人类侧</li><li><span class="shape ai" style="border-radius:6px"></span>AI 相关</li></ul></section>`);
  parts.push(`<section><h4>研究线 · 左上角色点</h4><ul>${model.clusters.map((c) => `<li title="${esc(c.desc || '')}"><span class="dot" style="--c:${c._color}"></span><span${c.main ? ' style="font-weight:600"' : ''}>${esc(c.name)}</span><span class="ex">${(model.nodesByCluster.get(c.id) || []).length} 个${c.main ? ' · 主线' : ''}</span></li>`).join('')}</ul></section>`);
  parts.push(`<section><h4>近距离细节（放大后显示）</h4><ul>
    ${['A', 'B', 'C', 'N/A'].map((g) => `<li><span class="pill${g === 'N/A' ? ' na' : ''}" style="--c:${enc.EVIDENCE[g].color}">${g}</span>证据 ${g}<span class="ex">${esc(enc.EVIDENCE[g].desc)}</span></li>`).join('')}
    ${enc.CROWDING_ORDER.map((k) => `<li><span class="crowd">${'<i></i>'.repeat(enc.CROWDING[k].n)}</span>${k}<span class="ex">${esc(enc.CROWDING[k].desc)}</span></li>`).join('')}
    <li><span class="mk">?</span>未核验<span class="ex">${esc(enc.UNVERIFIED_TEXT)}</span></li>
    <li><span class="mk alert">!</span>重要警示</li>
    <li><span class="mk done">✓</span>已消化</li>
  </ul></section>`);
  parts.push(`<p class="note">节点位置只表示所属研究线和相邻关系，不表示重要性。簇背景淡色 = 研究线。</p>`);
  $('legendBody').innerHTML = parts.join('');
}

function setupTheme() {
  const btn = $('theme');
  const apply = (t) => { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); };
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysDark = (() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } })();
    /* 顺序：跟随系统 → 与系统相反 → 跟随系统 */
    const next = cur ? null : (sysDark ? 'light' : 'dark');
    apply(next); storage.saveGlobal('theme', next);
    btn.title = next ? `当前：${next === 'dark' ? '深色' : '浅色'}（点击恢复跟随系统）` : '当前：跟随系统';
  });
}

async function boot() {
  if (!window.d3) { fatal('D3 未能加载', '请检查网络：需要从 cdn.jsdelivr.net 读取 d3@7.9.0。'); return; }
  const packId = packIdFromURL();
  if (!packId) { fatal('内容包编号不合法', '?pack= 只能包含小写字母、数字和连字符。'); return; }
  let loaded;
  try { loaded = await loadPack(packId); }
  catch (e) { fatal('内容包加载失败', e.message); return; }
  const model = buildModel(loaded.pack);
  storage.setPrefix(model.domain.pack_id || packId);
  window.__atlas = { model, layout: loaded.layout };

  $('defs').innerHTML = enc.markerDefsHTML();
  renderHeader(model);
  renderBanner(model);
  renderLegend(model);
  setupTheme();

  const network = createNetwork({ svgEl: $('canvas'), stageEl: $('stage'), model, layout: loaded.layout });
  window.__atlas.network = network;
  $('fit').addEventListener('click', () => network.fitAll(true));
  window.addEventListener('resize', () => network.fitAll(false));
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') network.zoomBy(1.25);
    else if (e.key === '-') network.zoomBy(0.8);
    else if (e.key === '0') network.fitAll(true);
  });

  const stat = document.createElement('span');
  stat.className = 'placeholder';
  stat.textContent = ` · ${model.nodes.length} 个节点 · ${model.edges.length} 条关系 · ${model.gaps.length} 个空缺 · 布局来源：${network.layoutSource() === 'file' ? 'layout.json' : '种子力导向（seed 42）'}`;
  $('filters').appendChild(stat);
}

boot();
