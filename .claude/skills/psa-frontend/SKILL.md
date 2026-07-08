---
name: psa-frontend
description: 本项目 React+TS 前端工作台(frontend/src)的实现与维护技能。修改 ETA 编辑器/FTA 画布/FMEA/参考库/风险矩阵/报告界面、项目文件与持久化、撤销重做、布局与主题、离线单文件包,或新增前端功能时使用。触发词:前端、EventTreeEditor、FaultTreeCanvas、App.tsx、eventtree.ts、model.ts、useModel、参考库界面、FMEA 界面、风险矩阵、psa-btn/psa-card、standalone、离线包、vitest。
---

# 前端工作台实现与维护(psa-frontend)

真实代码结构优先——原蓝图(etafta-frontend)的 architecture/assets 描述的是设计期草图,已归档 `docs/skill-blueprints/`,**以本文与实际代码为准**;references/ 保留的是仍然有效的设计意图(FTA 符号规范、交互模式、结果呈现)。

## 一、真实架构(2026-07)

```
frontend/src/
  App.tsx            ~1000 行:标签路由(ETA/FTA/FMEA/参考库/报告)+ 两个 useModel(故障树 model + 事件树 etModel)
                     + userFts(自建 FTA)+ 各 store 装配 + 保存/存档/项目文件工具栏。Phase 3 计划拆分——新状态优先放 store,别再往里加。
  eventtree.ts       可编辑事件树模型:EtNode 分支显式记 feId(**有序可跳过**:选中叶可续接任意更靠后屏障);
                     积式频率(独立屏障下=精确);toEngineRequest 序列化(共享事件必须走引擎精确定量);
                     reorderFe(次序调整,后果按深度保留)、normalizeEta(旧存档兼容)。
  model.ts           可编辑故障树 + 纯操作 + activatedNodes(割集回溯高亮) + addFaultTree/deleteFaultTree(自建 FTA)。
  useModel.ts        撤销/重做 reducer(泛化 useHistory<T>)。
  api.ts             引擎/后端契约类型 + 调用(/api/quantify、/api/event-tree/{quantify,uncertainty,importance}、/api/bess/*、/api/saved、/api/report)。
  bayes.ts           纯前端贝叶斯:posteriorPfd(Beta-二项)+ posteriorRate(Poisson-Gamma)+ beta/gamma 分位数。
  riskmatrix.ts      6×5 中电联矩阵 + riskSummary。   fmea.ts  RPN/AP + 可配置 MappingConfig。
  libraryStore.ts    参考库用户覆盖层(localStorage 叠加内置,applyOverlay 全站生效,随项目文件迁移)。
  fmeaStore.ts / mappingStore.ts   localStorage 持久化(键 bess-eta:*)。
  projectFile.ts     项目文件信封 bess-psa-project(payload v2:ETA 页签+活动页+勾选集+userFts+FMEA+映射+库覆盖层)。
  components/        EventTreeEditor(837 行,直角连接器/冻结表头/检视器/内联贝叶斯)、FaultTreeCanvas+Palette+Inspector(React Flow+dagre)、
                     BarrierFtModal(屏障挂 FTA)、FmeaWorkbench、ReferenceLibrary(三表+分级筛选+现场更新)、
                     RiskMatrix+RiskSummary、SequencePaths(事故序列路径图)、LibPicker、AiDraftPanel、EChart(自写,勿用 echarts-for-react)、icons.tsx。
  theme.css          --psa-* 设计令牌 + psa-btn/psa-card/psa-ch/psa-kpi 等组合类;设计规范见 docs/design/restyle-spec.md。
```

## 二、硬性规则

1. **版本锁定**:Vite 5 / React 18 / echarts 5 / ag-grid 32(Node 20)。不升级。
2. **`id`/`feId` 稳定性是全局契约**——挂载 FTA、pfds、序列化、MEF 导出全依赖它;改名只改中文 `label`。屏障重排(`reorderFe`)有 isCascade/cascadeConsequences 守护测试。
3. **积式频率只在屏障独立时精确**;功能事件挂了共享基本事件的 FTA 时必须走「引擎精确量化」按钮路径(POST /api/event-tree/quantify)。UI 上要保留差异高亮语义。
4. **持久化三层**:localStorage(工作态)→ `/api/saved` 快速存档(opaque payload)→ 项目文件导出(离线可迁移)。改 payload 结构必须保持旧档兼容(经 normalizeEta / 缺省补全),并同时更新 serialize/deserialize 两侧。
5. **改了参考库数据或影响离线包的 UI ⇒ `make bundle`** 重新生成 `bess-eta-standalone.html`(scripts/capture-data.mjs 重生成 embeddedData.ts + inline-html.mjs 打包)。
6. **UI 验证用 `preview_eval` 查 DOM,不用 `preview_screenshot`**(重前端包必超时,既定惯例)。交互类改动在 preview 里实测(点击/拖拽/联动)再收口。
7. 样式走 `theme.css` 令牌与组合类,遵循 `docs/design/restyle-spec.md` 的卡片式语言;不要新增大段内联样式。
8. vitest 与源码同目录(`*.test.ts`);纯函数(eventtree/model/bayes/fmea/riskmatrix)是测试重心,新纯逻辑必须带测试。当前基线 165 例。

## 三、references(设计意图,仍有效)

- `fta-symbols.md` — IEC 标准门符号(与门平底拱顶/或门凹弧底尖顶)与节点视觉规范。
- `interactions.md` — 画布交互模式(选中/连线/删除/撤销/割集回溯高亮)。
- `results-and-data.md` — 结果呈现与数据网格设计意图。
