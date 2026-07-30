// 可编辑事件树(客户端)。每个分支节点显式记录所判定的功能事件 feId(屏障);
// 叶=末态(后果)。成功/失败子节点都可以是分支(继续到某后续屏障)或叶(止于此)。
// 「有序可跳过」:沿任一路径,分支的 feIndex 严格递增 → 可跳过中间屏障、继续到任意更靠后屏障。
// 频率 = 初始频率 × 路径上各分支概率之积(各功能事件相互独立时即精确;跳过的屏障不参与)。

export interface FuncEvent { id: string; label: string; failProb: number; linkFt?: string; source?: string; grade?: string; evidence?: string; category?: string; note?: string; url?: string }

/** 现场贝叶斯更新:将第 idx 个功能事件的 failProb/grade/evidence 设为 patch 中的值。
 *  failProb 夹到 [0,1];返回新模型(不可变)。 */
export function applyFieldUpdate(
  m: EventTreeModel,
  idx: number,
  patch: { failProb: number; grade?: string; evidence?: string },
): EventTreeModel {
  if (idx < 0 || idx >= m.functionalEvents.length) return m
  const clamped = Math.min(1, Math.max(0, patch.failProb))
  return {
    ...m,
    functionalEvents: m.functionalEvents.map((f, i) =>
      i === idx
        ? { ...f, failProb: clamped, grade: patch.grade ?? f.grade, evidence: patch.evidence ?? f.evidence }
        : f,
    ),
  }
}
export type EtNode =
  | { kind: 'branch'; feId: string; success: EtNode; failure: EtNode }
  | { kind: 'leaf'; consequence: string }
export type ConsLevel = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
export interface ConsequenceDef { id: string; desc: string; level: ConsLevel }
export type InitFreqSource = 'manual' | 'ft' | 'product'
export interface ProductDims { cellsPerPack: number; packsPerSystem: number; cellFailureRate: number }
export interface EventTreeModel {
  initEvent: string
  initFreq: number
  functionalEvents: FuncEvent[]
  root: EtNode
  consequenceDefs?: Record<string, string>   // C1..C5 → 文字内涵;缺省取 DEFAULT_CONSEQUENCE_DEFS (legacy)
  consequences?: ConsequenceDef[]
  initFreqSource?: InitFreqSource
  product?: ProductDims
  // 初因事件溯源(证据链首环:数字→数据条目 value+unit+grade+citation)。模板/库带入,可编辑。
  initSource?: string
  initGrade?: string
  initEvidence?: string
}

export const CONSEQUENCES = ['C1', 'C2', 'C3', 'C4', 'C5']
// 级联深度 d(连续失败屏障数) → 后果, 封顶 C5
export const CONSEQUENCE_AT_DEPTH = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5', 'C5']

/** 各 ETA 新建时的 C1–C5 默认文字内涵(可在编辑器中逐个改写)。 */
export const DEFAULT_CONSEQUENCE_DEFS: Record<string, string> = {
  C1: '单体安全排气',
  C2: '模组内热蔓延/起火',
  C3: 'Pack/簇级起火',
  C4: '箱级起火蔓延',
  C5: '爆炸 + 毒气释放',
}
export function defaultConsequences(): ConsequenceDef[] {
  return CONSEQUENCES.map((c) => ({ id: c, desc: DEFAULT_CONSEQUENCE_DEFS[c] ?? '', level: c as ConsLevel }))
}
export function consEntries(m: EventTreeModel): ConsequenceDef[] {
  return m.consequences && m.consequences.length ? m.consequences : defaultConsequences()
}
export function consEntry(m: EventTreeModel, consId: string): ConsequenceDef {
  const e = consEntries(m).find((x) => x.id === consId)
  if (e) return e
  const lvl = (CONSEQUENCES.includes(consId) ? consId : 'C1') as ConsLevel
  return { id: consId, desc: DEFAULT_CONSEQUENCE_DEFS[lvl] ?? '', level: lvl }
}
export function consLevel(m: EventTreeModel, consId: string): ConsLevel { return consEntry(m, consId).level }
export function consText(m: EventTreeModel, consId: string): string { return consEntry(m, consId).desc }

/** 后果等级的展示标签:C1-C5 → 0-IV 级(中电联严重度记法)。仅用于界面展示,
 *  内部仍以 C1-C5 作键(C_COLOR / CONSEQUENCES / totals / 引擎)。 */
