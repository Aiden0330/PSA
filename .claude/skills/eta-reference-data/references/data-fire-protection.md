> **迁移说明(2026-07-07)**:本文迁自前身工具(D:\\ETA_claude)的数据技能。其中「机制/文件路径」(components.ts、SystemFreqPanel、evalPipeline.ts、data.test.ts 等)描述的是前身代码库,当前工具的对应机制见本技能 SKILL.md;**数据分型、口径规范、来源定级、id 命名与数值量级仍然有效**。

---
name: eta-data-fire-protection
description: 消防/防爆措施数据细化 skill。在向 ETA 工具新增消防抑制类 barrier 条目(全氟己酮/细水雾/干粉/CO₂/泡沫/气溶胶 × Pack/舱/场站级 × 自动/手动触发)时使用;涵盖分型维度、数据源规范、与 site.ts 场站外推的关系、入库流程及示范条目指引。触发词:消防措施、灭火系统、全氟己酮、细水雾、干粉、气溶胶、Pack 抑制、舱级全淹没、sup-pack、sup-aerosol、fire-protection。
---

# 消防/防爆措施数据细化

## 1. 分型维度表

消防措施按三个正交维度描述:

### 1.1 介质类型

| 介质         | 典型条目 id             | 优点                      | 局限                          |
|------------|----------------------|--------------------------|-------------------------------|
| 全氟己酮(FK-5-1-12) | `pas-gas-suppression` | 洁净、电绝缘;NFPA 认可     | 对复燃和内部热失控链效果有限     |
| 细水雾       | `sup-water-mist`     | 冷却+窒息双重效果;复燃延迟显著 | 需水源;机械结构较复杂           |
| 干粉         | `nfpa-dry-chem`      | 快速扑灭明火;成本低         | 有效率仅 58%;清洁困难;复燃风险  |
| CO₂         | `nfpa-co2`           | 综合有效率 84%;洁净         | 不降温,内部热失控可能复燃       |
| 泡沫         | `nfpa-foam`          | 大面积火灾控制;冷却效果好    | 对锂电池内短路无针对性          |
| 气溶胶       | `sup-aerosol`        | 体积小、安装灵活;对初期火灾有效 | 降温能力有限,须与冷却措施组合   |

### 1.2 作用层级

| 层级         | 典型条目 id                   | 作用对象                   | 参数口径                        |
|------------|------------------------------|--------------------------|--------------------------------|
| Pack 级定向  | `sup-pack-direct`            | 单 Pack 或 Rack 内定向喷射  | PFD = 1 − successProb,事件级     |
| 舱级全淹没   | `pas-gas-suppression`        | 整个储能舱充满抑制剂         | 同上                           |
| 场站级      | `site-cabin-separation`(隔离) | 舱间蔓延阻断;非主动灭火      | 与 site.ts q 参数关联,见 §3     |

### 1.3 触发方式

| 触发          | 说明                                               | 对 PFD 的影响            |
|-------------|--------------------------------------------------|------------------------|
| 自动联动      | 探测信号(气体/烟感/温度)触发,响应时间 <30 s        | 高 successProb(联动可靠性高) |
| 手动          | 操作员确认后触发;响应时间 1–5 min                  | 较低,须按 LOPA 操作员响应典型值 |

## 2. 数据源规范

| 来源                                             | 适用定级 | 说明                                               |
|-------------------------------------------------|---------|---------------------------------------------------|
| NFPA 统计(Hall 2009; Ahrens 2024)               | C       | 含喷淋动作率×有效率;需注明场所类型                   |
| FM Global Data Sheet 5-33                       | C       | 洁净灭火剂系统设计与有效性;需注明 DS 版本             |
| UL 9540A 单元/组件/系统级测试报告                  | C       | 含抑制剂类型、电芯化学体系、测试通过标准;强烈推荐        |
| GB 50370-2005 气体灭火系统设计规范                 | D       | 规范类比;未含锂电池专项测试                           |
| GB 51048-2014 储能电站设计规范                     | D       | 储能专项条款可参照,但无统计有效率数据                  |
| 产品白皮书(单一厂商,无第三方测试)                  | D       | 需在 note 中注明"单一厂商数据,须第三方测试校核"        |
| UL 9540A 实测(含具体产品型号,第三方出具)           | C       | 最推荐;提供最接近实际部署的场景化有效率                |

**citation 必须包含:**来源名称 + 版本/年份 + 适用场景(如"单元级"/"舱级"等)。

## 3. 与 site.ts 场站外推 q 参数的关系

`site.ts` 实现场站级多舱蔓延外推:

```ts
// src/core/site.ts 核心逻辑(简化)
场站频率 = [N − β(N−1)] × f         // 单舱等效
多舱事件频率 = β × f + N(1−β) × f × q  // q = 舱间蔓延概率
```

