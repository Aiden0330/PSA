# 拓展参考库(并入 ETA_claude 内置库)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `D:/ETA_claude/eta-tool/src/data/{barriers.ts,components.ts}` 我尚缺的条目补充式并入 `bess/reference_data.json`(屏障 10→43、器件 5→15),引入 `grade`/`url`,前端参考库加置信列。

**Architecture:** 纯数据 + 小前端/测试。`successProb→pfd=1−sp`;现有 id/值不动;跳过同名重复。

**Tech Stack:** JSON / Python pytest / React TS。

**数据源(执行时照此转写)**:`D:/ETA_claude/eta-tool/src/data/barriers.ts` 的 `BARRIER_LIBRARY`、`components.ts` 的 `COMPONENT_LIBRARY`(本会话已读取)。

**验证:** `.\.venv\Scripts\python.exe -m pytest -q`;`npm run build --prefix frontend` + `preview_eval`。

---

## Task 1: 测试先行 + 数据合并

**Files:** Modify `tests/test_library.py`, `bess/reference_data.json`

- [ ] **Step 1: 扩充 `tests/test_library.py`**(在现有测试后追加)

```python
def test_expanded_counts():
    lib = load_library()
    assert len(lib["barrier_effectiveness"]) >= 40
    assert len(lib["component_failure_rates"]) >= 14


def test_grade_present_and_valid():
    lib = load_library()
    for sec in ("barrier_effectiveness", "component_failure_rates"):
        for r in lib[sec]:
            assert r.get("grade") in ("C", "D"), f"{sec}:{r['id']} grade={r.get('grade')}"


def test_existing_scenario_ids_preserved():
    ids = {b["id"] for b in load_library()["barrier_effectiveness"]}
    assert {"B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG", "B_SPACING", "B_RESPONSE"} <= ids
```

- [ ] **Step 2: 跑测试确认失败** — `... -m pytest tests/test_library.py -q` → `test_expanded_counts`(当前 10/5)与 `test_grade_present_and_valid`(现有无 grade)失败。

- [ ] **Step 3: 给现有 15 条补 `grade`**(`bess/reference_data.json`,id/值/citation 不变)

按来源定级:统计/手册类(EPRI/NPRD/OREDA/IEEE/NFPA/LOPA/UL 9540A 研究)→`"C"`;SIL 类比/示例/工程推断→`"D"`。逐条:
- 器件:`CFR_CELL_TR`→C、`CFR_BMS`→C、`CFR_CONTACTOR`→C、`CFR_PCS`→C、`CFR_COOLANT`→D。
- 屏障:`B_OFFGAS`→C、`B_AI_WARN`→D、`B_GAS_DET`→D、`B_BMS`→D、`B_THERMAL`→D、`B_DEFLAG`→C、`B_SUPPRESS`→C、`B_WATER`→C、`B_SPACING`→C、`B_RESPONSE`→D。
（每条在其对象内加 `"grade": "C"|"D"`。）

- [ ] **Step 4: 并入 ETA_claude 屏障(+33)到 `barrier_effectiveness`**

规则:对 `BARRIER_LIBRARY` 每条,**跳过** id ∈ {`warn-ai`,`warn-gas`,`pas-gas-suppression`,`pas-sprinkler`}(与我同名);其余转写为:
```jsonc
{ "id": <原 id>, "name": <原 name>, "category": <原 category>,
  "pfd": <round(1 - successProb, 6)>, "grade": <原 grade>,
  "source": { "citation": <原 citation>, "url": <原 url 若有>, "note": <原 note 若有> } }
```
示例(`sil-1`:successProb 0.9→pfd 0.1):
```json
{ "id": "sil-1", "name": "SIS 安全仪表功能(SIL 1)", "category": "active", "pfd": 0.1, "grade": "C",
  "source": { "citation": "IEC 61511; CCPS", "note": "SIL 1 PFD 区间 10⁻¹–10⁻²,取保守上限 10⁻¹" } }
```
示例(`sup-water-mist`:0.85→0.15):
```json
{ "id": "sup-water-mist", "name": "细水雾抑制系统", "category": "passive", "pfd": 0.15, "grade": "D",
  "source": { "citation": "Victoria Univ./FHMT (2021) 细水雾抑制锂离子电池火灾试验;NIOSH 锂电池组灭火剂对比试验", "note": "火焰直接可达时灭火迅速;含表面活性剂/F500 添加剂显著延迟复燃(45s,对比 CO₂ 8s、干粉 10s);0.85 为示例量级,复燃风险须专项评估" } }
```
其余 31 条同法转写(`warn-threshold`,`act-overtemp`,`act-overcurrent`,`pas-thermal-barrier`,`pas-vent`,`pas-explosion-vent`,`lopa-bpcs`,`lopa-alarm-operator`,`sil-2`,`sil-3`,`lopa-psv`,`lopa-dike`,`lopa-flame-arrester`,`nfpa-dry-chem`,`nfpa-co2`,`nfpa-foam`,`vent-sil2`,`warn-offgas-voc`,`site-cabin-separation`,`warn-high-temp`,`warn-tr-multi`,`warn-imd`,`act-main-relay`,`act-liquid-cooling-max`,`act-overcharge-protect`,`pas-cell-vent`,`pas-immersion-pack`,`warn-gas-h2`,`warn-gas-voc-early`,`sup-pack-direct`,`sup-aerosol`)。

