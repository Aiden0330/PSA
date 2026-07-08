// 从运行中的后端(默认 http://localhost:8000/api)捕获预置模板与内部数据,
// 生成 src/embeddedData.ts,供单文件离线版在后端不可达时回退使用。
// 重新生成(需后端运行):  node scripts/capture-data.mjs
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BESS_API || 'http://localhost:8000/api'
const j = async (p) => {
  const r = await fetch(BASE + p)
  if (!r.ok) throw new Error(`${p} → ${r.status}`)
  return r.json()
}

const data = {}
data.scenarios = await j('/bess/scenarios')
data.library = await j('/bess/library')
data.examples = await j('/examples')
data.eventTrees = { _default: await j('/bess/event-tree') }
for (const s of data.scenarios) data.eventTrees[s.id] = await j('/bess/event-tree?scenario=' + encodeURIComponent(s.id))
data.models = {}
for (const e of data.examples) data.models[e.id] = await j('/model/' + encodeURIComponent(e.id))

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(frontend, 'src', 'embeddedData.ts')
writeFileSync(out,
  '// 自动生成,请勿手改。从后端捕获的预置模板与内部数据(单文件离线回退用)。\n' +
  '// 重新生成(后端运行时): node scripts/capture-data.mjs\n' +
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n' +
  'export const EMBEDDED_BESS: any = ' + JSON.stringify(data) + '\n')
console.log(`wrote ${out}  scenarios=${data.scenarios.length} examples=${data.examples.length}`)
