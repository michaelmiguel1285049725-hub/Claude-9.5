// 命令行校验内容包，与浏览器用同一套规则（js/validate.js）。
// 用法（在 atlas 目录里）：node tools/validate.mjs packs/ai-bias
// 也可以在仓库根目录：node atlas/tools/validate.mjs atlas/packs/ai-bias
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack, summarizePack } from '../js/validate.js';

const atlasDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
if (!arg) {
  console.error('用法：node tools/validate.mjs packs/<内容包编号>');
  process.exit(2);
}

// 先按当前目录找，找不到再按 atlas 目录找；参数可以是目录，也可以直接是 pack.json
let target = [resolve(arg), resolve(atlasDir, arg)].find(p => existsSync(p));
if (!target) { console.error(`找不到：${arg}`); process.exit(2); }
if (statSync(target).isDirectory()) target = join(target, 'pack.json');

let pack;
try {
  pack = JSON.parse(readFileSync(target, 'utf8'));
} catch (err) {
  console.error(`✗ 读取或解析失败：${target}\n  ${err.message}`);
  process.exit(1);
}

const issues = validatePack(pack);
console.log(`内容包：${target}`);
console.log(`内容：${summarizePack(pack)}`);
if (!issues.length) {
  console.log('✓ 校验通过，没有发现问题');
  process.exit(0);
}
console.log(`✗ 发现 ${issues.length} 个问题：`);
for (const i of issues) console.log(`  - ${i.where} · ${i.field} · ${i.msg}`);
process.exit(1);
