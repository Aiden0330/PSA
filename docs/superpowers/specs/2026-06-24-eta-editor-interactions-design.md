# ETA 编辑器交互增强 — 设计文档

- 日期:2026-06-24 · 分支 `feat/eta-editor-interactions`
- 状态:已确认(brainstorm:3 项澄清,用户批准设计),待 spec 复核 → writing-plans
- 方法:纯前端(React + TS,vitest);多 agent 执行(frontend-dev / code-reviewer / test-runner)

## 0. 目标

两项 ETA 事件树编辑器交互增强(**撤销/重做已具备,本轮不做**):

A. **点击分支节点 → 完整屏障检视器**:重新指派该分支判定的屏障、编辑屏障属性(改名/PFD/挂载·卸载 FTA)、删除屏障。
B. **成功/失败分支显示条件概率**:成功支 = 1−PFD,失败支 = PFD。

引擎/MEF/后端契约不变;纯前端模型操作经 `onChange`→`etHist`(撤销/重做自然覆盖)。

## 1. 现状关键事实

- `frontend/src/components/EventTreeEditor.tsx`:分支节点 `onClick={() => setSel(n.path)}`(`sel` 为路径);选中节点时右侧检视器**已含**该分支屏障的 PFD 显示 + 挂载/卸载 FTA(`onAttachFt`/`onDetachFt`)、叶节点的「继续到屏障」;SVG 分支线(约 208–211)仅画线 + 文字「成功」「失效」**无概率值**;列头显示 `PFD {fe.failProb}`(约 196)。
- `frontend/src/eventtree.ts`:`EtNode = {kind:'branch', feId, success, failure} | {kind:'leaf', consequence}`;纯操作 `setFailProb / renameFe / delFe / setLinkFt / branchLeaf / setConsequence`;helpers `feIndex / maxAncestorFeIndex / subsequentFes / nodeAt / replaceAt / branchesUsingFe`。**有序可跳过不变式**:沿任一路径分支的 `feIndex` 严格递增。
- `frontend/src/App.tsx`:向 `EventTreeEditor` 传 `onChange=etHist.set`、`onAttachFt/onDetachFt/onFtEdited`、`pfds`、`libBarriers/libComponents` 等。屏障删除按钮现位于检视器「功能事件(屏障)」列表(`delFe`),含「折叠 N 个引用分支?」确认。

## 2. 设计

### 2.1 功能 A:分支节点屏障检视器(重新指派 / 编辑 / 删除)

选中**分支节点**(`sel=path`,其 `feId`=该分支判定的屏障,`idx=feIndex(model, feId)`)时,右侧检视器呈现该屏障的完整面板:

- **改名**:`renameFe(model, idx, label)`(现有)。
- **改 PFD**:`setFailProb(model, idx, p)`(直接 PFD 模式;若该屏障挂载了 FTA,PFD 由 FTA 顶事件决定 → 只读显示)。
- **挂载 / 卸载 FTA**:`onAttachFt(idx)` / `onDetachFt(idx)`(复用,现已部分在检视器)。
- **重新指派屏障(新)**:下拉选另一功能事件 → `setBranchFe(model, path, newFeId)`。
- **删除屏障**:`delFe(model, idx)`(复用既有确认:被引用时提示「折叠 N 个引用分支为末态?」)。

**新增纯函数(`eventtree.ts`)+ vitest:**
- `setBranchFe(m, path, newFeId): EventTreeModel` —— 改变 `path` 处分支判定的 `feId`,**仅当保持有序不变式时生效**,否则原样返回:`newFeId` 存在;`feIndex(newFeId)` 严格 > 祖先最大 feIndex(`maxAncestorFeIndex(m, path)`);且严格 < 该节点两子树中最小分支 feIndex(无子分支则上界 +∞)。实现用 `replaceAt(m.root, path, n => n.kind==='branch' ? {...n, feId:newFeId} : n)`。
- `branchFeOptions(m, path): FuncEvent[]` —— 返回该位置可合法指派的功能事件集合(满足上述上下界);供下拉用。当前 feId 始终包含。

触点:`eventtree.ts`(2 新函数 + vitest),`EventTreeEditor.tsx`(分支节点检视器:整合改名/PFD/挂载/重新指派/删除)。

### 2.2 功能 B:分支条件概率

每个分支节点的 SVG 分支线上,在「成功」「失效」标签后追加条件概率值:
- 成功支 = `1 − pfd`,失败支 = `pfd`,其中 `pfd = pfds?.[feId] ?? fe.failProb`(有效 PFD:挂载 FTA 时用其顶概率,否则直接 PFD)。
- 格式:成功取 3 位有效数字;失败 `pfd` 在 `<0.01` 时用 `toExponential(1)`、否则 `toFixed(2)`(使极小 PFD 仍可读)。
- 例:`成功 0.90` / `失效 0.10`;`成功 1.00` / `失效 1.0e-5`。

触点:`EventTreeEditor.tsx`(SVG 分支文字,约 208–211)。

## 3. 跨切面 / 兼容

- 引擎 / MEF / 后端不变;`setBranchFe` 纯前端模型操作,走 `onChange`→`etHist`,撤销/重做自然覆盖。
- 有序可跳过不变式由 `setBranchFe` 校验维持;违反的指派被拒(原样返回),下拉本就只列合法项。
- 旧存档无需迁移(未改模型 shape)。

## 4. 测试策略

- **vitest `eventtree.ts`**:`setBranchFe`(合法改 feId 生效;违反上界/下界/祖先约束时不改;非分支路径不改;不存在的 feId 不改);`branchFeOptions`(返回满足上下界的集合,含当前)。
- **组件 / 集成(preview DOM)**:选中分支节点 → 检视器出现改名 / PFD / 挂载 / 重新指派下拉 / 删除;重新指派后该列屏障变化;分支线显示条件概率(成功 1−PFD、失败 PFD)。
- **回归**:`npm run test --prefix frontend` 全绿;`tsc -b && vite build` 干净;`.venv/Scripts/python.exe -m pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- **撤销/重做不做**(ETA 工具栏已有 ↶/↷)。
- 重新指派**限合法集**(保有序不变式),非自动修子树。
- 分支概率为**条件分支概率**(成功 1−PFD / 失败 PFD),非累计序列概率。

## 6. 构建顺序(供 writing-plans)

1. `eventtree.ts`:`setBranchFe` + `branchFeOptions` + vitest(先红后绿)。
2. `EventTreeEditor.tsx`:分支节点屏障检视器(改名 / PFD / 挂载·卸载 FTA / 重新指派下拉 / 删除)。
3. `EventTreeEditor.tsx`:分支线条件概率标注。
4. 回归 + 文档(ROADMAP 记录)。
