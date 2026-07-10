# 预置 ETA 模板迁移 —— 数据出处三查(4c2)

*2026-07-10 · 前身工具 `docs/reference-assets/templates-eta-claude.ts`(7 个 ETA 模板)迁入
`frontend/src/features/templates/etaTemplates.ts` · 硬约束 #4 自查,domain-reviewer 为合并门*

## 一、迁移口径

- 模板 = **可编辑起点**(UI 标注「量化前请按项目实测替换取值」),非参考库本体;但仍逐条带
  citation + grade,遵守内置只 C/D。
- **无单位换算**:所有初因频率均为系统级 /yr(EventTreeModel.initFreq 语义),前身注记里的
  「×电芯数折算」逐字保留在 note,不在代码里再乘。
- **failProb = 失败分支概率**(前身 branches[失败].probability),逐字搬运;McMicken 的高失败率
  屏障(热障 0.95、泄爆 0.95)表征「装备缺失」的设计事实,原样保留。
- 结局→后果级固定映射(前身 stdOutcomes):安全 C1 / 冒烟 C2 / 局部起火 C3 / 蔓延 C4 / 爆炸 C5。

## 二、逐模板分级与来源(内置合规性)

| 模板 | 初因 grade/source | 屏障 grade 分布 | 备注 |
|---|---|---|---|
| 通用预置 | C · EPRI 事故库 + 行业统计 | 1C/4D | **2 处 note=「示例参考值」**(warning、insulation)——已 grade D,来源诚实标注为示例 |
| 跨领域 LOPA | C · DNV GL QRA 2019 + 综述 §7 | 3C(3 屏障) | detect PFD₁=0.1 / suppress PFD₂≈0.1(NFPA 喷淋统计) / vent PFD₃=0.01(SIL 2, IEC 61511);逐字忠实,守护测试锁 |
| 内短路(ISC) | C · EPRI DB + 库条目 | 2C/2D | 屏障均引库条目(warn-tr-multi 等,已过 2026-07-08 校核) |
| 绝缘失效 | D · IEEE 493 + GB 51048 推断 | 3D | 初因 note=推断值,已 grade D |
| 过充 | C · EPRI 2024 白皮书 | 4D | IEC 62619/61511 引用明确 |
| 异常热源 | D · NFPA 855 + EPRI 推断 | 2C/2D | 初因 note=推断值,已 grade D |
| McMicken 对标 | D · DNV McMicken 报告 2020 | 6D | 反事实对标结构;每屏障 note 记 DNV 根因与口径 |

**合规结论(自查)**:① 分级全部 C/D ✓;② 每条初因与屏障均有 citation(长度>4)——单测
`etaTemplates.test.ts` 守护 ✓;③ 无单位换算 ✓;④ 最弱来源(通用预置的 2 处「示例参考值」)已诚实
grade D 并在 note 标注,不冒充实测。

## 三、留给 domain-reviewer 的重点

1. 通用预置模板的 warning(0.1)/insulation(0.15)两处「示例参考值」:是否应进一步在 UI
   或名称上弱化(如加「(示意)」),以免用户误当可交付取值。
2. McMicken 反事实语义:高失败率(0.95)表征装备缺失——note 是否足以让评审理解「非通用先验」。
3. 频率折算注记(×电芯数)是否需在模板卡片显式展示,避免被当作直接系统级实测。
4. 与现有场景库(bess/scenarios.json)是否有重名/口径冲突(模板走前端 EventTreeModel,不入
   bess/ 场景构建器,故与故障树后端场景解耦)。

## 四、domain-reviewer 首轮 FAIL 与修正(2026-07-10)

domain-reviewer(fable)逐条比对源文件,判 **FAIL**;要害与修正:

- **缺陷#1(阻断)LOPA 被杜撰**:初版把跨领域 LOPA 写成 4 屏障(排爆通风 PFD 0.01/C 误作 0.1/D、
  成功后果 C4 误作 C3、并**凭空新增**「舱间距 0.1」屏障)——在中电联 III 级(C4)静默低估约 11×。
  **已按前身逐字复原**为 3 屏障(detect 0.1/C→C1、suppress 0.1/C→C2「NFPA 喷淋统计,88–91%」、
  vent **0.01/C→C4「IEC 61511;DNV GL QRA」**含「双树精确复现」独立性口径注记);新增
  `etaTemplates.test.ts` LOPA 忠实守护测试锁死。自查表(§二)LOPA 行同步更正。
- **缺陷#2(阻断)初因溯源在建模时丢失**:`templateToEtaModel` 原只置 initFreqSource,弃 init
  source/note/grade → 建出的树初因**零溯源**(证据链首环断)。**已修**:EventTreeModel 增
  `initSource/initGrade/initEvidence`,converter 带入,`EtInspector` 初始事件段显示「置信 X · 来源 · 注记」。
- **缺陷#4 终态文字落回默认口径**:converter 原弃 outcomes → C2「冒烟」被默认「模组内热蔓延」覆盖。
  **已修**:模板带 outcomeNames(LOPA 自有五级名)。首修仅写旧字段 consequenceDefs,复评(R1)发现
  展示路径 `consText` 读 `consequences`、建页仍落默认(save/reload 才 normalize)——**已改写现代
  `consequences` 字段**(并留 consequenceDefs 兼容),建页即正确;测试改断言 `consText(model,'C2')`
  展示路径而非仅字段。
- **缺陷#5 McMicken 注记截断**:恢复 mcm-response「库先验 0.7 未 rig…留待反事实/敏感性」等被删语句;
  数值语义从前身「成功 0.05」诚实改述为「失败率 0.95」(与模型 failProb 一致,避免数-文相悖),
  保留「反事实复原至库先验 0.85」方法学内容 + 文件级反循环原则并入初因 note。
- **缺陷#6 屏障 category 丢失**:TemplateBarrier 增 `category`(warning/active/passive),逐条补全
  (预警屏障口径依据)。
- **缺陷#7/开放问题①**:自查表计数 2C/3D→1C/4D 已改;「量化前替换」免责由 title 提示升级为**建页可见横幅**
  (EtaWorkbench,标示 C/D 级 + 指向检视器逐条来源)。

**复评结论**:两处阻断缺陷(LOPA 逐字复原、IE 证据链两层贯通)均判 **PASS 并加锁定测试**;R1(缺陷#4
半接线)已按复评建议一行修正并强化测试为展示路径断言。

**仍留作后续(非本次阻断)**:
- 缺陷#3 / R2(`setFailProb` 及 `setInitFreq` 手改数值不清置信快照——前身既有核心语义,涉
  eventtree.ts 全局;follow-up 任务 task_7dcd9495 已含 IE 字段口径)。
- R3(`to_v2` 仅还原 `initEvidence=evidence[0]`——当前唯一写入者只写 1 条,无损;若后续多条追加需拼接,
  已在 convert.py 加注)。
- 开放问题④(模板 IE 频率与 bess/scenarios.json 同物理初因取值口径差 2–50×,各自可辩护但需在模板
  note/技能文档说明并存理由)。

## 五、验收

- `etaTemplates.test.ts`(6 例):7 模板保留、分级 C/D、来源非空、初因溯源带入、终态文字随模板、
  converter 级联结构/失败分支映射、McMicken 高失败率、**LOPA 逐字忠实守护**。
- preview:7 模板下拉齐全、McMicken 建页渲染 + 引擎精确量化(≥III 累计 3.3e-5)、模板横幅可见、
  初因溯源入检视器、无 console error。fe vitest 全绿。