export const CONS_GRADE: Record<string, string> = { C1: '0', C2: 'I', C3: 'II', C4: 'III', C5: 'IV' }
export function gradeLabel(level: string): string { return CONS_GRADE[level] ?? level }
export function consGrade(m: EventTreeModel, consId: string): string { return gradeLabel(consLevel(m, consId)) }

function uniqConsId(list: ConsequenceDef[]): string {
  let i = 1; while (list.some((e) => e.id === `K${i}`)) i++; return `K${i}`
}
export function addConsequence(m: EventTreeModel, desc: string, level: ConsLevel): EventTreeModel {
  const list = consEntries(m)
  return { ...m, consequences: [...list, { id: uniqConsId(list), desc, level }] }
}
export function updateConsequence(
  m: EventTreeModel, id: string, patch: { desc?: string; level?: ConsLevel },
): EventTreeModel {
  const locked = CONSEQUENCES.includes(id)
  return { ...m, consequences: consEntries(m).map((e) =>
    e.id === id ? { ...e, desc: patch.desc ?? e.desc, level: locked ? e.level : (patch.level ?? e.level) } : e) }
}
export function delConsequence(m: EventTreeModel, id: string): EventTreeModel {
  if (CONSEQUENCES.includes(id)) return m
  // P4-A ①:被分支叶引用的后果不可删——此前直接 filter,引用叶经 consEntry 回退
  // **静默降级为 C1(最轻)**,安全工具不允许静默下调风险。拒删 = no-op,
  // UI 层负责提示「先改指派再删」(见 branchesUsingConsequence)。
  if (branchesUsingConsequence(m, id) > 0) return m
  return { ...m, consequences: consEntries(m).filter((e) => e.id !== id) }
}

/** 引用某后果 id 的叶(末态)计数——删除守卫与 UI 提示共用。 */
export function branchesUsingConsequence(m: EventTreeModel, id: string): number {
  let n = 0
  const walk = (node: EtNode): void => {
    if (node.kind === 'leaf') { if (node.consequence === id) n++; return }
    for (const c of [node.success, node.failure]) if (c) walk(c)
  }
  walk(m.root)
  return n
}

/** 取某后果在本 ETA 的文字内涵;模型未定义时回退到默认。 */
export function consDef(m: EventTreeModel, c: string): string {
  const here = consEntries(m).filter((e) => e.level === c).map((e) => e.desc).filter(Boolean)
  return here.length ? here.join('; ') : (DEFAULT_CONSEQUENCE_DEFS[c] ?? '')
}

/** 级联:depth d 成功→叶(consAtDepth[d]);失败→继续;全失败→叶(consAtDepth[n])。每分支 feId=fes[d].id。 */
export function buildCascade(fes: FuncEvent[], consAtDepth: string[]): EtNode {
  function build(d: number): EtNode {
    if (d >= fes.length) return { kind: 'leaf', consequence: consAtDepth[fes.length] ?? 'C5' }
    return {
      kind: 'branch', feId: fes[d].id,
      success: { kind: 'leaf', consequence: consAtDepth[d] ?? 'C1' }, failure: build(d + 1),
    }
  }
  return build(0)
}

/** 树是否为「完整级联」:depth d 分支 feId=fes[d].id、success=叶、failure=分支(d+1)或(末层)叶。 */
export function isCascade(m: EventTreeModel): boolean {
  const fes = m.functionalEvents
  let node: EtNode = m.root
  for (let d = 0; d < fes.length; d++) {
    if (node.kind !== 'branch' || node.feId !== fes[d].id || node.success.kind !== 'leaf') return false
    if (d < fes.length - 1) {
      if (node.failure.kind !== 'branch') return false
      node = node.failure
    } else if (node.failure.kind !== 'leaf') return false
  }
  return fes.length === 0 ? node.kind === 'leaf' : true
}

/** 沿失败脊收集各深度成功叶后果 + 末端全失败叶后果(长度 n+1);缺失位(非级联)用 CONSEQUENCE_AT_DEPTH 默认。 */
export function cascadeConsequences(m: EventTreeModel): string[] {
  const fes = m.functionalEvents
  const out: string[] = []
  let node: EtNode = m.root
  for (let d = 0; d < fes.length; d++) {
    if (node.kind === 'branch') {
      out[d] = node.success.kind === 'leaf' ? node.success.consequence : (CONSEQUENCE_AT_DEPTH[d] ?? 'C5')
      node = node.failure
    } else {
      out[d] = CONSEQUENCE_AT_DEPTH[d] ?? 'C5'
    }
  }
  out[fes.length] = node.kind === 'leaf' ? node.consequence : (CONSEQUENCE_AT_DEPTH[fes.length] ?? 'C5')
  return out
}

