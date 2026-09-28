// 全局状态与订阅：当前视角、选中对象、筛选等都放这里，各视角只订阅、不互相调用。
export function createState(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of subs) fn(state, prev);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
