---
name: eta-reference-data
description: 参考失效率/屏障有效性数据库的维护技能。向内置库(bess/reference_data.json)或用户覆盖层新增/修改器件失效率、屏障 PFD、初因频率条目,处理置信分级(A/B/C/D)、来源引用、探测维度、现场贝叶斯更新,或校核数据出处时使用。触发词:参考库、失效率、PFD、初因频率、置信分级、citation、来源校核、贝叶斯更新、现场数据、detection、cell-lfp、warn-gas、B_BMS、CFR_。
---

# 参考数据库维护(eta-reference-data)

**这是安全工具:每个数字都可能进监管报告。** 没有出处的数值不入库;单位口径错误比数值错误更危险。

## 一、当前机制(2026-07)

- **内置基线**:`bess/reference_data.json`(去重后 41 器件 + 51 屏障 + 初因频率),`bess/library.py` 加载,`GET /api/bess/library` 供前端。**保持单条目单行的紧凑 JSON 格式**(diff 友好,历史惯例)。
- **用户覆盖层**:前端 `libraryStore.ts`(localStorage 叠加内置,增删改/导出导入/恢复内置;`applyOverlay` 后全站生效;随项目文件迁移)。内置层改动走本仓库,用户层数据永不写回 builtin。
- **条目字段**:`source.citation` **必填**(测试强制)+ `grade` + 可选 `url`/`note`(换算方法、口径、误报率写这里);屏障带 `category`(warning/active/passive)与 `detection{difficulty(1–5), silent, precursor}`;器件带 `rate`+`unit`;初因带 `freq_prior`。
- **入库流程(TDD)**:改 `reference_data.json` → `tests/test_library.py` 守护(计数与关键 id:`B_OFFGAS/B_BMS/B_THERMAL/B_DEFLAG/B_SPACING/B_RESPONSE` 等)→ `make test-py` → **`make bundle`**(离线包内嵌库,必须重新生成 embeddedData.ts)。
- **id 约定**:PSA 原生 `CFR_*`(器件)/`B_*`(屏障)优先;前身工具风格 `cell-*`/`warn-*`/`sup-*` 仍在库中,语义重复时**保留 PSA 原生 id、并入更详 note 后删除重复者**(2026-06-26 去重先例)。

## 二、置信分级(全局语义,UI 有色标)

| 级 | 含义 | 允许层 |
|---|---|---|
| A | 项目实测(现场运行统计/贝叶斯更新后) | 仅用户层 |
| B | 厂商数据(MTBF/出厂报告,保密) | 仅用户层 |
| C | 行业公开统计(EPRI/OREDA/NPRD/NFPA/FM Global/UL 9540A 第三方报告) | builtin ✓ |
| D | 文献推断/类比(SIL 类比、设计推断;推断逻辑写入 note) | builtin ✓ |

**builtin 只允许 C/D。** 节点从库引用时快照 grade;手改数值即清快照(按 D 计并标注)。

## 三、单位与口径(最易错)

- 器件失效率:`/cell·yr`(单电芯·年)与 `/unit·yr`(单设备·年)不可混;`/cell·yr` 条目**不能直接作初始事件频率**,须经产品维度换算(f = N_cells × λ,前端「产品维度 cell→初因映射」)。
- 屏障:`pfd` = 每需求失效概率(有效性 = 1 − PFD)。前身工具存 `successProb`,迁移换算 `pfd = 1 − successProb`。
- **预警类屏障存"事件级召回率"口径**,不是样本级精确率/F1;误报率与提前量记 `note`,不入 PFD。详见 `references/data-warning.md`。
- 单位换算不确定时:原值+单位记入 `source.note`,不擅自换算(既定规则)。

## 四、现场贝叶斯更新(D/C → A 的通道)

- 屏障 PFD:`bayes.ts::posteriorPfd`(Beta-二项;先验=当前 PFD·强度 n₀ 或 Jeffreys;数据 N 需求/k 失败)。入口:参考库屏障行「现场更新」+ ETA 屏障检视器内联面板。
- 器件率/初因频率:`posteriorRate`(Poisson-Gamma;T 曝露/k 失效)。
- 采用后验 → 写回数值、`grade→A`、`source.note` 追加证据链。金标锚点:`betaQuantile(0.9,1,22)≈0.0994`、`gammaQuantile(0.9,1,1)≈2.302`(动这些函数必须保锚点)。

## 五、references(迁移自前身工具的数据技能,分型/口径/来源定级仍有效)

- `data-cells.md` — 电芯失效率分档(化学体系/容量/循环老化/温度)、LFP/NCM/LTO 量级、id 命名。
- `data-warning.md` — 预警屏障分型(AI/机理阈值/气体单参量/多参量)、事件级召回率口径、误报率治理、测评管道思想。
- `data-fire-protection.md` — 消防抑制分型(介质×层级×触发)、NFPA/FM/UL 9540A 数据源定级。

> 数据免责:内置数值为公开来源参考量级,仅用于演示与初步筛查;正式分析须项目数据校核并由具备资质的工程师审核(报告导出已含免责声明,勿删)。
