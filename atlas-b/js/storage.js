// localStorage 封装：所有读写都包在 try/catch 里，读不到或写不进时页面照常工作。
const NS = 'atlas-b';   // 与同站点上的 atlas/ 分开保存，互不干扰

export function createStore(packId) {
  const k = key => `${NS}.${packId}.${key}`;
  return {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(k(key));
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(k(key), JSON.stringify(value)); return true; } catch { return false; }
    },
    del(key) {
      try { localStorage.removeItem(k(key)); } catch { /* 忽略 */ }
    },
  };
}

// 与内容包无关的全局偏好（例如深浅色）
export const globalStore = createStore('_global');
