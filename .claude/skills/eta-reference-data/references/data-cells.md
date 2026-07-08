> **迁移说明(2026-07-07)**:本文迁自前身工具(D:\\ETA_claude)的数据技能。其中「机制/文件路径」(components.ts、SystemFreqPanel、evalPipeline.ts、data.test.ts 等)描述的是前身代码库,当前工具的对应机制见本技能 SKILL.md;**数据分型、口径规范、来源定级、id 命名与数值量级仍然有效**。

---
name: eta-data-cells
description: 电芯/电池包失效率数据细化 skill。在向 ETA 工具新增电芯失效率条目(分化学体系、容量段、循环老化段、温度段)时使用;涵盖 id 命名、来源定级、与 SystemFreqPanel 的配合、TDD 入库流程及升级路径。触发词:电芯失效率、电芯热失控频率、LFP/NCM/LTO 分档、循环老化分档、cell-lfp/cell-ncm/cell-lto。
---

# 电芯失效率数据细化

## 1. 分档维度表

电芯条目沿 `Applicability` 四个维度分档,字段与 `ComponentFailureEntry.applicability` 对应:

| 维度            | 可选值(示例)                  | `Applicability` 字段      |
|---------------|---------------------------|--------------------------|
| 化学体系        | LFP / NCM / NMC811 / LTO / other | `chemistry`              |
| 容量段          | ≤50 Ah / 50–300 Ah / ≥300 Ah  | `capacityRange`          |
| 循环老化段       | 0–1000 次 / 1000–1500 次 / >1500 次 | `cycleRange`             |
| 温度段          | −20–0 °C / 0–45 °C / >45 °C    | `temperatureRange`       |

同一化学体系可按需组合多维度分档;仅填写有约束的维度,不填表示"所有"。

**LFP 参考量级(公开来源):**

| 老化阶段     | 循环次数      | 失效率 (×/cell·yr) | 推荐定级 |
|------------|-------------|--------------------|---------|
| 寿命前期    | 0–1000 次    | ~1×10⁻⁷             | C       |
| 中期        | 1000–1500 次 | ~2×10⁻⁷             | D       |
| 深度老化    | >1500 次     | ~5×10⁻⁷             | D       |

NCM/NMC 整体量级较 LFP 偏高约 2–5 倍(电解液氧化+隔膜老化),正式使用须按项目数据校核。

## 2. id 命名约定

格式:`cell-{chem}-{分档标签}`

- `{chem}`:小写化学体系缩写,如 `lfp` / `ncm` / `lto`
- `{分档标签}`:简洁描述老化/容量特征,如 `fresh`(新品/寿命前期)、`aged`(中期)、`deepaged`(深度老化)、`large`(大容量)

**示例:**
- `cell-lfp-fresh` — LFP 寿命前期,0–1000 次
- `cell-lfp-aged` — LFP 深度老化,>1500 次
- `cell-ncm-hightemp` — NCM 高温工况

**unit 固定为 `/cell·yr`**,表示单颗电芯·年归一化失效率。

## 3. 来源优先级与定级表

| 级别 | 来源类型                                        | 允许层   | 说明                                                      |
|------|------------------------------------------------|---------|-----------------------------------------------------------|
| A    | 项目实测(现场运行统计)                          | 用户层   | 须录入电芯年运行量与失效次数,贝叶斯更新后自动升 A           |
| B    | 厂商出厂数据(MTBF/失效报告)                     | 用户层   | 保密性强,仅用户层,不入 builtin                             |
| C    | 行业公开统计(EPRI BESS DB/Battery University/ACP) | builtin | 直接引用可计数数据集或公开统计;citation 须含来源名称与年份    |
| D    | 文献推断/类比估算                               | builtin | 推断逻辑须在 `source.note` 中写明;工程推断值需说明倍增依据   |

**内置条目只允许 C/D**;A/B 来自用户数据(导入或数据库页录入)。

## 4. 与 SystemFreqPanel 及模板 initiatingEvent 的配合方式

`/cell·yr` 口径条目**不能**直接作为 ETA 初始事件频率,须经 `SystemFreqPanel`(Pack 换算)或手动折算:

```
系统初始频率 f = 电芯总数 N × 电芯失效率 λ
```