/** 移动第 fromIdx 个屏障到 toIdx,按新次序重建级联。后果按深度(位置)保留;屏障属性随屏障移动;id/feId 不变。 */
export function reorderFe(m: EventTreeModel, fromIdx: number, toIdx: number): EventTreeModel {
  const n = m.functionalEvents.length
  if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return m
  const cons = cascadeConsequences(m)
  const fes = [...m.functionalEvents]
  const [moved] = fes.splice(fromIdx, 1)
  fes.splice(toIdx, 0, moved)
  return { ...m, functionalEvents: fes, root: buildCascade(fes, cons) }
}

/** 新建空白自定义 ETA: 2 个直接 PFD 屏障的级联。 */
export function newBlankEta(name: string): EventTreeModel {
  const fes: FuncEvent[] = [
    { id: 'FE1', label: '屏障1', failProb: 0.1 },
    { id: 'FE2', label: '屏障2', failProb: 0.1 },
  ]
  return { initEvent: name || '自定义事件', initFreq: 1e-3, functionalEvents: fes, root: buildCascade(fes, CONSEQUENCE_AT_DEPTH), consequences: defaultConsequences() }
}

export function feIndex(m: EventTreeModel, feId: string): number {
  return m.functionalEvents.findIndex((f) => f.id === feId)
}
/** 沿 path 收集祖先分支已判定的最大 feIndex;根(空 path)返回 -1。 */
export function maxAncestorFeIndex(m: EventTreeModel, path: string[]): number {
  let n: EtNode = m.root, mx = -1
  for (const step of path) {
    if (n.kind !== 'branch') break
    mx = Math.max(mx, feIndex(m, n.feId))
    n = step === 'success' ? n.success : n.failure
  }
  return mx
}
/** 该节点可分支到的后续屏障(index 严格大于祖先最大 feIndex)。 */
export function subsequentFes(m: EventTreeModel, path: string[]): FuncEvent[] {
  const mx = maxAncestorFeIndex(m, path)
  return m.functionalEvents.filter((_, i) => i > mx)
}
/** 给缺 feId 的旧存档分支按当前深度补 feId(满级联 depth 即原 feIndex);已带 feId 幂等。 */
export function normalizeEta(m: EventTreeModel): EventTreeModel {
  function fix(n: EtNode, depth: number): EtNode {
    if (n.kind === 'leaf') return n
    const feId = (n as { feId?: string }).feId ?? m.functionalEvents[depth]?.id ?? `FE${depth + 1}`
    return { kind: 'branch', feId, success: fix(n.success, depth + 1), failure: fix(n.failure, depth + 1) }
  }
  const consequences = (m.consequences && m.consequences.length)
    ? m.consequences
    : CONSEQUENCES.map((c) => ({ id: c, desc: m.consequenceDefs?.[c] ?? DEFAULT_CONSEQUENCE_DEFS[c] ?? '', level: c as ConsLevel }))
  const src = m.initFreqSource ?? 'manual'
  const product = m.product ?? (src === 'product' ? { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 } : m.product)
  const functionalEvents = m.functionalEvents.map((f) => (f.label == null ? { ...f, label: f.id } : f))
  return { ...m, functionalEvents, root: fix(m.root, 0), consequences, initFreqSource: src, product }
}

export function nodeAt(root: EtNode, path: string[]): EtNode | null {
  let n: EtNode = root
  for (const step of path) {
    if (n.kind !== 'branch') return null
    n = step === 'success' ? n.success : n.failure
  }
  return n
}

function replaceAt(root: EtNode, path: string[], fn: (n: EtNode) => EtNode): EtNode {
  if (path.length === 0) return fn(root)
  if (root.kind !== 'branch') return root
  const [head, ...rest] = path
  return head === 'success'
    ? { ...root, success: replaceAt(root.success, rest, fn) }
    : { ...root, failure: replaceAt(root.failure, rest, fn) }
}

