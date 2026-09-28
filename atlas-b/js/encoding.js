// 视觉编码表：三个视角共用。只放"数据取值 → 含义 / 样式"的映射，不含任何领域内容。
// 颜色本身写在 css/tokens.css（便于深色模式），这里只引用变量名。
// 本文件不依赖浏览器，命令行校验也会读取其中的枚举。

// 八种关系：顺序即面板、图例、筛选栏里的固定顺序
export const REL_TYPES = ['继承', '解释', '支持', '挑战', '修正', '削弱', '加剧', '对应'];

export const REL = {
  继承: { key: 'inherit',  head: 'arrow',     width: 1.2, meaning: 'A 在 B 的基础上发展出来' },
  解释: { key: 'explain',  head: 'arrow',     width: 1.6, meaning: 'A 的机制说明了 B 为什么会发生' },
  支持: { key: 'support',  head: 'arrow',     width: 1.6, meaning: 'A 的证据让 B 更可信' },
  挑战: { key: 'challenge', head: 'solid',    width: 1.6, meaning: 'A 的证据和 B 方向相反' },
  修正: { key: 'modify',   head: 'hollow',    width: 1.6, meaning: 'B 仍然成立，但 A 把它的适用范围收窄了' },
  削弱: { key: 'weaken',   head: 'tee',       width: 1.6, meaning: 'A 能减少 B' },
  加剧: { key: 'worsen',   head: 'double',    width: 1.6, meaning: 'A 会让 B 更严重' },
  对应: { key: 'mirror',   head: 'dots',      width: 1.6, meaning: 'A 是 B 在另一侧（人类侧 / AI 侧）的对应物' },
};
export const relColor = t => `var(--rel-${REL[t]?.key || 'inherit'})`;

export const STATUSES = ['确立', '初步', '未验证'];
export const STATUS = {
  确立: { dash: null,  rule: 'A 档证据，或多个独立团队结果一致，或公认学术史事实' },
  初步: { dash: '7 4', rule: '只有单项研究或单个团队的工作' },
  未验证: { dash: '2 4', rule: '没有直接实证，是理论推测' },
};

export const BASES = ['来源', '加工'];
export const BASIS = {
  来源: { label: '来源', long: '文献结论' },
  加工: { label: '加工', long: 'Claude 的推断或连接' },
};

export const KINDS = ['理论', '现象', '方法', '发现', '概念'];
export const KIND = {
  理论: { shape: 'theory',  desc: '小圆角矩形' },
  现象: { shape: 'phenom',  desc: '圆角矩形' },
  方法: { shape: 'method',  desc: '胶囊形' },
  发现: { shape: 'finding', desc: '左侧粗色条' },
  概念: { shape: 'concept', desc: '虚线边框' },
};

export const EVIDENCES = ['N/A', 'C', 'B', 'A'];   // 成熟度地图从左到右的顺序
export const EVIDENCE = {
  A:     { key: 'a',  meaning: '元分析或多实验室重复' },
  B:     { key: 'b',  meaning: '单项预注册研究或设计较严的单项研究' },
  C:     { key: 'c',  meaning: '单项非预注册、预印本或理论综述' },
  'N/A': { key: 'na', meaning: '规范理论或框架，不适用证据等级' },
};

export const CROWDINGS = ['饱和', '活跃', '稀疏'];
export const CROWDING = {
  饱和: { level: 3, meaning: '再做同类研究几乎没有新意' },
  活跃: { level: 2, meaning: '仍在快速发表' },
  稀疏: { level: 1, meaning: '没几个人做' },
};

export const GAP_STATUSES = ['几乎空白', '有初步工作', '已基本解决'];
export const SIDES = ['human', 'ai', 'both'];

// 研究线颜色：按内容包里簇的顺序依次取一组低饱和色；簇里若写了 color 字段则优先用它
export const CLUSTER_PALETTE_SIZE = 8;
export function clusterColor(cluster, index) {
  if (cluster && typeof cluster.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(cluster.color)) return cluster.color;
  return `var(--cl-${index % CLUSTER_PALETTE_SIZE})`;
}

export const TEXT_LIMITS = { gist: 20, reason: 24 };
