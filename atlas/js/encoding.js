/* 视觉编码表：三个视角共用。关系类型 → 颜色 / 线宽 / 箭头；状态 → 线型；节点类型 → 形状；证据 / 拥挤度 / 空缺状态。
   这里不出现任何具体领域的内容（簇名、节点编号等都来自内容包）。 */

export const REL = [
  { zh: '继承', key: 'inherit',   width: 1.2, marker: 'tri',    desc: 'A 在 B 的基础上发展出来',            hint: '线较细' },
  { zh: '解释', key: 'explain',   width: 1.6, marker: 'tri',    desc: 'A 的机制说明了 B 为什么会发生',      hint: '' },
  { zh: '支持', key: 'support',   width: 1.6, marker: 'tri',    desc: 'A 的证据让 B 更可信',                hint: '' },
  { zh: '挑战', key: 'challenge', width: 1.6, marker: 'solid',  desc: 'A 的证据和 B 方向相反',              hint: '实心大三角' },
  { zh: '修正', key: 'revise',    width: 1.6, marker: 'hollow', desc: 'B 仍然成立，但 A 把它的适用范围收窄了', hint: '空心三角' },
  { zh: '削弱', key: 'reduce',    width: 1.6, marker: 'bar',    desc: 'A 能减少 B',                          hint: '箭头端加短横 ⊣' },
  { zh: '加剧', key: 'worsen',    width: 1.6, marker: 'double', desc: 'A 会让 B 更严重',                     hint: '双线箭头' },
  { zh: '对应', key: 'mirror',    width: 1.6, marker: 'dot',    desc: 'A 是 B 在另一侧（人类侧 / AI 侧）的对应物', hint: '两端小圆点，无箭头', both: true },
];
export const REL_ORDER = REL.map((r) => r.zh);
export const relByZh = Object.fromEntries(REL.map((r) => [r.zh, r]));
export const relColor = (zh) => `var(--rel-${(relByZh[zh] || REL[0]).key})`;

export const STATUS = {
  确立:   { dash: null,  rule: 'A 档证据，或多个独立团队得到同样结果，或是公认的学术史事实' },
  初步:   { dash: '7 4', rule: '只有单项研究或单个团队的工作' },
  未验证: { dash: '2 4', rule: '没有直接实证，是理论推测' },
};
export const STATUS_ORDER = ['确立', '初步', '未验证'];

export const BASIS = {
  来源: { cls: 'src',  desc: '文献结论' },
  加工: { cls: 'proc', desc: 'Claude 的推断或连接' },
};

/* 节点类型 → 形状 */
export const KINDS = {
  理论: { rx: 3,  desc: '直角偏小的圆角矩形' },
  现象: { rx: 8,  desc: '圆角矩形' },
  方法: { capsule: true, desc: '胶囊形' },
  发现: { rx: 6,  bar: true,    desc: '圆角矩形，左侧粗色条' },
  概念: { rx: 6,  dashed: true, desc: '圆角矩形，虚线边框' },
};
export const KIND_ORDER = Object.keys(KINDS);

export const EVIDENCE = {
  A:     { desc: '元分析或多实验室重复', color: 'var(--ev-a)' },
  B:     { desc: '单项预注册研究或设计较严的单项研究', color: 'var(--ev-b)' },
  C:     { desc: '单项非预注册、预印本或理论综述', color: 'var(--ev-c)' },
  'N/A': { desc: '规范理论或框架，不适用证据等级', color: 'var(--ev-na)', hollow: true },
};
export const EVIDENCE_ORDER = ['N/A', 'C', 'B', 'A'];

export const CROWDING = {
  饱和: { n: 3, desc: '再做同类研究几乎没有新意' },
  活跃: { n: 2, desc: '仍在快速发表' },
  稀疏: { n: 1, desc: '没几个人做' },
};
export const CROWDING_ORDER = ['饱和', '活跃', '稀疏'];

export const GAP_STATUS = {
  几乎空白:   { cls: 'blank', color: 'var(--gap-blank)' },
  有初步工作: { cls: 'some',  color: 'var(--gap-some)' },
  已基本解决: { cls: 'done',  color: 'var(--gap-done)' },
};

export const UNVERIFIED_TEXT = '据已有知识补充，本次未经检索核验';

/* 节点尺寸（世界坐标） */
export const NODE_W = 156;
export const NODE_H = 54;

/* 研究线颜色：按内容包里簇的顺序取色板；内容包可用可选字段 color 覆盖 */
export const CLUSTER_PALETTE_SIZE = 8;
export function clusterColor(cluster, index) {
  if (cluster && typeof cluster.color === 'string' && cluster.color) return cluster.color;
  return `var(--cl-${index % CLUSTER_PALETTE_SIZE})`;
}

/* 箭头 marker：每种类型单独一个（不依赖 context-stroke）。markerUnits=userSpaceOnUse 让箭头大小不随线宽变化。 */
export function markerDefsHTML() {
  const out = [];
  for (const r of REL) {
    const c = `var(--rel-${r.key})`;
    const id = `mk-${r.key}`;
    let body = '';
    let attrs = 'viewBox="0 0 12 12" markerUnits="userSpaceOnUse" orient="auto"';
    switch (r.marker) {
      case 'tri':
        attrs += r.key === 'inherit' ? ' markerWidth="9" markerHeight="9" refX="11" refY="6"' : ' markerWidth="11" markerHeight="11" refX="11" refY="6"';
        body = `<path d="M1 2 L11 6 L1 10 Z" style="fill:${c}"/>`;
        break;
      case 'solid':
        attrs += ' markerWidth="15" markerHeight="15" refX="11.5" refY="6"';
        body = `<path d="M0.5 1 L11.5 6 L0.5 11 Z" style="fill:${c}"/>`;
        break;
      case 'hollow':
        attrs += ' markerWidth="14" markerHeight="14" refX="11" refY="6"';
        body = `<path d="M1.5 2 L11 6 L1.5 10 Z" style="fill:var(--ground);stroke:${c};stroke-width:1.3"/>`;
        break;
      case 'bar':
        attrs += ' markerWidth="14" markerHeight="14" refX="11.5" refY="6"';
        body = `<path d="M0.5 2.2 L8.5 6 L0.5 9.8 Z" style="fill:${c}"/><rect x="9.5" y="1" width="2.2" height="10" rx="0.6" style="fill:${c}"/>`;
        break;
      case 'double':
        attrs += ' markerWidth="14" markerHeight="14" refX="11" refY="6"';
        body = `<path d="M1 1.5 L6 6 L1 10.5 M6 1.5 L11 6 L6 10.5" style="fill:none;stroke:${c};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"/>`;
        break;
      case 'dot':
        attrs += ' markerWidth="12" markerHeight="12" refX="6" refY="6"';
        body = `<circle cx="6" cy="6" r="3.2" style="fill:${c}"/>`;
        break;
    }
    out.push(`<marker id="${id}" ${attrs}>${body}</marker>`);
    if (r.both) out.push(`<marker id="${id}-start" ${attrs}>${body}</marker>`);
  }
  return out.join('\n');
}
