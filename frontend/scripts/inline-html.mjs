// 把 vite build 产物(dist/index.html + assets)内联成单个可离线打开的 HTML。
// 产物:仓库根 bess-eta-standalone.html(可拷到其他电脑双击打开)。
// 注:依赖后端 API 的功能(BESS 预置场景 / 引擎精确量化 / 导出 / 存档)在离线单文件下不可用;
//     可离线使用「新建 ETA」做客户端编辑、前端积式频率与风险矩阵。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(frontend, 'dist')
const asset = (href) => resolve(dist, href.replace(/^\.?\//, ''))

let html = readFileSync(resolve(dist, 'index.html'), 'utf8')
// 去掉对外部 chunk 的预载(已内联)
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')
// 内联 CSS
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_, href) => `<style>\n${readFileSync(asset(href), 'utf8')}\n</style>`)
// 内联 JS(转义内容中的 </script> 以免提前闭合)
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (_, pre, src, post) => {
  const js = readFileSync(asset(src), 'utf8').replace(/<\/script>/gi, '<\\/script>')
  const mod = /type="module"/.test(pre + post) ? ' type="module"' : ''
  return `<script${mod}>\n${js}\n</script>`
})

const out = resolve(frontend, '..', 'bess-eta-standalone.html')
writeFileSync(out, html)
console.log(`wrote ${out}  (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`)
