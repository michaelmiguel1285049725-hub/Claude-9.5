// 顶部搜索：按编号、中文名、英文名模糊搜索。快捷键 "/" 聚焦。
import { clusterOf } from './data.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const idKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');   // "c4" "C-04" "c04" 都能命中

// 子序列匹配：输入的字按顺序出现在目标里即可
function subseq(q, s) {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

export function scoreNode(n, raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return 0;
  const k = idKey(q), id = idKey(n.id);
  const name = (n.name || '').toLowerCase(), en = (n.name_en || '').toLowerCase();
  // 编号：C4 也能对上 C-04
  const idLoose = id.replace(/([A-Z]+)0*(\d+)/, '$1$2'), kLoose = k.replace(/([A-Z]+)0*(\d+)/, '$1$2');
  if (k && (k === id || kLoose === idLoose)) return 100;
  if (k && k.length >= 1 && id.startsWith(k) && /^[a-z]+\d*$/i.test(q.replace(/[-\s]/g, ''))) return 80;
  if (name.includes(q)) return 70 - Math.min(20, name.indexOf(q));
  if (en.includes(q)) return 55 - Math.min(20, en.indexOf(q) / 2);
  if (q.length >= 2 && subseq(q, name)) return 30;
  if (q.length >= 3 && subseq(q.replace(/\s/g, ''), en.replace(/\s/g, ''))) return 20;
  return 0;
}

export function createSearch(input, list, { model, onPick }) {
  let items = [], active = 0;
  function update() {
    const q = input.value;
    items = q.trim() ? model.nodes.map(n => ({ n, s: scoreNode(n, q) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.n.id < b.n.id ? -1 : 1)).slice(0, 8).map(x => x.n) : [];
    active = 0;
    render();
  }
  function render() {
    list.hidden = !input.value.trim() || document.activeElement !== input;
    list.innerHTML = items.length ? items.map((n, i) => `<li role="option" data-id="${esc(n.id)}" class="${i === active ? 'on' : ''}" aria-selected="${i === active}">
      <span class="mono">${esc(n.id)}</span><span class="nm">${esc(n.name)}</span><span class="cl"><span class="dot" style="background:${clusterOf(model, n).color}"></span>${esc(clusterOf(model, n).name)}</span></li>`).join('')
      : '<li class="empty">没有匹配的节点</li>';
  }
  function pick(id) {
    input.value = '';
    items = [];
    list.hidden = true;
    input.blur();
    onPick(id);
  }
  input.addEventListener('input', update);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { if (items[active]) pick(items[active].id); ev.preventDefault(); }
    else if (ev.key === 'Escape') { input.value = ''; list.hidden = true; input.blur(); ev.stopPropagation(); }
  });
  list.addEventListener('mousedown', ev => {
    const li = ev.target.closest('li[data-id]');
    if (li) { ev.preventDefault(); pick(li.dataset.id); }
  });
  return { focus: () => { input.focus(); input.select(); } };
}
