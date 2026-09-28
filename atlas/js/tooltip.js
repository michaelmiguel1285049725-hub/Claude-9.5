// 悬停小提示：一个跟随鼠标的浮层，三个视角共用。内容由调用方负责转义。
export function createTooltip(container) {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  container.appendChild(el);
  function move(ev) {
    if (el.hidden) return;
    const r = container.getBoundingClientRect();
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 16;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (x + w > r.width - 8) x = ev.clientX - r.left - w - 14;
    if (y + h > r.height - 8) y = ev.clientY - r.top - h - 12;
    el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }
  return {
    show(html, ev) { el.innerHTML = html; el.hidden = false; if (ev) move(ev); },
    move,
    hide() { el.hidden = true; },
  };
}
