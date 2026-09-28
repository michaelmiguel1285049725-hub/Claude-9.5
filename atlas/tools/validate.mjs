#!/usr/bin/env node
/* 命令行校验：node tools/validate.mjs packs/ai-bias   （也可以直接给 pack.json 的路径） */
import { readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack } from '../js/validate.js';

const here = fileURLToPath(new URL('.', import.meta.url));
let target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate.mjs packs/<pack_id>');
  process.exit(2);
}
target = resolve(process.cwd(), target);
try { if (statSync(target).isDirectory()) target = join(target, 'pack.json'); } catch (e) {
  const alt = resolve(here, '..', process.argv[2]);
  try { target = statSync(alt).isDirectory() ? join(alt, 'pack.json') : alt; } catch (e2) {
    console.error(`找不到 ${process.argv[2]}`); process.exit(2);
  }
}

let pack;
try { pack = JSON.parse(readFileSync(target, 'utf8')); }
catch (e) { console.error(`读取或解析失败：${target}\n${e.message}`); process.exit(2); }

const { errors, warnings, summary } = validatePack(pack);
console.log(`文件：${target}`);
console.log(`节点 ${summary.nodes} · 关系 ${summary.edges} · 空缺 ${summary.gaps} · 研究线 ${summary.clusters}`);
if (warnings.length) {
  console.log(`\n提示 ${warnings.length} 条（不影响渲染）：`);
  for (const w of warnings) console.log(`  · ${w.where}${w.field ? ' · ' + w.field : ''}：${w.msg}`);
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条：`);
  for (const e of errors) console.log(`  ✗ ${e.where}${e.field ? ' · ' + e.field : ''}：${e.msg}`);
  process.exit(1);
}
console.log('\n校验通过，0 个错误。');