export function branchLeaf(m: EventTreeModel, path: string[], feId?: string): EventTreeModel {
  const subs = subsequentFes(m, path)
  const chosen = feId ?? subs[0]?.id          // 默认下一可用屏障(与旧"下一屏障"语义一致)
  if (!chosen || !subs.some((f) => f.id === chosen)) return m   // 无后续 / 非法 → 原样
  const root = replaceAt(m.root, path, (n) =>
    n.kind === 'leaf'
      ? { kind: 'branch', feId: chosen, success: { kind: 'leaf', consequence: n.consequence }, failure: { kind: 'leaf', consequence: n.consequence } }
      : n)
  return { ...m, root }
}
export function collapseNode(m: EventTreeModel, path: string[]): EventTreeModel {
  const root = replaceAt(m.root, path, (n) => (n.kind === 'branch' ? { kind: 'leaf', consequence: 'C1' } : n))
  return { ...m, root }
}
export function setConsequence(m: EventTreeModel, path: string[], c: string): EventTreeModel {
  const root = replaceAt(m.root, path, (n) => (n.kind === 'leaf' ? { ...n, consequence: c } : n))
  return { ...m, root }
}
/** 手改 PFD 的唯一咽喉。值实际变化且节点带库快照(grade)时,快照失效:按 D 计并在
 *  evidence 标注原 grade/原值;citation/url/note/category 保留(出处事实不因手改消失,
 *  失效的是置信分级)。贝叶斯路径走 applyFieldUpdate,有意设 A,不经此处。 */
export function setFailProb(m: EventTreeModel, idx: number, p: number): EventTreeModel {
  return { ...m, functionalEvents: m.functionalEvents.map((f, i) => {
    if (i !== idx) return f
    const v = Math.min(1, Math.max(0, p))
    if (v === f.failProb || f.grade === undefined) return { ...f, failProb: v }
    const mark = `手改数值,库快照失效(原 ${f.grade}/${f.failProb})`
    return { ...f, failProb: v, grade: 'D', evidence: f.evidence ? `${f.evidence};${mark}` : mark }
  }) }
}
export function setInitEvent(m: EventTreeModel, name: string): EventTreeModel {
  return { ...m, initEvent: name }
}
export function setInitFreq(m: EventTreeModel, freq: number): EventTreeModel {
  return Number.isFinite(freq) && freq >= 0 ? { ...m, initFreq: freq } : m
}
export function setInitFreqSource(m: EventTreeModel, src: InitFreqSource): EventTreeModel {
  return { ...m, initFreqSource: src }
}
export function setProduct(m: EventTreeModel, patch: Partial<ProductDims>): EventTreeModel {
  const base: ProductDims = { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 }
  return { ...m, product: { ...base, ...m.product, ...patch } }
}
export function computeProductFreq(m: EventTreeModel): number {
  const p = m.product ?? { cellsPerPack: 100, packsPerSystem: 20, cellFailureRate: 1e-7 }
  return p.cellFailureRate * p.cellsPerPack * p.packsPerSystem
}
export function setLinkFt(m: EventTreeModel, idx: number, name: string | undefined): EventTreeModel {
  return { ...m, functionalEvents: m.functionalEvents.map((f, i) => (i === idx ? { ...f, linkFt: name } : f)) }
}
export function renameFe(m: EventTreeModel, idx: number, label: string): EventTreeModel {
  return { ...m, functionalEvents: m.functionalEvents.map((f, i) => (i === idx ? { ...f, label } : f)) }
}
export function addFe(m: EventTreeModel): EventTreeModel {
  const taken = new Set(m.functionalEvents.map((f) => f.id))
  let k = m.functionalEvents.length + 1
  while (taken.has(`FE${k}`)) k++
  const id = `FE${k}`
  return { ...m, functionalEvents: [...m.functionalEvents, { id, label: `屏障${k}`, failProb: 0.1 }] }
}

function uniqId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let i = 2
  while (taken.includes(`${base}_${i}`)) i++
  return `${base}_${i}`
}
export interface LibBarrier { id: string; name: string; pfd: number; grade?: string; category?: string; source?: { citation?: string; url?: string; note?: string } }
/** 从参考库屏障追加功能事件 —— 快照 grade/category/note/url/citation(证据链声明:
 *  引用即快照;undefined 不落键,保证 JSON 边界前后模型一致)。 */
