# ETA 屏障次序调整 + 屏障名显示中文 — 设计文档

- 日期:2026-06-24 · 分支 `feat/eta-barrier-reorder-cn-names`
- 状态:已确认(brainstorm:2 项澄清,用户批准设计),待 spec 复核 → writing-plans
- 方法:纯前端(React + TS,vitest);多 agent 执行(frontend-dev / test-runner / code-reviewer)
- 交付:重建离线单文件 `bess-eta-standalone.html`(`npm run bundle`)

## 0. 目标(用户 2 条)

1. **屏障次序支持调整**:在屏障列表用 ↑/↓ 调整屏障先后;按新次序**重建级联**(后果按深度保留、屏障属性随屏障移动)。
2. **屏障英文名改中文**:事件树列头当前粗体显示英文 `id`(FE1/B_BMS…),改为突出可编辑的中文 `label`;新建屏障默认中文名。

引擎 / MEF / 后端契约不变;`id`/`feId` 保持稳定(仍英文),挂载 FTA、`pfds`、项目序列化全部兼容,无需迁移。

## 1. 现状关键事实(已核对源码)

- `frontend/src/eventtree.ts`:
  - `FuncEvent = { id; label; failProb; linkFt?; source? }`;`functionalEvents: FuncEvent[]` 的**数组次序 = `feIndex`(`findIndex`)= 列次序**。
  - **「有序可跳过」不变式**:沿任一根→叶路径,分支 `feIndex` 严格递增(`layout` 按 `feIndex` 定列:L277 `const idx = feIndex(m, n.feId)`)。故纯数组交换会破坏不变式 → 列向左回绕、布局错乱。
  - `buildCascade(fes, consAtDepth)`(L78):depth d 成功→叶 `consAtDepth[d]`,失败→continue,全失败→叶 `consAtDepth[fes.length]`;每分支 `feId=fes[d].id`。
  - `addFe(m)`(L193):新屏障 `id=FE${n+1}`,**`label=id`(英文)**,failProb 0.1。
  - `newBlankEta`(L90):种子屏障 label = `屏障1`/`屏障2`(中文)。
  - 预置/默认 ETA 经 `buildScenarioTab`→`buildCascade` 构建,**都是纯级联**;`d.labels[id]` 多为中文,`id` 为英文代码。
- `frontend/src/components/EventTreeEditor.tsx`:
  - **列头(L194-201)**:`fe.id` **粗体**(L197,fontSize 11 weight 700)+ `fe.label` 小字(L198,fontSize 9,截断 10)+ `PFD {failProb}`。← 功能 2 根因(英文 id 突出)。
  - **屏障列表(L466-478)**:每行 `fe.id`(灰,只读 42px)+ `fe.label`(可编辑 input,116px)+ `failProb`(可编辑)+ 删除 ✕;尾部「＋ 添加屏障」。← 功能 1 ↑/↓ 落点。
  - 分支检视器「分支:决定 **{selFeId}**」(L509)、「继续到屏障 {f.id} — {f.label}」(L262/L500)亦突出 `id`。
  - 挂载 FTA 存于 App 的 `etFts`(按 `feId` 命名故障树);`pfds` 按 `feId` 索引 → **只要 `id` 不变,reorder 后两者仍有效**。

## 2. 设计

### 2.1 功能 1:屏障次序调整(`eventtree.ts` 新增 3 纯函数 + UI)

```ts
/** 树是否为「完整级联」:depth d 分支 feId=fes[d].id、success=叶、failure=分支(d+1)或(末层)叶。 */
export function isCascade(m: EventTreeModel): boolean {
  const fes = m.functionalEvents
  let node: EtNode = m.root
  for (let d = 0; d < fes.length; d++) {
    if (node.kind !== 'branch' || node.feId !== fes[d].id || node.success.kind !== 'leaf') return false
    if (d < fes.length - 1) { if (node.failure.kind !== 'branch') return false; node = node.failure }
    else { if (node.failure.kind !== 'leaf') return false }
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
    } else { out[d] = CONSEQUENCE_AT_DEPTH[d] ?? 'C5' }
  }
  out[fes.length] = node.kind === 'leaf' ? node.consequence : (CONSEQUENCE_AT_DEPTH[fes.length] ?? 'C5')
  return out
}

/** 移动第 fromIdx 个屏障到 toIdx,按新次序重建级联。后果按深度(位置)保留;屏障属性随屏障移动。 */
export function reorderFe(m: EventTreeModel, fromIdx: number, toIdx: number): EventTreeModel {
  const n = m.functionalEvents.length
  if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return m
  const fes = [...m.functionalEvents]
  const [moved] = fes.splice(fromIdx, 1)
  fes.splice(toIdx, 0, moved)
  return { ...m, functionalEvents: fes, root: buildCascade(fes, cascadeConsequences(m)) }
}
```

