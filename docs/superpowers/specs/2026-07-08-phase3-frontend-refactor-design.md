# Phase 3:前端结构重构蓝图(设计)

*状态:结构评审完成,重构方案成稿;外壳/IA 方向待用户从 4 个 mockup 中选定 · 2026-07-08*

范围:**设计级**——本文是结构评审结论 + 重构蓝图;实施待排期(ADR 实现暂缓为用户既定
决策,本蓝图不依赖 ADR-1 落地,但为其原生化预留切换点)。

## 一、结构评审发现(App.tsx 982 行 / 52 hooks,逐行核对)

1. **五个互不相关的状态域同居一个组件**:①多 ETA 页签(etaTabs/activeKey/checkedKeys)
   ②FTA 三路编辑目标(`cv*` 五元组按 `src: model|eta|standalone` 三态路由,L416-453)
   ③持久化(saved/savedId/archiveLocal + 项目文件导入导出)④参考库叠加
   (libBase/lib/libVersion)⑤AI 草案 9 个状态 + FMEA 2 个。
2. **活动页签双真相(核心反模式)**:活动 ETA 的实时态在 `etHist/etFts/pfds` 三个独立
   hook,非活动页签在 `etaTabs[].{model,fts,pfds}` 快照;所有跨页签读取都要写
   `t.key === activeKey ? etModel : t.model` 三元(≥7 处);每个页签操作前必须手工
   `snapshotActive()`,漏调即静默丢编辑。这是未来一切多视图/协作特性的税。
3. **派生量回写纠缠**:linkFt 屏障的 PFD(quantify 顶值)回写进 `etHist`(内容撤销
   历史)——撤销结构编辑会留下过期派生值(代码在 L425-428 自注此坑);`pfds` 又独立
   存一份缓存,与 failProb 双写。
4. **副作用内联**:buildScenarioTab/computePfds/save/load/import/export/AI apply
   全部在组件体内,不可单测(现状:App 级测试仅 4 例,靠纯函数层兜底)。
5. **EventTreeEditor 837 行**:画布 SVG 渲染 + 冻结表头 + 检视器 + 内联贝叶斯面板 +
   序列路径表 + 分栏拖拽同文件;RiskMatrix/RiskSummary/SequencePaths 已是独立组件
   (先例良好),编辑器本体未拆。

## 二、目标状态架构(zustand,三 store 一分离)

```
stores/
  projectStore   单一项目文档:etas 全量(无活动/非活动之分)+ userFts + fmea + mapping
                 编辑 actions 直接复用 eventtree.ts/model.ts 纯函数;
                 撤销/重做提升为文档级单历史(现 useHistory<T> 泛化即可)
  viewStore      activeKey / 主标签 / FTA 编辑目标 / 布局(treeH/seqW)/ 选中 / 折叠
                 —— persist 到 localStorage,键控预留 project 标识(ADR-1 D2 落地位)
  derivedStore   pfds / quantify 结果 / 不确定性 / AI 草案请求态
                 —— 内容与派生彻底分离:linkFt 屏障的 failProb 不再回写内容历史,
                 显示与序列化时从 derived 合成快照(消解 L425 之坑)
libraryStore     现存,保持
```

- **双真相消失**:活动/非活动页签同源于 projectStore;`snapshotActive` 删除;
  跨页签三元不再存在(可作 grep 验收)。
- **canonical 切换点**:projectStore 的文档形状先沿 v2(绞杀者);ADR-1 实现后,
  store 内部形状换 canonical、serialize 边界换转换器,组件层选择器不动。

## 三、组件分解

```
App.tsx (≤200 行:壳 + 路由 + Provider)
  ├─ features/eta/ EtaWorkbench(容器)
  │    EventTreeEditor 拆:EtCanvas(SVG+冻结表头)/ EtInspector(屏障检视+内联贝叶斯)
  │                        / SequencePaths(已有)/ EtToolbar
  ├─ features/fta/ FtaWorkbench(cv* 路由 → viewStore.ftaTarget 显式选择器)
  ├─ features/fmea|library|consequences|report/ 容器化现组件
  ├─ features/ai-draft/ AiDraftPanel + apply 逻辑(出 App)
  └─ features/persistence/ save/load/import/export + scenario-loader(出 App,可单测)
```

## 四、实施顺序(渐进绞杀,每步全绿可交付)

1. viewStore 抽取(纯搬迁,低风险)→ 2. persistence/scenario 副作用出组件(补单测)
→ 3. projectStore 页签统一(删双真相;**本步最大,单独 spec+plan**)→ 4. derived
分离(PFD 回写解耦)→ 5. EventTreeEditor 拆分 → 6. 外壳/IA 落地(按选定 mockup,
执行 docs/design/restyle-spec.md 的既有约定)。
每步:vitest 全绿(基线 165)+ 新增 store 测试 + preview_eval 交互冒烟 + `make bundle`;
**不改 id/feId/payload/引擎契约**(守护测试在)。

## 五、外壳/IA 方向(design-directions,待用户选)

四个分歧方向的单文件 HTML mockup(真实数据:5 场景、真实屏障名与量级、6×5 中电联
矩阵、A–D 分级徽章),见 `docs/design/mockups/2026-07-08-shell-{a,b,c,d}.html`:

| # | 方向 | 押注 |
|---|---|---|
| A | 工程座舱(Explorer-classic) | RiskSpectrum 用户零迁移成本:左侧项目树 + 密排表格 + 坞式面板 |
| B | 分析驾驶舱(Mission-control) | 洞察先行:KPI 带 + 卡片网格,面向评审/管理汇报的首屏 |
| C | 画布至上(Canvas-first) | 分析师心流:模型即屏幕,浮动面板 + ⌘K 命令板 + 数字溯源气泡(可解释数字的主舞台) |
| D | 证据文档(Dossier) | 报告即产品:活报告大纲 + 嵌入式实时图表,每个数字挂 case/版本徽章,监管第一 |

选定后:融合意见 → 按 restyle-spec 风格写实现规格 → 归 frontend-dev 分步实施(§四-6)。

## 六、验收标准(实施期)

App.tsx ≤200 行;`snapshotActive`/跨页签三元清零;PFD 回写不再进内容历史(撤销结构
编辑后派生值一致性测试);vitest 165 基线全绿 + store 层新测;preview_eval 冒烟
(切页签/挂 FTA/量化/保存/导入全链);离线包重建。

## 非目标

canonical 原生化(等 ADR-1 实现解禁)、Yjs/协作、视觉 token 重做(沿用 theme.css +
restyle-spec)、EventTreeEditor 交互语义变更(纯拆分)。