**舱间隔离条目(`site-cabin-separation`,successProb=0.9)**直接影响 `q`:

- 若项目使用标准 NFPA 855 间距且无额外防火墙,`q` 可参考 `1 − successProb = 0.1` 作起点
- Pack 级定向抑制(`sup-pack-direct`)主要阻止舱内传播,**不直接影响** site.ts 的 `q`
- 舱级全淹没系统(如 `pas-gas-suppression`)与舱间隔离共同决定多舱事件频率

**在分析页「场站级参数」面板**中设置 `spreadProb`(蔓延概率 q):
- 有 UL 9540A 系统级通过报告 → q ≤ 0.05(工程建议)
- 仅舱间间距符合 NFPA 855 → q ≈ 0.1(参考 `site-cabin-separation`)
- 无专项消防设计 → q = 0.3–0.5(保守估计)

## 4. 入库流程与定级

### 4.1 builtin 条目(改 barriers.ts + data.test.ts,TDD 流程)

1. **先写失败测试**(`src/data/data.test.ts` 追加):

```ts
it('P?? 消防分型示范条目 sup-xxx', () => {
  const e = BARRIER_LIBRARY.find((x) => x.id === 'sup-xxx');
  expect(e).toBeDefined();
  expect(e!.successProb).toBeCloseTo(EXPECTED_PROB, 12);
  expect(['C', 'D']).toContain(e!.grade);
  expect(e!.category).toBe('passive');
  expect(e!.source.citation.length).toBeGreaterThan(0);
  expect(e!.origin).toBe('builtin');
});
```

2. 运行确认失败:`npm test -- --run src/data/data.test.ts`
3. 在 `src/data/barriers.ts` 的 `BARRIER_LIBRARY` 末尾追加条目
4. 运行确认通过
5. 提交:`git add src/data/barriers.ts src/data/data.test.ts`

### 4.2 定级决策树

```
有 UL 9540A 单元/系统级测试报告(含本项目化学体系)? 
  → 是 → C 级,citation 含报告编号
  → 否 → FM Global DS 5-33 或 NFPA 统计可支持?
           → 是 → C 级,citation 含来源+年份
           → 否 → D 级,note 中注明推断逻辑
```

### 4.3 用户层 CSV 导入(A/B 级)

CSV 列(measures):`id,name,category,successProb,grade,chemistry,capacityRange,cycleRange,temperatureRange,citation,url,note`

- `category` 必须为 `passive`(消防措施)
- `grade` A/B 仅允许用户层,不允许 builtin

## 5. 示范条目指引

builtin 库已包含以下 P16 消防分型示范条目:

| id                | successProb | grade | 层级        | 介质     | 触发   |
|-------------------|-------------|-------|-------------|---------|-------|
| `sup-pack-direct` | 0.92        | D     | Pack 级定向  | 通用    | 自动  |
| `sup-aerosol`     | 0.85        | D     | 舱/Pack 级  | 气溶胶  | 自动  |

与已有条目的区分:
- `sup-pack-direct` vs `pas-thermal-barrier`(0.85/D):前者是主动喷射抑制,后者是被动隔热阻隔;两者作用机理不同,可串联在 ETA 中作不同屏障
- `sup-aerosol` vs `pas-gas-suppression`(0.9/C):前者为气溶胶体积小灵活安装,适合 Pack 级近距离部署;后者为全氟己酮舱级全淹没,NFPA/FM 统计支撑定级 C

**新增条目时注意:**
1. `source.note` 须说明"推断"逻辑(D 级)或来源数据口径(C 级)
2. 若对复燃有效性存疑,在 `note` 中写明"须与降温措施组合"或"须按 UL 9540A 试验校核"
3. Pack 级条目 `applicability` 可留空(通用介质),场站级条目可加 `temperatureRange`

**P22 扩展(2026-06-22):**已补 `sup-manual-extinguish`(手动触发,操作员响应 1–5 min,0.7/D,首次覆盖「触发方式」维度)、`pas-fk-clean-agent`(全氟己酮 FK-5-1-12 专项,0.85/C,NFPA 2001;复燃/内部热失控链有效性有限须组合降温,区别于泛指的 `pas-gas-suppression` 0.9)。

## 6. 数据声明

本技能所有数值均为公开来源参考量级,来自 NFPA 灭火统计、FM Global Data Sheet 5-33、UL 9540A 单元级测试、GB 50370/GB 51048 规范等文献,仅用于演示与初步筛查。消防系统有效性强烈依赖部署位置、储能系统化学体系、Pack 结构与联动逻辑,正式分析须按项目实际测试报告与规范要求校核替换,并由具备资质的工程师审核。
