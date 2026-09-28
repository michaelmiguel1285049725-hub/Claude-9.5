/* 悬停提示：三个视角共用一个 DOM。 */
let el = null;
export function init() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'tooltip'; el.setAttribute('role', 'tooltip'); el.hidden = true;
  document.body.appendChild(el);
}
export function show(html, x, y) { if (!el) init(); el.innerHTML = html; el.hidden = false; move(x, y); }
export function move(x, y) {
  if (!el || el.hidden) return;
  const r = el.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 14);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - 12);
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
export function hide() { if (el) el.hidden = true; }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
