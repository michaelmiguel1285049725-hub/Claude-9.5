/* 顶部搜索：按编号、中文名、英文名模糊匹配，下拉候选，回车 / 点击 → 选中并缩放过去。 */
import { esc } from './tooltip.js';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
/* "c4" / "c04" / "c-4" 都能匹配 C-04 */
function idVariants(id) {
  const m = /^([a-z]+)-?0*(\d+)$/i.exec(id);
  const base = norm(id);
  if (!m) return [base];
  return [base, norm(m[1] + m[2]), norm(m[1] + '-' + m[2]), norm(m[1] + m[2].padStart(2, '0'))];
}

export function initSearch(input, model, onPick) {
  const wrap = input.parentElement;
  const list = document.createElement('ul'); list.id = 'searchList'; list.hidden = true; list.setAttribute('role', 'listbox');
  wrap.appendChild(list);
  const index = model.nodes.map((n) => ({ n, ids: idVariants(n.id), name: norm(n.name), en: norm(n.name_en) }));
  let items = [], cursor = -1;

  function score(it, q) {
    if (it.ids.includes(q)) return 0;
    if (it.ids.some((v) => v.startsWith(q))) return 1;
    if (it.name.startsWith(q)) return 2;
    if (it.name.includes(q)) return 3;
    if (it.en.startsWith(q)) return 4;
    if (it.en.includes(q)) return 5;
    return -1;
  }
  function render() {
    list.innerHTML = '';
    if (!items.length) { list.hidden = true; return; }
    items.forEach((it, i) => {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.classList.toggle('cur', i === cursor);
      const c = model.clusterById.get(it.n._cluster);
      li.innerHTML = `<span class="s-id">${esc(it.n.id)}</span><span class="s-name">${esc(it.n.name)}</span><span class="s-en">${esc(it.n.name_en)}</span><span class="s-cl"><i class="dot" style="--c:${c?._color}"></i>${esc(c?.name || '')}</span>`;
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(i); });
      list.appendChild(li);
    });
    list.hidden = false;
  }
  function update() {
    const q = norm(input.value);
    if (!q) { items = []; cursor = -1; render(); return; }
    items = index.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.it.n.id.localeCompare(b.it.n.id)).slice(0, 8).map((x) => x.it);
    cursor = items.length ? 0 : -1;
    render();
  }
  function pick(i) {
    const it = items[i]; if (!it) return;
    input.value = ''; items = []; render(); input.blur();
    onPick(it.n.id);
  }
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (items.length) { cursor = (cursor + 1) % items.length; render(); } }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (items.length) { cursor = (cursor - 1 + items.length) % items.length; render(); } }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (cursor >= 0) pick(cursor); }
    else if (ev.key === 'Escape') { input.value = ''; items = []; render(); input.blur(); }
  });
}
