#!/usr/bin/env node
/*
 * Lint 减债棘轮门(FE-14)。跑 `eslint . -f json`,把 error 总数与 lint-baseline.json 的
 * maxErrors 比较:上升即 exit 1(新增 lint 错误被拒绝)。本脚本只做门,不做任何修复;
 * 减债请只在你触碰的文件内进行,严禁全仓 autofix 扫荡,清洗后手动收紧 maxErrors。
 */
'use strict'
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const root = resolve(__dirname, '..')
const baselinePath = resolve(root, 'lint-baseline.json')

let maxErrors
try {
  maxErrors = JSON.parse(readFileSync(baselinePath, 'utf8')).maxErrors
} catch (e) {
  console.error('lint:gate — 无法读取 lint-baseline.json:', e.message)
  process.exit(2)
}
if (typeof maxErrors !== 'number' || !Number.isInteger(maxErrors) || maxErrors < 0) {
  console.error('lint:gate — lint-baseline.json 的 maxErrors 非法(应为非负整数)')
  process.exit(2)
}

let out = ''
try {
  out = execFileSync('npx', ['eslint', '.', '-f', 'json'], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
} catch (e) {
  // eslint 有 error 时退出码非零,报告仍在 stdout。
  out = e.stdout ? String(e.stdout) : ''
  if (!out) { console.error('lint:gate — eslint 未产出 JSON 报告:', e.message); process.exit(2) }
}

let report
try { report = JSON.parse(out) } catch { console.error('lint:gate — 无法解析 eslint JSON 输出'); process.exit(2) }

let errors = 0
let warnings = 0
for (const f of report) { errors += f.errorCount || 0; warnings += f.warningCount || 0 }

const trend = errors > maxErrors ? '上升' : errors < maxErrors ? '下降' : '持平'
console.log(`lint:gate — 当前 ${errors} errors / ${warnings} warnings,基线上限 ${maxErrors}(${trend})`)

if (errors > maxErrors) {
  console.error(`✗ error 数从基线 ${maxErrors} 升至 ${errors} —— 新增 lint 错误被拒绝。仅在你触碰的文件内减债,勿全仓 autofix。`)
  process.exit(1)
}
if (errors < maxErrors) {
  console.log(`✓ 已降至 ${errors}(≤ ${maxErrors})。建议把 lint-baseline.json 的 maxErrors 收紧为 ${errors} 以锁定本次减债。`)
}
process.exit(0)