- **语义**:后果绑定**深度**(位置),屏障属性(`label`/`failProb`/`linkFt`/`id`/`source`)随屏障移动;`id`/`feId` 不变 → 挂载 FTA(`etFts`)、`pfds`、`toEngineRequest` 全兼容。
- **重建副作用**:`buildCascade` 产出**完整**级联——若原树有折叠/跳过/手工分支,重建会规整为「每屏障逐层级联」(UI 在非级联时先 `confirm`)。
- UI(屏障列表 L466-478 每行):加 **↑/↓** 小按钮(`d===0` 禁 ↑、`d===n-1` 禁 ↓)。点击:
  ```ts
  const move = (d, dir) => {
    if (!isCascade(model) && !window.confirm('该 ETA 含自定义分支结构,调整次序将重建为标准级联,确定?')) return
    onChange(reorderFe(model, d, d + dir))
  }
  ```

### 2.2 功能 2:屏障名在树中显示中文

- **列头(EventTreeEditor L194-201)**:交换主次——`fe.label` 为主(粗体,截断 ~10,`<title>` 全名),`fe.id` 退为下方小字(灰)。即把 L197/L198 的内容/字号对调,`id` 用更小字号/淡色。
- **`addFe`(eventtree.ts L193)**:新屏障默认 `label` 由 `id`(`FE${n}`)改为 **`屏障${n}`**(中文);`id` 仍 `FE${n+1}` 作稳定键。
- **次要**:分支检视器标题(L509)显示 `{label}`(`id` 作 `<title>`/小字);叶「继续到屏障」(L262)、检视器下拉(L500)显示 `label`(去掉/弱化 `{f.id} —` 前缀,`id` 入 `title`)。
- **不改** `fe.id`、不改 `model.initEvent`(用户只选屏障名);引擎/MEF 名仍英文 `id`。

## 3. 跨切面 / 兼容

- `id`/`feId` 稳定不变 → 挂载 FTA、`pfds`、`serializeProject`/`deserializeProject`、`toEngineRequest`、引擎/MEF 全部不变,旧存档无需迁移。
- reorder 重建级联会丢失自定义分支结构(折叠/跳过/重指派)——已由 UI `confirm` 守护;纯级联(默认/预置)无损。
- 列头改 `label` 为主:旧屏障 `label===id`(英文)时列头显示英文直到用户改名;新屏障与预置默认中文。

## 4. 测试策略

- **vitest `eventtree.ts`**:
  - `isCascade`:默认 `newBlankEta`/`buildCascade` 树为真;折叠/手工分支树为假。
  - `cascadeConsequences`:级联树返回各深度成功叶后果 + 末端(长度 n+1);非级联缺失位回退默认。
  - `reorderFe`:移动后 `functionalEvents` 次序正确;新树为级联且各深度后果按位置保留;屏障 `label`/`failProb`/`linkFt` 随屏障移动;`id` 不变;越界/同位/`fromIdx===toIdx` 返回原对象。
- **组件/集成(preview DOM)**:屏障列表 ↑/↓ 调整次序 → 列头次序变、树重建;非级联树点 ↑/↓ 弹确认;列头粗体显示中文 `label`(改名即变)、新建屏障默认「屏障N」中文。
- **回归**:`npm run test --prefix frontend` 全绿;`npm run build --prefix frontend`(`tsc -b && vite build`)干净;`.venv/Scripts/python.exe -m pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- reorder = **上/下移动 + 按新次序重建级联**(后果按深度保留;非级联先 confirm 规整)。**非**「仅相邻交换」、**非**「智能混合」。
- 改中文 = **仅屏障名**:列头突出可编辑中文 `label` + 新屏障默认中文名。**不改** `id` 本身、**不改**初始事件名。
- `id`/`feId`/引擎/MEF/后端不变。

## 6. 构建顺序(供 writing-plans)

1. `eventtree.ts`:`isCascade` + `cascadeConsequences` + `reorderFe`(先红后绿 vitest);`addFe` label 改中文(顺带改其断言)。
2. `EventTreeEditor.tsx`:屏障列表 ↑/↓(含非级联 confirm)。
3. `EventTreeEditor.tsx`:列头 `label` 为主 / `id` 次要;分支检视器与「继续到屏障」显示 `label`。
4. 回归 + `npm run bundle` 重建单 HTML + ROADMAP 记录。