export function addBarrierFromLib(m: EventTreeModel, b: LibBarrier): EventTreeModel {
  const id = uniqId(b.id, m.functionalEvents.map((f) => f.id))
  const fe: FuncEvent = { id, label: b.name, failProb: b.pfd }
  if (b.source?.citation !== undefined) fe.source = b.source.citation
  if (b.grade !== undefined) fe.grade = b.grade
  if (b.category !== undefined) fe.category = b.category
  if (b.source?.note !== undefined) fe.note = b.source.note
  if (b.source?.url !== undefined) fe.url = b.source.url
  return { ...m, functionalEvents: [...m.functionalEvents, fe] }
}

/** CONSEQUENCES 升序;返回子树中最严重后果(无叶→'C1')。 */
function mostSevere(m: EventTreeModel, n: EtNode): string {
  let worst = -1
  ;(function walk(x: EtNode) {
    if (x.kind === 'leaf') { const r = CONSEQUENCES.indexOf(consLevel(m, x.consequence)); if (r > worst) worst = r }
    else { walk(x.success); walk(x.failure) }
  })(n)
  return worst < 0 ? 'C1' : CONSEQUENCES[worst]
}
/** 统计树中判定该 feId 的分支数(供删除确认提示)。 */
export function branchesUsingFe(m: EventTreeModel, feId: string): number {
  let c = 0
  ;(function walk(n: EtNode) { if (n.kind === 'branch') { if (n.feId === feId) c++; walk(n.success); walk(n.failure) } })(m.root)
  return c
}
/** 该分支位置可合法指派的功能事件:index 严格 > 祖先最大、严格 < 子树内最小分支 feIndex。含当前 feId。 */
export function branchFeOptions(m: EventTreeModel, path: string[]): FuncEvent[] {
  const node = nodeAt(m.root, path)
  if (!node || node.kind !== 'branch') return []
  const ancMax = maxAncestorFeIndex(m, path)
  let subMin = Infinity
  const walk = (n: EtNode) => {
    if (n.kind === 'branch') { subMin = Math.min(subMin, feIndex(m, n.feId)); walk(n.success); walk(n.failure) }
  }
  walk(node.success); walk(node.failure)
  return m.functionalEvents.filter((_, i) => i > ancMax && i < subMin)
}

/** 改变 path 处分支判定的功能事件;仅当 newFeId 在 branchFeOptions 内(保持有序不变式)才生效, 否则原样返回。 */
export function setBranchFe(m: EventTreeModel, path: string[], newFeId: string): EventTreeModel {
  const node = nodeAt(m.root, path)
  if (!node || node.kind !== 'branch') return m
  if (!branchFeOptions(m, path).some((f) => f.id === newFeId)) return m
  if (node.feId === newFeId) return m
  return { ...m, root: replaceAt(m.root, path, (n) => (n.kind === 'branch' ? { ...n, feId: newFeId } : n)) }
}

/** 删除第 idx 个功能事件;凡判定它的分支折叠为单叶(后果=该子树最严重,保守)。 */
export function delFe(m: EventTreeModel, idx: number): EventTreeModel {
  const fe = m.functionalEvents[idx]
  if (!fe) return m
  function fix(n: EtNode): EtNode {
    if (n.kind === 'leaf') return n
    if (n.feId === fe.id) return { kind: 'leaf', consequence: mostSevere(m, n) }
    return { ...n, success: fix(n.success), failure: fix(n.failure) }
  }
  return { ...m, functionalEvents: m.functionalEvents.filter((_, i) => i !== idx), root: fix(m.root) }
}

export interface EtLayoutNode {
  path: string[]; depth: number; y: number; kind: 'branch' | 'leaf'
  consequence?: string; freq?: number; successY?: number; failureY?: number
  successCol?: number; failureCol?: number
}
/** 叶按 DFS(成功优先)分行;分支 y=两子中点。列:分支=自身 feIndex,叶=父 feIndex+1(根叶=0)。 */
/** 显示/预览用有效模型(闪变修复 2026-07-30 ④):挂载 FTA 的屏障以派生 PFD(侧表)
 *  覆写 failProb——前端积式预览与引擎实际输入同源,量化前后数值不再两套。
 *  未挂载屏障**绝不**被侧表残值覆写(解除挂载后手改优先);无覆写时返回原引用。 */
export function withDerivedPfds(m: EventTreeModel, pfds?: Record<string, number>): EventTreeModel {
  if (!pfds) return m
  let changed = false
  const fes = m.functionalEvents.map((fe) => {
    const d = fe.linkFt ? pfds[fe.id] : undefined
    if (d == null || d === fe.failProb) return fe
    changed = true
    return { ...fe, failProb: Math.max(0, Math.min(1, d)) }
  })
  return changed ? { ...m, functionalEvents: fes } : m
}