- **SystemFreqPanel** 操作:选择器件库中 `cell-*` 条目 → 填入 Pack 电芯数 → 自动输出 `/系统·年` 频率 → 一键填入树的 `initiatingEvent.frequency`。
- **模板配合**:`bess-ie-thermal-runaway`、`bess-lopa-crossdomain` 等模板的初始事件默认使用 `cell-tr-typical`(1e-6/cell·yr × 1e4 cells = 0.01/yr);切换分档条目时须同步更新 `initiatingEvent.frequency`。
- **树节点引用**:节点从库引用时快照 `grade`;手动改 `frequency` 即清除快照(视为自定义,结果按 D 计并标注)。

## 5. 入库 TDD 流程

### 5.1 builtin 条目(改 components.ts + data.test.ts)

1. **先写失败测试**(`src/data/data.test.ts` 追加):

```ts
it('P?? 电芯分档条目 cell-lfp-xxx', () => {
  const e = COMPONENT_LIBRARY.find((x) => x.id === 'cell-lfp-xxx');
  expect(e).toBeDefined();
  expect(e!.rate).toBeCloseTo(EXPECTED_RATE, 15);
  expect(e!.unit).toBe('/cell·yr');
  expect(e!.applicability?.chemistry).toBe('LFP');
  expect(e!.applicability?.cycleRange?.length).toBeGreaterThan(0);
  expect(e!.source.citation.length).toBeGreaterThan(0);
  expect(['C', 'D']).toContain(e!.grade);
});
```

2. 运行确认失败:`npm test -- --run src/data/data.test.ts`
3. 在 `src/data/components.ts` 的 `COMPONENT_LIBRARY` 末尾追加条目
4. 运行确认通过
5. 提交:`git add src/data/components.ts src/data/data.test.ts`

### 5.2 用户层条目(数据库页 / CSV 导入)

CSV 列(器件):`id,name,failureMode,rate,unit,grade,chemistry,capacityRange,cycleRange,temperatureRange,citation,url,note`

- `unit` 必须为 `/cell·yr`
- `grade` 只允许 `A`/`B`(A/B 仅用户层)
- 导入原子:任一行非法整体拒绝;id 与内置相同跳过

## 6. 升级路径

```
D(推断) → C(统计引用) → B(厂商,仅用户层) → A(现场实测,仅用户层)
```

**D → C:**在 EPRI BESS DB、Battery University 等公开数据集中找到可直接引用的计数统计,更新 `citation` 并将 `grade` 改 `C`。

**C/D → A:**在数据库页录入现场"需求/失败"次数,触发 Beta 二项贝叶斯更新(`src/core/bayes.ts`)——后验均值替换 `rate`,`grade` 自动升 A,`source` 记录证据链。

**P12 测评管道升级(仅 barriers.ts 适用,电芯条目不适用):**见 eta-data-warning 技能。

## 7. 示范条目指引

builtin 库已包含以下 P16 示范条目:

| id                | rate      | grade | applicability                     |
|-------------------|-----------|-------|-----------------------------------|
| `cell-lfp-fresh`  | 1×10⁻⁷   | C     | chemistry: LFP, cycleRange: 0–1000 次 |
| `cell-lfp-aged`   | 5×10⁻⁷   | D     | chemistry: LFP, cycleRange: >1500 次 |

这两条展示了同一化学体系按循环老化分档的最小完整示例。新增条目参照其结构,尤其注意:
- `source.note` 中写明推断逻辑(D 级)或来源统计口径(C 级)
- `applicability` 至少填写 `chemistry` + 有约束的分段维度
- `cycleRange` 字符串需与已有条目对齐(一致性便于 UI 筛选)

**P22 扩展(2026-06-22):**已补 `cell-lfp-mid`(1000–1500 次,2e-7)、`cell-ncm-fresh`/`cell-ncm-aged`(NCM,3e-7/1.5e-6)、`cell-lto-fresh`(LTO,1e-8)、`cell-lfp-large`(≥300Ah,1.5e-7)、`cell-lfp-hightemp`(>45℃,5e-7),首次覆盖 NCM/LTO 化学体系与 `capacityRange`/`temperatureRange` 维度,均 D 级推断。另有电子/系统部件失效率(BMIC/BCU/RPCB/液冷子部件/传感器/Pack 不一致性等 18 条)入 `COMPONENT_LIBRARY`,unit `/unit·yr`,来源「储能系统基本事件失效率分配表(2026-06,行业 FMEA)」,D 级,须按项目 FIT/运行数据校核。

## 8. 数据声明

本技能所有数值均为公开来源参考量级,来自 EPRI BESS Failure Incident Database、Battery University、American Clean Power 统计等文献,仅用于演示与初步筛查。正式分析须按项目实际运行数据与厂商报告校核替换,并由具备资质的工程师审核。
