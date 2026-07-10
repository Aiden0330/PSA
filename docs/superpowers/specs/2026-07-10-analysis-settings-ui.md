# 分析设置面板 UI(4c1)—— 边界条件 + 割集后处理规则

*2026-07-10 · Phase 4 收尾:把 4a2(house/边界条件)与 4a3(割集后处理)的引擎能力接到界面 ·
依赖已就绪:`/api/quantify` 接受 `house_states`/`boundary_condition_set`/`post_rules`,响应含
可选 `post` 块;`EtQuantifyRequest` 同样接受 house/边界字段。*

## 一、放置

- **主面板在 FTA 工作台**:house 事件 + 后处理规则 + 割集三者天然同域(都作用于单棵故障树的
  `/api/quantify`)。右侧检视列新增可折叠「分析设置」段(位于「属性」上方),量化时一并提交。
- **ETA 侧从简**:引擎精确量化按钮旁加「边界条件」轻量选择(house 覆盖),经 `toEngineRequest`
  透传;当前默认场景的联动故障树多无 house 事件,故不做完整面板,仅保证能力贯通。

## 二、语义边界(与引擎既定行为一致,勿在前端重复判定)

1. **house 覆盖只在副本生效**:引擎 `apply_house_states` 在 PDAG 副本上改状态,模型本体不变
   (审计前提)。前端只发「覆盖字典」,不改本地模型树。
2. **精确概率通道不受后处理影响**:`result.probability` 恒为**未后处理**模型的精确 BDD 顶值
   (卖点)。后处理仅作用于 MCS 列表,其概率估计走 `post.probability_rea`/`post.probability_mcub`
   (RiskSpectrum MCS 级语义)。UI 必须把两者分列、不得让用户误以为后处理改了精确值。
3. **命名集 vs 显式覆盖的优先级**(seam):后端 `resolve_house_states` = 命名集打底、显式
   `house_states` 覆盖(逐键)。前端遵循同序——面板里选中命名集后,逐个 house 开关表达的是
   **对该集的增量覆盖**;「另存为命名集」时保存的是**合成后**的最终字典。
4. **未知 house / 非 house 目标 → 后端 400**:前端只从当前树的 house 节点生成开关,天然不越界;
   仍需把 400 文案透传给用户(不静默吞)。

## 三、模块与组件

- `features/analysis/analysisSettings.ts`(纯,单测):
  - `listHouseEvents(model, ftName)` → `{id,label,state}[]`(从 FT 节点抽 `house` 节点)。
  - `PostRuleDraft` 类型 + `newPostRule(kind)` + `validatePostRules(rules)`(phi 无关;
    互斥≥2 成员、删除≥1、恢复需 add_event + prob∈[0,1])——与引擎 `PostRule.from_dict` 同规则,
    前端先验校验只为即时反馈,真值仍由后端把关。
  - `AnalysisSettings` 状态形:`{houseOverrides: Record<id,bool>, postRules: PostRuleDraft[]}`。
  - `toQuantifyOptions(settings)` → `{house_states, post_rules}`(空则省略键,保持旧请求形状)。
- `features/analysis/AnalysisSettingsPanel.tsx`:house 三态开关(继承/真/假 → 简化为覆盖开关 +
  「清除覆盖」)+ 后处理规则列表编辑(类型下拉 + 成员多选 + 恢复事件/概率)。
- `api.ts`:`quantify(model, ft, method, opts?)` 增可选 `opts:{house_states?,post_rules?}`;
  `QuantifyResult` 增 `post?:{removed,recovered,probability_rea,probability_mcub}`。
- `ResultsPanel`:有 `post` 时加一段「后处理」——精确值/后处理 REA·MCUB 并列 + 删除/恢复计数。

## 四、验收

- `analysisSettings.test.ts`:house 抽取、规则校验、`toQuantifyOptions` 空省略/非空透传。
- 后端 `test_postprocess.py` 已覆盖 `/api/quantify` 的 house+post 往返与精确值不变(4a3)。
- preview:FTA 加互斥规则后量化 → 结果面板显示精确值不变 + 后处理 removed 计数 + REA;
  house 开关翻转改变顶值。无 console error;`tsc -b` + vitest 全绿;离线包重建。