- [ ] **Step 5: 并入 ETA_claude 器件(+10)到 `component_failure_rates`**

规则:对 `COMPONENT_LIBRARY` 每条,**跳过** id ∈ {`cell-thermal-runaway`,`bms-functional-failure`,`dc-contactor-fail-to-open`,`pcs-functional-failure`,`liquid-cooling-loss`};其余转写为:
```jsonc
{ "id": <原 id>, "name": <原 name>, "failure_mode": <原 failureMode>, "rate": <原 rate>,
  "unit": <原 unit>, "grade": <原 grade>,
  "source": { "citation": <原 citation>, "url": <原 url 若有>, "note": <原 note 若有> } }
```
示例(`cell-tr-typical`):
```json
{ "id": "cell-tr-typical", "name": "锂离子电芯(一般)", "failure_mode": "热失控", "rate": 1e-6, "unit": "/cell·yr", "grade": "C",
  "source": { "citation": "行业通用引用值(跨领域可靠性综述表 3)", "note": "低于 1×10⁻⁶/颗;综述示例事件树以 10⁴ 颗×本值构造 IE=10⁻²/舱·年" } }
```
其余 9 条同法(`cell-tr-premium`,`cell-tr-defective`,`cooling-water-loss`,`sys-insulation-fault`,`sys-bms-overcharge`,`sys-external-heat`,`pcs-field-survey`,`cell-lfp-fresh`,`cell-lfp-aged`)。`applicability` 字段可并入(可选,放对象内原样)或略去——本批**略去 applicability** 以保持 schema 简洁(YAGNI)。

- [ ] **Step 6: 跑测试 + 全量回归** — `... -m pytest tests/test_library.py -q`(PASS)+ `... -m pytest -q`(≥132 绿;scenarios 仍量化,证明现有 id/值未破)。

- [ ] **Step 7: 提交**

```bash
git add bess/reference_data.json tests/test_library.py
git commit -m "feat(bess): 参考库并入 ETA_claude 内置库(屏障10→43/器件5→15, 补 grade)"
```

## Task 2: 前端置信列 + url 链接

**Files:** Modify `frontend/src/api.ts`, `frontend/src/components/ReferenceLibrary.tsx`

- [ ] **Step 1: `api.ts` 的 `LibraryData` 加字段**

`SourceRef` 已有 `url?`。给 `barrier_effectiveness`/`component_failure_rates` 元素类型加 `grade?: 'C' | 'D'`:
```ts
component_failure_rates: { id: string; name: string; failure_mode: string; rate: number; unit: string; grade?: 'C' | 'D'; source: SourceRef }[]
barrier_effectiveness: { id: string; name: string; category: string; pfd: number; eff?: number; grade?: 'C' | 'D'; source: SourceRef }[]
```

- [ ] **Step 2: `ReferenceLibrary.tsx` 加置信列 + url 链接**

器件表表头加 `<th>置信</th>`,行加 `<td>{c.grade ?? '—'}</td>`;屏障表同样加 `置信` 列与 `{b.grade ?? '—'}`。来源单元改为:
```tsx
{c.source.url
  ? <a href={c.source.url} target="_blank" rel="noreferrer">{c.source.citation}</a>
  : c.source.citation}{c.source.note ? `(${c.source.note})` : ''}
```
（器件、屏障两表来源列都这样;初因表保持纯文本不变。）

- [ ] **Step 3: 构建 + 预览** — `npm run build --prefix frontend`;`preview_eval`:进「参考库」,屏障表 `tbody tr` ≥40、表头含「置信」、出现 `C`/`D` 文本;含 url 的条目有 `a[href]`。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api.ts frontend/src/components/ReferenceLibrary.tsx
git commit -m "feat(frontend): 参考库表加置信(grade)列 + 来源 url 链接"
```

## 收尾

- [ ] 全量回归 `... -m pytest -q`(≥135,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;`preview_eval` 参考库三表 + 置信列 + 「从库添加屏障」picker 选项变多。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(参考库扩容自 ETA_claude:屏障43/器件15 + 置信)。

## 自检(plan vs spec)

- spec 2.1 数据合并(+33 屏障/+10 器件、跳过同名、successProb→pfd、补 grade)→ Task 1。
- spec 2.2 前端置信列 + url → Task 2。
- spec 2.3 测试(计数+grade)→ Task 1 Step1。
- 类型一致:`grade∈{C,D}`、`pfd=round(1−sp,6)`、`failure_mode`(下划线,我的键名)、跳过列表与 spec 一致。
- 现有 id/值不动 → `test_existing_scenario_ids_preserved` + 全量回归把关。
- 坑:JSON 不能有注释/尾逗号;ETA_claude 的 note 内含特殊字符(×、⁻¹ 等)直接作为 JSON 字符串值(UTF-8)无需转义;applicability 本批略去。