export function layout(m: EventTreeModel, rowH: number, headerH: number) {
  let row = 0
  const nodes: EtLayoutNode[] = []
  function walk(n: EtNode, path: string[], prob: number, col: number): { y: number; col: number } {
    if (n.kind === 'leaf') {
      const y = headerH + row * rowH + rowH / 2
      row++
      nodes.push({ path, depth: col, y, kind: 'leaf', consequence: n.consequence, freq: m.initFreq * prob })
      return { y, col }
    }
    const idx = feIndex(m, n.feId)
    const pf = m.functionalEvents[idx]?.failProb ?? 0
    const s = walk(n.success, [...path, 'success'], prob * (1 - pf), idx + 1)
    const f = walk(n.failure, [...path, 'failure'], prob * pf, idx + 1)
    const y = (s.y + f.y) / 2
    nodes.push({ path, depth: idx, y, kind: 'branch', successY: s.y, failureY: f.y, successCol: s.col, failureCol: f.col })
    return { y, col: idx }
  }
  walk(m.root, [], 1, 0)
  return { nodes, leafCount: row, maxDepth: m.functionalEvents.length }
}

export function consequenceTotals(m: EventTreeModel): Record<string, number> {
  const t: Record<string, number> = {}
  for (const n of layout(m, 1, 0).nodes) if (n.kind === 'leaf') {
    const lvl = consLevel(m, n.consequence!)
    t[lvl] = (t[lvl] ?? 0) + (n.freq ?? 0)
  }
  return t
}

// ---- ROADMAP A: 序列化为引擎精确量化请求 ----
/** 序列级 LFT 集成的自包含初因块(规格 2026-07-15):树 + 类型化参数(初因 = frequency kind)。 */
export interface IeFaultTreeBlock {
  name: string
  top: string
  nodes: any[]
  parameters: { id: string; kind: string; value: number }[]
}
export interface EtQuantifyRequest {
  init_event: string
  init_frequency: number
  functional_events: { id: string; pfd?: number; link_ft?: string }[]
  fault_trees: Record<string, any>
  parameters: Record<string, any>
  sequences: { path: Record<string, string>; end_state: string }[]
  consequence_bins: Record<string, string>
  ccf_groups?: any[]
  // 初因源=故障树时附带:设置即走引擎「integrated」通道(响应带 method/ie_frequency)。
  ie_fault_tree?: IeFaultTreeBlock
}

/** F3 收口二轮 F-2b:参数按类型直传引擎(与 canonical 反构 _param_json 同形,钉扎哈希两侧同源)。
 *  probability / 无 kind → `{value}`(旧形状,逐字节零扰动);typed kind(rate/frequency/
 *  exponential/glm/weibull/periodic_test)→ `{kind, value, <typed 字段>}`,引擎按精确
 *  Q(t) 求值——此前一律压平为 `{value}` 被当概率:rate λ=1e-5/MTTR=24 时活路径 q=λ,
 *  真值 λ·MTTR=2.4e-4,24× 静默低估(安全工具不可接受方向);重放侧(canonical 反构)
 *  算的是对的数,两表面两套数。typed 字段白名单排放(杂散注记键不进请求)。 */
const TYPED_PARAM_FIELDS = ['mttr', 'test_interval', 'mission_time', 'gamma', 'alpha', 'beta', 't0'] as const
function engineParamJson(p: any): Record<string, any> {
  if (!p.kind || p.kind === 'probability') return { value: p.value }
  const out: Record<string, any> = { kind: p.kind, value: p.value }
  for (const f of TYPED_PARAM_FIELDS) if (p[f] !== undefined && p[f] !== null) out[f] = p[f]
  return out
}

/** 叶按 DFS(成功优先, 与 layout 同序)枚举为 end_state L0,L1,...;path 仅含各分支显式 feId(子集路径)。
 *  功能事件默认带前端 PFD; 若 linked 提供非平凡故障树则改用 link_ft(共享事件精确)。 */
