---
name: psa-frontend
description: 本项目 React+TS 前端工作台(frontend/src)的实现与维护技能。修改探索者壳(菜单/项目树/状态栏)、多项目状态层、ETA/FTA 画布(缩放/直角走线)、参数库/参考库/FMEA/报告/组合总览页面、持久化与撤销重做、主题令牌、离线单文件包,或新增前端功能时使用。触发词:前端、App.tsx、projectStore、viewStore、ExplorerTree、MenuBar、EtCanvas、useCanvasZoom、FaultTreeCanvas、EventTreeEditor、eventtree.ts、model.ts、persistence、多项目、切换项目、--exp-、psa-btn、standalone、离线包、vitest、tsc。
---

# 前端工作台实现与维护(psa-frontend)

探索者壳 + 多项目架构(2026-07-13/14 R1–R5 落地)。以本文与实际代码为准;
证据链相关 UI 语义(台账/组合总览/409)另见技能 **psa-evidence-chain**。

## 一、真实架构(2026-07-14)

```
frontend/src/
  App.tsx                 ~190 行壳:App(认证门,off 恒放行)→ AppShell(菜单栏+项目树+
                          懒页签 Suspense+状态栏)。新状态一律进 store,不进 App。
  stores/
    projectStore.ts       ★多项目单一真源(方案 C 绞杀者):顶层字段=活动项目;非活动整槽
                          停放 parked{past,present,future,activeKey,checkedKeys,pfds,identity,
                          fmea*}。openProject(wid+savedId 双键去重→聚焦)/switchProject/
                          closeProject/setIdentityFor(槽定向)/rekeyWorkspace(另存后键迁移)。
                          pfds 派生缓存在撤销历史之外。锁测 projectSlots.test.ts(13)。
    viewStore.ts          布局/页签/命令板/折叠态(seqExpanded/ftaResultsExpanded),persist 子集。
    useActiveEta.ts       活动 ETA 选择器门面(etaTabs/activeKey/P() 等,稳定快照)。
    derived.ts            composeEta/stripDerived(PFD 写回与历史解耦)。
  features/
    shell/                MenuBar(文件/编辑/视图/分析/数据/评审/帮助+身份簇)· ExplorerTree
                          (稳定切片订阅+useMemo——fresh-array 选择器会无限渲染)· StatusBar ·
                          CommandPalette · LoginWall · AccountsPanel · SaveConflictDialog。
    persistence/          useProjectPersistence(★身份/存档/导入导出/会话草稿;所有 await 后
                          身份写回必须 setIdentityFor(发起 wid)——见陷阱)· projectIo · bootstrap。
    eta/ fta/ home/ report/ portfolio/ ai-draft/ library/ analysis/ templates/
  components/eta/         EtCanvas(SVG 直角级联,全内容 <g transform>)· useCanvasZoom
                          (纯数学:clamp 0.4–2.5/指针不动点/fit;16 测)· EtInspector 等。
  components/             FaultTreeCanvas(reactflow+dagre,zoomToolbar prop)· ResultsPanel ·
                          ParamLibrary(ag-grid)· ReferenceLibrary · FmeaWorkbench · EChart(自写)。
  eventtree.ts / model.ts 可编辑模型纯函数(有序可跳过分支;toEngineRequest;consLevel 折级)。
  api.ts                  后端契约(quantify/event-tree/*、ft/frequency、saved、projects、
                          reviews、auth、portfolio);401→AuthRequiredError 上抛。
  theme.css               --psa-*(工作台)+ --exp-*(探索者壳)令牌与组合类。
```

## 二、硬性规则

1. **版本锁定**:Vite 5 / React 18 / echarts 5 / ag-grid 32(Node 20)。不升级。
2. **类型门是 `npx tsc -b`**(构建同款,项目引用配置)——`tsc --noEmit` 解析更宽松的
   config,漏过 4 个错误的前科。CI/收口一律 tsc -b。
3. **`id`/`feId` 稳定契约**;改名只改中文 `label`;reorderFe 有级联守护测试。
4. **多项目隔离是结构给的,别绕过**:项目内容/身份只经 projectStore 动作变更;
   **任何 async 回调里的身份写回必须槽定向**(`setIdentityFor(发起时捕获的 wid)`,
   槽已关闭即丢弃);另存/首存后 `rekeyWorkspace`;跨项目 UI 态(AI 草案、冲突对话)
   要么随 workspaceId 清空、要么携带发起 wid。R2 对抗审查 9 项发现全是违反此条。
5. **积式频率只在屏障独立时精确**;共享事件必须走「引擎精确量化」;初因频率走
   /api/ft/frequency 专用通道(频率≠概率,不钳位≤1)。
6. **持久化兼容**:旧档经 normalizeEta/缺省补全;serialize/deserialize 同改 + 旧档往返测试。
7. **改影响离线包的东西 ⇒ `make bundle`**(协调者跑,子代理不跑)。
8. **UI 验证:浏览器 DOM 检查/JS 断言**,截图在重前端页超时(既定);交互实测后收口。
9. 样式走 theme.css 令牌(壳用 --exp-*,工作台用 --psa-*);禁大段内联样式蔓生;
   数字 tabular-nums。vitest 与源码同目录,纯函数必须带测;基线 **281**。
10. React 陷阱备忘:`onWheel` 是 passive 委托(preventDefault 无效 → 原生
    {passive:false});useSyncExternalStore 选择器必须稳定快照;StrictMode 下
    reactflow 缩放按钮 dev 无效(生产正常,已知)。

## 三、开发环境陷阱

- **白屏 + "Invalid hook call"(双 React)**:vite 依赖预优化缓存损坏(非正常重启后),
  网络里同名 chunk 带/不带 `?v=` 各一份即确诊 → `rm -rf node_modules/.vite` 重启。
  **不是代码回归,别急着改码。**
- 非交互 shell 先 `source ~/.nvm/nvm.sh`;npm/npx 在 frontend/ 下跑(cwd 漂移常犯)。

## 四、references(设计意图,仍有效)

- `fta-symbols.md` — IEC 门符号视觉规范。 `interactions.md` — 画布交互模式。
- `results-and-data.md` — 结果呈现与数据网格设计意图。
- 设计令牌规范 `docs/design/restyle-spec.md`;探索者壳版式以
  `docs/superpowers/specs/2026-07-13-explorer-redesign.md` 为准(§6 有偏离记录)。
