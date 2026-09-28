/* localStorage 封装。所有读写 try/catch；读不到时返回 fallback，页面照常工作。键前缀 atlas.<pack_id>. */
let prefix = 'atlas.';
export function setPrefix(packId) { prefix = `atlas.${packId}.`; }
export function load(key, fallback = null) {
  try {
    const v = localStorage.getItem(prefix + key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}
export function remove(key) {
  try { localStorage.removeItem(prefix + key); return true; }
  catch (e) { return false; }
}
/* 不带前缀的全局键（主题等跨内容包共用） */
export function loadGlobal(key, fallback = null) {
  try { const v = localStorage.getItem('atlas.' + key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
export function saveGlobal(key, value) {
  try { localStorage.setItem('atlas.' + key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}