export function toEngineRequest(
  m: EventTreeModel,
  linked?: { fault_trees: any[]; parameters: any[]; ccf_groups?: any[] },
): EtQuantifyRequest {
  const sequences: { path: Record<string, string>; end_state: string }[] = []
  const consequence_bins: Record<string, string> = {}
  let leaf = 0
  function walk(n: EtNode, path: Record<string, string>): void {
    if (n.kind === 'leaf') {
      const es = `L${leaf++}`
      sequences.push({ path: { ...path }, end_state: es })
      consequence_bins[es] = consLevel(m, n.consequence)
      return
    }
    walk(n.success, { ...path, [n.feId]: 'success' })
    walk(n.failure, { ...path, [n.feId]: 'failure' })
  }
  walk(m.root, {})

  const ftByName = new Map<string, any>((linked?.fault_trees ?? []).map((f: any) => [f.name, f]))
  const functional_events = m.functionalEvents.map((fe) =>
    fe.linkFt && ftByName.has(fe.linkFt)
      ? { id: fe.id, link_ft: fe.id }
      : { id: fe.id, pfd: fe.failProb },
  )
  const fault_trees: Record<string, any> = {}
  const parameters: Record<string, any> = {}
  for (const fe of m.functionalEvents) {
    if (fe.linkFt && ftByName.has(fe.linkFt)) fault_trees[fe.id] = ftByName.get(fe.linkFt)
  }
  for (const p of linked?.parameters ?? []) parameters[p.id] = engineParamJson(p)
  return {
    init_event: m.initEvent, init_frequency: m.initFreq, functional_events, fault_trees, parameters, sequences, consequence_bins,
    // 4a1:挂载工作区带 CCF 组时透传(合并 PDAG 上展开;空缺省略保持既有请求形状)
    ...(linked?.ccf_groups?.length ? { ccf_groups: linked.ccf_groups } : {}),
  }
}

/** 序列级 LFT 集成(规格 2026-07-15 §6):初因源=故障树(fts 内存有 `__init__` 树)时,把该树
 *  作为自包含 `ie_fault_tree` 块并入「引擎精确量化 / 重要度」请求 → 服务端走 integrated 通道
 *  (rate(s)=Σλ_i·P(E_i∧Path),共享事件在合并 BDD 上精确处理)。
 *
 *  参数分流是关键:
 *  - 仅初因树引用(与任何屏障树不共享)的基本事件 → 进块的 typed parameters(**保留 kind**,
 *    频率初因保持 `frequency`,不能走无类型 parameters 映射被强转 probability),并从无类型映射移除;
 *  - 与屏障共享的基本事件 → **留在**无类型 parameters 映射(服务端按 id 合并统一;放进块会与请求
 *    参数同 id 触发 F3 拒绝)。
 *
 *  非 ft 源 / fts 无 `__init__` 树 → 原样返回(单树通道,`init_frequency` 标量照旧;导出/报告
 *  /不确定性等其它调用方不经本函数,请求逐字节不变)。 */
export function withIeFaultTree(
  req: EtQuantifyRequest,
  m: EventTreeModel,
  linked?: { fault_trees: any[]; parameters: any[] },
): EtQuantifyRequest {
  if (m.initFreqSource !== 'ft') return req
  const trees = linked?.fault_trees ?? []
  const ie = trees.find((f: any) => f.name === '__init__')
  if (!ie) return req
  // 屏障侧(除 __init__ 外所有树)引用的参数 id:必须留在无类型映射(共享事件正是要留下)。
  const barrierRefs = new Set<string>()
  for (const f of trees) {
    if (!f || f.name === '__init__') continue
    for (const n of f.nodes ?? []) if (n?.basic) barrierRefs.add(n.param_ref ?? n.id)
  }
  const paramById = new Map<string, any>((linked?.parameters ?? []).map((p: any) => [p.id, p]))
  const parameters: Record<string, any> = { ...req.parameters }
  const ieParams: { id: string; kind: string; value: number }[] = []
  const seen = new Set<string>()
  for (const n of ie.nodes ?? []) {
    if (!n?.basic) continue
    const ref = n.param_ref ?? n.id
    if (barrierRefs.has(ref) || seen.has(ref)) continue     // 共享 → 留映射;去重
    const p = paramById.get(ref)
    if (!p) continue
    seen.add(ref)
    ieParams.push({ id: p.id, kind: p.kind, value: p.value })   // kind 保留(初因 = frequency)
    delete parameters[ref]                                        // 从无类型映射移除,避免 F3 同 id 拒绝
  }
  return { ...req, parameters, ie_fault_tree: { name: '__init__', top: ie.top, nodes: ie.nodes, parameters: ieParams } }
}
